import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import Lenis from 'lenis';
import gsap from 'gsap';

/* ------------------------------------------------------------------ *
 * 1. Renderer / scene / camera
 * ------------------------------------------------------------------ */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04101c);
scene.fog = new THREE.FogExp2(0x04101c, 0.035);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);

/* ------------------------------------------------------------------ *
 * 2. Procedural textures (roughness + bump + env gradient)
 * ------------------------------------------------------------------ */
function noiseCanvas(size, scale, seed = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const hash = (x, y) => {
    let h = x * 374761393 + y * 668265263 + seed * 1442695041;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  };
  const smooth = t => t * t * (3 - 2 * t);
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c2 = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c2 - a) * yf + (a - b - c2 + d) * xf * yf;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, f = scale;
      for (let o = 0; o < 5; o++) {
        v += vnoise((x / size) * f, (y / size) * f) * amp;
        amp *= 0.5; f *= 2;
      }
      const i = (y * size + x) * 4;
      const b = Math.max(0, Math.min(255, v * 255 * 1.3));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const roughMap = noiseCanvas(256, 6, 3);
const bumpMap = noiseCanvas(256, 10, 7);

// Gradient equirect used as environment so the glass has something to refract/reflect
function envTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#9fe3ff');
  grd.addColorStop(0.45, '#2a6c9a');
  grd.addColorStop(0.55, '#0b2438');
  grd.addColorStop(1, '#020a12');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,255,255,.9)';
  for (let i = 0; i < 6; i++) g.fillRect(40 + i * 80, 60 + (i % 2) * 20, 30, 6);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const envTex = envTexture();
scene.environment = envTex;

/* ------------------------------------------------------------------ *
 * 3. Lights
 * ------------------------------------------------------------------ */
scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x061a2a, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(5, 8, 4);
scene.add(key);
const glow = new THREE.PointLight(0x58c8ff, 0, 18, 2);
glow.position.set(0, 0.6, 0);
scene.add(glow);

/* ------------------------------------------------------------------ *
 * 4. Hero dome (transmissive glass) + ground + core
 * ------------------------------------------------------------------ */
const domeMat = new THREE.MeshPhysicalMaterial({
  color: 0xdff4ff,
  transmission: 1,
  thickness: 1.4,
  ior: 1.31,
  roughness: 0.35,
  roughnessMap: roughMap,
  bumpMap,
  bumpScale: 2.2,
  dispersion: 0.6,
  envMapIntensity: 1.4,
  clearcoat: 1,
  clearcoatRoughness: 0.2,
  attenuationColor: new THREE.Color(0x7fd0ff),
  attenuationDistance: 3,
});
const dome = new THREE.Mesh(new THREE.SphereGeometry(2.2, 96, 64, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
scene.add(dome);

const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.55, 2),
  new THREE.MeshStandardMaterial({ color: 0x8be4ff, emissive: 0x2fb4ff, emissiveIntensity: 2.2, roughness: 0.3, flatShading: true })
);
core.position.y = 0.7;
scene.add(core);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(40, 64),
  new THREE.MeshStandardMaterial({ color: 0x0c2a42, roughness: 0.55, metalness: 0.1, roughnessMap: roughMap, bumpMap, bumpScale: 1.2 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
roughMap.repeat.set(8, 8); bumpMap.repeat.set(8, 8);

/* ------------------------------------------------------------------ *
 * 5. Shards (InstancedMesh) -- explode/return driven by scroll
 * ------------------------------------------------------------------ */
const SHARDS = 140;
const shardGeo = new THREE.TetrahedronGeometry(0.28, 0);
const shardMat = new THREE.MeshPhysicalMaterial({
  color: 0xbfeaff, transmission: 0.9, thickness: 0.6, roughness: 0.15, ior: 1.31, envMapIntensity: 1.6, flatShading: true,
});
const shards = new THREE.InstancedMesh(shardGeo, shardMat, SHARDS);
const base = [];
const rand = (a, b) => a + Math.random() * (b - a);
for (let i = 0; i < SHARDS; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(rand(0.05, 1));
  const r = 2.15;
  base.push({
    pos: new THREE.Vector3(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)),
    dir: new THREE.Vector3(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize(),
    dist: rand(2, 9),
    spin: new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2)),
    scale: rand(0.4, 1.5),
  });
}
scene.add(shards);
const dummy = new THREE.Object3D();
const q = new THREE.Quaternion(), e = new THREE.Euler();

/* ------------------------------------------------------------------ *
 * 6. Snow (Points + shader)
 * ------------------------------------------------------------------ */
const SNOW = 2500;
const sPos = new Float32Array(SNOW * 3), sSeed = new Float32Array(SNOW);
for (let i = 0; i < SNOW; i++) {
  sPos[i * 3] = rand(-25, 25); sPos[i * 3 + 1] = rand(0, 18); sPos[i * 3 + 2] = rand(-25, 25);
  sSeed[i] = Math.random();
}
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
snowGeo.setAttribute('seed', new THREE.BufferAttribute(sSeed, 1));
const snowMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
  vertexShader: /* glsl */`
    uniform float uTime; uniform float uPx; attribute float seed; varying float vA;
    void main(){
      vec3 p = position;
      p.y = mod(p.y - uTime * (0.6 + seed * 0.9), 18.0);
      p.x += sin(uTime * 0.4 + seed * 40.0) * 0.6;
      p.z += cos(uTime * 0.3 + seed * 30.0) * 0.6;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = (2.0 + seed * 3.0) * uPx * (22.0 / -mv.z);
      vA = 0.35 + seed * 0.5;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying float vA;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d) * vA;
      gl_FragColor = vec4(vec3(0.85, 0.95, 1.0), a);
    }`,
});
scene.add(new THREE.Points(snowGeo, snowMat));

