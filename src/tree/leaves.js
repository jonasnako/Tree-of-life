// Leaves, computed on the GPU.
//
// Every branch's centreline lives in one small float texture (see
// branchTexture.js). A leaf is just a few static numbers: which branch, at
// what depth (or how far behind the growing tip), angle, tilt, size. The
// vertex shader looks the branch up, places and orients the leaf, unfolds
// it, ages its colour and hides it when its time is over, so leaves cost no
// JavaScript per frame however many there are.
//
// Kinds of leaves:
//   shoot leaves  - born at a fixed depth just behind the tip, live LEAF_LIFE
//   tip leaves    - ride the growing tip of a branch and stay on living tips:
//                   one leaf per species (a one-species tip ends in exactly
//                   one leaf), up to TUFT_MAX
//   sprays        - extra foliage for rich clades alive today; they fill in
//                   slowly as the clade ages, standing for leaves too many to draw
//   seed leaves   - the seedling's two cotyledons (2 instances, CPU)
import * as THREE from 'three';
import { createRandom } from '../random.js';
import { thicknessAt, smooth, GROWTH } from './growth.js';
import { TREE_HEIGHT } from './layout.js';
import { windUniforms, WIND_GLSL } from '../wind.js';

/** Shared with main.js, which keeps the sun direction (view space) and the crown current. */
export const leafLight = {
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color('#ffd9a0') },
  uCrown: { value: new THREE.Vector4(0, 5, 0, 5) }, // centre xyz, radius: for self-shading
  // Cutaway: foliage between the camera and this point (w = strength 0..1)
  // is cleared, so a single leaf deep in the crown can be seen.
  uReveal: { value: new THREE.Vector4(0, 0, 0, 0) },
  // First branch-texture sample of the followed species' twig: its leaf glows.
  uFocusSample: { value: -1 },
};

export const LEAF_LIFE = 0.14; // depth units a shoot leaf lives
const LEAF_SPACING = 0.16; // world units between leaves along a shoot
const UNFOLD = 0.006; // depth units to unfold
const TUFT_MAX = 10; // leaves at a tip: one per species, up to this many
const SPRAY_REACH = 0.03; // depth behind a growing tip that carries sprays
const COTYLEDON_HEIGHT = 0.32; // world units up the seedling stem

const FRESH = new THREE.Color('#79c043');
const MATURE = new THREE.Color('#3f7d2a');
const AUTUMN = new THREE.Color('#c9a23a');
const SEED_LEAF = new THREE.Color('#9acb5a');

/**
 * @param {object[]} branches
 * @param {{texture: THREE.DataTexture, width: number, start: Map}} branchTex
 */
