// The Tree of Life grown from real data (Open Tree of Life + TimeTree):
// the lineages of a few showcase species, forking on their real dates.
// It starts as a seedling with two seed leaves; young shoots are green and
// leafy; wood thickens, barks and gnarls as it ages; dead leaves fall and
// build up as litter under the crown.
import * as THREE from 'three';
import { loadTree, setFocus, TIME_END_MA } from './data.js';
import { GrowthClock } from './clock.js';
import { depthAt, depthPerMa, setOrigin } from './timeScale.js';
import { createScene, handleResize, applyClimate } from './scene.js';
import { climateAt } from './climate.js';
import { createCamera } from './camera.js';
import { createUI, formatMa } from './ui.js';
import { createCallouts } from './callouts.js';
import { addPlaceholderForks, layoutTree, locate } from './tree/layout.js';
import { createTreeMesh } from './tree/treeMesh.js';
import { thicknessAt } from './tree/growth.js';
import { createLeaves, leafLight, STATUS } from './tree/leaves.js';
import { createBranchTexture } from './tree/branchTexture.js';
import { createLeafFall } from './tree/leafFall.js';
import { createFoliageDust } from './tree/foliageDust.js';
import { windUniforms, windSway } from './wind.js';
import { imageFor, speciesImage } from './images.js';
import { createPicker } from './picker.js';
import { threatOf } from './tree/status.js';

const RUN_SECONDS = 60; // seed to today at 1×

const canvas = document.getElementById('scene');
const world = createScene(canvas);
const { renderer, scene, sun, sky } = world;
const { camera, controls, update: updateCamera, flyTo, release: releaseCamera } = createCamera(canvas);
handleResize(renderer, camera);

