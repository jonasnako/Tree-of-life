// Turns the node tree into branches in 3D: a centreline for every node,
// running from the fork where it split off to the fork where its own
// children split (or to today, for living tips).
//
// Rules (CLAUDE.md, "Rendering"):
// - Shape is procedural but deterministic: seeded by node id.
// - Thickness follows descendant species (pipe model).
// - The bigger child at a fork keeps the parent's direction (the leader);
//   smaller children leave at a wider angle. Children spread around the
//   parent by the golden angle so neighbouring forks don't line up.
import * as THREE from 'three';
import { createRandom } from '../random.js';
import { depthAt, maAtDepth } from '../timeScale.js';

export const TREE_HEIGHT = 16; // world units from seed to today along any path
const STEP = 0.11; // centreline sample spacing (world units)
const ROOT_RADIUS = 1.1;
// Long wood must be thick enough to hold itself up ("elastic similarity"):
// a branch is at least this share of the length still to grow above it.
const MIN_SLENDERNESS = 1 / 45;
// Life's first fork is very early, so the trunk would be a stub. A mother
// tree stands on a tall bole: the first segment gets at least this length.
const TRUNK_MIN = 3.4;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const UP = new THREE.Vector3(0, 1, 0);

/** Radius of a fully aged branch carrying `species` descendants. */
export function radiusFor(species, rootSpecies) {
  return ROOT_RADIUS * Math.pow(species / rootSpecies, 0.2);
}

/** Radius from descendant species (pipe model), but never too slender to stand. */
function woodRadius(node, rootSpecies) {
  const pipe = radiusFor(node.species, rootSpecies);
  const reach = (1 - depthAt(node.splitMa)) * TREE_HEIGHT;
  const parentPipe = node.parentNode ? radiusFor(node.parentNode.species, rootSpecies) : Infinity;
  return Math.max(pipe, Math.min(reach * MIN_SLENDERNESS, parentPipe * 0.75));
}

/**
 * Collapsed clades (leaves with many species) get a few seeded stand-in
 * forks so they read as limbs with a crown rather than bare poles.
 * They are marked `placeholder`; real detail replaces them when the full
 * tree is streamed in (build step 8).
 */
export function addPlaceholderForks(tree) {
  const visit = (node) => {
    if (node.children.length) return node.children.forEach(visit);
    // Rich clades fork more; so do long lone limbs, so they don't read as
    // whips. Never more stand-in tips than the clade has species.
    const byRichness = Math.floor(Math.log10(node.species)) - 2;
    const byLength = Math.floor(((1 - depthAt(node.splitMa)) * TREE_HEIGHT) / 3.5);
    const levels = Math.max(0, Math.min(3, Math.max(byRichness, byLength), Math.floor(Math.log2(node.species))));
    split(node, levels, createRandom(`${node.id}-placeholder`));
  };
  const split = (node, levels, rand) => {
    if (levels <= 0) return;
    const s0 = depthAt(node.splitMa);
    const forkMa = maAtDepth(s0 + (1 - s0) * rand.range(0.18, 0.42));
    const p = rand.range(0.3, 0.7);
    for (const [i, share] of [p, 1 - p].entries()) {
      const child = {
        id: `${node.id}~${i}`,
        name: node.name,
        splitMa: forkMa,
        species: Math.max(1, Math.round(node.species * share)),
        endMa: node.endMa,
        placeholder: true,
        parentNode: node,
        children: [],
      };
      node.children.push(child);
      split(child, levels - 1, rand);
    }
  };
  visit(tree.root);
}

/**
 * @returns {object[]} branches, parents before children. Each has
 *   node, points[], tangents[], normals[], binormals[], depths[], radii[],
 *   dists[] (along this branch) and paths[] (distance from the seed, continuous
 *   across forks so bark twist and fluting run on without a seam).
 * Roots (`isRoot`) come last; they carry no leaves.
 */
