# Agent animation

Fleet renders each researcher as a small stateful SVG character animated with Motion for React.

## Research ocean

The homepage and live conversation also render the fleet as a Three.js research ocean. The ocean is a lazy-loaded deep module with a small React interface: it receives the current run snapshot and the existing open-trace callback, then owns the WebGL scene and interaction model behind that seam.

- A vertex shader displaces the water surface while the fragment shader layers depth, crest light, and a moving scan shimmer.
- Quadratic routes place up to 50 visible boats across primary sources, history, contradictions, benchmarks, economics, and edge cases without adding a labeled map overlay.
- Planned boats remain at the orchestrator, running boats accelerate outward, overload retries turn red, and successful boats return toward the synthesis point.
- A raycaster and matching DOM targets let pointer and keyboard users open the real agent trace from a boat.
- The scene uses capped device pixel ratio, disposes all GPU resources on unmount, and stops camera/water motion when reduced motion is requested.
- The homepage keeps one detailed boat, while live runs merge the boat silhouette once and render up to 50 researchers through one `InstancedMesh`. Instance transforms, status colors, and raycast IDs preserve the existing per-agent behavior without rebuilding or traversing 50 mesh hierarchies every frame.
- Three.js is split from the main route chunk and loaded behind a dark ocean fallback so the existing research interface does not absorb the rendering runtime.

The reproducible before-and-after measurements live in [Three.js performance benchmark](./threejs-performance.md).

## Why Motion

Three current runtimes were considered:

- [Motion](https://motion.dev/docs/react-svg-animation) animates React SVG elements directly, including transforms, attributes, and coordinated keyframes. Its [reduced-motion hook](https://motion.dev/docs/react-use-reduced-motion) responds to the operating system preference.
- [Rive](https://rive.app/docs/runtimes/state-machines) provides designer-authored state machines and a high-performance vector runtime. It is a strong future option when Fleet has a canonical `.riv` character asset.
- [dotLottie React](https://docs.lottiefiles.com/en/runtimes/distributions/react) is well suited to packaged animation playback, but fifty repeated asset players would make agent-specific expressions and timing less direct.

Motion fits this interface because the character is part of the React state model. No remote animation file, canvas instance, or asset license is required. The same SVG can vary its palette, face, timing, and movement from the agent index and live status.

## Character rig

The `Bot` component is one SVG with independently animated groups:

- The rig floats and tilts while its agent is working.
- The antenna and chest core pulse on offset clocks.
- Eyes scan and blink with per-agent timing.
- Arms alternate like the robot is operating a tiny console.
- Six palettes and four face paths keep a large fleet from looking cloned.
- The shadow contracts as the body rises, giving the movement depth without 3D rendering.

Motion runs only for active agents. Planned and terminal agents render the same detailed character in a stable pose.

## Accessibility and performance

`useReducedMotion` disables the transform, limb, eye, antenna, and core loops when the user requests reduced motion. The browser test verifies both the hook state and a stable computed transform.

Every character is an inline SVG, so the browser shares the React and Motion runtimes across the whole fleet. There are no per-agent network requests. `LazyMotion` with the `domAnimation` feature set keeps unused Motion features out of the initial bundle. The interface can render 100 agents without per-agent players because each character is a lightweight vector tree and traces are bounded.
