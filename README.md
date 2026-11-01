# Tree of Life

A browser-based 3D Tree of Life that grows like a real tree. See `CLAUDE.md` for the full brief.

**Status:** build step 1. A single organic, tapered branch grows from 4,000 Ma to today, with a million-years counter, play/pause, restart and a speed slider.

## Run it

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173). `npm run dev` also prints a network address you can open on a phone on the same Wi-Fi.

- Drag to orbit, scroll or pinch to zoom, right-drag to pan. The camera follows the growing tip again after 4 seconds without input.
- Space bar: play/pause.
- Speed slider: 0.1× to 10×. At 1×, 4 billion years take 40 seconds.

`npm run build` writes a static site to `dist/` (relative paths, ready for GitHub Pages or Netlify).

## Code layout

| File | Role |
| --- | --- |
| `src/data.js` | Tree nodes (`id`, `parentId`, `name`, `splitMa`, `species`) and eon names |
| `src/clock.js` | Growth clock in Ma; `rateAt()` is the hook for non-linear time |
| `src/tree/Branch.js` | Tapered tube along a seeded, gently bent spline; `setGrowth(0..1)` |
| `src/tree/barkTexture.js` | Procedural tileable bark colour and bump maps |
| `src/scene.js` | Renderer, sky, sun and soft shadows, ground, fog |
| `src/camera.js` | Orbit camera that follows the growing tip |
| `src/ui.js` | Counter, eon label, play/pause, restart, speed |
| `src/random.js` | Seeded random numbers, so shapes are stable per node id |
| `src/main.js` | Wires it together and runs the frame loop |
