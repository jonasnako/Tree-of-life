// Orbit camera that frames the growing tree.
// During growth it keeps the whole tree in view while leaning toward the
// tip of the followed lineage; when time reaches today it pulls back to the
// whole tree. While you drag or zoom it hands control to you, then eases
// back after a pause.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const RESUME_AFTER = 4; // seconds of no input before auto-framing resumes

export function createCamera(canvas) {
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 500);
  camera.position.set(0.9, 0.45, 1.3);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.4;
  controls.maxDistance = 120;
  controls.maxPolarAngle = Math.PI * 0.495; // stay above the ground
  controls.target.set(0, 0.15, 0);

  let idle = Infinity;
  let interacting = false;
  controls.addEventListener('start', () => { interacting = true; });
  controls.addEventListener('end', () => { interacting = false; idle = 0; });
  canvas.addEventListener('wheel', () => { idle = 0; }, { passive: true });

  const desiredTarget = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const before = new THREE.Vector3();

  /**
   * @param {number} dt seconds
   * @param {{center: THREE.Vector3, radius: number, tip: THREE.Vector3, finished: boolean}} view
   */
  function update(dt, view) {
    if (!interacting) idle += dt;
    if (!interacting && idle > RESUME_AFTER) {
      const k = 1 - Math.exp(-dt * (view.finished ? 0.8 : 1.6));
      const lean = view.finished ? 0 : 0.45;
      desiredTarget.lerpVectors(view.center, view.tip, lean);
      const fit = view.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect);
      const desiredDistance = THREE.MathUtils.clamp(0.4 + fit * (view.finished ? 1.25 : 0.95), 0.9, 110);

      before.copy(controls.target);
      controls.target.lerp(desiredTarget, k);
      camera.position.add(before.subVectors(controls.target, before)); // pan with the target

      offset.subVectors(camera.position, controls.target);
      const dist = offset.length();
      offset.setLength(dist + (desiredDistance - dist) * k);
      camera.position.copy(controls.target).add(offset);
    }
    controls.update();
  }

  return { camera, controls, update };
}
