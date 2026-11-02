// Renderer, sky, light and the planet the tree grows on; all of it follows
// the climate of the time (see climate.js).
import * as THREE from 'three';

const SKY_TOP = '#6c9fd2';
const HORIZON = '#ece3c8';
const SUN_COLOR = '#ffd9a0';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const sky = createSky();
  scene.add(sky);
  scene.fog = new THREE.Fog(HORIZON, 22, 95);

  // Soft sky light from above, earthy bounce from below.
  const hemi = new THREE.HemisphereLight('#d6e4f2', '#6a583c', 1.0);
  scene.add(hemi);

  // Warm afternoon sun with soft shadows.
  const sun = new THREE.DirectionalLight(SUN_COLOR, 3.0);
  sun.position.set(18, 15, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -6;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 5;
  sky.material.uniforms.uSunDir.value.copy(sun.position).normalize();
  sun.target.position.set(0, 4, 0);
  scene.add(sun, sun.target);

  // Climate-driven ground: shared uniforms, updated by applyClimate().
  const env = {
    uPlanetR: { value: PLANET_R },
    uTemp: { value: 0 },
    uArid: { value: 0.4 },
    uHaze: { value: 0 },
    uMolten: { value: 0 },
    uLife: { value: 1 },
    uTime: { value: 0 },
  };
  scene.add(createPlanet(env));

  return { renderer, scene, sun, sky, hemi, env };
}

/** Sky dome: blue overhead, warm haze at the horizon, a soft glow around the sun. */
function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uTop: { value: new THREE.Color(SKY_TOP) },
      uHorizon: { value: new THREE.Color(HORIZON) },
      uSun: { value: new THREE.Color(SUN_COLOR) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // always at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSun;
      uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.25, h));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSun * (pow(s, 24.0) * 0.18 + pow(s, 400.0) * 0.8);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), material);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

// The tree stands on top of a small planet: the horizon bends a little as
// you pull back. Its ground is drawn in the shader from the climate: bare
// volcanic rock on the young Earth, desert sand in hothouse times, moss and
// grass once plants reach land, snow in the ice ages; gentle hills rise away
// from the tree.
export const PLANET_R = 140;

/** Height of the ground below a point near the tree (the planet's curve). */
export function groundY(x, z) {
  return Math.sqrt(Math.max(0, PLANET_R * PLANET_R - x * x - z * z)) - PLANET_R;
}