export function createLeaves(branches, branchTex) {
  const shoots = branches.filter((br) => !br.isRoot);
  const leafInst = []; // [branchIndex, mode, depthOrLag, angle, tilt, size, hue]
  const sprayInst = [];
  const slots = []; // shoot leaves, for falling-leaf events on the CPU

  for (const br of shoots) {
    const d0 = br.depths[0];
    const d1 = br.depths.at(-1);
    let rand = createRandom(`${br.node.id}-leaves`);
    const count = Math.floor(br.length / LEAF_SPACING);
    for (let k = 0; k < count; k++) {
      const dist = (k + rand.range(0.3, 0.9)) * LEAF_SPACING;
      const depth = d0 + (dist / br.length) * (d1 - d0);
      const angle = k * 2.39996 + rand.range(-0.3, 0.3); // golden-angle phyllotaxis
      leafInst.push([br, 0, depth, angle, rand.range(0.7, 1.15), rand.range(0.2, 0.28), rand.range(-0.03, 0.03)]);
      slots.push({ br, depth, angle });
    }
    rand = createRandom(`${br.node.id}-tuft`);
    const species = br.node.species ?? 1;
    const living = !br.node.children.length && !br.node.endMa;
    if (species === 1) {
      // A single species: one leaf, right at the tip.
      leafInst.push([br, 1, 0.0003, 0, 0.12, 0.26, 0.02]);
    } else {
      const tips = Math.min(species, TUFT_MAX);
      for (let k = 0; k < tips; k++) {
        leafInst.push([br, 1, (k / tips) * 0.006 + 0.0006, k * 2.39996 + rand.range(-0.3, 0.3), rand.range(0.35, 0.8), rand.range(0.16, 0.24), rand.range(-0.03, 0.03)]);
      }
    }
    rand = createRandom(`${br.node.id}-sprays`);
    const richness = Math.log10((br.node.species ?? 1) + 1);
    const sprays = living && species > TUFT_MAX ? Math.round(THREE.MathUtils.clamp(2.5 * Math.log10(species / TUFT_MAX), 1, 16)) : 0;
    for (let k = 0; k < sprays; k++) {
      sprayInst.push([br, 1, rand() ** 1.5 * SPRAY_REACH, rand.range(0, Math.PI * 2), rand.range(0.35, 1.25), rand.range(0.4, 0.65) * (0.85 + 0.1 * richness), rand.range(-0.06, 0.05)]);
    }
  }

  const uniforms = { uNow: { value: 0 }, uBranchTex: { value: branchTex.texture }, ...windUniforms, ...leafLight };
  const leafMat = createGpuLeafMaterial(createLeafTexture(), uniforms, { alphaTest: 0, spray: false });
  const sprayMat = createGpuLeafMaterial(createSprayTexture(), uniforms, { alphaTest: 0.45, spray: true });
  const leafMesh = gpuLeafMesh(createLeafGeometry(), leafInst, branchTex, leafMat);
  const sprayMesh = gpuLeafMesh(createSprayGeometry(), sprayInst, branchTex, sprayMat);

  // Seed leaves: two instances, placed on the CPU.
  const root = branches[0];
  const cotyledonDepth = root.depths[0] + COTYLEDON_HEIGHT / TREE_HEIGHT;
  const ci = Math.round((COTYLEDON_HEIGHT / root.length) * (root.points.length - 1));
  const cotyledons = [0, Math.PI].map((angle) => ({ branch: root, i: ci, t: 0, depth: cotyledonDepth, angle: angle + 0.6, size: 0.15 }));
  const seedMat = createLeafMaterial(createLeafTexture());
  const seedLeaves = new THREE.InstancedMesh(createSeedLeafGeometry(), seedMat.material, 2);
  seedLeaves.geometry.setAttribute('aAge', new THREE.InstancedBufferAttribute(new Float32Array(2), 1).setUsage(THREE.DynamicDrawUsage));
  seedLeaves.customDepthMaterial = seedMat.depthMaterial;
  seedLeaves.castShadow = true;
  seedLeaves.frustumCulled = false;
  seedLeaves.count = 0;

  const group = new THREE.Group();
  group.add(leafMesh, sprayMesh, seedLeaves);

  // CPU side: only events (which leaves let go) and the two seed leaves.
  slots.sort((a, b) => a.depth - b.depth);
  const slotDepths = Float64Array.from(slots, (s) => s.depth);
  const firstAtOrAbove = (d) => {
    let lo = 0;
    let hi = slotDepths.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (slotDepths[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const tips = shoots.map((br) => ({ br, d0: br.depths[0], d1: br.depths.at(-1), living: !br.node.children.length && !br.node.endMa }));

  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const xAxis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const color = new THREE.Color();

  /** Point on a branch's surface at a depth, at an angle around it. */
  function surfacePoint(br, depth, angle, out) {
    const d0 = br.depths[0];
    const d1 = br.depths.at(-1);
    const f = THREE.MathUtils.clamp((depth - d0) / (d1 - d0 || 1), 0, 1) * (br.points.length - 1);
    const i = Math.min(br.points.length - 2, Math.floor(f));
    out.lerpVectors(br.points[i], br.points[i + 1], f - i);
    radial.copy(br.normals[i]).multiplyScalar(Math.cos(angle)).addScaledVector(br.binormals[i], Math.sin(angle));
    return out.addScaledVector(radial, br.radii[i] * 0.3);
  }

  let prevNow = 0;
  let activeSprays = 0;
  const dying = []; // world positions of leaves that just let go
  function update(now, dt = 0) {
    uniforms.uNow.value = now;
    dying.length = 0;
    const forward = now > prevNow && now - prevNow < 0.01;
    if (forward) {
      // Shoot leaves whose life just ended.
      const a = firstAtOrAbove(prevNow - LEAF_LIFE * 0.9);
      const b = firstAtOrAbove(now - LEAF_LIFE * 0.9);
      for (let k = a; k < b && dying.length < 60; k++) dying.push(surfacePoint(slots[k].br, slots[k].depth, slots[k].angle, new THREE.Vector3()));
    }
    if (now !== prevNow) {
      activeSprays = 0;
      for (const t of tips) {
        const active = now > t.d0 && (now <= t.d1 || t.living);
        if (active) activeSprays++;
        // A shoot that just forked drops the sprays at its old tip.
        if (forward && !t.living && prevNow <= t.d1 && now > t.d1) {
          for (let j = 0; j < 3; j++) dying.push(surfacePoint(t.br, t.d1 - Math.random() * 0.01, Math.random() * 6.28, new THREE.Vector3()));
        }
      }
    }
    // Now and then a leaf lets go from the living crown.
    const drops = activeSprays * dt * 0.05;
    for (let k = 0; k < drops || Math.random() < drops - k; k++) {
      const t = tips[Math.floor(Math.random() * tips.length)];
      if (now > t.d0 && (now <= t.d1 || t.living)) dying.push(surfacePoint(t.br, Math.min(now, t.d1) - Math.random() * 0.02, Math.random() * 6.28, new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0)));
      if (k > 5) break;
    }

    // Seed leaves.
    let nc = 0;
    for (const c of cotyledons) {
      const age = now - c.depth;
      if (age <= 0 || age > 0.09) continue;
      const open = smooth(0.002, 0.014, age);
      const fall = 1 - smooth(0.075, 0.09, age);
      const br = c.branch;
      const size = c.size * (0.5 + 0.5 * open) * fall;
      p.copy(br.points[c.i]);
      tan.copy(br.tangents[c.i]);
      radial.copy(br.normals[c.i]).multiplyScalar(Math.cos(c.angle)).addScaledVector(br.binormals[c.i], Math.sin(c.angle));
      p.addScaledVector(radial, br.radii[c.i] * thicknessAt(age) * 0.9);
      const tilt = 0.15 + 1.35 * open;
      yAxis.copy(tan).multiplyScalar(Math.cos(tilt)).addScaledVector(radial, Math.sin(tilt)).normalize();
      zAxis.copy(up).addScaledVector(yAxis, -up.dot(yAxis));
      if (zAxis.lengthSq() < 1e-4) zAxis.copy(radial);
      zAxis.normalize();
      xAxis.crossVectors(yAxis, zAxis);
      m4.makeBasis(xAxis.multiplyScalar(size), yAxis.multiplyScalar(size), zAxis.multiplyScalar(size)).setPosition(p);
      seedLeaves.setMatrixAt(nc, m4);
      seedLeaves.geometry.attributes.aAge.array[nc] = age;
      seedLeaves.setColorAt(nc++, color.copy(SEED_LEAF).lerp(AUTUMN, smooth(0.05, 0.08, age)));
    }
    seedLeaves.count = nc;
    seedLeaves.instanceMatrix.needsUpdate = true;
    seedLeaves.geometry.attributes.aAge.needsUpdate = true;
    if (seedLeaves.instanceColor) seedLeaves.instanceColor.needsUpdate = true;
    prevNow = now;
  }

  return { group, update, dying, counts: { leaves: leafInst.length, sprays: sprayInst.length } };
}

/** One instanced mesh; each instance carries its branch and leaf parameters. */
function gpuLeafMesh(base, inst, branchTex, material) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, base.attributes[name]);
  const aBranch = new Float32Array(inst.length * 4);
  const aMode = new Float32Array(inst.length * 4);
  const aShape = new Float32Array(inst.length * 4);
  inst.forEach(([br, mode, value, angle, tilt, size, hue], k) => {
    const living = !br.node.children.length && !br.node.endMa ? 1 : 0;
    aBranch.set([branchTex.start.get(br), br.points.length, br.depths[0], br.depths.at(-1)], k * 4);
    aMode.set([mode, value, living, 0], k * 4);
    aShape.set([angle, tilt, size, hue], k * 4);
  });
  geometry.setAttribute('aBranch', new THREE.InstancedBufferAttribute(aBranch, 4));
  geometry.setAttribute('aMode', new THREE.InstancedBufferAttribute(aMode, 4));
  geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(aShape, 4));
  geometry.instanceCount = inst.length;
  const mesh = new THREE.Mesh(geometry, material.material);
  mesh.customDepthMaterial = material.depthMaterial;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