export function layoutTree(tree) {
  const rootSpecies = tree.root.species;
  const branches = [];

  const grow = (node, start, dir, phase, startNormal = null, startPath = 0, leader = true) => {
    const endMa = node.children.length ? node.children[0].splitMa : node.endMa ?? 0;
    const s0 = depthAt(node.splitMa);
    const s1 = depthAt(endMa);
    const length = Math.max(node === tree.root ? TRUNK_MIN : STEP, (s1 - s0) * TREE_HEIGHT);
    const rand = createRandom(node.id);
    // Long side limbs sag under their weight, then turn up toward the light.
    const sag = leader ? 0 : 0.14 * Math.min(1, length / 6);
    const branch = buildCenterline(node, start, dir, length, s0, s1, rand, startNormal, startPath, false, sag);
    branch.node = node;
    node.branch = branch;

    // Radius: from this node's own pipe size at the base toward the biggest
    // child's at the end, so the leader continues without a step.
    const rSelf = woodRadius(node, rootSpecies);
    const rEnd = node.children.length ? Math.max(...node.children.map((c) => woodRadius(c, rootSpecies))) : rSelf * 0.7;
    branch.radii = branch.depths.map((_, i) => {
      const u = i / (branch.depths.length - 1);
      const dist = branch.dists[i];
      const flare = node === tree.root ? 1 + 1.3 * Math.exp(-dist * 2.2) : 1;
      // A swollen collar where a side branch leaves its parent.
      const collar = leader ? 1 : 1 + 0.35 * Math.exp(-dist * 4);
      return THREE.MathUtils.lerp(rSelf, rEnd, u) * flare * collar;
    });
    // The bark pattern follows the plain pipe radius, which runs on smoothly
    // from a branch into its leader (flares and collars would make a seam).
    branch.barkRadii = branch.depths.map((_, i) => THREE.MathUtils.lerp(rSelf, rEnd, i / (branch.depths.length - 1)));
    branches.push(branch);

    // Children.
    const kids = [...node.children].sort((a, b) => b.species - a.species);
    const total = kids.reduce((s, c) => s + c.species, 0);
    const endPos = branch.points.at(-1);
    const endDir = branch.tangents.at(-1);
    const n = branch.normals.at(-1);
    const b = branch.binormals.at(-1);
    const baseAz = phase + rand.range(-0.4, 0.4);
    kids.forEach((child, k) => {
      const share = child.species / total;
      const leader = k === 0;
      const theta = THREE.MathUtils.degToRad(leader ? 6 + 40 * Math.pow(1 - share, 1.6) : 22 + 48 * Math.pow(1 - share, 1.2));
      const az = baseAz + (k * Math.PI * 2) / kids.length;
      const side = n.clone().multiplyScalar(Math.cos(az)).addScaledVector(b, Math.sin(az));
      const childDir = endDir.clone().multiplyScalar(Math.cos(theta)).addScaledVector(side, Math.sin(theta)).normalize();
      if (childDir.y < 0.12) childDir.lerp(UP, 0.12 - childDir.y + 0.1).normalize();
      grow(child, endPos.clone(), childDir, phase + GOLDEN * (k + 1), leader ? n : null, branch.paths.at(-1), leader);
    });
  };

  // The trunk leans a little, as old trees do.
  const lean = createRandom('trunk-lean');
  const trunkDir = new THREE.Vector3(lean.range(-0.18, 0.18), 1, lean.range(-0.18, 0.18)).normalize();
  grow(tree.root, new THREE.Vector3(0, -0.15, 0), trunkDir, 0);
  addRoots(branches, rootSpecies);
  return branches;
}

/**
 * Surface roots and buttresses: they spread from the base over the ground
 * and grow all through the tree's life (a decorative part, not data).
 */
function addRoots(branches, rootSpecies) {
  const count = 9;
  const rand = createRandom('roots');
  const trunkR = radiusFor(rootSpecies, rootSpecies);
  for (let k = 0; k < count; k++) {
    const az = (k / count) * Math.PI * 2 + rand.range(-0.35, 0.35);
    const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const node = { id: `root-${k}`, name: 'Root', children: [], parentNode: null, isRoot: true };
    const length = rand.range(4, 9);
    const s0 = 0.02 + k * 0.012;
    const s1 = rand.range(0.8, 0.97);
    const start = out.clone().multiplyScalar(trunkR * 0.12).setY(0.5);
    const dir = out.clone().setY(-0.35).normalize();
    const br = buildCenterline(node, start, dir, length, s0, s1, createRandom(node.id), null, 0, true);
    // Hug the ground: dive from the buttress into the soil, then run just under the surface.
    const r0 = trunkR * rand.range(0.4, 0.6);
    br.radii = br.dists.map((d) => r0 * (0.12 + 0.88 * Math.exp(-d / (length * 0.45))));
    br.points.forEach((p, i) => {
      const d = br.dists[i];
      p.y = Math.max(-br.radii[i] * 0.45, 0.6 * Math.exp(-d * 1.1) - br.radii[i] * 0.45);
    });
    br.barkRadii = br.radii.map(() => trunkR);
    br.node = node;
    br.isRoot = true;
    br.fin = 1.9; // buttress: taller than wide near the trunk
    branches.push(br);
  }
}

