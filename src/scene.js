// Renderer, sky, light and ground: soft, warm, natural.
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
  scene.add(new THREE.HemisphereLight('#d6e4f2', '#6a583c', 1.0));

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

  scene.add(createGround());

  return { renderer, scene, sun, sky };
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

function createGround() {
  // A mossy clearing: darker under the tree, fading into the haze.
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, '#55602f');
  grad.addColorStop(0.25, '#76803f');
  grad.addColorStop(1, '#b7b47e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  // Speckle so it doesn't read as plastic.
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '40,48,20' : '170,165,120'},${0.08 + Math.random() * 0.12})`;
    ctx.fillRect(x, y, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(300, 96),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
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
