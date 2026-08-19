# Three.js performance benchmark

Fleet's research ocean has a repeatable production benchmark in `scripts/benchmark-threejs.mjs`. It opens local headless Chrome at a 1440 × 1000 viewport and 2× device scale factor, samples five five-second windows, and reports medians for frame cadence, WebGL work, heap, canvas resolution, and built JavaScript assets.

Run the production server before collecting results:

```bash
pnpm build
pnpm start
pnpm benchmark:threejs
FLEET_BENCHMARK_MODE=fleet pnpm benchmark:threejs
FLEET_BENCHMARK_MODE=fleet FLEET_BENCHMARK_AGENTS=1 pnpm benchmark:threejs
```

Fleet mode submits a deterministic development run in the browser, defaulting to 50 agents. Set `FLEET_BENCHMARK_AGENTS` to benchmark a smaller fleet. The benchmark-only fetch wrapper changes the profile from `live` to `development`, so it exercises the complete UI and event flow without calling external providers. It also clicks an agent target after sampling and reports whether the trace dialog opened.

## August 18, 2026 result

Both sides used the same finalized harness and five-trial protocol. The baseline was built from `main` at `0cbac59`; the optimized build was measured from this branch.

| 50-agent scene, median | Before | After | Change |
| --- | ---: | ---: | ---: |
| FPS | 120.00 | 120.00 | Held the display ceiling |
| p95 frame time | 9.1 ms | 9.0 ms | 1.1% lower |
| Draw calls per frame | 876.46 | 126.21 | 85.6% lower |
| Triangles per frame | 95,251 | 49,146 | 48.4% lower |
| JavaScript heap | 25.84 MB | 11.55 MB | 55.3% lower |
| Canvas pixels | 637,980 | 473,484 | 25.8% lower |
| Long frames over 20 ms | 0 | 0 | No regression |

The homepage hero remained at 120 FPS while triangles fell from 48,233 to 27,719 and canvas pixels fell from 3,154,932 to 2,111,472. The lazy Three.js chunk grew from 145,579 to 147,810 gzip bytes, a 1.5% cost for the geometry merge utility used to build the instanced fleet mesh.

The main gain comes from keeping the detailed single hero boat while merging and instancing the 50 live boats. Status colors and transforms update through instance buffers, route and agent identity remain separate, and the raycaster maps `instanceId` back to the existing agent trace callback.

The August 19 single-canvas morph follow-up keeps the benchmark gated on the completed transition before sampling. Across five steady-state windows it held 120 FPS, a 9.0 ms p95 frame time, zero frames over 20 ms, 126.21 draw calls per frame, and 49,146 triangles per frame. The transition therefore preserves the optimized live-scene rendering profile.

## Visual and behavior checks

- Stable homepage and completed-run frames render without black canvases, clipping, z-fighting, or transparency defects.
- The camera and canvas remain correctly proportioned at the benchmark viewport and 2× device scale factor.
- The water and boat motion remain active, while the existing reduced-motion path still freezes camera and scene drift.
- The 50-agent benchmark clicked an instanced boat and confirmed the real trace dialog opened.
- GPU cleanup still disposes the scene graph, shared texture, postprocessing composer, and renderer on unmount.