function buildCenterline(node, start, dir, length, s0, s1, rand, startNormal = null, startPath = 0, flat = false, sag = 0) {
  const count = Math.max(3, Math.ceil(length / STEP));
  const step = length / count;
  const points = [start.clone()];
  const tangents = [dir.clone().normalize()];
  // Seeded wander, sudden kinks (old wood is gnarled), and a pull upward
  // (branches curve toward the light).
  const tropism = flat ? 0 : node.parentNode ? rand.range(0.03, 0.1) : 0.05;
  const wander = rand.range(0.04, 0.08);
  let nextKink = rand.range(0.4, 1.2);
  const kinkAxis = new THREE.Vector3();
  const f1 = rand.range(0.4, 1.1);
  const f2 = rand.range(0.4, 1.1);
  const ph1 = rand.range(0, Math.PI * 2);
  const ph2 = rand.range(0, Math.PI * 2);
  const d = tangents[0].clone();
  const tmpSide = new THREE.Vector3();
  const tmpSide2 = new THREE.Vector3();
  for (let i = 1; i <= count; i++) {
    const t = i * step;
    tmpSide.crossVectors(d, Math.abs(d.y) < 0.95 ? UP : new THREE.Vector3(1, 0, 0)).normalize();
    tmpSide2.crossVectors(d, tmpSide).normalize();
    d.addScaledVector(UP, (tropism - sag * (1 - t / length) + sag * 0.6 * (t / length) ** 2) * step)
      .addScaledVector(tmpSide, (Math.sin(t * f1 + ph1) + 0.5 * Math.sin(t * f1 * 3.1 + ph2)) * wander * step * 4)
      .addScaledVector(tmpSide2, (Math.sin(t * f2 + ph2) + 0.5 * Math.sin(t * f2 * 2.7 + ph1)) * wander * step * 4)
      .normalize();
    if (t >= nextKink) {
      kinkAxis.copy(tmpSide).multiplyScalar(rand.range(-1, 1)).addScaledVector(tmpSide2, rand.range(-1, 1)).normalize();
      d.applyAxisAngle(kinkAxis, rand.range(0.1, 0.28));
      if (flat) d.y = Math.min(d.y, 0);
      d.normalize();
      nextKink = t + rand.range(0.5, 1.4);
    }
    if (!flat && d.y < -0.15) d.lerp(UP, 0.1).normalize();
    points.push(points[i - 1].clone().addScaledVector(d, step));
    tangents.push(d.clone());
  }

  // Parallel-transport frames: radial directions that don't twist.
  const normals = [];
  const binormals = [];
  const first = tangents[0];
  // Carry the parent's frame into a leader so the bark pattern lines up.
  const n0 = startNormal
    ? startNormal.clone().addScaledVector(first, -startNormal.dot(first)).normalize()
    : new THREE.Vector3().crossVectors(first, Math.abs(first.y) < 0.95 ? UP : new THREE.Vector3(1, 0, 0)).normalize();
  normals.push(n0);
  const q = new THREE.Quaternion();
  for (let i = 1; i <= count; i++) {
    q.setFromUnitVectors(tangents[i - 1], tangents[i]);
    normals.push(normals[i - 1].clone().applyQuaternion(q).normalize());
  }
  for (let i = 0; i <= count; i++) binormals.push(new THREE.Vector3().crossVectors(tangents[i], normals[i]).normalize());

  const depths = [];
  const dists = [];
  const paths = [];
  for (let i = 0; i <= count; i++) {
    depths.push(s0 + ((s1 - s0) * i) / count);
    dists.push(i * step);
    paths.push(startPath + i * step);
  }
  return { points, tangents, normals, binormals, depths, dists, paths, length };
}

/** Index and fraction of the centreline sample at a given depth (clamped). */
export function locate(branch, depth) {
  const d = branch.depths;
  const f = THREE.MathUtils.clamp((depth - d[0]) / (d.at(-1) - d[0] || 1), 0, 1) * (d.length - 1);
  const i = Math.min(d.length - 2, Math.floor(f));
  return { i, t: f - i };
}
