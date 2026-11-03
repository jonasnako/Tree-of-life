# Tree of Life

A browser-based 3D Tree of Life that grows like a real tree. See `CLAUDE.md` for the full brief.

**Status:** build steps 1–6: real data, an ancient, gnarled look, foliage masses sized by species count with level of detail, and leaves coloured by conservation status. The tree is grown from a real slice of the Tree of Life: the lineages of seven showcase species (human, common octopus, English oak, fly agaric, *E. coli*, a diatom, an archaeon) with every sister clade along the way, forking on dated divergences. Pick whose lineage to follow at the top right, and the shape: **Fractal** (the default; branch length follows species count, as in OneZoom: every sub-branch is a smaller copy of the whole and leaves shrink with their twig, so you can follow the branching down to any single leaf) or **Natural** (branch length follows time, like a real tree; link with `#natural`). As each new lineage splits off, a label with a line points to its branch; the followed species ends in its own single leaf (each leaf is a species), labelled at the end. At today the camera settles close on the followed species' leaf (pull back yourself to see the whole tree), and leaves keep falling from the living crown in the colours of the threatened. Every new major lineage gets a label (with a small picture) for a few seconds as it sprouts. Point at a branch or foliage to see what it is; tap or click for a card with its picture, age, species count, threat status and, for small groups, each species. Click a label to fly to it; foliage in the way is cleared and the species' leaf glows. Wheel and pinch zoom toward the cursor; once you move the camera it stays put until you press play.

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

## Environment

The tree grows on top of a small planet (the horizon bends as you pull back), and the world around it follows Earth's climate through deep time (`src/climate.js`): the orange-hazed, still volcanic young Earth, the Huronian and Snowball Earth glaciations, the warm “boring billion”, the Ordovician and Late Paleozoic ice ages, the end-Permian hothouse desert, the Mesozoic greenhouse, the PETM heat spike, cooling after 34 Ma, the Pleistocene ice ages and the Holocene. Sky, haze, sunlight, fog and the ground (bare rock, sand, moss and grass once plants reach land around 470 Ma, snow) change with it, snow settles on the tops of branches in ice ages, and the episode is named under the eon. These are broad strokes, not a temperature record.

## Data

`public/data/tree-slice.json` is built by `node scripts/build-slice.mjs` (Node 18+, network on first run; responses are cached in `raw/cache`, which is not committed).

