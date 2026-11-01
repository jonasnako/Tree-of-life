// Labels in the scene: a small name with a hairline leader that bends into
// an underline beneath it, pointing at a branch or a leaf. Labels sit a
// little outward from the tree (seen from the camera), so leaders fan out
// from the crown. Click a label to fly to what it points at.
import * as THREE from 'three';

const OFFSET = 96; // px from the anchor to the label
const MARGIN = 16;
const NS = 'http://www.w3.org/2000/svg';

/**
 * @typedef {{ key: string, title: string, sub?: string, anchor: THREE.Vector3, alpha?: number, kind?: string }} Callout
 * @param {{ onPick?: (callout: Callout) => void }} options
 */
export function createCallouts({ onPick } = {}) {
  const svg = document.getElementById('callout-lines');
  const layer = document.getElementById('callouts');
  const items = new Map();
  const p = new THREE.Vector3();
  const c = new THREE.Vector3();

  function make(callout) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `callout ${callout.kind ?? ''}`;
    el.innerHTML = '<span class="callout-title"></span><span class="callout-sub"></span>';
    layer.append(el);
    const halo = document.createElementNS(NS, 'polyline');
    halo.setAttribute('class', 'callout-halo');
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('class', `callout-line ${callout.kind ?? ''}`);
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('class', `callout-dot ${callout.kind ?? ''}`);
    dot.setAttribute('r', callout.kind === 'focus' ? '3' : '2');
    svg.append(halo, line, dot);
    const item = { el, halo, line, dot, title: null, sub: null, callout };
    el.addEventListener('click', () => onPick?.(item.callout));
    items.set(callout.key, item);
    return item;
  }

  /**
   * @param {Callout[]} list
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} center the tree's centre; labels move away from it
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
      const item = items.get(callout.key) ?? make(callout);
      item.callout = callout;
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
      const bx = ax + dx * OFFSET * 0.6; // where the leader bends
      let ly = ay + dy * OFFSET - lh;
      let left = right ? bx + 10 : bx - 10 - lw;
      left = Math.min(Math.max(left, MARGIN), w - lw - MARGIN);
      ly = Math.min(Math.max(ly, MARGIN), bottomLimit - lh);
      // Keep clear of the counter in the top-left corner.
      if (left < 250 && ly < 150) ly = 150;
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find((r) => left < r.x + r.w + 8 && left + lw + 8 > r.x && ly < r.y + r.h + 2 && ly + lh + 2 > r.y);
        if (!hit) break;
        ly = hit.y + hit.h + 4;
      }
      placed.push({ x: left, y: ly, w: lw, h: lh });

      const alpha = callout.alpha ?? 1;
      item.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(ly)}px)`;
      item.el.style.opacity = alpha;
      item.el.classList.toggle('left', !right);
      // Leader: anchor -> bend -> along the underline beneath the label.
      const under = ly + lh + 1;
      const near = right ? left : left + lw;
      const far = right ? left + lw : left;
      const pts = `${ax.toFixed(1)},${ay.toFixed(1)} ${near.toFixed(1)},${under.toFixed(1)} ${far.toFixed(1)},${under.toFixed(1)}`;
      for (const l of [item.halo, item.line]) {
        l.setAttribute('points', pts);
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
