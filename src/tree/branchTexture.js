// Every branch centreline packed into one float texture, so shaders can
// place things on branches without any per-frame JavaScript.
//
// Per centreline sample, three RGBA texels:
//   0: position xyz, full radius
//   1: tangent xyz,  depth
//   2: normal xyz,   path distance from the seed
// Samples of one branch are consecutive; `start` gives each branch's first.
import * as THREE from 'three';

const WIDTH = 2048;

export function createBranchTexture(branches) {
  const start = new Map();
  let total = 0;
  for (const br of branches) {
    start.set(br, total);
    total += br.points.length;
  }
  const height = Math.max(1, Math.ceil((total * 3) / WIDTH));
  const data = new Float32Array(WIDTH * height * 4);
  for (const br of branches) {
    let s = start.get(br);
    for (let i = 0; i < br.points.length; i++, s++) {
      const o = s * 12;
      const p = br.points[i];
      const t = br.tangents[i];
      const n = br.normals[i];
      data.set([p.x, p.y, p.z, br.radii[i], t.x, t.y, t.z, br.depths[i], n.x, n.y, n.z, br.paths?.[i] ?? 0], o);
    }
  }
  const texture = new THREE.DataTexture(data, WIDTH, height, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return { texture, start, samples: total, bytes: data.byteLength };
}
