// Maps real time (Ma) to "depth": how far along its path from the root a
// point of the tree is, 0 at the seed (the origin, about 4,350 Ma) and 1 at today.
// Depth is part linear and part logarithmic, so the billions of years of
// early life still make a trunk, while the last few million years (where
// most of the human lineage's forks are) get enough room to be seen.
// The clock also uses it: depth grows at a steady visual speed, so the
// counter races through empty eons and slows down for recent forks.

export let T0 = 4000; // the seed; set from the data file's origin
const LINEAR = 0.55; // share of the linear part
const C = 20; // Ma; smaller = more room for recent time
let LN = Math.log(1 + T0 / C);

export function setOrigin(ma) {
  T0 = ma;
  LN = Math.log(1 + T0 / C);
}

export function depthAt(ma) {
  const lin = (T0 - ma) / T0;
  const log = 1 - Math.log(1 + ma / C) / LN;
  return LINEAR * lin + (1 - LINEAR) * log;
}

/** |d depth / d Ma| at the given time. */
export function depthPerMa(ma) {
  return LINEAR / T0 + (1 - LINEAR) / ((C + ma) * LN);
}

/** Inverse of depthAt (bisection; depthAt is monotonic). */
export function maAtDepth(depth) {
  let lo = 0;
  let hi = T0;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (depthAt(mid) > depth) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
