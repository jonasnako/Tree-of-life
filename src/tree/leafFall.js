// Dead leaves. Leaves that reach the end of their life let go and drift
// down, turning in the air. On the ground a litter of fallen leaves builds
// up under the crown over the ages, then slowly rots back into the soil.
import * as THREE from 'three';
import { groundY } from '../scene.js';
import { createRandom } from '../random.js';

const FALLING = 600; // leaves in the air at most
const LITTER = 16000; // fallen leaves on the ground
const LEAF_LIFE = 0.14; // keep in step with leaves.js
const LITTER_DECAY = 0.32; // depth units a fallen leaf lasts on the ground

const AUTUMN = ['#d8b04a', '#c99a3c', '#b8642a', '#94603a', '#c0883a', '#a89850'].map((c) => new THREE.Color(c));

export function createLeafFall(branches) {
  const texture = createDeadLeafTexture();
  const geometry = new THREE.PlaneGeometry(0.45, 1);
  const group = new THREE.Group();

  // --- Falling leaves (animated in real seconds, so they fall even when paused).
  const fallMat = new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  const falling = new THREE.InstancedMesh(geometry, fallMat, FALLING);
  falling.frustumCulled = false;
  falling.castShadow = true;
  falling.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const pool = Array.from({ length: FALLING }, (_, i) => {
    falling.setMatrixAt(i, zero);
    falling.setColorAt(i, AUTUMN[i % AUTUMN.length]);
    return { active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), spinAxis: new THREE.Vector3(), spin: 0, size: 0, phase: 0, rest: 0 };
  });
  let cursor = 0;
  group.add(falling);

  // --- Litter: placed once; the shader shows each leaf from the moment the
  // leaves above it died until it has rotted away.
  const litterGeo = geometry.clone().rotateX(-Math.PI / 2);
  litterGeo.setAttribute('aFallen', new THREE.InstancedBufferAttribute(new Float32Array(LITTER), 1));
  const litterUniforms = { uNow: { value: 0 } };
  const litterMat = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  litterMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, litterUniforms);
    shader.vertexShader =
      `attribute float aFallen;\nuniform float uNow;\nvarying float vLying;\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `float lying = uNow - aFallen;
         float shown = step(0.0, lying) * (1.0 - smoothstep(${(LITTER_DECAY * 0.65).toFixed(3)}, ${LITTER_DECAY.toFixed(3)}, lying));
         vec3 transformed = position * shown;
         vLying = lying;`,
      );
    shader.fragmentShader =
      `varying float vLying;\n` +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         // Fresh litter is golden; older litter darkens toward humus.
         diffuseColor.rgb *= mix(1.0, 0.55, smoothstep(0.0, ${LITTER_DECAY.toFixed(3)}, vLying));`,
      );
  };
  const litter = new THREE.InstancedMesh(litterGeo, litterMat, LITTER);
  litter.receiveShadow = true;
  litter.frustumCulled = false;
  placeLitter(litter, branches);
  group.add(litter);

  const m4 = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const dq = new THREE.Quaternion();

  /**
   * @param {number} dt real seconds
   * @param {number} now current depth
   * @param {THREE.Vector3[]} released positions of leaves that just let go
   */
  let lastNow = 0;
  function update(dt, now, released) {
    litterUniforms.uNow.value = now;
    // Time went back (restart, rewind, another species): leaves still in
    // the air came from a crown that does not exist yet, so clear them.
    if (now < lastNow - 1e-6) clear();
    lastNow = now;
    for (const at of released) {
      const p = pool[cursor];
      cursor = (cursor + 1) % FALLING;
      p.active = true;
      p.pos.copy(at);
      p.vel.set((Math.random() - 0.5) * 0.4, -(0.35 + Math.random() * 0.35), (Math.random() - 0.5) * 0.4);
      p.spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      p.spin = 1.5 + Math.random() * 3;
      p.q.setFromAxisAngle(p.spinAxis, Math.random() * 6.28);
      p.size = 0.14 + Math.random() * 0.08;
      p.phase = Math.random() * 6.28;
      p.rest = 0;
    }
    const t = performance.now() / 1000;
    for (let i = 0; i < FALLING; i++) {
      const p = pool[i];
      if (!p.active) continue;
      const floor = groundY(p.pos.x, p.pos.z) + 0.02;
      if (p.pos.y > floor) {
        // Flutter: side-to-side drift and tumbling on the way down.
        p.pos.addScaledVector(p.vel, dt);
        p.pos.x += Math.sin(t * 2.2 + p.phase) * 0.5 * dt;
        p.pos.z += Math.cos(t * 1.7 + p.phase) * 0.5 * dt;
        p.q.multiply(dq.setFromAxisAngle(p.spinAxis, p.spin * dt));
      } else {
        // Lie flat for a moment, then fade into the litter.
        p.pos.y = floor;
        p.rest += dt;
        p.q.slerp(dq.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), Math.min(1, dt * 6));
        if (p.rest > 4) {
          p.active = false;
          falling.setMatrixAt(i, zero);
          continue;
        }
      }
      const s = p.size * (p.rest > 3 ? 4 - p.rest : 1);
      m4.compose(p.pos, p.q, scale.set(s, s, s));
      falling.setMatrixAt(i, m4);
    }
    falling.instanceMatrix.needsUpdate = true;
  }

  function clear() {
    for (let i = 0; i < FALLING; i++) {
      pool[i].active = false;
      falling.setMatrixAt(i, zero);
    }
    falling.instanceMatrix.needsUpdate = true;
  }

  return { group, update, clear };
}

