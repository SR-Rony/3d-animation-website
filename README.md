# Glacier Study — scroll-driven 3D (Three.js + Lenis + GSAP)

An original rebuild of the technique behind award-style "one persistent 3D scene, one scroll value" sites
(the public case study for igloo.inc lists Three.js, three-mesh-bvh, Svelte, GSAP and Vite). No assets, copy or
branding from that site are used.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
```

## How the scroll works

1. **Rendering setup** – one fixed full-screen `<canvas>`, one `WebGLRenderer` (ACES tone mapping, PR capped at 2),
   one scene with exp fog. HTML sections scroll in a normal document on top of it.
2. **Animation driver** – Lenis smooths wheel/touch input and emits a 0–1 `progress` and a `velocity`.
   Lenis is ticked from `gsap.ticker`, so scroll, GSAP and rendering share one clock.
   `progress` is damped once more in the frame loop and becomes the single state value `p`.
3. **Camera path** – `p` samples a `CatmullRomCurve3` for camera position and a second curve for the look-at target.
   FOV and dome thickness are authored as bell/smoothstep curves of `p`.
4. **Scene choreography** – shards (`InstancedMesh`) explode outward between p≈0.2–0.55 and return after 0.72;
   the glow light and core pulse peak while the camera is inside the dome.
5. **Post-processing** – `EffectComposer`: `RenderPass` → `UnrealBloomPass` (strength rises with interior glow and
   scroll speed) → custom `ShaderPass` (radial chromatic aberration scaled by scroll velocity, vignette, grain) → `OutputPass`.
6. **Textures** – generated procedurally on a canvas (fractal value noise). One feeds `roughnessMap`, another `bumpMap`
   on the transmissive `MeshPhysicalMaterial` dome and ground, giving frosted, uneven ice. A small gradient equirect
   canvas acts as the environment so the glass has something to refract.
7. **Snow** – `Points` with a vertex shader that wraps particles vertically using `uTime`; no CPU updates.
8. **DOM** – an `IntersectionObserver` toggles `.on` on each chapter for fade/translate-in; HUD shows progress.
# 3d-animation-website