const glslColor = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

const GPU_LEAF_VERTEX_HEADER = /* glsl */ `
attribute vec4 aBranch; // first sample, sample count, start depth, end depth
attribute vec4 aMode;   // mode (0 shoot leaf, 1 rides the tip), depth or lag, living, -
attribute vec4 aShape;  // angle, tilt, size, hue
uniform float uNow;
uniform highp sampler2D uBranchTex;
uniform vec4 uCrown;
varying vec3 vLeafColor;
varying float vShade;
varying float vGlow;
uniform vec4 uReveal;
uniform float uFocusSample;
${WIND_GLSL}

vec4 sampleTexel(float s, float k) {
  int t = int(s) * 3 + int(k);
  int w = textureSize(uBranchTex, 0).x;
  return texelFetch(uBranchTex, ivec2(t % w, t / w), 0);
}
float woodThickness(float age) {
  float g = ${GROWTH.minThickness.toFixed(3)} + ${(1 - GROWTH.minThickness).toFixed(3)} * pow(smoothstep(0.0, ${GROWTH.thickenSpan.toFixed(3)}, age), ${GROWTH.thickenPower.toFixed(3)});
  return g * smoothstep(0.0, ${GROWTH.tipLength.toFixed(4)}, age);
}
// Places, orients, unfolds, ages and hides a leaf from its branch and uNow.
void computeLeaf(out vec3 outPos, out vec3 outNormal) {
  float d0 = aBranch.z;
  float d1 = aBranch.w;
  float depth;
  float shown;
  float open;
  float scale;
  if (aMode.x < 0.5) {
    depth = aMode.y;
    float a = uNow - depth;
    shown = step(0.0, a) * step(a, ${LEAF_LIFE.toFixed(3)});
    open = smoothstep(0.0, ${UNFOLD.toFixed(4)}, a);
    scale = (0.25 + 0.75 * open) * (1.0 - smoothstep(${(LEAF_LIFE * 0.85).toFixed(4)}, ${LEAF_LIFE.toFixed(3)}, a));
    vLeafColor = mix(mix(${glslColor(FRESH)}, ${glslColor(MATURE)}, smoothstep(0.0, ${(LEAF_LIFE * 0.5).toFixed(4)}, a)), ${glslColor(AUTUMN)}, smoothstep(${(LEAF_LIFE * 0.6).toFixed(4)}, ${(LEAF_LIFE * 0.9).toFixed(4)}, a));
  } else {
    float onTip = step(d0, uNow) * max(step(uNow, d1 + 1e-6), aMode.z);
    depth = min(uNow, d1) - aMode.y * min(1.0, (d1 - d0) / ${SPRAY_REACH.toFixed(3)});
    shown = onTip * step(d0, depth);
    #ifdef SPRAY_LEAVES
      open = smoothstep(0.0, 0.08, uNow - d0); // foliage fills in slowly
    #else
      open = smoothstep(0.0, 0.008, uNow - d0);
    #endif
    scale = 0.25 + 0.75 * open;
    #ifdef SPRAY_LEAVES
      vLeafColor = mix(${glslColor(MATURE)}, ${glslColor(FRESH)}, clamp(0.35 + aShape.w * 3.0, 0.0, 1.0)) * (1.0 + aShape.w);
    #else
      vLeafColor = ${glslColor(FRESH)} * (1.0 + aShape.w);
    #endif
  }
  float age = uNow - depth;
  float f = clamp((depth - d0) / max(d1 - d0, 1e-6), 0.0, 1.0) * (aBranch.y - 1.0);
  float si = min(floor(f), aBranch.y - 2.0);
  float st = f - si;
  vec4 A0 = sampleTexel(aBranch.x + si, 0.0);
  vec4 A1 = sampleTexel(aBranch.x + si + 1.0, 0.0);
  vec4 B0 = sampleTexel(aBranch.x + si, 1.0);
  vec4 C0 = sampleTexel(aBranch.x + si, 2.0);
  vec3 P = mix(A0.xyz, A1.xyz, st);
  vec3 T = normalize(B0.xyz);
  vec3 N = normalize(C0.xyz);
  vec3 Bn = cross(T, N);
  vec3 radial = cos(aShape.x) * N + sin(aShape.x) * Bn;
  P += radial * mix(A0.w, A1.w, st) * woodThickness(age) * 0.9;
  float tilt = aShape.y * open;
  vec3 Y = normalize(T * cos(tilt) + radial * sin(tilt));
  vec3 Z = vec3(0.0, 1.0, 0.0) - Y * Y.y;
  Z = dot(Z, Z) < 1e-4 ? radial : normalize(Z);
  vec3 X = cross(Y, Z);
  // The followed species' own leaf glows softly.
  vGlow = (aMode.x > 0.5 && abs(aBranch.x - uFocusSample) < 0.5) ? 1.0 : 0.0;
  // Cutaway: hide leaves near the line of sight to the revealed point.
  if (uReveal.w > 0.0 && vGlow < 0.5) {
    vec3 toPoint = uReveal.xyz - cameraPosition;
    float along = clamp(dot(P - cameraPosition, toPoint) / dot(toPoint, toPoint), 0.0, 1.0);
    float off = length(P - (cameraPosition + toPoint * along));
    float cone = mix(0.12, 0.9, along);
    shown *= 1.0 - uReveal.w * (1.0 - smoothstep(cone * 0.7, cone, off)) * step(along, 0.98);
  }
  float size = aShape.z * scale * shown;
  vec3 pos = P + (X * position.x + Y * position.y + Z * position.z) * size;
  vec3 sway = windSway(P, age);
  pos += sway + vec3(0.0, sin(uTime * 1.7 + P.x * 3.1 + P.z * 2.3) * 0.02 * uWind * position.y * size, 0.0);
  // Self-shading: leaves deep inside the crown get less light.
  float inner = length(P - uCrown.xyz) / max(uCrown.w, 0.5);
  vShade = mix(0.45, 1.0, smoothstep(0.25, 0.95, inner));
  outPos = pos;
  outNormal = Z;
  }
`;


