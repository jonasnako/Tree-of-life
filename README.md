# Tree of Life

A browser-based 3D Tree of Life that grows like a real tree. See `CLAUDE.md` for the full brief.

**Status:** build step 3 (the look). Earlier: step 2. A tree grows from a seedling (two seed leaves) to today, forking on the real (approximate) dates of the human lineage from `public/data/tree-human.json`. Young shoots are slim, green and leafy; wood thickens and turns to bark as it ages. A caption names each fork on the human lineage.

Step 3 adds the look: veined leaves that glow when backlit, deeper bark on old wood that weathers grey and gathers moss near the ground, gentle wind (young wood bends more than old), a sky with a warm sun, and a camera that follows the human tip with a slow orbit, then pulls back to the whole tree with a label on the human leaf.

## Run it

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173). `npm run dev` also prints a network address you can open on a phone on the same Wi-Fi.

- Drag to orbit, scroll or pinch to zoom, right-drag to pan. The camera follows the growing tip again after 4 seconds without input.
- Space bar: play/pause.
- Speed slider: 0.1× to 10×. At 1×, seed to today takes 60 seconds; the counter races through the early eons and slows for recent forks.
- Time slider: drag (or use the arrow keys) to move through time; it pauses while you drag and carries on playing after. Its scale matches the growth pace, and ticks mark the forks on the human lineage.
- Console: `treeOfLife.clock.ma = 600` jumps to 600 Ma.
- The camera follows the human lineage's growing tip and slowly circles; at today it pulls back to the whole tree.

`npm run build` writes a static site to `dist/` (relative paths, ready for GitHub Pages or Netlify).

## Code layout

| File | Role |
| --- | --- |
| `public/data/tree-human.json` | Hand-made slice: the human lineage, sister clades collapsed with species counts |
| `src/data.js` | Loads the node file into a linked tree; eon names |
| `src/timeScale.js` | Maps Ma to "depth" along the tree (part linear, part log) and back |
| `src/clock.js` | Growth clock in real Ma; speed comes from a rate function |
| `src/tree/layout.js` | Branch centrelines: seeded bends, fork angles by species share, pipe-model radii; stand-in forks for collapsed clades |
| `src/tree/growth.js` | How wood ages: tip taper, thickening, shoot → twig → bark |
| `src/tree/treeMesh.js` | All branches as one mesh; growth and bark run in the shader |
| `src/tree/leaves.js` | Instanced veined leaves on young shoots, tip tufts, seed leaves; wind and backlight in the shader |
| `src/tree/barkTexture.js` | Procedural tileable bark colour and bump maps |
| `src/scene.js` | Renderer, sky dome with sun glow, sun and shadows, ground, fog |
| `src/wind.js` | Wind sway shared by wood and leaf shaders |
| `src/camera.js` | Orbit camera that frames the growing tree, then pulls back |
| `src/ui.js` | Counter, eon, fork caption, play/pause, restart, speed |
| `src/random.js` | Seeded random numbers, so shapes are stable per node id |
| `src/main.js` | Wires it together and runs the frame loop |

Collapsed clades (e.g. insects) get a few seeded stand-in forks so they read as limbs with a crown. They are flagged `placeholder` and will be replaced by real data in step 4.
