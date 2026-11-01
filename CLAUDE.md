# Tree of Life – Project Brief

Nov 1, 2026 · @Jonas

## Vision

A browser-based 3D Tree of Life that grows like a real tree: the trunk is the origin of life, every fork is a speciation event, and every leaf is a species. It takes the idea of OneZoom but makes it organic and beautiful rather than diagrammatic.

- **Search and replay:** type a species name and watch the tree grow from the first cells to that leaf, following every branching on its lineage.
- **Deep time:** a million-years counter runs alongside the growth. Growth speed follows real time, so the trunk crawls for billions of years, then bursts of evolution (Cambrian explosion, mammal radiation after 66 Ma) make branches shoot out.
- **Living status:** leaf colour shows conservation status, from healthy green (Least Concern) to autumn red (Critically Endangered). Recently extinct species lose their leaf; long-extinct lineages end as bare twigs.
- **Scale:** at the found leaf, the camera pulls back to reveal the whole tree at that moment, so you feel how vast it is.

Start in the browser (Three.js) for easy sharing on phone and laptop. A Unity version can follow once the concept is proven.

## Core features

Version 1 proves the look and the growth on real data; everything else waits.

| Feature | Version 1 | Later |
| --- | --- | --- |
| Tree data | Real dated tree, limited to a manageable slice (see Data) | Full tree of \~2.3 million species, streamed in on demand |
| Search | Choose from a short list (human, octopus, oak, fly agaric mushroom, E. coli, a diatom, an archaeon: vertebrates, invertebrates, plants, fungi, bacteria, protists, archaea) | Free-text search over all species, with autocomplete |
| Growth replay | Root to chosen leaf, with million-years counter, play/pause and speed | Scrubbable timeline, jump to named eras |
| Context | Other clades shown as masses of foliage | Any clade expands into detail when you zoom in |
| Conservation status | Leaf colour for the chosen path and a few neighbours | Colour for every species from the IUCN Red List |
| Extinct lineages | A few famous ones (dinosaurs, trilobites) as bare branches | Fossil lineages from the Paleobiology Database |
| Camera | Follow the growing tip, then pull back to the whole tree | Free orbit, touch gestures, guided tours |
| Platforms | Laptop browser, then phone browser | Native app via Unity, if needed |

## Data

All the core data is public. The work is merging it into one compact file the browser can load. Figures below are approximate, from memory, and should be checked when the pipeline is built.

| Source | What it gives | Use |
| --- | --- | --- |
| Open Tree of Life | The branching structure of all named species (\~2.3 million tips) | Shape of the tree |
| TimeTree | Divergence dates in millions of years for tens of thousands of species | Timing of every fork, drives growth speed |
| OneZoom (open source) | Already-merged, dated tree plus popularity scores | Shortcut: may save most of the merging work |
| IUCN Red List API | Conservation status per species (needs a free API token) | Leaf colour |
| Paleobiology Database | Fossil occurrences and extinct taxa | Bare branches for extinct lineages |

**Data model.** One preprocessed file of nodes. Each node holds: id, parent id, name, date of the split (Ma), number of descendant species, and conservation status for leaves. The descendant count sets branch thickness, so big clades read as thick limbs.

**Starting slice.** Instead of hand-entering the human lineage, take a real subset: the full path to each showcase species, plus each sibling clade collapsed to one node with its species count. That is a few hundred nodes, but uses the same format as the full tree, so nothing is thrown away later.

**Layout from the full tree.** Space is allotted from true species counts from the start, even for collapsed clades. Every branch claims the room it will eventually need, so the tree keeps its shape and nothing moves when detail is loaded later. Example: insects (over a million species) get a huge limb even in the human-only mock-up.

**Extra attributes as separate layers.** The core file holds only what the tree needs to grow: id, parent, split date, species count. Everything else (climate, geographic range, images, descriptions) lives in separate files keyed by the permanent Open Tree id, loaded only when needed. Attributes can be added at any time without slowing the tree.

**Switchable views.** The tree's shape always stays the true family tree; views only change the colours. Planned: conservation status (default). Possible later: climate, geographic distribution (e.g. colour by continent, showing a lineage spreading across the world).

**Leaf looks instead of millions of pictures.** Each major group gets its own hand-designed leaf form (fronds for plants, caps for fungi, fin- or feather-like shapes for fish and birds, tiny bead-like clusters for microbes): a few dozen shapes in one texture atlas. Each species adds only a tint colour taken from its photo. Real photos load only when you zoom right in, streamed on demand from public sources like Wikimedia Commons, never stored or loaded in bulk.

