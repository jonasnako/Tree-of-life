// Orbit camera. During replay it follows the growing tip of the followed
// lineage, close enough to watch the forks, and drifts slowly around the
// tree. When time reaches today it pulls back to show the whole tree.
// Once you drag or zoom, it stays where you put it until playback starts
// again. Wheel and pinch zoom toward the cursor; flyTo() glides to a point.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const UP = new THREE.Vector3(0, 1, 0);
const ORBIT_SPEED = 0.06; // radians per second of slow drift around the tree

export function createCamera(canvas) {
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 500);
  camera.position.set(0.9, 0.45, 1.3);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.12;
  controls.zoomToCursor = true;
  controls.maxDistance = 120;
  controls.maxPolarAngle = Math.PI * 0.495; // stay above the ground
  controls.target.set(0, 0.15, 0);

  let interacting = false;
  let manual = false; // the user has taken the camera
  let fly = null;
  let track = null; // () => point the camera keeps centred (after flyTo)
  const trackLast = new THREE.Vector3();
  controls.addEventListener('start', () => {
    interacting = true;
    manual = true;
    fly = null;
  });
  controls.addEventListener('end', () => { interacting = false; });
  canvas.addEventListener('wheel', () => { manual = true; fly = null; }, { passive: true });

  const desiredTarget = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const before = new THREE.Vector3();

  /**
   * @param {number} dt seconds
   * @param {{center: THREE.Vector3, radius: number, tip: THREE.Vector3, finished: boolean}} view
   */
  function update(dt, view) {
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / fly.duration);
      const e = fly.t * fly.t * (3 - 2 * fly.t);
      controls.target.lerpVectors(fly.fromTarget, track ? track() : fly.toTarget, e);
      offset.copy(fly.fromOffset).lerp(fly.toOffset, e);
      camera.position.copy(controls.target).add(offset);
      if (fly.t >= 1) {
        fly = null;
        if (track) trackLast.copy(track());
      }
    } else if (track) {
      // Keep what we flew to in the middle as it sways; orbiting still works.
      const p = track();
      before.subVectors(p, trackLast);
      controls.target.add(before);
      camera.position.add(before);
      trackLast.copy(p);
    } else if (!interacting && !manual) {
      const k = 1 - Math.exp(-dt * (view.finished ? 0.7 : 1.6));
      const fit = view.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect);
      let desiredDistance;
      if (view.finished) {
        desiredTarget.copy(view.center);
        desiredDistance = fit * 1.0;
      } else {
        // Close on the tip while the tree is small, then a little wider.
        desiredTarget.lerpVectors(view.tip, view.center, 0.3);
        desiredDistance = 0.6 + fit * 0.55;
      }
      desiredDistance = THREE.MathUtils.clamp(desiredDistance, 0.9, 110);

      before.copy(controls.target);
      controls.target.lerp(desiredTarget, k);
      camera.position.add(before.subVectors(controls.target, before)); // pan with the target

      offset.subVectors(camera.position, controls.target);
      const dist = offset.length();
      offset.setLength(dist + (desiredDistance - dist) * k);
      offset.applyAxisAngle(UP, ORBIT_SPEED * dt);
      camera.position.copy(controls.target).add(offset);
    }
    controls.update();
  }

  /**
   * Glide to look at a point from a given distance. `point` may be a function
   * returning the current position: the camera then keeps it centred.
   */
  function flyTo(point, distance) {
    manual = true;
    track = typeof point === 'function' ? point : null;
    const fromOffset = camera.position.clone().sub(controls.target);
    fly = {
      t: 0,
      duration: 1.4,
      fromTarget: controls.target.clone(),
      toTarget: track ? null : point.clone(),
      fromOffset,
      toOffset: fromOffset.clone().setLength(distance),
    };
  }

  /** Hand the camera back to the automatic framing (e.g. when playback starts). */
  function release() {
    manual = false;
    fly = null;
    track = null;
  }

  return { camera, controls, update, flyTo, release };
}
