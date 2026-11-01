// One organic branch: a tapered tube along a gently bent spline.
// The shape is fixed by the node id (seeded), so it grows the same way every time.
// Growth is a value from 0 (just sprouted) to 1 (full length): the branch
// lengthens along its spline and thickens as it ages, like a real shoot.
import * as THREE from 'three';
import { createRandom } from '../random.js';

const SAMPLES = 400; // precomputed points along the full spline
const RINGS = 160; // rings along the visible part
const RADIAL = 22; // vertices around each ring

export class Branch {
  /**
   * @param {object} opts
   * @param {string} opts.id         node id, seeds the shape
   * @param {THREE.Vector3} opts.origin
   * @param {THREE.Vector3} opts.direction  initial growth direction
   * @param {number} opts.length     full length in world units
   * @param {number} opts.radius     base radius when fully grown
   * @param {THREE.Material} opts.material
   */
  constructor({ id, origin, direction, length, radius, material }) {
    this.id = id;
    this.length = length;
    this.radius = radius;
    this.growth = 0;
    const rand = createRandom(id);

    this.curve = buildCurve(rand, origin, direction, length);
    this.points = [];
    for (let i = 0; i <= SAMPLES; i++) this.points.push(this.curve.getPointAt(i / SAMPLES));
    const frames = this.curve.computeFrenetFrames(SAMPLES, false);
    this.normals = frames.normals;
    this.binormals = frames.binormals;

    // Bark irregularity: a few lobes around the ring and slow swellings along it.
    this.lobes = [
      { k: 2, amp: rand.range(0.04, 0.08), phase: rand.range(0, Math.PI * 2), twist: rand.range(-0.6, 0.6) },
      { k: 3, amp: rand.range(0.03, 0.06), phase: rand.range(0, Math.PI * 2), twist: rand.range(-0.9, 0.9) },
      { k: 7, amp: rand.range(0.015, 0.03), phase: rand.range(0, Math.PI * 2), twist: rand.range(-2, 2) },
    ];
    this.swell = { freq: rand.range(0.6, 1.1), amp: rand.range(0.04, 0.08), phase: rand.range(0, 6.28) };

    this.geometry = createTubeGeometry();
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    this.tip = new THREE.Vector3();
    this.setGrowth(0);
  }

  /** Point and frame at fraction u (0..1) of the full spline, interpolated. */
  sample(u, outP, outN, outB) {
    const f = Math.min(SAMPLES, Math.max(0, u * SAMPLES));
    const i = Math.min(SAMPLES - 1, Math.floor(f));
    const t = f - i;
    outP.lerpVectors(this.points[i], this.points[i + 1], t);
    if (outN) outN.lerpVectors(this.normals[i], this.normals[i + 1], t).normalize();
    if (outB) outB.lerpVectors(this.binormals[i], this.binormals[i + 1], t).normalize();
  }

  /** Radius at relative position s (0 = base, 1 = tip) of the current branch. */
  radiusAt(s, dist, angle) {
    const g = this.growth;
    const thickness = this.radius * (0.12 + 0.88 * Math.sqrt(g));
    const taper = 0.1 + 0.9 * Math.pow(1 - s, 1.1);
    const flare = 1 + 0.55 * Math.exp(-s * 14); // root flare at the base
    let lobe = 1;
    for (const l of this.lobes) lobe += l.amp * Math.sin(angle * l.k + l.phase + dist * l.twist);
    const swell = 1 + this.swell.amp * Math.sin(dist * this.swell.freq + this.swell.phase);
    return thickness * taper * flare * lobe * swell;
  }

  setGrowth(growth) {
    this.growth = THREE.MathUtils.clamp(growth, 0, 1);
    const g = Math.max(this.growth, 1e-4);
    const pos = this.geometry.attributes.position.array;
    const uv = this.geometry.attributes.uv.array;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const b = new THREE.Vector3();
    const circumference = Math.PI * 2 * this.radius;

    for (let i = 0; i <= RINGS; i++) {
      const s = i / RINGS; // relative position along the current branch
      const u = s * g; // fraction of the full spline
      const dist = u * this.length; // world distance from the base: bark stays put while growing
      this.sample(u, p, n, b);
      const closing = i === RINGS ? 0 : 1; // close the tip to a point
      for (let j = 0; j <= RADIAL; j++) {
        const angle = (j / RADIAL) * Math.PI * 2;
        const r = this.radiusAt(s, dist, angle) * closing;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const k = (i * (RADIAL + 1) + j) * 3;
        pos[k] = p.x + r * (cos * n.x + sin * b.x);
        pos[k + 1] = p.y + r * (cos * n.y + sin * b.y);
        pos[k + 2] = p.z + r * (cos * n.z + sin * b.z);
        const q = (i * (RADIAL + 1) + j) * 2;
        uv[q] = j / RADIAL;
        uv[q + 1] = dist / circumference;
      }
    }
    this.sample(g, this.tip);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.uv.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    this.mesh.visible = this.growth > 0.0005;
  }
}

function buildCurve(rand, origin, direction, length) {
  const dir = direction.clone().normalize();
  // Two axes perpendicular to the growth direction for sideways wander.
  const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
  const side2 = new THREE.Vector3().crossVectors(dir, side).normalize();

  const steps = 7;
  const pts = [];
  const offset = new THREE.Vector2();
  const drift = new THREE.Vector2(rand.range(-1, 1), rand.range(-1, 1)).multiplyScalar(0.035);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const along = dir.clone().multiplyScalar(t * length);
    // Gentle overall lean plus small random bends that grow toward the tip.
    if (i > 0) {
      offset.add(drift);
      offset.x += rand.range(-1, 1) * (0.03 + 0.07 * t);
      offset.y += rand.range(-1, 1) * (0.03 + 0.07 * t);
    }
    const lateral = side.clone().multiplyScalar(offset.x * length).add(side2.clone().multiplyScalar(offset.y * length));
    pts.push(origin.clone().add(along).add(lateral));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

function createTubeGeometry() {
  const vertexCount = (RINGS + 1) * (RADIAL + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertexCount * 2), 2).setUsage(THREE.DynamicDrawUsage));
  const index = [];
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const a = i * (RADIAL + 1) + j;
      const b = (i + 1) * (RADIAL + 1) + j;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  geometry.setIndex(index);
  return geometry;
}
