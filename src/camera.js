// Orbit camera that gently follows the growing tip.
// While you drag or zoom it hands control to you, then eases back after a pause.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const RESUME_AFTER = 4; // seconds of no input before auto-follow resumes

export function createCamera(canvas) {
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(3.2, 1.6, 4.2);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2;
  controls.maxDistance = 80;
  controls.maxPolarAngle = Math.PI * 0.495; // stay above the ground
  controls.target.set(0, 0.8, 0);

  let idle = Infinity;
  let interacting = false;
  controls.addEventListener('start', () => { interacting = true; });
  controls.addEventListener('end', () => { interacting = false; idle = 0; });
  canvas.addEventListener('wheel', () => { idle = 0; }, { passive: true });

  const desiredTarget = new THREE.Vector3();
  const offset = new THREE.Vector3();

  /**
   * @param {number} dt seconds
   * @param {{base: THREE.Vector3, tip: THREE.Vector3}} focus
   */
  function update(dt, focus) {
    if (!interacting) idle += dt;
    if (!interacting && idle > RESUME_AFTER) {
      const k = 1 - Math.exp(-dt * 1.5);
      // Look a little below the tip so the whole branch stays in view.
      desiredTarget.lerpVectors(focus.base, focus.tip, 0.6);
      const height = focus.tip.distanceTo(focus.base);
      const desiredDistance = THREE.MathUtils.clamp(5 + height * 1.5, 5, 70);

      const before = controls.target.clone();
      controls.target.lerp(desiredTarget, k);
      camera.position.add(controls.target.clone().sub(before)); // pan with the target

      offset.subVectors(camera.position, controls.target);
      const dist = offset.length();
      offset.setLength(dist + (desiredDistance - dist) * k);
      camera.position.copy(controls.target).add(offset);
    }
    controls.update();
  }

  return { camera, controls, update };
}
