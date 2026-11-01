// A branching tree grown from a hand-made file of the human lineage.
// It starts as a seedling with two seed leaves; young shoots are green and
// leafy; wood thickens, barks and gnarls as it ages; dead leaves fall and
// build up as litter under the crown.
import * as THREE from 'three';
import { loadTree, TIME_START_MA, TIME_END_MA } from './data.js';
import { GrowthClock } from './clock.js';
import { depthAt, depthPerMa } from './timeScale.js';
import { createScene, handleResize } from './scene.js';
import { createCamera } from './camera.js';
import { createUI } from './ui.js';
import { addPlaceholderForks, layoutTree, locate } from './tree/layout.js';
import { createTreeMesh } from './tree/treeMesh.js';
import { createLeaves, leafLight } from './tree/leaves.js';
import { createLeafFall } from './tree/leafFall.js';
import { windUniforms } from './wind.js';
import { createBarkTextures } from './tree/barkTexture.js';

const RUN_SECONDS = 60; // seed to today at 1×

const canvas = document.getElementById('scene');
const { renderer, scene, sun, sky } = createScene(canvas);
const { camera, update: updateCamera } = createCamera(canvas);
handleResize(renderer, camera);

// Data -> layout -> meshes.
const tree = loadTree();
addPlaceholderForks(tree);
const branches = layoutTree(tree);
const treeMesh = createTreeMesh(branches, createBarkTextures());
const leaves = createLeaves(branches);
const leafFall = createLeafFall(branches);
scene.add(treeMesh.mesh, leaves.group, leafFall.group);

// Depth grows at a steady visual pace; the counter shows real Ma.
const clock = new GrowthClock({
  startMa: TIME_START_MA,
  endMa: TIME_END_MA,
  rateAt: (ma) => 1 / RUN_SECONDS / depthPerMa(ma),
});

// Captions for each fork on the followed lineage.
const events = [];
for (let i = 1; i < tree.lineage.length; i++) {
  const node = tree.lineage[i];
  const sisters = node.parentNode.children.filter((c) => c !== node && !c.placeholder);
  events.push({ ma: node.splitMa, text: `${sisters.map((s) => s.name).join(', ')} branch off` });
}
const ui = createUI(clock, events);

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

// A label on the followed leaf once its lineage stands on its own.
const focusLabel = document.getElementById('focus-label');
focusLabel.querySelector('.focus-name').textContent = tree.focus.name;
const labelPos = new THREE.Vector3();
function placeFocusLabel() {
  const show = clock.ma <= tree.focus.splitMa;
  focusLabel.classList.toggle('show', show);
  if (!show) return;
  labelPos.copy(tip).project(camera);
  const x = (labelPos.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-labelPos.y * 0.5 + 0.5) * window.innerHeight;
  focusLabel.style.transform = `translate(${x}px, ${y}px)`;
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
  placeFocusLabel();

  ui.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy from the browser console, e.g. treeOfLife.clock.ma = 600.
window.treeOfLife = { clock, tree, branches, leaves, treeMesh, camera };