// Data -> layout -> meshes. The shape can be rebuilt in another mode
// (natural or fractal, see layout.js); the data stays the same.
const tree = loadTree();
setOrigin(tree.originMa);
addPlaceholderForks(tree);
let mode = location.hash === '#natural' ? 'natural' : 'fractal'; // fractal is the default
let branches, treeMesh, branchTex, leaves, leafFall, dust;
// Tiny-leaf budget: fewer on small screens (phones).
const SMALL_SCREEN = Math.min(window.innerWidth, window.innerHeight) < 600;
const DUST_BUDGET = SMALL_SCREEN ? { budget: 80000 } : { budget: 220000 };
function build() {
  for (const part of [treeMesh?.mesh, leaves?.group, leafFall?.group, dust?.mesh]) {
    if (!part) continue;
    scene.remove(part);
    part.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
  branchTex?.texture.dispose();
  branches = layoutTree(tree, { mode });
  treeMesh = createTreeMesh(branches);
  branchTex = createBranchTexture(branches);
  leaves = createLeaves(branches, branchTex);
  leafFall = createLeafFall(branches);
  dust = createFoliageDust(branches, branchTex, DUST_BUDGET);
  scene.add(treeMesh.mesh, leaves.group, leafFall.group, dust.mesh);
}
build();

// Depth grows at a steady visual pace; the counter shows real Ma.
const clock = new GrowthClock({
  startMa: tree.originMa,
  endMa: TIME_END_MA,
  rateAt: (ma) => 1 / RUN_SECONDS / depthPerMa(ma),
});

// Forks on the followed lineage: each new sister lineage gets a callout
// pointing at its branch, and a tick on the timeline.
const displayName = (n) => n.common ?? n.name;
const statusLabel = Object.fromEntries(STATUS.map((s) => [s.code, s.label]));
/** "2 species · 2 critically endangered" style summary of a lineage's listed species. */
function statusSummary(n) {
  if (!n.leaves) return '';
  const counts = {};
  for (const l of n.leaves) if (['VU', 'EN', 'CR'].includes(l.status)) counts[l.status] = (counts[l.status] ?? 0) + 1;
  return ['CR', 'EN', 'VU'].filter((c) => counts[c]).map((c) => ` · ${counts[c]} ${statusLabel[c].toLowerCase()}`).join('');
}
const speciesFmt = new Intl.NumberFormat('en-US');
function lineageEvents() {
  const events = [];
  for (let i = 1; i < tree.lineage.length; i++) {
    const node = tree.lineage[i];
    const sisters = node.parentNode.children.filter((c) => c !== node && !c.placeholder).sort((a, b) => b.species - a.species);
    if (!sisters.length) continue;
    events.push({ ma: node.splitMa, sister: sisters[0], others: sisters.length - 1 });
  }
  return events;
}
const SHOWN_FORKS = 3; // the most recent forks keep their callouts
// Major shoots: named lineages worth a label when they sprout.
const SHOOT_SECONDS = 5;
const shoots = new Map(); // id -> { node, time }
let majorShoots = [];
function collectShoots() {
  majorShoots = [...tree.byId.values()]
    .filter((n) => n.parentNode && !n.placeholder && !n.grouped && (n.species >= 30 || n.common || n.leaves))
    .sort((a, b) => b.splitMa - a.splitMa);
}
collectShoots();
let shootMa = Infinity;
function watchShoots() {
  // Shoots whose split we just passed while playing forward.
  if (clock.ma < shootMa && shootMa - clock.ma < 400) {
    const t = performance.now() / 1000;
    const fresh = majorShoots.filter((n) => n.splitMa < shootMa && n.splitMa >= clock.ma && !tree.lineage.includes(n));
    fresh.sort((a, b) => b.species - a.species);
    for (const n of fresh.slice(0, 3)) shoots.set(n.id, { node: n, time: t });
    // Keep the four most recent.
    while (shoots.size > 4) shoots.delete(shoots.keys().next().value);
  } else if (clock.ma > shootMa) shoots.clear(); // time went back
  shootMa = clock.ma;
}
// Clicking a label flies to the branch or leaf it points at.
const flyDistance = (c) => (c.kind === 'focus' ? 0.25 + 0.5 * (tree.focus.branch.leafScale ?? 1) : mode === 'fractal' ? 0.5 + 2 * (c.scale ?? 1) : 3.5);
const callouts = createCallouts({
  onPick: (c) => {
    flyTo(c.track ?? c.anchor, flyDistance(c));
    if (c.node) showInfo(c.node);
  },
});
const nowDepth = () => depthAt(clock.ma);
const anchor = new THREE.Vector3();
const sway = new THREE.Vector3();
const radialV = new THREE.Vector3();
const leafY = new THREE.Vector3();
const revealAt = new THREE.Vector3();
function updateCallouts(now) {
  const list = [];
  // At today only the followed species keeps its label.
  const past = clock.finished ? [] : ui.events.filter((e) => e.ma >= clock.ma).slice(-SHOWN_FORKS);
  past.forEach((e, k) => {
    const br = e.sister.branch;
    const d0 = br.depths[0];
    const d1 = br.depths.at(-1);
    // Point partway along the new branch (never past its growing tip), or at
    // the leaves themselves when the lineage is a few listed species.
    const at = e.sister.leaves ? 1 : 0.45;
    const depth = Math.min(now, d0 + (d1 - d0) * at, d1);
    pointAt(br, Math.max(d0, depth), anchor);
    anchor.add(windSway(anchor, now - depth, sway)); // move with the wind, as the wood does
    const fresh = Math.min(1, (now - d0) / 0.004);
    const sci = e.sister.common ? `${e.sister.name} · ` : '';
    const sub = `${sci}${formatMa(e.ma)} Ma · ${speciesFmt.format(e.sister.species)} species${statusSummary(e.sister)}${e.others ? ` · +${e.others} more` : ''}`;
    const track = () => {
      const n = nowDepth();
      const d = Math.max(d0, Math.min(n, d0 + (d1 - d0) * at, d1));
      const p = pointAt(br, d, new THREE.Vector3());
      return p.add(windSway(p, n - d, new THREE.Vector3()));
    };
    list.push({
      key: e.sister.id,
      title: displayName(e.sister),
      sub,
      img: imageFor(e.sister)?.src,
      node: e.sister,
      anchor: anchor.clone(),
      track,
      scale: br.leafScale ?? 1,
      alpha: fresh * [0.55, 0.75, 1][k + SHOWN_FORKS - past.length],
    });
  });
  // Every new major shoot anywhere in the tree gets a label for a while.
  if (!clock.finished) {
    const shown = new Set(list.map((c) => c.key));
    const t = performance.now() / 1000;
    for (const [id, born] of shoots) {
      const age = t - born.time;
      if (age > SHOOT_SECONDS || shown.has(id)) {
        if (age > SHOOT_SECONDS) shoots.delete(id);
        continue;
      }
      const node = born.node;
      const br = node.branch;
      const d0 = br.depths[0];
      const d1 = br.depths.at(-1);
      const track = () => {
        const n = nowDepth();
        const d = Math.max(d0, Math.min(n, d0 + (d1 - d0) * 0.6, d1));
        const p = pointAt(br, d, new THREE.Vector3());
        return p.add(windSway(p, n - d, new THREE.Vector3()));
      };
      const fade = Math.min(1, age / 0.4) * (1 - THREE.MathUtils.smoothstep(age, SHOOT_SECONDS - 1, SHOOT_SECONDS));
      list.push({
        key: id,
        title: displayName(node),
        sub: `${formatMa(node.splitMa)} Ma · ${speciesFmt.format(node.species)} species`,
        img: imageFor(node)?.src,
        node,
        anchor: track(),
        track,
        scale: br.leafScale ?? 1,
        alpha: 0.85 * fade,
      });
    }
  }
  // The followed species: the middle of its own single leaf at the tip of
  // its twig (same placement as the leaf shader).
  if (clock.ma <= tree.focus.splitMa) {
    leafCentre(tree.focus.branch, now, anchor);
    const br = tree.focus.branch;
    const status = tree.focus.leaves?.[0]?.status;
    const sub = status ? `${tree.focus.name} · ${statusLabel[status]}` : `${tree.focus.name} · not assessed`;
    list.push({
      key: 'focus',
      kind: 'focus',
      title: tree.focusLabel,
      sub,
      img: imageFor(tree.focus)?.src,
      node: tree.focus,
      anchor: anchor.clone(),
      track: () => leafCentre(br, nowDepth(), new THREE.Vector3()),
    });
  }
  callouts.update(list, camera, sphere.center);
}
function leafCentre(br, now, out) {
  const d0 = br.depths[0];
  const d1 = br.depths.at(-1);
  const depth = Math.min(now, d1) - 0.0003 * Math.min(1, (d1 - d0) / 0.03);
  const { i, t } = locate(br, depth);
  out.lerpVectors(br.points[i], br.points[i + 1], t);
  const age = now - depth;
  const open = Math.min(1, Math.max(0, (now - d0) / 0.008));
  radialV.copy(br.normals[i]); // the single leaf sits at angle 0
  out.addScaledVector(radialV, br.radii[i] * thicknessAt(age) * 0.9);
  const tilt = 0.12 * open;
  leafY.copy(br.tangents[i]).multiplyScalar(Math.cos(tilt)).addScaledVector(radialV, Math.sin(tilt)).normalize();
  const size = 0.26 * (br.leafScale ?? 1) * (0.25 + 0.75 * open);
  out.add(windSway(out, age, sway)).addScaledVector(leafY, size * 0.5);
  return out;
}
const ui = createUI(clock, lineageEvents());

// ---- What is this? Hover for a name, tap or click for a card.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tooltip = document.getElementById('tooltip');
const info = document.getElementById('info');
let infoNode = null;
function showInfo(node) {
  infoNode = node;
  const img = imageFor(node);
  const sci = node.common ? `<div class="info-sci">${esc(node.name)}</div>` : '';
  const facts = [
    node.parentNode ? `Split off ${formatMa(node.splitMa)} million years ago` : `The first life, ${formatMa(tree.originMa)} million years ago`,
    `${speciesFmt.format(node.species)} species${node.leaves || node.species < 2 ? '' : ' (named, living)'}`,
  ];
  let threat = '';
  if (node.leaves?.length) {
    threat =
      '<ul class="info-species">' +
      node.leaves
        .map((l) => {
          const st = l.extinct ? STATUS.find((x) => x.code === 'EX') : STATUS.find((x) => x.code === l.status);
          const pic = speciesImage(l.name);
          return `<li>${pic ? `<img src="${pic.src}" alt="">` : '<span class="info-noimg"></span>'}<span><b>${esc(l.common ?? l.name)}</b>${l.common ? ` <i>${esc(l.name)}</i>` : ''}<br><small><i class="info-leaf" style="background:${st?.color ?? '#79c043'}"></i>${esc(l.extinct ? 'Fossil species' : st ? st.label : 'Not assessed')}</small></span></li>`;
        })
        .join('') +
      '</ul>';
  } else {
    const share = threatOf(node);
    if (share != null) threat = `<p class="info-threat">About <b>${Math.round(share * 100)}%</b> of its species are threatened (estimate from Red List summaries).</p>`;
  }
  info.innerHTML = `
    <button class="info-close" type="button" aria-label="Close">×</button>
    <div class="info-head">${img ? `<img src="${img.src}" alt="">` : ''}<div><h2>${esc(displayName(node))}</h2>${sci}</div></div>
    <p class="info-facts">${facts.map(esc).join('<br>')}</p>
    ${threat}
    <div class="info-actions"><button class="info-fly" type="button">Fly here</button>${img ? '<span class="info-credit">Image: Wikimedia Commons</span>' : ''}</div>`;
  info.hidden = false;
  info.querySelector('.info-close').addEventListener('click', () => (info.hidden = true));
  info.querySelector('.info-fly').addEventListener('click', () => {
    const br = node.branch;
    if (node === tree.focus) flyTo(() => leafCentre(br, nowDepth(), new THREE.Vector3()), flyDistance({ kind: 'focus' }));
    else flyTo(() => pointAt(br, Math.min(nowDepth(), br.depths.at(-1)), new THREE.Vector3()), mode === 'fractal' ? 0.6 + 2.5 * (br.leafScale ?? 1) : 3.5);
  });
}
createPicker({
  canvas,
  camera,
  getState: () => ({ branches, masses: dust.masses, now: nowDepth() }),
  onHover: (hit, x, y) => {
    if (!hit) {
      tooltip.hidden = true;
      canvas.style.cursor = '';
      return;
    }
    canvas.style.cursor = 'pointer';
    tooltip.innerHTML = `<b>${esc(displayName(hit.node))}</b><span>${esc(speciesFmt.format(hit.node.species))} species · tap for more</span>`;
    tooltip.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 14)}px)`;
    tooltip.hidden = false;
  },
  onPick: (hit) => {
    tooltip.hidden = true;
    if (hit) showInfo(hit.node);
    else info.hidden = true;
  },
});
// Playback hands the camera back to the automatic framing.
clock.onChange(() => { if (clock.playing) releaseCamera(); });
document.getElementById('restart').addEventListener('click', releaseCamera);

// Legend for leaf colours.
document.getElementById('legend').innerHTML =
  '<span class="legend-title">Leaf colour · IUCN Red List · big groups estimated</span>' +
  STATUS.map((st) => `<span class="legend-item" title="${st.label}"><i style="background:${st.color}"></i>${st.code === 'EX' ? 'Fossil' : st.code}</span>`).join('');

// Shape mode: natural (time sets branch length) or fractal (species do).
const modeButtons = document.querySelectorAll('[data-mode]');
function setMode(next) {
  mode = next;
  modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  history.replaceState(null, '', mode === 'natural' ? '#natural' : location.pathname + location.search);
}
modeButtons.forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.mode === mode) return;
    setMode(b.dataset.mode);
    build();
    releaseCamera();
  }),
);
setMode(mode);

// Pick whose lineage to follow; the replay starts again from the seed.
const focusSelect = document.getElementById('focus');
for (const s of tree.showcase) focusSelect.add(new Option(s.label, s.key, false, s.node === tree.focus));
focusSelect.addEventListener('change', () => {
  setFocus(tree, focusSelect.value);
  ui.setEvents(lineageEvents());
  shoots.clear();
  releaseCamera();
  clock.restart();
});

// Framing helpers.
const tip = new THREE.Vector3();
const box = new THREE.Box3();
const sphere = new THREE.Sphere();
const tmp = new THREE.Vector3();
function pointAt(branch, depth, out) {
  const { i, t } = locate(branch, depth);
  return out.lerpVectors(branch.points[i], branch.points[i + 1], t);
}
function frameTree(now) {
  box.makeEmpty();
  box.expandByPoint(tmp.set(0, 0, 0));
  for (const br of branches) {
    if (br.depths[0] > now) continue;
    box.expandByPoint(pointAt(br, Math.min(now, br.depths.at(-1)), tmp));
  }
  box.getBoundingSphere(sphere);
  sphere.radius = Math.max(sphere.radius, 0.25) + 0.35; // room for leaves
  const lineageNode = tree.lineage.findLast((n) => n.branch.depths[0] <= now) ?? tree.root;
  pointAt(lineageNode.branch, now, tip);
}

// Keep sun shadows sharp by fitting the shadow box to the tree.
const sunDir = sun.position.clone().normalize();
function fitShadows() {
  const r = sphere.radius + 1;
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -r;
  cam.right = cam.top = r;
  cam.near = 0.1;
  cam.far = r * 4 + 40;
  cam.updateProjectionMatrix();
  sun.target.position.copy(sphere.center);
  sun.position.copy(sphere.center).addScaledVector(sunDir, r * 2 + 20);
}

const climateEl = document.getElementById('climate');
let climateName = '';
const upView = new THREE.Vector3();
const focusLeaf = new THREE.Vector3();
let lastTime = null;
function frame(time) {
  // Clamp so a background tab or a slow frame never jumps (or reverses) time.
  const dt = lastTime === null ? 0 : Math.min(Math.max((time - lastTime) / 1000, 0), 0.1);
  lastTime = time;

  clock.update(dt);
  const now = depthAt(clock.ma);
  treeMesh.setDepth(now);
  leaves.update(now, dt);
  leafFall.update(dt, now, leaves.dying);

  windUniforms.uTime.value = time / 1000;
  world.env.uTime.value = time / 1000;

  // Climate of the time: sky, light, ground, snow on the branches.
  const climate = climateAt(clock.ma);
  applyClimate(world, climate);
  if (climate.name !== climateName) climateEl.textContent = climateName = climate.name;

  frameTree(now);
  fitShadows();
  if (clock.finished) leafCentre(tree.focus.branch, now, focusLeaf);
  updateCamera(dt, {
    center: sphere.center,
    radius: sphere.radius,
    tip,
    finished: clock.finished,
    leaf: focusLeaf,
    leafDistance: 0.5 + 1.0 * (tree.focus.branch.leafScale ?? 1),
  });
  const dist = camera.position.distanceTo(sphere.center);
  scene.fog.near = dist * 1.6 + 6;
  scene.fog.far = dist * 5 + 40;

  sky.position.copy(camera.position);
  camera.updateMatrixWorld();
  leafLight.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  treeMesh.setSnow(THREE.MathUtils.smoothstep(-climate.temp, 0.1, 0.7), upView.set(0, 1, 0).transformDirection(camera.matrixWorldInverse));
  leafLight.uCrown.value.set(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius);
  // Level of detail: from far away, fewer (larger) foliage cards.
  const detail = ((sphere.radius * 1.6) / Math.max(dist, 0.1)) ** 2;
  leaves.setDetail(detail);
  dust.setDetail(SMALL_SCREEN ? 6 : 10);
  dust.update(now, renderer, camera, sunDir);
  // Clear the view to the followed leaf when the camera is close to it.
  if (clock.ma <= tree.focus.splitMa) {
    leafCentre(tree.focus.branch, now, revealAt);
    const near = 1 - THREE.MathUtils.smoothstep(camera.position.distanceTo(revealAt), 2.5, 6);
    leafLight.uReveal.value.set(revealAt.x, revealAt.y, revealAt.z, near);
  } else leafLight.uReveal.value.w = 0;
  leafLight.uFocusSample.value = branchTex.start.get(tree.focus.branch) ?? -1;
  watchShoots();
  updateCallouts(now);

  ui.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy from the browser console, e.g. treeOfLife.clock.ma = 600.
window.treeOfLife = { clock, tree, get branches() { return branches; }, get leaves() { return leaves; }, get treeMesh() { return treeMesh; }, camera, controls, setMode: (m) => { setMode(m); build(); }, focusLeaf: () => leafCentre(tree.focus.branch, depthAt(clock.ma), new THREE.Vector3()) };
