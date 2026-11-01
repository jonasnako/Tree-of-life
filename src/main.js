// The Tree of Life grown from real data (Open Tree of Life + TimeTree):
// the lineages of a few showcase species, forking on their real dates.
// It starts as a seedling with two seed leaves; young shoots are green and
// leafy; wood thickens, barks and gnarls as it ages; dead leaves fall and
// build up as litter under the crown.
import * as THREE from 'three';
import { loadTree, setFocus, TIME_END_MA } from './data.js';
import { GrowthClock } from './clock.js';
import { depthAt, depthPerMa, setOrigin } from './timeScale.js';
import { createScene, handleResize } from './scene.js';
import { createCamera } from './camera.js';
import { createUI, formatMa } from './ui.js';
import { createCallouts } from './callouts.js';
import { addPlaceholderForks, layoutTree, locate } from './tree/layout.js';
import { createTreeMesh } from './tree/treeMesh.js';
import { createLeaves, leafLight } from './tree/leaves.js';
import { createBranchTexture } from './tree/branchTexture.js';
import { createLeafFall } from './tree/leafFall.js';
import { windUniforms } from './wind.js';

const RUN_SECONDS = 60; // seed to today at 1×

const canvas = document.getElementById('scene');
const { renderer, scene, sun, sky } = createScene(canvas);
const { camera, controls, update: updateCamera } = createCamera(canvas);
handleResize(renderer, camera);

// Data -> layout -> meshes.
const tree = loadTree();
setOrigin(tree.originMa);
addPlaceholderForks(tree);
const branches = layoutTree(tree);
const treeMesh = createTreeMesh(branches);
const branchTex = createBranchTexture(branches);
const leaves = createLeaves(branches, branchTex);
const leafFall = createLeafFall(branches);
scene.add(treeMesh.mesh, leaves.group, leafFall.group);

// Depth grows at a steady visual pace; the counter shows real Ma.
const clock = new GrowthClock({
  startMa: tree.originMa,
  endMa: TIME_END_MA,
  rateAt: (ma) => 1 / RUN_SECONDS / depthPerMa(ma),
});

// Forks on the followed lineage: each new sister lineage gets a callout
// pointing at its branch, and a tick on the timeline.
const displayName = (n) => (n.common ? `${n.common} (${n.name})` : n.name);
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
const callouts = createCallouts();
const anchor = new THREE.Vector3();
function updateCallouts(now) {
  const list = [];
  const past = ui.events.filter((e) => e.ma >= clock.ma).slice(-SHOWN_FORKS);
  past.forEach((e, k) => {
    const br = e.sister.branch;
    const d0 = br.depths[0];
    const d1 = br.depths.at(-1);
    // Point partway along the new branch, never past its growing tip.
    const depth = Math.min(now, d0 + (d1 - d0) * 0.45, d1);
    pointAt(br, Math.max(d0, depth), anchor);
    const fresh = Math.min(1, (now - d0) / 0.004);
    const sub = `${formatMa(e.ma)} Ma · ${speciesFmt.format(e.sister.species)} species${e.others ? ` · +${e.others} more lineage${e.others > 1 ? 's' : ''}` : ''}`;
    list.push({ key: e.sister.id, title: displayName(e.sister), sub, anchor: anchor.clone(), alpha: fresh * [0.55, 0.75, 1][k + SHOWN_FORKS - past.length] });
  });
  // The followed species: its own single leaf at the tip of its twig.
  if (clock.ma <= tree.focus.splitMa) {
    const br = tree.focus.branch;
    const end = Math.min(now, br.depths.at(-1));
    pointAt(br, end, anchor);
    const { i } = locate(br, end);
    anchor.addScaledVector(br.tangents[i + 1] ?? br.tangents[i], 0.12);
    list.push({ key: 'focus', kind: 'focus', title: tree.focusLabel, sub: tree.focus.name, anchor: anchor.clone() });
  }
  callouts.update(list, camera, sphere.center);
}
const ui = createUI(clock, lineageEvents());

// Pick whose lineage to follow; the replay starts again from the seed.
const focusSelect = document.getElementById('focus');
for (const s of tree.showcase) focusSelect.add(new Option(s.label, s.key, false, s.node === tree.focus));
focusSelect.addEventListener('change', () => {
  setFocus(tree, focusSelect.value);
  ui.setEvents(lineageEvents());
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

  frameTree(now);
  fitShadows();
  updateCamera(dt, { center: sphere.center, radius: sphere.radius, tip, finished: clock.finished });
  const dist = camera.position.distanceTo(sphere.center);
  scene.fog.near = dist * 1.6 + 6;
  scene.fog.far = dist * 5 + 40;

  sky.position.copy(camera.position);
  camera.updateMatrixWorld();
  leafLight.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  leafLight.uCrown.value.set(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius);
  updateCallouts(now);

  ui.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy from the browser console, e.g. treeOfLife.clock.ma = 600.
window.treeOfLife = { clock, tree, branches, leaves, treeMesh, camera, controls };