**Microbes.** Named bacteria and archaea are a tiny fraction of real microbial diversity, so sizing by named species makes them look far too small. Consider genome-based data (GTDB) for their part of the tree, and show the uncertain, gene-swapping base of the tree as misty and tangled.

## Storage and size

No database server is needed: the data is read-only, so it is served as static files. All sizes below are rough estimates.

| Data | Approx. size | Where it lives |
| --- | --- | --- |
| Mock-up slice (a few hundred nodes) | A few KB | Project folder, `public/data` |
| Full skeleton (\~2 million species plus forks) | 50–80 MB, \~20–30 MB compressed | Static hosting, split into chunks |
| Species names for search | \~15–20 MB compressed | Separate search file |
| Raw downloads (Open Tree, TimeTree, IUCN) | Hundreds of MB to a few GB | Laptop only, `raw/` folder, never online |

- **Project folders:** `raw/` for downloads, a `scripts/` folder that turns them into the lean files in `public/data`.
- **Hosting:** GitHub Pages or Netlify (free) while the data is small; cheap object storage such as Cloudflare R2 once the full tree is added.
- **Phones:** the full skeleton is too big to load at once, so later versions load only the chunk of tree in view. Layout is precomputed by a script, not in the browser.

## Rendering

Build with Three.js and Vite. Aesthetic: expressive, organic and nature-like, a middle ground between painterly and realistic, not photorealism. The grown tree should feel old and mighty, with rough, deeply textured bark. Living lineages end in twigs dense with fresh, vivid green leaves full of life; old or extinct parts look weathered, dry and dead. Light carries the mood: warm sunlight, soft shadows, light filtering through the foliage, gentle glow on fresh leaves.

- **Branch geometry:** each branch is a tapered tube along a gently curved spline, with small random bends so it looks grown, not drawn. Thickness follows descendant count, like the pipe model of real trees.
- **Layout:** fork angles and directions are procedural but deterministic (seeded by node id), so the same tree grows the same way every time. Branches spread to fill space and avoid crossing.
- **Growth:** a global clock in millions of years. Each branch starts growing at its split date and lengthens until its children split. Time runs on a non-linear scale, slowing over empty stretches and speeding through bursts, with the counter always showing real Ma.
- **Bark and leaves:** a bark texture with normal map on branches; leaves as instanced textured cards, coloured by conservation status.
- **Keeping it cheap (level of detail):** only the searched lineage and nearby branches are full geometry. Every other clade is a foliage cluster whose size reflects its species count. From far away, clusters become flat billboard images. Target: smooth on a mid-range laptop, acceptable on a phone.
- **Atmosphere:** soft sky light, gentle wind sway, light fog for depth.
- **Camera:** follows the growing tip during replay, then pulls back smoothly to the whole tree; free orbit and touch zoom otherwise.

## Build order

Each step ends with something you can see in the browser.

1. **One growing branch:** a single tapered branch that grows over time, with the million-years counter.
2. **A small tree from a hand-made file:** 20–30 nodes along the human lineage, forking and growing on the real dates.
3. **The look:** bark, leaves, light, wind, camera that follows the tip and pulls back.
4. **Real data slice:** script that builds the data file from OneZoom / Open Tree / TimeTree for a few showcase species and their collapsed neighbours.
5. **Foliage clusters:** sibling clades shown as masses sized by species count, with level of detail.
6. **Search and status:** pick a species, replay its growth, leaves coloured by conservation status.
7. **Phone:** touch controls, performance tuning, put it online (GitHub Pages or Netlify).
8. **Scale up:** stream the full tree in chunks; add fossil lineages.

## First prompt for Claude Code

Save this whole brief as `CLAUDE.md` in the project folder (Claude Code reads it automatically), then start with:

```
Read CLAUDE.md. Set up a Three.js project with Vite. Build step 1 of the build order: a single organic, tapered 3D branch that grows over time, with a million-years counter on screen counting from 4,000 Ma to today. Add play/pause and a speed slider. Use soft natural lighting and a camera I can orbit. Keep the code split into small modules (data, tree geometry, growth clock, camera, UI) so we can grow it step by step. Then tell me how to run it in my browser.
```

After each step: check it in the browser, tell Claude Code what to change, then move to the next step.
