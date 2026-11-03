// Labels in the scene: a small name with a hairline leader that bends into
// an underline beneath it, pointing at a branch or a leaf. Labels sit a
// little outward from the tree (seen from the camera), so leaders fan out
// from the crown. Click a label to fly to what it points at.
import * as THREE from 'three';

// Directions tried around the outward one (radians), nearest first.
const TURNS = [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI];
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
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
    el.innerHTML =
      '<img class="callout-img" alt="" hidden><span class="callout-text"><span class="callout-title"></span><span class="callout-sub"></span></span>';
    layer.append(el);
    const halo = document.createElementNS(NS, 'polyline');
    halo.setAttribute('class', 'callout-halo');
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('class', `callout-line ${callout.kind ?? ''}`);
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('class', `callout-dot ${callout.kind ?? ''}`);
    dot.setAttribute('r', callout.kind === 'focus' ? '3' : '2');
    svg.append(halo, line, dot);
    // The followed species' leaf gets a soft pulsing ring, so it can be found.
    let ring = null;
    if (callout.kind === 'focus') {
      ring = document.createElementNS(NS, 'circle');
      ring.setAttribute('class', 'callout-ring');
      ring.setAttribute('r', '11');
      svg.append(ring);
    }
    const item = {
      el,
      halo,
      line,
      dot,
      ring,
      img: el.querySelector('.callout-img'),
      titleEl: el.querySelector('.callout-title'),
      subEl: el.querySelector('.callout-sub'),
      title: null,
      sub: null,
      src: null,
      callout,
    };
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
    c.copy(center).project(camera);
    const cx = (c.x * 0.5 + 0.5) * w;
    const cy = (-c.y * 0.5 + 0.5) * h;
    // Everything on screen that labels must not cover.
    const blockers = ['.controls', '.topbar', '.hud', '.info']
      .map((q) => document.querySelector(q)?.getBoundingClientRect())
      .filter((r) => r && r.width)
      .map((r) => ({ x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 }));
    const small = Math.min(w, h) < 600;
    const reach = small ? [52, 80, 110] : [70, 105, 145];
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
      if (item.title !== callout.title) item.titleEl.textContent = item.title = callout.title;
      if (item.sub !== (callout.sub ?? '')) item.subEl.textContent = item.sub = callout.sub ?? '';
      if (item.src !== (callout.img ?? null)) {
        item.src = callout.img ?? null;
        item.img.hidden = !item.src;
        if (item.src) item.img.src = item.src;
      }

      // Try spots around the anchor, starting outward from the tree's centre,
      // close in first. A spot must stay on screen and clear of the controls
      // and of labels already placed. With no free spot nearby the label is
      // dropped (its dot stays) rather than drawn far away on a long line.
      const lw = item.el.offsetWidth;
      const lh = item.el.offsetHeight;
      const base = Math.atan2(ay - cy - 40, ax - cx);
      let spot = null;
      for (const dist of reach) {
        for (const turn of TURNS) {
          const ang = base + turn;
          const dx = Math.cos(ang);
          const dy = Math.sin(ang);
          const right = dx >= 0;
          const bx = ax + dx * dist * 0.6;
          const ly = ay + dy * dist - lh;
          const left = right ? bx + 10 : bx - 10 - lw;
          const r = { x: left, y: ly, w: lw, h: lh + 2 };
          if (left < MARGIN || left + lw > w - MARGIN || ly < MARGIN || ly + lh > h - MARGIN) continue;
          if ([...blockers, ...placed].some((b) => overlaps(r, b))) continue;
          spot = { left, ly, right };
          break;
        }
        if (spot) break;
      }
      item.el.style.visibility = spot ? '' : 'hidden'; // keeps its size for next frame's fit
      if (!spot) {
        item.halo.style.opacity = item.line.style.opacity = 0;
        item.dot.setAttribute('cx', ax.toFixed(1));
        item.dot.setAttribute('cy', ay.toFixed(1));
        item.dot.style.opacity = (callout.alpha ?? 1) * 0.8;
        continue;
      }
      const { left, ly, right } = spot;
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
      if (item.ring) {
        item.ring.setAttribute('cx', ax.toFixed(1));
        item.ring.setAttribute('cy', ay.toFixed(1));
      }
    }

    for (const [key, item] of items) {
      if (seen.has(key)) continue;
      item.el.remove();
      item.halo.remove();
      item.line.remove();
      item.dot.remove();
      item.ring?.remove();
      items.delete(key);
    }
  }

  return { update };
}
