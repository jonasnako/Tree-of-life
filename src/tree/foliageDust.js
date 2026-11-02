// The immensity of a big clade: dense foliage on small side twigs.
//
// Each living clade richer than ten species grows many thin sprigs from the
// last part of its twig (angled outward and forward, like real side shoots),
// and every small leaf grows along a sprig, mostly toward its tip. Twig,
// sprig and leaf are placed from the same branch frame on the GPU (see
// branchTexture.js) and sway with the same wind, so no leaf floats. Richer
// clades get more sprigs, more leaves and a thicker leafy sleeve (its radius
// grows with the sixth root of the species count).
//
// Leaves are GPU points drawn as little leaf shapes, coloured by conservation
// status sampled from the clade's approximate share of threatened species.
// Detail follows the zoom, leaf by leaf: each point knows its distance to the
// camera, and far away only a shuffled share of them draws (a little larger),
// while everything near the camera draws in full.
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

// Shared: the twig's frame at a point `along` its last part (0 = tip).
const FRAME_GLSL = /* glsl */ `
uniform float uNow;
uniform highp sampler2D uBranchTex;
vec4 sampleTexel(float s, float k) {
  int t = int(s) * 3 + int(k);
  int w = textureSize(uBranchTex, 0).x;
  return texelFetch(uBranchTex, ivec2(t % w, t / w), 0);
}
// Fills P, T, N, B for the twig described by br at "along"; returns the age there.
float twigFrame(vec4 br, float along, float open, out vec3 P, out vec3 T, out vec3 N, out vec3 B) {
  float d0 = br.z;
  float d1 = br.w;
  float depth = max(d0, min(uNow, d1) - along * (d1 - d0) * 0.85 * open);
  float f = clamp((depth - d0) / max(d1 - d0, 1e-6), 0.0, 1.0) * (br.y - 1.0);
  float si = min(floor(f), br.y - 2.0);
  P = mix(sampleTexel(br.x + si, 0.0).xyz, sampleTexel(br.x + si + 1.0, 0.0).xyz, f - si);
  T = normalize(sampleTexel(br.x + si, 1.0).xyz);
  N = normalize(sampleTexel(br.x + si, 2.0).xyz);
  B = cross(T, N);
  return uNow - depth;
}
`;