const GPU_LEAF_NORMAL = /* glsl */ `
vec3 leafPos;
vec3 leafNormal;
computeLeaf(leafPos, leafNormal);
vec3 objectNormal = leafNormal;
`;

function createGpuLeafMaterial(map, uniforms, { alphaTest, spray }) {
  const material = new THREE.MeshStandardMaterial({ map, alphaTest, side: THREE.DoubleSide, roughness: 0.55, metalness: 0 });
  const defines = spray ? '#define SPRAY_LEAVES\n' : '';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      defines +
      GPU_LEAF_VERTEX_HEADER +
      shader.vertexShader
        .replace('#include <beginnormal_vertex>', GPU_LEAF_NORMAL)
        .replace('#include <begin_vertex>', 'vec3 transformed = leafPos;');
    shader.fragmentShader =
      'uniform vec3 uSunView;\nuniform vec3 uSunColor;\nvarying vec3 vLeafColor;\nvarying float vShade;\nvarying float vGlow;\n' +
      shader.fragmentShader
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vLeafColor * vShade;')
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          float through = pow(max(dot(normalize(vViewPosition), -uSunView), 0.0), 3.0);
          totalEmissiveRadiance += diffuseColor.rgb * (uSunColor * through * 0.9 + 0.07);
          totalEmissiveRadiance += vec3(1.0, 0.72, 0.18) * vGlow * 0.35;`,
        );
  };
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: alphaTest ? map : null, alphaTest });
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      defines +
      GPU_LEAF_VERTEX_HEADER +
      shader.vertexShader.replace('#include <begin_vertex>', 'vec3 leafPos;\nvec3 leafNormal;\ncomputeLeaf(leafPos, leafNormal);\nvec3 transformed = leafPos;');
  };
  return { material, depthMaterial };
}

/** A pointed leaf along +Y, slightly cupped and drooping at the tip. */
function createLeafGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.3, 0.2, 0.32, 0.65, 0, 1);
  shape.bezierCurveTo(-0.32, 0.65, -0.3, 0.2, 0, 0);
  const g = new THREE.ShapeGeometry(shape, 4);
  setLeafUv(g, 0.7, 1);
  bend(g, 0.6, 0.25);
  return g;
}

/** A round, fleshy seed leaf. */
function createSeedLeafGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.12, 0.05, 0.5, 0.35, 0, 0.9);
  shape.bezierCurveTo(-0.5, 0.35, -0.12, 0.05, 0, 0);
  const g = new THREE.ShapeGeometry(shape, 8);
  setLeafUv(g, 1.0, 0.9);
  bend(g, 0.9, 0.1);
  return g;
}

function bend(geometry, cup, droop) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, cup * x * x - droop * y * y);
  }
  geometry.computeVertexNormals();
}

function setLeafUv(geometry, width, length) {
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / width + 0.5, pos.getY(i) / length);
}

/** Pale veins on a white leaf; the instance colour tints it. */
function createLeafTexture() {
  const w = 128;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#b9b9b9');
  grad.addColorStop(0.5, '#e6e6e6');
  grad.addColorStop(1, '#b9b9b9');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,240,0.85)';
  ctx.lineCap = 'round';
  // Midrib.
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w / 2, h);
  ctx.lineTo(w / 2, 6);
  ctx.stroke();
  // Side veins, curving toward the tip.
  ctx.lineWidth = 1.6;
  for (let k = 1; k < 9; k++) {
    const y = h - k * (h / 9.5);
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(w / 2, y);
      ctx.quadraticCurveTo(w / 2 + dir * w * 0.22, y - 14, w / 2 + dir * w * 0.42, y - 34);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const LEAF_VERTEX_HEADER = /* glsl */ `
attribute float aAge;
${WIND_GLSL}
`;

// Instancing first, then the same wind as the wood, plus a quick flutter.
const LEAF_PROJECT = /* glsl */ `
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  vec3 anchor = instanceMatrix[3].xyz;
  mvPosition.xyz += windSway(anchor, aAge);
  float flutter = sin(uTime * 4.0 + anchor.x * 3.1 + anchor.z * 2.3) * 0.04 * uWind;
  mvPosition.y += flutter * transformed.y;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

/** Leaf material: shared wind, sunlight through the blade, faint glow. */
export function createLeafMaterial(map, { alphaTest = 0 } = {}) {
  const material = new THREE.MeshStandardMaterial({
    map,
    alphaTest,
    side: THREE.DoubleSide,
    roughness: 0.55,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms, leafLight);
    shader.vertexShader = LEAF_VERTEX_HEADER + shader.vertexShader.replace('#include <project_vertex>', LEAF_PROJECT);
    shader.fragmentShader =
      'uniform vec3 uSunView;\nuniform vec3 uSunColor;\n' +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // Sunlight shining through the leaf when you look toward the sun,
        // plus a faint glow so fresh leaves never go dull in shade.
        float through = pow(max(dot(normalize(vViewPosition), -uSunView), 0.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * (uSunColor * through * 0.9 + 0.07);`,
      );
  };
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: alphaTest ? map : null, alphaTest });
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms);
    shader.vertexShader = LEAF_VERTEX_HEADER + shader.vertexShader.replace('#include <project_vertex>', LEAF_PROJECT);
  };
  return { material, depthMaterial };
}

/** Two crossed cards, pivoting at the twig's base, for a spray of leaves. */
function createSprayGeometry() {
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const pos = [...a.attributes.position.array, ...b.attributes.position.array];
  const nor = [...a.attributes.normal.array, ...b.attributes.normal.array];
  const uv = [...a.attributes.uv.array, ...b.attributes.uv.array];
  const idx = [...a.index.array, ...[...b.index.array].map((i) => i + 4)];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A twig with a dozen overlapping leaves, drawn once into a texture. */
function createSprayTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const rand = createRandom('spray-texture');
  // Stem.
  ctx.strokeStyle = 'rgb(120,110,90)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(128, 256);
  ctx.quadraticCurveTo(118, 150, 132, 40);
  ctx.stroke();
  const leaf = (x, y, angle, len, shade) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const w = len * 0.32;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(w, -len * 0.2, w, -len * 0.7, 0, -len);
    ctx.bezierCurveTo(-w, -len * 0.7, -w, -len * 0.2, 0, 0);
    const g = ctx.createLinearGradient(-w, 0, w, 0);
    g.addColorStop(0, `rgb(${shade - 40},${shade - 40},${shade - 40})`);
    g.addColorStop(0.5, `rgb(${shade},${shade},${shade})`);
    g.addColorStop(1, `rgb(${shade - 55},${shade - 55},${shade - 55})`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,240,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -len * 0.95);
    ctx.stroke();
    ctx.restore();
  };
  for (let k = 0; k < 14; k++) {
    const t = 0.12 + (k / 14) * 0.85;
    const y = 256 - t * 220;
    const x = 128 + Math.sin(t * 3) * 6;
    const side = k % 2 ? 1 : -1;
    leaf(x, y, side * rand.range(0.6, 1.15), rand.range(52, 78) * (1.1 - t * 0.35), Math.round(rand.range(185, 250)));
  }
  leaf(132, 46, rand.range(-0.15, 0.15), 60, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
