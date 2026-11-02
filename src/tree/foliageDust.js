// The immensity of a big clade: a cloud of countless tiny leaves.
//
// Each living clade richer than ten species gets a dense mass of small leaf
// points hugging the last part of its twig (thicker toward the tip), so the
// foliage grows from the wood rather than floating beside it. Richer clades
// get many more (the share of the budget grows with the square root of the
// species count). Every point is one GPU vertex
// drawn as a little leaf shape, so tens of thousands cost almost nothing.
// Points are coloured by conservation status, sampled from the clade's
// approximate share of threatened species: the crown shows what we are losing.
// Points are shuffled once, so from far away only a leading share is drawn.
import * as THREE from 'three';
import { createRandom } from '../random.js';
import { windUniforms, WIND_GLSL } from '../wind.js';
import { leafLight } from './leaves.js';
import { STATUS, threatOf, sampleStatus } from './status.js';

const TUFT_MAX = 10;
const glsl = (hex) => {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

export function createFoliageDust(branches, branchTex, { budget = 60000 } = {}) {
  const masses = branches.filter(
    (br) => !br.isRoot && !br.node.children.length && !br.node.endMa && !br.node.leaves && (br.node.species ?? 1) > TUFT_MAX,
  );
  const weights = masses.map((br) => Math.sqrt(br.node.species));
  const total = weights.reduce((a, b) => a + b, 0) || 1;

  const points = [];
  masses.forEach((br, m) => {
    const rand = createRandom(`${br.node.id}-dust`);
    const species = br.node.species;
    const ls = br.leafScale ?? 1;
    // Thickness of the leafy sleeve around the twig.
    const R = 0.12 * Math.pow(species, 1 / 6) * ls;
    const count = Math.max(40, Math.round((budget * weights[m]) / total));
    const threat = threatOf(br.node);
    for (let k = 0; k < count; k++) {
      // Where along the twig (0 = tip, 1 = back along it), and how far out:
      // mostly near the surface of the sleeve, so it reads as a canopy.
      const along = Math.pow(rand(), 1.4);
      const ang = rand.range(0, Math.PI * 2);
      const r = R * (0.35 + 0.65 * Math.pow(rand(), 0.5)) * (1 - 0.45 * along);
      points.push({
        br,
        off: [along, Math.cos(ang) * r, Math.sin(ang) * r],
        size: rand.range(0.035, 0.065) * Math.max(0.6, ls),
        angle: rand.range(0, Math.PI * 2),
        status: sampleStatus(threat, rand, 0.04),
        shade: rand.range(0.75, 1.15),
        rank: rand(),
      });
    }
  });
  points.sort((a, b) => a.rank - b.rank);

  const n = points.length;
  const aBranch = new Float32Array(n * 4);
  const aOffset = new Float32Array(n * 3);
  const aMisc = new Float32Array(n * 4);
  points.forEach((p, i) => {
    aBranch.set([branchTex.start.get(p.br), p.br.points.length, p.br.depths[0], p.br.depths.at(-1)], i * 4);
    aOffset.set(p.off, i * 3);
    aMisc.set([p.size, p.angle, p.status, p.shade], i * 4);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geometry.setAttribute('aBranch', new THREE.BufferAttribute(aBranch, 4));
  geometry.setAttribute('aOffset', new THREE.BufferAttribute(aOffset, 3));
  geometry.setAttribute('aMisc', new THREE.BufferAttribute(aMisc, 4));

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uNow: { value: 0 },
    uBranchTex: { value: branchTex.texture },
    uLodScale: { value: 1 },
    uPointScale: { value: 500 },
    ...windUniforms,
    uCrown: leafLight.uCrown,
  });
  const statusColors = STATUS.map((s, i) => `s < ${i + 1.5} ? ${glsl(s.color)} : `).join('') + 'vec3(0.0)';

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */ `
      attribute vec4 aBranch;
      attribute vec3 aOffset;
      attribute vec4 aMisc;
      uniform float uNow;
      uniform highp sampler2D uBranchTex;
      uniform float uLodScale;
      uniform float uPointScale;
      uniform vec4 uCrown;
      varying vec3 vColor;
      varying float vAngle;
      ${WIND_GLSL}
      #include <fog_pars_vertex>
      vec4 sampleTexel(float s, float k) {
        int t = int(s) * 3 + int(k);
        int w = textureSize(uBranchTex, 0).x;
        return texelFetch(uBranchTex, ivec2(t % w, t / w), 0);
      }
      void main() {
        float d0 = aBranch.z;
        float d1 = aBranch.w;
        float shown = step(d0, uNow);
        float open = smoothstep(0.0, 0.08, uNow - d0);
        // Along the last part of the twig, behind its current tip.
        float depth = max(d0, min(uNow, d1) - aOffset.x * (d1 - d0) * 0.7 * open);
        float f = clamp((depth - d0) / max(d1 - d0, 1e-6), 0.0, 1.0) * (aBranch.y - 1.0);
        float si = min(floor(f), aBranch.y - 2.0);
        vec3 P = mix(sampleTexel(aBranch.x + si, 0.0).xyz, sampleTexel(aBranch.x + si + 1.0, 0.0).xyz, f - si);
        vec3 T = normalize(sampleTexel(aBranch.x + si, 1.0).xyz);
        vec3 N = normalize(sampleTexel(aBranch.x + si, 2.0).xyz);
        vec3 B = cross(T, N);
        P += (N * aOffset.y + B * aOffset.z) * (0.3 + 0.7 * open) + T * (0.25 * length(aOffset.yz));
        P += windSway(P, 0.02);
        vec4 mvPosition = modelViewMatrix * vec4(P, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aMisc.x * uLodScale * open * shown * uPointScale / max(-mvPosition.z, 0.05);
        // Healthy leaves in varied greens; threatened ones in their status colour.
        float s = aMisc.z;
        vec3 green = mix(vec3(0.10, 0.36, 0.05), vec3(0.28, 0.62, 0.10), fract(aMisc.w * 7.31));
        vColor = (s > 0.5 ? ${statusColors} : green) * aMisc.w;
        float inner = length(P - uCrown.xyz) / max(uCrown.w, 0.5);
        vColor *= mix(0.62, 1.1, smoothstep(0.2, 0.95, inner));
        vAngle = aMisc.y;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAngle;
      #include <fog_pars_fragment>
      void main() {
        // A small pointed leaf, turned at its own angle.
        vec2 c = gl_PointCoord - 0.5;
        float ca = cos(vAngle), sa = sin(vAngle);
        c = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
        float along = c.y * 2.0; // -1..1
        float half_ = 0.32 * pow(max(1.0 - along * along, 0.0), 0.7);
        if (abs(c.x) > half_ || abs(along) > 1.0) discard;
        vec3 col = vColor * (0.82 + 0.3 * (0.5 - c.y)) * (1.0 - 0.25 * smoothstep(0.6, 1.0, abs(c.x) / half_));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });

  const mesh = new THREE.Points(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    count: n,
    update(now, renderer, camera) {
      uniforms.uNow.value = now;
      const h = renderer.domElement.height;
      uniforms.uPointScale.value = h * 0.5 * camera.projectionMatrix.elements[5];
    },
    setDetail(share) {
      const f = THREE.MathUtils.clamp(share, 0.15, 1);
      geometry.setDrawRange(0, Math.max(1, Math.ceil(n * f)));
      uniforms.uLodScale.value = Math.min(2.2, 1 / Math.sqrt(f));
    },
  };
}
