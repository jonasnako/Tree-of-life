// What is under the pointer? Branches and foliage are shaped on the GPU, so
// picking works on their source: each branch's centreline, as far as it has
// grown, with its current thickness, plus the leafy region of each foliage
// mass and the leaves at small tips. Hover (mouse) reports as you move; a tap
// or click (without dragging) picks.
import * as THREE from 'three';
import { thicknessAt } from './tree/growth.js';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const closest = new THREE.Vector3();
const onRay = new THREE.Vector3();

/** Squared distance between a ray and a segment, and the ray distance there. */
function raySegment(ray, p0, p1) {
  const sqr = ray.distanceSqToSegment(p0, p1, onRay, closest);
  return { d2: sqr, t: onRay.distanceTo(ray.origin) };
}

export function createPicker({ canvas, camera, getState, onHover, onPick }) {
  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;
    const { branches, masses, now } = getState();
    let best = null;
    const consider = (node, t, kind) => {
      if (!best || t < best.t) best = { node, t, kind };
    };

    // Leafy regions first: foliage masses and small tips' leaves.
    for (const m of masses) {
      const br = m.br;
      if (br.depths[0] > now) continue;
      const n = br.points.length;
      const from = Math.floor(n * 0.15);
      for (let i = from; i < n - 1; i++) {
        if (br.depths[i] > now) break;
        const { d2, t } = raySegment(ray, br.points[i], br.points[i + 1]);
        if (d2 < (m.R * 0.9) ** 2) consider(br.node, t, 'foliage');
      }
    }
    // Wood (and the leaves at small tips).
    for (const br of branches) {
      if (br.isRoot || br.depths[0] > now) continue;
      const n = br.points.length;
      const tipLeaves = !br.node.children.length;
      for (let i = 0; i < n - 1; i++) {
        if (br.depths[i] > now) break;
        a.copy(br.points[i]);
        b.copy(br.points[i + 1]);
        const r = br.radii[i] * Math.max(0.05, thicknessAt(now - br.depths[i]));
        const { d2, t } = raySegment(ray, a, b);
        // A few pixels of slack, so thin twigs can be hit.
        const slack = t * 0.006;
        const nearTip = tipLeaves && i > n * 0.8;
        const reach = Math.max(r * 1.2, slack, nearTip ? 0.2 * (br.leafScale ?? 1) : 0);
        if (d2 < reach * reach) consider(br.node, t, nearTip ? 'leaves' : 'branch');
      }
    }
    if (!best) return null;
    let node = best.node;
    while (node.placeholder) node = node.parentNode; // stand-in forks belong to their clade
    return { node, kind: best.kind, point: ray.at(best.t, new THREE.Vector3()) };
  }

  // Hover with a mouse, throttled.
  let pending = null;
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      onHover?.(pick(e.clientX, e.clientY), e.clientX, e.clientY);
    }, 70);
  });
  canvas.addEventListener('pointerleave', () => onHover?.(null));

  // Click or tap without dragging.
  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 400;
    down = null;
    if (moved < 6 && quick) onPick?.(pick(e.clientX, e.clientY), e.clientX, e.clientY);
  });

  return { pick };
}
