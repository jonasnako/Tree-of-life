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
const STEP = 0.08; // centreline sample spacing (world units)
const ROOT_RADIUS = 0.55;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const UP = new THREE.Vector3(0, 1, 0);

/** Radius of a fully aged branch carrying `species` descendants. */
export function radiusFor(species, rootSpecies) {
  return ROOT_RADIUS * Math.pow(species / rootSpecies, 0.2);
}

/**
 * Collapsed clades (leaves with many species) get a few seeded stand-in
 * forks so they read as limbs with a crown rather than bare poles.
 * They are marked `placeholder` and will be replaced by real data in step 4.
 */
export function addPlaceholderForks(tree) {
  const visit = (node) => {
    if (node.children.length) return node.children.forEach(visit);
    const levels = Math.max(0, Math.min(4, Math.floor(Math.log10(node.species)) - 1));
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
 *   node, points[], tangents[], normals[], binormals[], depths[], radii[], dists[]
 */
export function layoutTree(tree) {
  const rootSpecies = tree.root.species;
  const branches = [];

  const grow = (node, start, dir, phase) => {
    const endMa = node.children.length ? node.children[0].splitMa : node.endMa ?? 0;
    const s0 = depthAt(node.splitMa);
    const s1 = depthAt(endMa);
    const length = Math.max(STEP, (s1 - s0) * TREE_HEIGHT);
    const rand = createRandom(node.id);
    const branch = buildCenterline(node, start, dir, length, s0, s1, rand);
    branch.node = node;
    node.branch = branch;

    // Radius: from this node's own pipe size at the base toward the biggest
    // child's at the end, so the leader continues without a step.
    const rSelf = radiusFor(node.species, rootSpecies);
    const rEnd = node.children.length
      ? radiusFor(Math.max(...node.children.map((c) => c.species)), rootSpecies)
      : rSelf * 0.7;
    branch.radii = branch.depths.map((_, i) => {
      const u = i / (branch.depths.length - 1);
      const flare = node === tree.root ? 1 + 0.7 * Math.exp(-branch.dists[i] * 5) : 1;
      return THREE.MathUtils.lerp(rSelf, rEnd, u) * flare;
    });
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
      grow(child, endPos.clone(), childDir, phase + GOLDEN * (k + 1));
    });
  };

  grow(tree.root, new THREE.Vector3(0, -0.15, 0), UP.clone(), 0);
  return branches;
}

function buildCenterline(node, start, dir, length, s0, s1, rand) {
  const count = Math.max(3, Math.ceil(length / STEP));
  const step = length / count;
  const points = [start.clone()];
  const tangents = [dir.clone().normalize()];
  // Gentle, seeded wander plus a pull upward (branches curve toward the light).
  const tropism = node.parentNode ? rand.range(0.05, 0.12) : 0.02;
  const wander = rand.range(0.02, 0.05);
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
    d.addScaledVector(UP, tropism * step)
      .addScaledVector(tmpSide, Math.sin(t * f1 + ph1) * wander * step * 4)
      .addScaledVector(tmpSide2, Math.sin(t * f2 + ph2) * wander * step * 4)
      .normalize();
    points.push(points[i - 1].clone().addScaledVector(d, step));
    tangents.push(d.clone());
  }

  // Parallel-transport frames: radial directions that don't twist.
  const normals = [];
  const binormals = [];
  const first = tangents[0];
  const n0 = new THREE.Vector3().crossVectors(first, Math.abs(first.y) < 0.95 ? UP : new THREE.Vector3(1, 0, 0)).normalize();
  normals.push(n0);
  const q = new THREE.Quaternion();
  for (let i = 1; i <= count; i++) {
    q.setFromUnitVectors(tangents[i - 1], tangents[i]);
    normals.push(normals[i - 1].clone().applyQuaternion(q).normalize());
  }
  for (let i = 0; i <= count; i++) binormals.push(new THREE.Vector3().crossVectors(tangents[i], normals[i]).normalize());

  const depths = [];
  const dists = [];
  for (let i = 0; i <= count; i++) {
    depths.push(s0 + ((s1 - s0) * i) / count);
    dists.push(i * step);
  }
  return { points, tangents, normals, binormals, depths, dists, length };
}

/** Index and fraction of the centreline sample at a given depth (clamped). */
export function locate(branch, depth) {
  const d = branch.depths;
  const f = THREE.MathUtils.clamp((depth - d[0]) / (d.at(-1) - d[0] || 1), 0, 1) * (d.length - 1);
  const i = Math.min(d.length - 2, Math.floor(f));
  return { i, t: f - i };
}
