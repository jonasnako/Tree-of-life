// How wood changes with age. "Age" of a point on the tree is how long ago
// (in depth units, see timeScale.js) the growing tip passed it.
// The GPU shader (treeMesh.js) and the CPU (leaves, camera) both use these.

export const GROWTH = {
  tipLength: 0.012, // the soft, tapering growing tip
  thickenSpan: 0.5, // age at which wood reaches full thickness
  thickenPower: 1.0, // >1 keeps young wood slender for longer
  minThickness: 0.05, // a fresh shoot, as a share of full thickness
  twig0: 0.008, // green shoot starts turning into a brown twig
  twig1: 0.05,
  bark0: 0.03, // twig starts growing bark
  bark1: 0.2, // fully barked
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Radius multiplier for wood of a given age (0 if not grown yet). */
export function thicknessAt(age) {
  if (age < 0) return 0;
  const g = GROWTH.minThickness + (1 - GROWTH.minThickness) * Math.pow(smooth(0, GROWTH.thickenSpan, age), GROWTH.thickenPower);
  return g * smooth(0, GROWTH.tipLength, age);
}

export { smooth };
