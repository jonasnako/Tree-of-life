// Leaves on young shoots, leafy sprays that make up the living crown, and
// the two seed leaves (cotyledons) of the seedling.
// Leaves sit along every branch. Each one unfolds just behind the growing
// tip, stays while the shoot is young, then yellows and falls once the
// wood behind it turns to bark. So the green always rides on the fresh growth.
import * as THREE from 'three';
import { createRandom } from '../random.js';
import { thicknessAt, smooth } from './growth.js';
import { TREE_HEIGHT } from './layout.js';
import { windUniforms, WIND_GLSL } from '../wind.js';

/** Shared with main.js, which keeps the sun direction (view space) current. */
export const leafLight = {
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color('#ffd9a0') },
};

const LEAF_SPACING = 0.11; // world units between leaves along a shoot
const LEAF_LIFE = 0.14; // depth units a leaf lives
const UNFOLD = 0.006; // depth units to unfold
const TUFT = 8;
const SPRAY_REACH = 0.03; // depth behind a growing tip that carries sprays // leaves around each growing tip
const COTYLEDON_HEIGHT = 0.32; // world units up the seedling stem

const FRESH = new THREE.Color('#79c043');
const MATURE = new THREE.Color('#3f7d2a');
const AUTUMN = new THREE.Color('#c9a23a');
const SEED_LEAF = new THREE.Color('#9acb5a');