export function createFoliageDust(branches, branchTex, { budget = 160000, sprigBudget = 9000 } = {}) {
  const masses = branches.filter(
    (br) => !br.isRoot && !br.node.children.length && !br.node.endMa && !br.node.leaves && (br.node.species ?? 1) > TUFT_MAX,
  );
  const weights = masses.map((br) => Math.sqrt(br.node.species));
  const total = weights.reduce((a, b) => a + b, 0) || 1;

  const sprigs = [];
  const leaves = [];
  masses.forEach((br, m) => {
    const rand = createRandom(`${br.node.id}-sprigs`);
    const species = br.node.species;
    const ls = br.leafScale ?? 1;
    const R = 0.3 * Math.pow(species, 1 / 6) * ls; // thickness of the leafy sleeve
    const nSprigs = Math.max(5, Math.round((sprigBudget * weights[m]) / total));
    const nLeaves = Math.max(40, Math.round((budget * weights[m]) / total));
    const threat = threatOf(br.node);
    const mine = [];
    for (let k = 0; k < nSprigs; k++) {
      const along = Math.pow(rand(), 1.2) * 0.9;
      const ang = rand.range(0, Math.PI * 2);
      const elev = rand.range(0.25, 0.9); // leaning forward along the twig
      const len = R * rand.range(0.6, 1.1) * (1 - 0.35 * along);
      const dir = [Math.sin(elev), Math.cos(elev) * Math.cos(ang), Math.cos(elev) * Math.sin(ang)];
      const s = { br, along, tip: dir.map((d) => d * len), radius: 0.012 * Math.max(0.5, ls) * (0.6 + len / Math.max(R, 1e-3)) };
      sprigs.push(s);
      mine.push(s);
    }
    for (let k = 0; k < nLeaves; k++) {
      const s = mine[Math.floor(rand() * mine.length)];
      const u = 0.3 + 0.7 * Math.pow(rand(), 0.6); // mostly toward the sprig's tip
      const jitter = 0.12 * Math.hypot(...s.tip);
      leaves.push({
        br,
        along: s.along,
        off: s.tip.map((d) => d * u + rand.range(-1, 1) * jitter),
        size: rand.range(0.06, 0.1) * Math.max(0.6, ls),
        angle: rand.range(0, Math.PI * 2),
        status: sampleStatus(threat, rand, 0.04),
        shade: rand.range(0.75, 1.15),
        rank: rand(),
      });
    }
  });

  const branchAttr = (list) => {
    const a = new Float32Array(list.length * 4);
    list.forEach((p, i) => a.set([branchTex.start.get(p.br), p.br.points.length, p.br.depths[0], p.br.depths.at(-1)], i * 4));
    return a;
  };

  // --- Leaves: points.
  const n = leaves.length;
  const aLocal = new Float32Array(n * 4);
  const aMisc = new Float32Array(n * 4);
  const aRank = new Float32Array(n);
  leaves.forEach((p, i) => {
    aLocal.set([p.along, ...p.off], i * 4);
    aMisc.set([p.size, p.angle, p.status, p.shade], i * 4);
    aRank[i] = p.rank;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geometry.setAttribute('aBranch', new THREE.BufferAttribute(branchAttr(leaves), 4));
  geometry.setAttribute('aLocal', new THREE.BufferAttribute(aLocal, 4));
  geometry.setAttribute('aMisc', new THREE.BufferAttribute(aMisc, 4));
  geometry.setAttribute('aRank', new THREE.BufferAttribute(aRank, 1));

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, {
    uNow: { value: 0 },
    uBranchTex: { value: branchTex.texture },
    uPointScale: { value: 500 },
    uLodNear: { value: 6 },
    ...windUniforms,
    uCrown: leafLight.uCrown,
  });
  const statusColors = STATUS.map((s, i) => `s < ${i + 1.5} ? ${glsl(s.color)} : `).join('') + 'vec3(0.0)';

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */ `
      attribute vec4 aBranch;
      attribute vec4 aLocal;
      attribute vec4 aMisc;
      attribute float aRank;
      uniform float uPointScale;
      uniform float uLodNear;
      uniform vec4 uCrown;
      varying vec3 vColor;
      varying float vAngle;
      ${WIND_GLSL}
      ${FRAME_GLSL}
      #include <fog_pars_vertex>
      void main() {
        float shown = step(aBranch.z, uNow);
        float open = smoothstep(0.0, 0.08, uNow - aBranch.z);
        vec3 P, T, N, B;
        float age = twigFrame(aBranch, aLocal.x, open, P, T, N, B);
        P += (T * aLocal.y + N * aLocal.z + B * aLocal.w) * open;
        P += windSway(P, age);
        vec4 mvPosition = modelViewMatrix * vec4(P, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // Detail by distance: near the camera every leaf, far away a shuffled
        // share drawn a little larger.
        float dist = max(-mvPosition.z, 0.05);
        float keep = clamp(pow(uLodNear / dist, 2.0), 0.2, 1.0);
        // Kept leaves grow a bit more than they thin out, so the canopy stays closed.
        float size = aMisc.x * open * shown * step(aRank, keep) * pow(keep, -0.65);
        gl_PointSize = size * uPointScale / dist;
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
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  // --- Sprigs: thin three-sided tubes from the twig to the leaves.
  const tube = new THREE.BufferGeometry();
  {
    const pos = [];
    const idx = [];
    for (let r = 0; r < 2; r++) for (let j = 0; j < 3; j++) pos.push(Math.cos((j / 3) * Math.PI * 2), r, Math.sin((j / 3) * Math.PI * 2));
    for (let j = 0; j < 3; j++) {
      const a = j;
      const b = (j + 1) % 3;
      idx.push(a, b, a + 3, b, b + 3, a + 3);
    }
    tube.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tube.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((v, i) => (i % 3 === 1 ? 0 : v)), 3));
    tube.setIndex(idx);
  }
  const sg = new THREE.InstancedBufferGeometry();
  sg.index = tube.index;
  sg.setAttribute('position', tube.attributes.position);
  sg.setAttribute('normal', tube.attributes.normal);
  const sLocal = new Float32Array(sprigs.length * 4);
  const sRadius = new Float32Array(sprigs.length);
  sprigs.forEach((s, i) => {
    sLocal.set([s.along, ...s.tip], i * 4);
    sRadius[i] = s.radius;
  });
  sg.setAttribute('aBranch', new THREE.InstancedBufferAttribute(branchAttr(sprigs), 4));
  sg.setAttribute('aLocal', new THREE.InstancedBufferAttribute(sLocal, 4));
  sg.setAttribute('aRadius', new THREE.InstancedBufferAttribute(sRadius, 1));
  sg.instanceCount = sprigs.length;
  const sprigMat = new THREE.MeshStandardMaterial({ color: '#5a4630', roughness: 0.9, metalness: 0 });
  sprigMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      `attribute vec4 aBranch;\nattribute vec4 aLocal;\nattribute float aRadius;\n${WIND_GLSL}\n${FRAME_GLSL}\n` +
      shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `
          float open = smoothstep(0.0, 0.08, uNow - aBranch.z) * step(aBranch.z, uNow);
          vec3 P, T, N, B;
          float sAge = twigFrame(aBranch, aLocal.x, open, P, T, N, B);
          vec3 tipOff = (T * aLocal.y + N * aLocal.z + B * aLocal.w) * open;
          vec3 axis = normalize(tipOff + T * 1e-4);
          vec3 side = normalize(cross(axis, abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 side2 = cross(axis, side);
          vec3 objectNormal = side * normal.x + side2 * normal.z;`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          vec3 transformed = P + tipOff * position.y + (side * position.x + side2 * position.z) * aRadius * open * (1.0 - 0.7 * position.y);
          transformed += windSway(transformed, sAge);`,
        );
  };
  const sprigMesh = new THREE.Mesh(sg, sprigMat);
  sprigMesh.frustumCulled = false;
  sprigMesh.receiveShadow = true;

  const mesh = new THREE.Group();
  mesh.add(sprigMesh, points);

  return {
    mesh,
    count: n,
    update(now, renderer, camera) {
      uniforms.uNow.value = now;
      const h = renderer.domElement.height;
      uniforms.uPointScale.value = h * 0.5 * camera.projectionMatrix.elements[5];
    },
    /** Distance (world units) within which every leaf is drawn. */
    setDetail(nearDistance) {
      uniforms.uLodNear.value = nearDistance;
    },
  };
}