- **Structure and species counts:** [Open Tree of Life](https://tree.opentreeoflife.org) synthetic tree (v3 API). The path from the root to each showcase species, and every living sister clade along it collapsed to one node with its real number of tips. At each fork the 3 biggest sister clades are kept and smaller ones grouped.
- **Dates:** [TimeTree](https://timetree.org) pairwise divergence times between a showcase species and a member of the clade on the other side of each fork. The root (no TimeTree estimate across domains) uses Moody et al. 2024 (LUCA about 4.2 billion years ago), so the seed is planted at 4,350 Ma. Forks without an estimate are interpolated; `dateSource` on each node says which.
- **Species and conservation status (step 6):** tips of ten or fewer species list their species (subspecies and strains merged), each drawn as one leaf coloured by its IUCN Red List status from [Wikidata](https://www.wikidata.org) (P141, matched by scientific name): green (least concern) through yellow, orange to autumn red (critically endangered), grey-green for data deficient, plain green where not assessed. Big groups (foliage masses) carry an approximate share of threatened species from published Red List summaries (e.g. amphibians ~41%, primates ~60%, vascular plants ~39%, animals in general ~1 in 8 per IPBES 2019; the table and sources are in the script and the data file), and their leaves are coloured in those proportions. Fossil species keep a dry, dead leaf hanging on the twig, and a few dry leaves stay in the crown, as on real trees. Common names come from Wikidata too (P1843, else the English label).
- **Pictures:** small Wikimedia Commons thumbnails (via the Wikidata image, P18) in `public/data/images.json`, a separate layer keyed by node id or species name, embedded as data URIs. Each keeps its Commons file name for attribution.
- Fossil-only lineages are left out for now (step 8). A few unflagged fossil genera remain as living twigs.

## How it stays fast

The approach is demoscene-like: store little, compute the rest on the GPU.

- **Growth on the GPU.** All wood is one static mesh. Each vertex stores its centreline point, direction, full radius, depth, angle and path distance; the vertex shader derives thickness, gnarling (twisted flutes, burls), wind sway and colour from the current time. No per-frame JavaScript for wood.
- **Leaves on the GPU.** Branch centrelines are packed into one float texture (`branchTexture.js`, 3 texels per sample). Each leaf is 12 static numbers; the shader looks up its branch, places, orients, unfolds, ages and hides it. Leaf work per frame went from ~27 ms of JavaScript to under 1 ms.
- **Procedural bark.** No bark textures: warped cellular noise on the branch's own cylinder coordinates gives plates and fissures that widen with age, lichen and moss; lighting is bent by the noise's screen-space slope. Seamless and sharp at any distance.
- **Fractal foliage, detail by zoom.** Each big clade's twig carries clumps of foliage on short sprigs; each clump is made of sub-clumps covered in small leaves (twig → sprig → clump → sub-clump → leaf). Leaves take their normal from their clump, so each clump is lit as one soft, round volume and leaves point outward. 220,000 leaf points (80,000 on phones), placed and swayed on the GPU from the branch texture, so nothing floats. Each leaf decides from its own camera distance whether to draw: everything near the camera, a shuffled, larger share far away.
- **Foliage masses (step 5).** Each living clade richer than 10 species ends in a leafy sleeve whose thickness grows with the sixth root of its species count; smaller clades show one leaf per species.
- **Cheap light.** Ambient occlusion is analytic (distance from the crown's centre, height above ground); light through leaves is a view-to-sun term.

Toward 2 million species (step 8): the topology can be stored as a succinct tree (balanced parentheses, ~2 bits per node) with quantised log-dates and log-species counts (1 byte each), streamed in chunks; layout is computed from those on the fly with the same seeded rules, so the shape never needs to be stored.

## Code layout

| File | Role |
| --- | --- |
| `public/data/tree-slice.json` | Real-data slice built by `scripts/build-slice.mjs` (Open Tree of Life + TimeTree) |
| `scripts/build-slice.mjs` | Builds the slice; caches API responses in `raw/cache` |
| `src/data.js` | Loads the node file into a linked tree; eon names |
| `src/timeScale.js` | Maps Ma to "depth" along the tree (part linear, part log) and back |
| `src/clock.js` | Growth clock in real Ma; speed comes from a rate function |
| `src/tree/layout.js` | Branch centrelines: seeded bends, fork angles by species share, pipe-model radii; stand-in forks for collapsed clades |
| `src/tree/growth.js` | How wood ages: tip taper, thickening, shoot → twig → bark |
| `src/tree/treeMesh.js` | All wood as one mesh; growth, gnarling, procedural bark and AO in the shader |
| `src/tree/leafFall.js` | Falling dead leaves and leaf litter that builds up under the crown and rots away |
| `src/tree/leaves.js` | Leaves placed entirely on the GPU: shoot leaves, tip tufts, leaf sprays (more species, more foliage); seed leaves; falling-leaf events |
| `src/tree/branchTexture.js` | Branch centrelines packed into a float texture for the shaders |
| `src/scene.js` | Renderer, sky dome with sun glow, sun and shadows, ground, fog |
| `src/wind.js` | Wind sway shared by wood and leaf shaders |
| `src/camera.js` | Orbit camera that frames the growing tree, then pulls back |
| `src/ui.js` | Counter, eon, fork caption, play/pause, restart, speed |
| `src/random.js` | Seeded random numbers, so shapes are stable per node id |
| `src/main.js` | Wires it together and runs the frame loop |

Collapsed clades get a few seeded stand-in forks (more for rich clades and long lone limbs, never more tips than species) so they read as limbs with a crown. They are flagged `placeholder` and give way to real detail when the full tree streams in (step 8).
