// Step 1: a single organic branch growing from the origin of life to today.
import * as THREE from 'three';
import { nodes, TIME_START_MA, TIME_END_MA } from './data.js';
import { GrowthClock } from './clock.js';
import { createScene, handleResize } from './scene.js';
import { createCamera } from './camera.js';
import { createUI } from './ui.js';
import { Branch } from './tree/Branch.js';
import { createBarkTextures } from './tree/barkTexture.js';

const canvas = document.getElementById('scene');
const { renderer, scene } = createScene(canvas);
const { camera, update: updateCamera } = createCamera(canvas);
handleResize(renderer, camera);

const clock = new GrowthClock({ startMa: TIME_START_MA, endMa: TIME_END_MA, baseRate: 100 });
const ui = createUI(clock);

// Bark material shared by all branches.
const bark = createBarkTextures();
bark.map.repeat.set(2, 1);
bark.bumpMap.repeat.set(2, 1);
const barkMaterial = new THREE.MeshStandardMaterial({
  map: bark.map,
  bumpMap: bark.bumpMap,
  bumpScale: 4,
  roughness: 0.95,
  metalness: 0,
  color: '#ffffff',
});

const node = nodes[0];
const branch = new Branch({
  id: node.id,
  origin: new THREE.Vector3(0, -0.2, 0),
  direction: new THREE.Vector3(0, 1, 0),
  length: 14,
  radius: 0.6,
  material: barkMaterial,
});
scene.add(branch.mesh);

// A small, glowing green bud marks the growing tip.
const bud = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshStandardMaterial({ color: '#8fcf4a', emissive: '#4f8f1c', emissiveIntensity: 0.6, roughness: 0.5 }),
);
bud.scale.set(0.05, 0.08, 0.05);
bud.castShadow = true;
scene.add(bud);

const base = new THREE.Vector3(0, 0, 0);
let lastTime = null;

function frame(time) {
  // Clamp so a background tab or a slow frame never jumps (or reverses) time.
  const dt = lastTime === null ? 0 : Math.min(Math.max((time - lastTime) / 1000, 0), 0.1);
  lastTime = time;

  clock.update(dt);
  const growth = (node.splitMa - clock.ma) / (node.splitMa - TIME_END_MA);
  if (growth !== branch.growth) branch.setGrowth(growth);
  bud.position.copy(branch.tip);
  bud.scale.set(0.05, 0.08, 0.05).multiplyScalar(0.45 + 0.55 * Math.sqrt(branch.growth));
  bud.visible = branch.growth > 0.0005;

  updateCamera(dt, { base, tip: branch.tip });
  ui.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