export function createLeaves(branches) {
  const slots = [];
  const shoots = branches.filter((br) => !br.isRoot);
  for (const br of shoots) {
    const rand = createRandom(`${br.node.id}-leaves`);
    const count = Math.floor(br.length / LEAF_SPACING);
    for (let k = 0; k < count; k++) {
      const dist = (k + rand.range(0.3, 0.9)) * LEAF_SPACING;
      const f = (dist / br.length) * (br.points.length - 1);
      const i = Math.min(br.points.length - 2, Math.floor(f));
      slots.push({
        branch: br,
        i,
        t: f - i,
        depth: br.depths[0] + (dist / br.length) * (br.depths.at(-1) - br.depths[0]),
        angle: k * 2.39996 + rand.range(-0.3, 0.3), // golden-angle phyllotaxis
        tilt: rand.range(0.7, 1.15), // radians away from the stem
        size: rand.range(0.3, 0.42),
        hue: rand.range(-0.03, 0.03),
      });
    }
  }

  // A tuft of young leaves riding on every growing tip.
  const tufts = [];
  for (const br of shoots) {
    const rand = createRandom(`${br.node.id}-tuft`);
    for (let k = 0; k < TUFT; k++) {
      tufts.push({
        branch: br,
        lag: (k / TUFT) * 0.006 + 0.0006, // depth behind the tip
        angle: k * 2.39996 + rand.range(-0.3, 0.3),
        tilt: rand.range(0.35, 0.8),
        size: rand.range(0.24, 0.36),
        hue: rand.range(-0.03, 0.03),
      });
    }
  }

  // Leafy sprays: each card is a twig with many leaves, so the crown can
  // be dense without drawing every leaf. More species, more foliage.
  const sprays = [];
  for (const br of shoots) {
    const rand = createRandom(`${br.node.id}-sprays`);
    const richness = Math.log10((br.node.species ?? 1) + 1);
    const count = Math.round(THREE.MathUtils.clamp(5 + richness * 3, 5, 22));
    for (let k = 0; k < count; k++) {
      sprays.push({
        branch: br,
        lag: (rand() ** 1.5) * SPRAY_REACH,
        angle: rand.range(0, Math.PI * 2),
        tilt: rand.range(0.35, 1.25),
        size: rand.range(0.55, 0.95) * (0.85 + 0.12 * richness),
        hue: rand.range(-0.04, 0.03),
        light: rand.range(-0.06, 0.05),
        wasVisible: false,
      });
    }
  }

  // Two seed leaves, opposite each other, low on the first stem.
  const root = branches[0];
  const cotyledonDepth = root.depths[0] + (COTYLEDON_HEIGHT / TREE_HEIGHT);
  const ci = Math.round((COTYLEDON_HEIGHT / root.length) * (root.points.length - 1));
  const cotyledons = [0, Math.PI].map((angle) => ({ branch: root, i: ci, t: 0, depth: cotyledonDepth, angle: angle + 0.6, size: 0.15 }));

  const { material: leafMaterial, depthMaterial } = createLeafMaterial(createLeafTexture());
  const leaves = new THREE.InstancedMesh(createLeafGeometry(), leafMaterial, slots.length + tufts.length);
  const seedLeaves = new THREE.InstancedMesh(createSeedLeafGeometry(), leafMaterial, 2);
  for (const m of [leaves, seedLeaves]) {
    // Age of the wood each leaf hangs on, so the wind moves leaf and twig together.
    m.geometry.setAttribute('aAge', new THREE.InstancedBufferAttribute(new Float32Array(m.count), 1).setUsage(THREE.DynamicDrawUsage));
    m.customDepthMaterial = depthMaterial;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, FRESH);
  }
  const sprayMat = createLeafMaterial(createSprayTexture(), { alphaTest: 0.45 });
  const sprayMesh = new THREE.InstancedMesh(createSprayGeometry(), sprayMat.material, sprays.length);
  sprayMesh.geometry.setAttribute('aAge', new THREE.InstancedBufferAttribute(new Float32Array(sprays.length), 1).setUsage(THREE.DynamicDrawUsage));
  sprayMesh.customDepthMaterial = sprayMat.depthMaterial;
  sprayMesh.castShadow = true;
  sprayMesh.receiveShadow = true;
  sprayMesh.frustumCulled = false;
  sprayMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sprayMesh.setColorAt(0, MATURE);

  const group = new THREE.Group();
  group.add(leaves, seedLeaves, sprayMesh);

  // Scratch objects.
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const xAxis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const color = new THREE.Color();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  function place(mesh, idx, slot, open, size) {
    const br = slot.branch;
    const { i, t } = slot;
    p.lerpVectors(br.points[i], br.points[i + 1], t);
    tan.lerpVectors(br.tangents[i], br.tangents[i + 1], t).normalize();
    const n = br.normals[i];
    const b = br.binormals[i];
    radial.copy(n).multiplyScalar(Math.cos(slot.angle)).addScaledVector(b, Math.sin(slot.angle));
    // Sit on the bark surface.
    const r = br.radii[i] * thicknessAt(slotAge);
    p.addScaledVector(radial, r * 0.9);
    // Folded against the shoot when closed, angled out when open.
    const tilt = (slot.tilt ?? 1.3) * open;
    yAxis.copy(tan).multiplyScalar(Math.cos(tilt)).addScaledVector(radial, Math.sin(tilt)).normalize();
    // Leaf blade faces the sky as much as it can.
    zAxis.copy(up).addScaledVector(yAxis, -up.dot(yAxis));
    if (zAxis.lengthSq() < 1e-4) zAxis.copy(radial);
    zAxis.normalize();
    xAxis.crossVectors(yAxis, zAxis);
    m4.makeBasis(xAxis, yAxis, zAxis).scale(p.set(size, size, size));
    // makeBasis+scale reset the translation; set it again.
    p.lerpVectors(br.points[i], br.points[i + 1], t).addScaledVector(radial, r * 0.9);
    m4.setPosition(p);
    mesh.setMatrixAt(idx, m4);
    mesh.geometry.attributes.aAge.array[idx] = slotAge;
  }

  let slotAge = 0;
  let prevNow = 0;
  const dying = []; // world positions of leaves that just reached the end of their life
  function update(now, dt = 0) {
    dying.length = 0;
    const forward = now > prevNow && now - prevNow < 0.01;
    for (let k = 0; k < slots.length; k++) {
      const s = slots[k];
      const age = now - s.depth;
      if (forward && age > LEAF_LIFE * 0.9 && prevNow - s.depth <= LEAF_LIFE * 0.9) {
        leaves.getMatrixAt(k, m4);
        dying.push(new THREE.Vector3().setFromMatrixPosition(m4));
      }
      if (age <= 0 || age > LEAF_LIFE) {
        leaves.setMatrixAt(k, hidden);
        continue;
      }
      slotAge = age;
      const open = smooth(0, UNFOLD, age);
      const fall = 1 - smooth(LEAF_LIFE * 0.85, LEAF_LIFE, age);
      place(leaves, k, s, open, s.size * (0.25 + 0.75 * open) * fall);
      color.copy(FRESH).lerp(MATURE, smooth(0, LEAF_LIFE * 0.5, age)).lerp(AUTUMN, smooth(LEAF_LIFE * 0.6, LEAF_LIFE * 0.9, age));
      color.offsetHSL(s.hue, 0, 0);
      leaves.setColorAt(k, color);
    }
    for (let k = 0; k < tufts.length; k++) {
      const s = tufts[k];
      const br = s.branch;
      const idx = slots.length + k;
      const d0 = br.depths[0];
      const d1 = br.depths.at(-1);
      const living = !br.node.children.length && !br.node.endMa;
      const depth = Math.min(now, d1) - s.lag;
      // Only while this branch is the one growing (or it is a living tip).
      if (now <= d0 || depth <= d0 || (now > d1 + 1e-6 && !living)) {
        leaves.setMatrixAt(idx, hidden);
        continue;
      }
      const f = ((depth - d0) / (d1 - d0)) * (br.points.length - 1);
      const i = Math.min(br.points.length - 2, Math.floor(f));
      slotAge = now - depth;
      const open = smooth(0, 0.004, now - d0);
      place(leaves, idx, { branch: br, i, t: f - i, angle: s.angle, tilt: s.tilt }, open, s.size * (0.3 + 0.7 * open));
      leaves.setColorAt(idx, color.copy(FRESH).offsetHSL(s.hue, 0.02, 0.02));
    }
    leaves.instanceMatrix.needsUpdate = true;
    leaves.geometry.attributes.aAge.needsUpdate = true;

    for (let k = 0; k < sprays.length; k++) {
      const s = sprays[k];
      const br = s.branch;
      const d0 = br.depths[0];
      const d1 = br.depths.at(-1);
      const living = !br.node.children.length && !br.node.endMa;
      const depth = Math.min(now, d1) - s.lag * Math.min(1, (d1 - d0) / SPRAY_REACH);
      const visible = now > d0 && depth > d0 && (now <= d1 + 1e-6 || living);
      if (!visible) {
        // A spray left behind when its shoot forked drops its leaves.
        if (s.wasVisible && forward) {
          sprayMesh.getMatrixAt(k, m4);
          const at = new THREE.Vector3().setFromMatrixPosition(m4);
          for (let j = 0; j < 3; j++) dying.push(at.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).multiplyScalar(s.size)));
        }
        s.wasVisible = false;
        sprayMesh.setMatrixAt(k, hidden);
        continue;
      }
      const f = ((depth - d0) / (d1 - d0)) * (br.points.length - 1);
      const i = Math.min(br.points.length - 2, Math.floor(f));
      slotAge = now - depth;
      const open = smooth(0, 0.01, now - d0);
      place(sprayMesh, k, { branch: br, i, t: f - i, angle: s.angle, tilt: s.tilt }, open, s.size * (0.2 + 0.8 * open));
      sprayMesh.setColorAt(k, color.copy(MATURE).lerp(FRESH, 0.35 + s.light * 3).offsetHSL(s.hue, 0, s.light));
      // Now and then a leaf lets go.
      if (s.wasVisible && Math.random() < dt * 0.012) {
        sprayMesh.getMatrixAt(k, m4);
        dying.push(new THREE.Vector3().setFromMatrixPosition(m4).add(new THREE.Vector3(0, s.size * 0.5, 0)));
      }
      s.wasVisible = true;
    }
    sprayMesh.instanceMatrix.needsUpdate = true;
    sprayMesh.geometry.attributes.aAge.needsUpdate = true;
    if (sprayMesh.instanceColor) sprayMesh.instanceColor.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;

    cotyledons.forEach((c, k) => {
      const age = now - c.depth;
      if (age <= 0 || age > 0.09) {
        seedLeaves.setMatrixAt(k, hidden);
        return;
      }
      slotAge = age;
      const open = smooth(0.002, 0.014, age);
      const fall = 1 - smooth(0.075, 0.09, age);
      place(seedLeaves, k, { ...c, tilt: 0.15 + 1.35 * open }, 1, c.size * (0.5 + 0.5 * open) * fall);
      seedLeaves.setColorAt(k, color.copy(SEED_LEAF).lerp(AUTUMN, smooth(0.05, 0.08, age)));
    });
    seedLeaves.instanceMatrix.needsUpdate = true;
    seedLeaves.geometry.attributes.aAge.needsUpdate = true;
    prevNow = now;
    if (seedLeaves.instanceColor) seedLeaves.instanceColor.needsUpdate = true;
  }

  return { group, update, dying };
}

/** A pointed leaf along +Y, slightly cupped and drooping at the tip. */
function createLeafGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.3, 0.2, 0.32, 0.65, 0, 1);
  shape.bezierCurveTo(-0.32, 0.65, -0.3, 0.2, 0, 0);
  const g = new THREE.ShapeGeometry(shape, 8);
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
