// Labels in the scene: a name with a thin line pointing at a branch or a
// leaf. Each label sits a little outward from the tree (seen from the
// camera), so lines fan out from the crown and labels don't cover it.
import * as THREE from 'three';

const OFFSET = 110; // px from the anchor to the label
const MARGIN = 16;

/**
 * @typedef {{ key: string, title: string, sub?: string, anchor: THREE.Vector3, alpha?: number, kind?: string }} Callout
 */
export function createCallouts() {
  const svg = document.getElementById('callout-lines');
  const layer = document.getElementById('callouts');
  const items = new Map(); // key -> { el, halo, line, dot }
  const p = new THREE.Vector3();
  const c = new THREE.Vector3();

  function make(key, kind) {
    const el = document.createElement('div');
    el.className = `callout ${kind ?? ''}`;
    el.innerHTML = '<span class="callout-title"></span><span class="callout-sub"></span>';
    layer.append(el);
    const ns = 'http://www.w3.org/2000/svg';
    const halo = document.createElementNS(ns, 'line');
    halo.setAttribute('class', 'callout-halo');
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('class', 'callout-line');
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('class', `callout-dot ${kind ?? ''}`);
    dot.setAttribute('r', kind === 'focus' ? '4.5' : '3');
    svg.append(halo, line, dot);
    const item = { el, halo, line, dot, title: null, sub: null };
    items.set(key, item);
    return item;
  }

  /**
   * @param {Callout[]} list
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} center the tree's centre, labels move away from it
   */
  function update(list, camera, center) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const bottomLimit = h - (document.querySelector('.controls')?.offsetHeight ?? 110) - 32;
    c.copy(center).project(camera);
    const cx = (c.x * 0.5 + 0.5) * w;
    const cy = (-c.y * 0.5 + 0.5) * h;
    const placed = [];
    const seen = new Set();

    for (const callout of list) {
      p.copy(callout.anchor).project(camera);
      if (p.z > 1 || p.z < -1) continue; // behind the camera
      const ax = (p.x * 0.5 + 0.5) * w;
      const ay = (-p.y * 0.5 + 0.5) * h;
      const item = items.get(callout.key) ?? make(callout.key, callout.kind);
      seen.add(callout.key);
      if (item.title !== callout.title) item.el.firstChild.textContent = item.title = callout.title;
      if (item.sub !== (callout.sub ?? '')) item.el.lastChild.textContent = item.sub = callout.sub ?? '';

      // Outward from the tree's centre, leaning upward.
      let dx = ax - cx;
      let dy = ay - cy - 40;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const right = dx >= 0;
      const lw = item.el.offsetWidth;
      const lh = item.el.offsetHeight;
      let lx = ax + dx * OFFSET;
      let ly = ay + dy * OFFSET - lh / 2;
      let left = right ? lx : lx - lw;
      left = Math.min(Math.max(left, MARGIN), w - lw - MARGIN);
      ly = Math.min(Math.max(ly, MARGIN + 140), bottomLimit - lh);
      // Step down past labels already placed.
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find((r) => left < r.x + r.w + 6 && left + lw + 6 > r.x && ly < r.y + r.h + 4 && ly + lh + 4 > r.y);
        if (!hit) break;
        ly = hit.y + hit.h + 6;
      }
      placed.push({ x: left, y: ly, w: lw, h: lh });

      const alpha = callout.alpha ?? 1;
      item.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(ly)}px)`;
      item.el.style.opacity = alpha;
      item.el.classList.toggle('left', !right);
      // Line from the anchor to the label's near edge.
      const ex = right ? left : left + lw;
      const ey = ly + lh / 2;
      for (const l of [item.halo, item.line]) {
        l.setAttribute('x1', ax.toFixed(1));
        l.setAttribute('y1', ay.toFixed(1));
        l.setAttribute('x2', ex.toFixed(1));
        l.setAttribute('y2', ey.toFixed(1));
        l.style.opacity = alpha;
      }
      item.dot.setAttribute('cx', ax.toFixed(1));
      item.dot.setAttribute('cy', ay.toFixed(1));
      item.dot.style.opacity = alpha;
    }

    for (const [key, item] of items) {
      if (seen.has(key)) continue;
      item.el.remove();
      item.halo.remove();
      item.line.remove();
      item.dot.remove();
      items.delete(key);
    }
  }

  return { update };
}
