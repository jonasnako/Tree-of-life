// All branches as one mesh, built once. Growth runs on the GPU:
// every vertex knows its centreline point, its outward direction, its full
// radius and its depth, and the shader works out from the current depth
// (uNow) how thick it is (0 = not grown yet), and whether it is a green
// shoot, a young twig or barked wood.
import * as THREE from 'three';
import { GROWTH } from './growth.js';

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
  };

  const geometry = buildGeometry(branches);

  const material = new THREE.MeshStandardMaterial({
    map: barkTextures.map,
    bumpMap: barkTextures.bumpMap,
    bumpScale: 4,
    roughness: 0.95,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX_HEADER + shader.vertexShader.replace('#include <begin_vertex>', GROW_VERTEX);
    shader.fragmentShader =
      FRAGMENT_HEADER +
      shader.fragmentShader
        .replace('#include <map_fragment>', COLOR_FRAGMENT)
        .replace('#include <roughnessmap_fragment>', ROUGHNESS_FRAGMENT)
        .replace(
          '#include <bumpmap_pars_fragment>',
          THREE.ShaderChunk.bumpmap_pars_fragment.replaceAll('bumpScale *', 'bumpScale * smoothstep(uBark0, uBark1, vAge) *'),
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
uniform float uNow;
uniform float uTipLen;
uniform float uSpan;
uniform float uMinThick;
uniform float uThickPow;
varying float vAge;
`;

// position = centreline point, normal = outward direction.
const GROW_VERTEX = /* glsl */ `
float age = uNow - aDepth;
float grown = step(0.0, age);
float thick = uMinThick + (1.0 - uMinThick) * pow(smoothstep(0.0, uSpan, age), uThickPow);
float tip = smoothstep(0.0, uTipLen, age);
vec3 transformed = position + normal * (aRadius * thick * tip * grown);
vAge = age;
`;

const FRAGMENT_HEADER = /* glsl */ `
uniform float uTwig0;
uniform float uTwig1;
uniform float uBark0;
uniform float uBark1;
uniform vec3 uShoot;
uniform vec3 uTwigColor;
varying float vAge;
`;

// Green shoot -> brown twig -> bark texture.
const COLOR_FRAGMENT = /* glsl */ `
float barkMix = smoothstep(uBark0, uBark1, vAge);
vec3 young = mix(uShoot, uTwigColor, smoothstep(uTwig0, uTwig1, vAge));
#ifdef USE_MAP
  vec4 barkTexel = texture2D(map, vMapUv);
  diffuseColor.rgb *= mix(young, barkTexel.rgb, barkMix);
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
  const uv = new Float32Array(vertexCount * 2);
  const aDepth = new Float32Array(vertexCount);
  const aRadius = new Float32Array(vertexCount);
  const index = new Uint32Array(indexCount);

  let v = 0;
  let k = 0;
  for (const br of branches) {
    const base = v;
    const m = br.radial;
    const uRepeat = Math.max(1, Math.round(Math.max(...br.radii) * 5));
    // Bark irregularity: a few lobes that twist slowly along the branch.
    const seed = br.node.id.length;
    const lobes = [
      { k: 2, amp: 0.06, ph: seed * 1.3, tw: 0.4 },
      { k: 3, amp: 0.045, ph: seed * 2.1, tw: -0.7 },
      { k: 7, amp: 0.02, ph: seed * 0.7, tw: 1.6 },
    ];
    for (let i = 0; i < br.points.length; i++) {
      const p = br.points[i];
      const n = br.normals[i];
      const b = br.binormals[i];
      const dist = br.dists[i];
      for (let j = 0; j <= m; j++) {
        const a = (j / m) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        let lobe = 1;
        for (const l of lobes) lobe += l.amp * Math.sin(a * l.k + l.ph + dist * l.tw);
        position[v * 3] = p.x;
        position[v * 3 + 1] = p.y;
        position[v * 3 + 2] = p.z;
        normal[v * 3] = c * n.x + s * b.x;
        normal[v * 3 + 1] = c * n.y + s * b.y;
        normal[v * 3 + 2] = c * n.z + s * b.z;
        uv[v * 2] = (j / m) * uRepeat;
        uv[v * 2 + 1] = dist / 1.6;
        aDepth[v] = br.depths[i];
        aRadius[v] = br.radii[i] * lobe;
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
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(aDepth, 1));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(aRadius, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

function radialSegments(radius) {
  return Math.max(6, Math.min(18, Math.round(6 + radius * 24)));
}
