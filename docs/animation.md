# Agent animation

Fleet renders each researcher as a small stateful SVG character animated with Motion for React.

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