const NOISE_GLSL = /* glsl */ `
float gHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float gNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gHash(i + vec3(0, 0, 0)), gHash(i + vec3(1, 0, 0)), f.x),
                 mix(gHash(i + vec3(0, 1, 0)), gHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(gHash(i + vec3(0, 0, 1)), gHash(i + vec3(1, 0, 1)), f.x),
                 mix(gHash(i + vec3(0, 1, 1)), gHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float gFbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) { v += a * gNoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;

function createPlanet(env) {
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, env);
    shader.vertexShader =
      `uniform float uPlanetR;\nvarying vec3 vGround;\n${NOISE_GLSL}\n` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        vec3 dirG = normalize(position);
        float fromTree = uPlanetR * acos(clamp(dirG.y, -1.0, 1.0));
        float hills = (gFbm(dirG * 9.0) - 0.45) * 7.0 * smoothstep(14.0, 45.0, fromTree);
        vec3 transformed = position + dirG * hills;
        vGround = transformed + vec3(0.0, uPlanetR, 0.0);`,
      );
    shader.fragmentShader =
      `uniform float uTemp;\nuniform float uArid;\nuniform float uHaze;\nuniform float uMolten;\nuniform float uLife;\nuniform float uTime;\nvarying vec3 vGround;\n${NOISE_GLSL}\n` +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec3 gp = vGround;
        float big = gFbm(gp * 0.06);
        float mid = gFbm(gp * 0.35 + 3.0);
        float fine = gNoise(gp * 3.1);
        // Rock: dark basalt on the young Earth, weathered grey-brown later.
        vec3 rock = mix(vec3(0.20, 0.16, 0.14), vec3(0.36, 0.31, 0.26), 0.5 + 0.5 * mid);
        rock = mix(rock, vec3(0.09, 0.07, 0.07), uMolten);
        // Sand where it is dry.
        vec3 sand = mix(vec3(0.70, 0.56, 0.36), vec3(0.80, 0.66, 0.44), fine);
        vec3 bare = mix(rock, sand, smoothstep(0.35, 0.75, uArid + (big - 0.5) * 0.6));
        // Plants on land: moss first, later grass and meadow; drier = straw.
        vec3 lush = mix(vec3(0.20, 0.33, 0.10), vec3(0.36, 0.48, 0.16), mid);
        vec3 dry = vec3(0.58, 0.53, 0.30);
        vec3 veg = mix(lush, dry, smoothstep(0.4, 0.9, uArid + (mid - 0.5) * 0.4));
        float cover = uLife * smoothstep(0.25, 0.6, big + 0.25 * (1.0 - uArid) + 0.1 * fine);
        vec3 ground = mix(bare, veg, cover);
        // Fine speckle so it never looks like plastic.
        ground *= 0.85 + 0.3 * fine;
        // Snow and ice in cold times, patchy at first, then everywhere.
        float snowLine = smoothstep(-0.05, -0.75, uTemp);
        float snow = smoothstep(0.55, 0.45, mid * 0.6 + big * 0.6 - snowLine * 1.2 + 0.25);
        ground = mix(ground, vec3(0.90, 0.93, 0.96) * (0.95 + 0.08 * fine), snow * snowLine);
        // Darker, richer soil under the tree.
        float underTree = 1.0 - smoothstep(1.0, 9.0, length(gp.xz));
        ground *= mix(1.0, 0.7, underTree * uLife);
        diffuseColor.rgb *= ground;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // Glowing cracks while the Earth is young and molten.
        float crack = (1.0 - smoothstep(0.0, 0.03, abs(gFbm(vGround * 1.3 + gFbm(vGround * 0.4) * 2.0) - 0.5))) * smoothstep(0.35, 0.6, gNoise(vGround * 0.2));
        totalEmissiveRadiance += vec3(1.0, 0.35, 0.05) * crack * uMolten * (0.8 + 0.4 * sin(uTime * 1.3 + vGround.x));`,
      );
  };
  const planet = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R, 320, 160), material);
  planet.position.y = -PLANET_R;
  planet.receiveShadow = true;
  return planet;
}

// Sky, light and fog for each climate.
const SKY = {
  normal: { top: '#6c9fd2', horizon: '#ece3c8', sun: '#ffd9a0' },
  ice: { top: '#8fbbe8', horizon: '#eef3f8', sun: '#fff3e2' },
  hot: { top: '#a7b6bf', horizon: '#f0d6a2', sun: '#ffd08a' },
  haze: { top: '#b98446', horizon: '#e7b06d', sun: '#ffa860' },
};
const C = Object.fromEntries(
  Object.entries(SKY).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([n, hex]) => [n, new THREE.Color(hex)]))]),
);

/** Apply a climate (see climate.js) to sky, fog, light and ground. */
export function applyClimate(world, c) {
  const cold = Math.min(1, Math.max(0, -c.temp));
  const heat = Math.min(1, Math.max(0, (c.temp - 0.5) / 0.5)) * c.arid;
  const haze = c.haze;
  const pick = (name, out) =>
    out.copy(C.normal[name]).lerp(C.ice[name], cold).lerp(C.hot[name], heat).lerp(C.haze[name], haze);
  const u = world.sky.material.uniforms;
  pick('top', u.uTop.value);
  pick('horizon', u.uHorizon.value);
  pick('sun', u.uSun.value);
  world.scene.fog.color.copy(u.uHorizon.value);
  world.sun.color.copy(u.uSun.value);
  world.sun.intensity = 3.0 * (1 - 0.35 * haze) * (1 + 0.15 * cold);
  world.hemi.color.copy(u.uTop.value).lerp(C.normal.top, 0.5);
  world.hemi.groundColor.setRGB(0.42, 0.35, 0.24).lerp(new THREE.Color('#c9d2dc'), cold * 0.6);
  world.env.uTemp.value = c.temp;
  world.env.uArid.value = c.arid;
  world.env.uHaze.value = haze;
  world.env.uMolten.value = c.molten;
  world.env.uLife.value = c.life;
}

export function handleResize(renderer, camera) {
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
}
