// Leaves on young shoots, and the two seed leaves (cotyledons) of the seedling.
// Leaves sit along every branch. Each one unfolds just behind the growing
// tip, stays while the shoot is young, then yellows and falls once the
// wood behind it turns to bark. So the green always rides on the fresh growth.
import * as THREE from 'three';
import { createRandom } from '../random.js';
import { thicknessAt, smooth } from './growth.js';
import { TREE_HEIGHT } from './layout.js';

const LEAF_SPACING = 0.14; // world units between leaves along a shoot
const LEAF_LIFE = 0.1; // depth units a leaf lives
const UNFOLD = 0.006; // depth units to unfold
const TUFT = 5; // leaves around each growing tip
const COTYLEDON_HEIGHT = 0.32; // world units up the seedling stem

const FRESH = new THREE.Color('#79c043');
const MATURE = new THREE.Color('#3f7d2a');
const AUTUMN = new THREE.Color('#c9a23a');
const SEED_LEAF = new THREE.Color('#9acb5a');

export function createLeaves(branches) {
  const slots = [];
  for (const br of branches) {
    const rand = createRandom(`${br.node.id}-leaves`);
    const count = Math.floor(br.length / LEAF_SPACING);
    for (let k = 0; k < count; k++) {
      const dist = (k + rand.range(0.3, 0.9)) * LEAF_SPACING;
      const f = (dist / br.length) * (br.points.length - 1);
      const i = Math.min(br.points.length - 2, Math.floor(f));
      slots.push({
        branch: br,
        i,
        t: f - i,
        depth: br.depths[0] + (dist / br.length) * (br.depths.at(-1) - br.depths[0]),
        angle: k * 2.39996 + rand.range(-0.3, 0.3), // golden-angle phyllotaxis
        tilt: rand.range(0.7, 1.15), // radians away from the stem
        size: rand.range(0.3, 0.42),
        hue: rand.range(-0.03, 0.03),
      });
    }
  }

  // A tuft of young leaves riding on every growing tip.
  const tufts = [];
  for (const br of branches) {
    const rand = createRandom(`${br.node.id}-tuft`);
    for (let k = 0; k < TUFT; k++) {
      tufts.push({
        branch: br,
        lag: (k / TUFT) * 0.006 + 0.0006, // depth behind the tip
        angle: k * 2.39996 + rand.range(-0.3, 0.3),
        tilt: rand.range(0.35, 0.8),
        size: rand.range(0.24, 0.36),
        hue: rand.range(-0.03, 0.03),
      });
    }
  }

  // Two seed leaves, opposite each other, low on the first stem.
  const root = branches[0];
  const cotyledonDepth = root.depths[0] + (COTYLEDON_HEIGHT / TREE_HEIGHT);
  const ci = Math.round((COTYLEDON_HEIGHT / root.length) * (root.points.length - 1));
  const cotyledons = [0, Math.PI].map((angle) => ({ branch: root, i: ci, t: 0, depth: cotyledonDepth, angle: angle + 0.6, size: 0.15 }));

  const leafMaterial = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, metalness: 0 });
  const leaves = new THREE.InstancedMesh(createLeafGeometry(), leafMaterial, slots.length + tufts.length);
  const seedLeaves = new THREE.InstancedMesh(createSeedLeafGeometry(), leafMaterial, 2);
  for (const m of [leaves, seedLeaves]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, FRESH);
  }
  const group = new THREE.Group();
  group.add(leaves, seedLeaves);

  // Scratch objects.
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const xAxis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const color = new THREE.Color();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  function place(mesh, idx, slot, open, size) {
    const br = slot.branch;
    const { i, t } = slot;
    p.lerpVectors(br.points[i], br.points[i + 1], t);
    tan.lerpVectors(br.tangents[i], br.tangents[i + 1], t).normalize();
    const n = br.normals[i];
    const b = br.binormals[i];
    radial.copy(n).multiplyScalar(Math.cos(slot.angle)).addScaledVector(b, Math.sin(slot.angle));
    // Sit on the bark surface.
    const r = br.radii[i] * thicknessAt(slotAge);
    p.addScaledVector(radial, r * 0.9);
    // Folded against the shoot when closed, angled out when open.
    const tilt = (slot.tilt ?? 1.3) * open;
    yAxis.copy(tan).multiplyScalar(Math.cos(tilt)).addScaledVector(radial, Math.sin(tilt)).normalize();
    // Leaf blade faces the sky as much as it can.
    zAxis.copy(up).addScaledVector(yAxis, -up.dot(yAxis));
    if (zAxis.lengthSq() < 1e-4) zAxis.copy(radial);
    zAxis.normalize();
    xAxis.crossVectors(yAxis, zAxis);
    m4.makeBasis(xAxis, yAxis, zAxis).scale(p.set(size, size, size));
    // makeBasis+scale reset the translation; set it again.
    p.lerpVectors(br.points[i], br.points[i + 1], t).addScaledVector(radial, r * 0.9);
    m4.setPosition(p);
    mesh.setMatrixAt(idx, m4);
  }

  let slotAge = 0;
  function update(now) {
    for (let k = 0; k < slots.length; k++) {
      const s = slots[k];
      const age = now - s.depth;
      if (age <= 0 || age > LEAF_LIFE) {
        leaves.setMatrixAt(k, hidden);
        continue;
      }
      slotAge = age;
      const open = smooth(0, UNFOLD, age);
      const fall = 1 - smooth(LEAF_LIFE * 0.85, LEAF_LIFE, age);
      place(leaves, k, s, open, s.size * (0.25 + 0.75 * open) * fall);
      color.copy(FRESH).lerp(MATURE, smooth(0, LEAF_LIFE * 0.5, age)).lerp(AUTUMN, smooth(LEAF_LIFE * 0.6, LEAF_LIFE * 0.9, age));
      color.offsetHSL(s.hue, 0, 0);
      leaves.setColorAt(k, color);
    }
    for (let k = 0; k < tufts.length; k++) {
      const s = tufts[k];
      const br = s.branch;
      const idx = slots.length + k;
      const d0 = br.depths[0];
      const d1 = br.depths.at(-1);
      const living = !br.node.children.length && !br.node.endMa;
      const depth = Math.min(now, d1) - s.lag;
      // Only while this branch is the one growing (or it is a living tip).
      if (now <= d0 || depth <= d0 || (now > d1 + 1e-6 && !living)) {
        leaves.setMatrixAt(idx, hidden);
        continue;
      }
      const f = ((depth - d0) / (d1 - d0)) * (br.points.length - 1);
      const i = Math.min(br.points.length - 2, Math.floor(f));
      slotAge = now - depth;
      const open = smooth(0, 0.004, now - d0);
      place(leaves, idx, { branch: br, i, t: f - i, angle: s.angle, tilt: s.tilt }, open, s.size * (0.3 + 0.7 * open));
      leaves.setColorAt(idx, color.copy(FRESH).offsetHSL(s.hue, 0.02, 0.02));
    }
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;

    cotyledons.forEach((c, k) => {
      const age = now - c.depth;
      if (age <= 0 || age > 0.09) {
        seedLeaves.setMatrixAt(k, hidden);
        return;
      }
      slotAge = age;
      const open = smooth(0.002, 0.014, age);
      const fall = 1 - smooth(0.075, 0.09, age);
      place(seedLeaves, k, { ...c, tilt: 0.15 + 1.35 * open }, 1, c.size * (0.5 + 0.5 * open) * fall);
      seedLeaves.setColorAt(k, color.copy(SEED_LEAF).lerp(AUTUMN, smooth(0.05, 0.08, age)));
    });
    seedLeaves.instanceMatrix.needsUpdate = true;
    if (seedLeaves.instanceColor) seedLeaves.instanceColor.needsUpdate = true;
  }

  return { group, update };
}

/** A pointed leaf along +Y, slightly cupped and drooping at the tip. */
function createLeafGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.3, 0.2, 0.32, 0.65, 0, 1);
  shape.bezierCurveTo(-0.32, 0.65, -0.3, 0.2, 0, 0);
  const g = new THREE.ShapeGeometry(shape, 8);
  bend(g, 0.6, 0.25);
  return g;
}

/** A round, fleshy seed leaf. */
function createSeedLeafGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.12, 0.05, 0.5, 0.35, 0, 0.9);
  shape.bezierCurveTo(-0.5, 0.35, -0.12, 0.05, 0, 0);
  const g = new THREE.ShapeGeometry(shape, 8);
  bend(g, 0.9, 0.1);
  return g;
}

function bend(geometry, cup, droop) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, cup * x * x - droop * y * y);
  }
  geometry.computeVertexNormals();
}