/* ------------------------------------------------------------------ *
 * 7. Camera path (CatmullRom) + look-at path
 * ------------------------------------------------------------------ */
const camPath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 1.8, 11),
  new THREE.Vector3(6, 2.4, 7),
  new THREE.Vector3(5, 1.2, 0.5),
  new THREE.Vector3(0.8, 1.0, 1.6),   // inside the dome
  new THREE.Vector3(-5, 3.5, 6),
  new THREE.Vector3(0, 8, 13),
], false, 'catmullrom', 0.5);
const lookPath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 1.2, 0),
  new THREE.Vector3(0, 1.2, 0),
  new THREE.Vector3(0, 1.0, 0),
  new THREE.Vector3(0, 0.7, 0),
  new THREE.Vector3(0, 1.4, 0),
  new THREE.Vector3(0, 1.5, 0),
]);

/* ------------------------------------------------------------------ *
 * 8. Post-processing: bloom + velocity-driven chromatic aberration
 * ------------------------------------------------------------------ */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.7, 0.85);
composer.addPass(bloom);
const chroma = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAmt: { value: 0 }, uTime: { value: 0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uAmt; uniform float uTime; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      vec2 off = c * (uAmt * (0.4 + d * 2.0));
      float r = texture2D(tDiffuse, vUv + off).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - off).b;
      vec3 col = vec3(r, g, b);
      col *= 1.0 - smoothstep(0.25, 0.85, d) * 0.55;               // vignette
      col += (fract(sin(dot(vUv * 800.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.02; // grain
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(chroma);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------ *
 * 9. Scroll driver: Lenis -> normalised progress -> GSAP-smoothed state
 * ------------------------------------------------------------------ */
const lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
const state = { p: 0, v: 0, explode: 0, glow: 0 };
let target = 0;

lenis.on('scroll', ({ progress, velocity }) => {
  target = progress;
  gsap.to(state, { v: THREE.MathUtils.clamp(velocity / 40, -1, 1), duration: 0.25, overwrite: 'auto' });
});
gsap.ticker.add(t => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);

const pctEl = document.getElementById('pct');
const barEl = document.getElementById('bar');
const chapters = [...document.querySelectorAll('.chapter')];
const io = new IntersectionObserver(es => es.forEach(en => en.target.classList.toggle('on', en.isIntersecting)), { threshold: 0.35 });
chapters.forEach(c => io.observe(c));

const bell = (x, a, b) => Math.max(0, Math.min(1, 1 - Math.abs((x - (a + b) / 2) / ((b - a) / 2))));
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ *
 * 10. Frame loop
 * ------------------------------------------------------------------ */
const clock = new THREE.Clock();
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

function frame() {
  const t = clock.getElapsedTime();
  state.p += (target - state.p) * 0.08;      // extra smoothing on top of Lenis
  const p = state.p;

  camPath.getPoint(p, camPos);
  lookPath.getPoint(p, camLook);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  camera.fov = 45 + bell(p, 0.5, 0.85) * 12;  // slight fov push inside the dome
  camera.updateProjectionMatrix();

  // dome fades/opens as camera moves in; glow rises in the interior chapter
  const inside = bell(p, 0.5, 0.82);
  domeMat.thickness = 1.4 - inside * 0.9;
  glow.intensity = inside * 18;
  bloom.strength = 0.45 + inside * 0.9 + Math.abs(state.v) * 0.8;

  // shard explode curve: out between 0.25 and 0.6, back between 0.75 and 1
  const ex = smooth(0.2, 0.55, p) * (1 - smooth(0.72, 1.0, p));
  for (let i = 0; i < SHARDS; i++) {
    const b = base[i];
    dummy.position.copy(b.pos).addScaledVector(b.dir, b.dist * ex);
    dummy.position.y += Math.sin(t * 0.6 + i) * 0.08 * ex;
    e.set(b.spin.x * (ex * 3 + t * 0.1), b.spin.y * (ex * 3 + t * 0.1), b.spin.z * ex * 3);
    q.setFromEuler(e);
    dummy.quaternion.copy(q);
    dummy.scale.setScalar(b.scale * (0.6 + ex * 0.8));
    dummy.updateMatrix();
    shards.setMatrixAt(i, dummy.matrix);
  }
  shards.instanceMatrix.needsUpdate = true;

  core.rotation.y = t * 0.5; core.rotation.x = t * 0.2;
  core.scale.setScalar(1 + inside * 0.6 + Math.sin(t * 2) * 0.03);
  dome.rotation.y = p * 1.2;

  snowMat.uniforms.uTime.value = t;
  chroma.uniforms.uAmt.value = 0.0015 + Math.abs(state.v) * 0.02;
  chroma.uniforms.uTime.value = t;

  pctEl.textContent = String(Math.round(p * 100)).padStart(3, '0');
  barEl.style.transform = `scaleX(${p})`;

  composer.render();
}
gsap.ticker.add(frame);

/* ------------------------------------------------------------------ *
 * 11. Resize
 * ------------------------------------------------------------------ */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});
