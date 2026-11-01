// Procedural, tileable bark texture: long vertical ridges split by dark furrows.
// Returns a colour map and a matching bump map. Generated once at startup.
import * as THREE from 'three';
import { createRandom } from '../random.js';

function makeNoise(seed, periodX, periodY) {
  const rand = createRandom(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = rand();
  const at = (ix, iy) => {
    const x = ((ix % periodX) + periodX) % periodX;
    const y = ((iy % periodY) + periodY) % periodY;
    return table[(y % size) * size + (x % size)];
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  // Value noise that wraps every periodX × periodY lattice cells (so it tiles).
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

export function createBarkTextures(size = 512, seed = 'bark') {
  const octaves = [
    { fx: 10, fy: 2, amp: 1.0 },
    { fx: 20, fy: 4, amp: 0.5 },
    { fx: 40, fy: 8, amp: 0.25 },
    { fx: 80, fy: 16, amp: 0.125 },
  ].map((o, i) => ({ ...o, noise: makeNoise(`${seed}-${i}`, o.fx, o.fy) }));
  const grain = makeNoise(`${seed}-grain`, 128, 128);

  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  colorCanvas.width = bumpCanvas.width = size;
  colorCanvas.height = bumpCanvas.height = size;
  const cctx = colorCanvas.getContext('2d');
  const bctx = bumpCanvas.getContext('2d');
  const color = cctx.createImageData(size, size);
  const bump = bctx.createImageData(size, size);

  const dark = [52, 38, 28];
  const mid = [120, 96, 72];
  const light = [178, 160, 136];
  const mix = (a, b, t) => a + (b - a) * t;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let n = 0;
      let norm = 0;
      for (const o of octaves) {
        n += o.noise(u * o.fx, v * o.fy) * o.amp;
        norm += o.amp;
      }
      n /= norm;
      // Ridges: lift the high values, carve the low ones into furrows.
      const ridge = Math.min(1, Math.max(0, (n - 0.38) / 0.24));
      const furrow = ridge * ridge * (3 - 2 * ridge);
      const g = grain(u * 128, v * 128);
      const lichen = Math.max(0, octaves[1].noise(u * 20 + 7, v * 4 + 3) - 0.72) * 2.2;

      const t = furrow * 0.85 + g * 0.15;
      let r = t < 0.5 ? mix(dark[0], mid[0], t * 2) : mix(mid[0], light[0], (t - 0.5) * 2);
      let gr = t < 0.5 ? mix(dark[1], mid[1], t * 2) : mix(mid[1], light[1], (t - 0.5) * 2);
      let b = t < 0.5 ? mix(dark[2], mid[2], t * 2) : mix(mid[2], light[2], (t - 0.5) * 2);
      // A faint grey-green lichen on the ridges.
      r = mix(r, 128, lichen * furrow * 0.5);
      gr = mix(gr, 138, lichen * furrow * 0.5);
      b = mix(b, 104, lichen * furrow * 0.5);

      const i = (y * size + x) * 4;
      color.data[i] = r;
      color.data[i + 1] = gr;
      color.data[i + 2] = b;
      color.data[i + 3] = 255;
      const h = (furrow * 0.8 + g * 0.2) * 255;
      bump.data[i] = bump.data[i + 1] = bump.data[i + 2] = h;
      bump.data[i + 3] = 255;
    }
  }
  cctx.putImageData(color, 0, 0);
  bctx.putImageData(bump, 0, 0);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  for (const tex of [map, bumpMap]) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
  }
  return { map, bumpMap };
}