/** Scatter litter under where leaves grew, timed to when they died. */
function placeLitter(litter, branches) {
  const rand = createRandom('litter');
  const shoots = branches.filter((b) => !b.isRoot);
  const weights = shoots.map((b) => b.length);
  const total = weights.reduce((a, b) => a + b, 0);
  const fallen = litter.geometry.attributes.aFallen.array;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();
  for (let k = 0; k < litter.count; k++) {
    let r = rand() * total;
    let bi = 0;
    while (r > weights[bi] && bi < shoots.length - 1) r -= weights[bi++];
    const br = shoots[bi];
    const i = Math.floor(rand() * br.points.length);
    const p = br.points[i];
    // Leaves from higher up drift further before they land.
    const spread = 0.35 + 0.18 * Math.max(0, p.y);
    const gx = (rand() + rand() + rand() - 1.5) * spread * 1.4;
    const gz = (rand() + rand() + rand() - 1.5) * spread * 1.4;
    pos.set(p.x + gx, 0, p.z + gz);
    pos.y = groundY(pos.x, pos.z) + 0.012 + rand() * 0.012;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    const s = rand.range(0.16, 0.24);
    m4.compose(pos, q, scl.set(s, s, s));
    litter.setMatrixAt(k, m4);
    fallen[k] = br.depths[i] + LEAF_LIFE * rand.range(0.9, 1.6);
    color.copy(AUTUMN[Math.floor(rand() * AUTUMN.length)]).offsetHSL(0, 0, rand.range(-0.06, 0.04));
    litter.setColorAt(k, color);
  }
  litter.instanceMatrix.needsUpdate = true;
}

/** A single leaf silhouette, curled at the edges, for dead leaves. */
function createDeadLeafTexture() {
  const w = 64;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.moveTo(w / 2, h);
  ctx.bezierCurveTo(w * 0.95, h * 0.75, w * 0.92, h * 0.3, w / 2, 2);
  ctx.bezierCurveTo(w * 0.08, h * 0.3, w * 0.05, h * 0.75, w / 2, h);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#9a9a9a');
  g.addColorStop(0.5, '#f0f0f0');
  g.addColorStop(1, '#8a8a8a');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,60,50,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2, h);
  ctx.lineTo(w / 2, 6);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
