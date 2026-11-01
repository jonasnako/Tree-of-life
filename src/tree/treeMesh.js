// All branches as one mesh, built once. Growth runs on the GPU:
// every vertex knows its centreline point, its outward direction, its full
// radius and its depth, and the shader works out from the current depth
// (uNow) how thick it is (0 = not grown yet), and whether it is a green
// shoot, a young twig or barked wood. Old wood gets gnarled: the trunk
// flutes into twisted ridges and grooves, burls swell out, bark turns grey,
// deeply fissured and mossy near the ground. Young wood bends more in the wind.
import * as THREE from 'three';
import { GROWTH } from './growth.js';
import { windUniforms, WIND_GLSL } from '../wind.js';
import { createRandom } from '../random.js';

export function createTreeMesh(branches, barkTextures) {
  const uniforms = {
    uNow: { value: 0 },
    uTipLen: { value: GROWTH.tipLength },
    uSpan: { value: GROWTH.thickenSpan },
    uMinThick: { value: GROWTH.minThickness },
    uThickPow: { value: GROWTH.thickenPower },
    uTwig0: { value: GROWTH.twig0 },
    uTwig1: { value: GROWTH.twig1 },
    uBark0: { value: GROWTH.bark0 },
    uBark1: { value: GROWTH.bark1 },
    uShoot: { value: new THREE.Color('#7fb04a') },
    uTwigColor: { value: new THREE.Color('#7a5a3c') },
    uWeathered: { value: new THREE.Color('#a8a396') },
    uMoss: { value: new THREE.Color('#5d7a2c') },
    ...windUniforms,
  };

  const geometry = buildGeometry(branches);

  const material = new THREE.MeshStandardMaterial({
    map: barkTextures.map,
    bumpMap: barkTextures.bumpMap,
    bumpScale: 5,
    roughness: 0.95,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      VERTEX_HEADER +
      shader.vertexShader.replace('#include <beginnormal_vertex>', NORMAL_VERTEX).replace('#include <begin_vertex>', GROW_VERTEX);
    shader.fragmentShader =
      FRAGMENT_HEADER +
      shader.fragmentShader
        .replace('#include <map_fragment>', COLOR_FRAGMENT)
        .replace('#include <roughnessmap_fragment>', ROUGHNESS_FRAGMENT)
        .replace(
          '#include <bumpmap_pars_fragment>',
          THREE.ShaderChunk.bumpmap_pars_fragment.replaceAll('bumpScale *', 'bumpScale * barkDepth(vAge) *'),
        );
  };

  // Shadows must see the same grown shape.
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX_HEADER + shader.vertexShader.replace('#include <begin_vertex>', GROW_VERTEX);
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.customDepthMaterial = depthMaterial;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  return {
    mesh,
    setDepth(depth) {
      uniforms.uNow.value = depth;
    },
  };
}

const VERTEX_HEADER = /* glsl */ `
attribute float aDepth;
attribute float aRadius;
attribute float aAngle;
attribute float aPath;
attribute vec2 aBurl;
attribute vec3 aTangent;
uniform float uNow;
uniform float uTipLen;
uniform float uSpan;
uniform float uMinThick;
uniform float uThickPow;
varying float vAge;
varying float vHeight;
varying float vGroove;
${WIND_GLSL}

// Twisted fluting: lobes around the trunk that spiral along the path
// from the seed. Returns (offset, d offset / d angle).
vec2 flutes(float a, float p) {
  float l1 = 2.0 * a + 0.45 * p + 1.3;
  float l2 = 3.0 * a - 0.30 * p + 0.4;
  float l3 = 5.0 * a + 0.80 * p + 2.0;
  float l4 = 9.0 * a - 1.30 * p;
  return vec2(
    0.10 * sin(l1) + 0.12 * sin(l2) + 0.05 * sin(l3) + 0.025 * sin(l4),
    0.20 * cos(l1) + 0.36 * cos(l2) + 0.25 * cos(l3) + 0.225 * cos(l4)
  );
}
// How gnarled wood of this age is: smooth shoots, contorted old wood.
float gnarl(float age) { return 0.25 + 1.75 * smoothstep(0.12, 0.85, age); }
// Total surface offset (and its angle derivative) for this vertex.
vec2 surfaceOffset(float age) {
  vec2 f = flutes(aAngle, aPath) * gnarl(age);
  return f + aBurl * smoothstep(0.15, 0.7, age);
}
`;

// normal attribute = outward direction on the round tube; tilt it by the
// slope of the flutes so ridges and grooves catch the light.
const NORMAL_VERTEX = /* glsl */ `
vec2 nOff = surfaceOffset(uNow - aDepth);
vec3 objectNormal = normalize(normal - (nOff.y / (1.0 + nOff.x)) * cross(aTangent, normal));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
`;

// position = centreline point.
const GROW_VERTEX = /* glsl */ `
float age = uNow - aDepth;
float grown = step(0.0, age);
float thick = uMinThick + (1.0 - uMinThick) * pow(smoothstep(0.0, uSpan, age), uThickPow);
float tip = smoothstep(0.0, uTipLen, age);
vec2 off = surfaceOffset(age);
vec3 transformed = position + normal * (aRadius * thick * tip * grown * (1.0 + off.x));
transformed += windSway(position, age);
vAge = age;
vHeight = position.y;
vGroove = clamp(-off.x * 2.5, 0.0, 1.0);
`;

const FRAGMENT_HEADER = /* glsl */ `
uniform float uTwig0;
uniform float uTwig1;
uniform float uBark0;
uniform float uBark1;
uniform vec3 uShoot;
uniform vec3 uTwigColor;
uniform vec3 uWeathered;
uniform vec3 uMoss;
varying float vAge;
varying float vHeight;
varying float vGroove;
// Bark relief: none on green shoots, deep fissures on old wood.
float barkDepth(float age) {
  return smoothstep(uBark0, uBark1, age) * (1.0 + 1.2 * smoothstep(0.3, 0.9, age));
}
`;

// Green shoot -> brown twig -> bark -> ancient grey, fissured, mossy bark.
const COLOR_FRAGMENT = /* glsl */ `
float barkMix = smoothstep(uBark0, uBark1, vAge);
vec3 young = mix(uShoot, uTwigColor, smoothstep(uTwig0, uTwig1, vAge));
#ifdef USE_MAP
  vec4 barkTexel = texture2D(map, vMapUv);
  vec3 bark = barkTexel.rgb;
  float old = smoothstep(0.3, 0.95, vAge);
  float ridge = barkTexel.r * 2.2;
  // Old wood weathers to silver-grey on the ridges.
  bark = mix(bark, uWeathered * ridge, 0.55 * old);
  #ifdef USE_BUMPMAP
    float height = texture2D(bumpMap, vBumpMapUv).x;
    // Deep fissures go dark.
    bark *= mix(1.0, mix(0.45, 1.1, height), barkMix * (0.4 + 0.6 * old));
    // Moss settles in the furrows low on old wood.
    float moss = (1.0 - smoothstep(0.1, 1.8, vHeight)) * smoothstep(0.25, 0.6, vAge) * smoothstep(0.3, 0.7, 1.0 - height);
    bark = mix(bark, uMoss * (0.7 + 0.6 * ridge), moss * 0.8);
  #endif
  // Shade the grooves between the twisted ridges.
  bark *= 1.0 - 0.55 * vGroove * old;
  diffuseColor.rgb *= mix(young, bark, barkMix);
#else
  diffuseColor.rgb *= young;
#endif
`;

// Fresh shoots are smoother and catch a little sheen.
const ROUGHNESS_FRAGMENT = /* glsl */ `
float roughnessFactor = mix(0.5, roughness, smoothstep(0.0, uBark1, vAge));
`;

function buildGeometry(branches) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const br of branches) {
    br.radial = radialSegments(Math.max(...br.radii));
    vertexCount += br.points.length * (br.radial + 1);
    indexCount += (br.points.length - 1) * br.radial * 6;
  }
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const tangent = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const aDepth = new Float32Array(vertexCount);
  const aRadius = new Float32Array(vertexCount);
  const aAngle = new Float32Array(vertexCount);
  const aPath = new Float32Array(vertexCount);
  const aBurl = new Float32Array(vertexCount * 2);
  const index = new Uint32Array(indexCount);
  const UP = new THREE.Vector3(0, 1, 0);
  const radial = new THREE.Vector3();

  let v = 0;
  let k = 0;
  for (const br of branches) {
    const base = v;
    const m = br.radial;
    const maxR = Math.max(...br.radii);
    const uRepeat = Math.max(1, Math.round(maxR * 5));
    const burls = makeBurls(br, maxR);
    for (let i = 0; i < br.points.length; i++) {
      const p = br.points[i];
      const n = br.normals[i];
      const b = br.binormals[i];
      const t = br.tangents[i];
      const dist = br.dists[i];
      const path = br.paths[i];
      for (let j = 0; j <= m; j++) {
        const a = (j / m) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        radial.set(c * n.x + s * b.x, c * n.y + s * b.y, c * n.z + s * b.z);
        // Buttress roots are fins: taller than they are wide near the trunk.
        const fin = br.fin ? 1 + br.fin * Math.abs(radial.dot(UP)) * Math.exp(-dist * 0.9) : 1;
        let burl = 0;
        let burlDa = 0;
        for (const q of burls) {
          let da = a - q.a;
          da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
          const dd = dist - q.d;
          const val = q.amp * Math.exp(-(dd * dd) / (q.w * q.w) - (da * da) / (q.aw * q.aw));
          burl += val;
          burlDa += val * ((-2 * da) / (q.aw * q.aw));
        }
        position.set([p.x, p.y, p.z], v * 3);
        normal.set([radial.x, radial.y, radial.z], v * 3);
        tangent.set([t.x, t.y, t.z], v * 3);
        // Bark grain spirals around old wood.
        uv[v * 2] = (j / m) * uRepeat + path * 0.12;
        uv[v * 2 + 1] = path / 1.6;
        aDepth[v] = br.depths[i];
        aRadius[v] = br.radii[i] * fin;
        aAngle[v] = a;
        aPath[v] = path;
        aBurl[v * 2] = burl;
        aBurl[v * 2 + 1] = burlDa;
        v++;
      }
    }
    for (let i = 0; i < br.points.length - 1; i++) {
      for (let j = 0; j < m; j++) {
        const a = base + i * (m + 1) + j;
        const b = a + m + 1;
        index[k++] = a;
        index[k++] = a + 1;
        index[k++] = b;
        index[k++] = b;
        index[k++] = a + 1;
        index[k++] = b + 1;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('aTangent', new THREE.BufferAttribute(tangent, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(aDepth, 1));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(aAngle, 1));
  geometry.setAttribute('aPath', new THREE.BufferAttribute(aPath, 1));
  geometry.setAttribute('aBurl', new THREE.BufferAttribute(aBurl, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

/** Seeded burls (rounded swellings) on thicker branches. */
function makeBurls(br, maxR) {
  if (maxR < 0.12 || br.length < 1) return [];
  const rand = createRandom(`${br.node.id}-burls`);
  const count = 1 + Math.floor(rand() * Math.min(4, br.length / 1.2));
  return Array.from({ length: count }, () => ({
    d: rand.range(0.15, 0.9) * br.length,
    a: rand.range(0, Math.PI * 2),
    w: rand.range(0.2, 0.55),
    aw: rand.range(0.45, 0.9),
    amp: rand.range(0.2, 0.45),
  }));
}

function radialSegments(radius) {
  return Math.max(6, Math.min(24, Math.round(6 + radius * 30)));
}
