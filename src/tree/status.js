// Conservation status: colours and sampling, shared by leaves and foliage.

// IUCN Red List status -> leaf colour, healthy green to autumn red.
export const STATUS = [
  { code: 'LC', label: 'Least concern', color: '#4f9e2c' },
  { code: 'NT', label: 'Near threatened', color: '#a3b52e' },
  { code: 'VU', label: 'Vulnerable', color: '#e2b42a' },
  { code: 'EN', label: 'Endangered', color: '#e07722' },
  { code: 'CR', label: 'Critically endangered', color: '#c8301c' },
  { code: 'DD', label: 'Data deficient', color: '#8f9c80' },
  { code: 'EX', label: 'Extinct (dry leaf)', color: '#7b5a38' },
];
export const DRY = 7; // index of the dry, dead leaf

/** Nearest approximate threat share up the tree (placeholder forks inherit). */
export function threatOf(node) {
  for (let n = node; n; n = n.parentNode) if (n.threat != null) return n.threat;
  return null;
}

/**
 * Sample a status index (STATUS order, 1-based; 0 = healthy, natural green)
 * from a clade's share of threatened species.
 */
export function sampleStatus(threat, rand, dryShare = 0) {
  // A few dry, dead leaves stay on the tree, as in nature.
  if (dryShare && rand() < dryShare) return DRY;
  if (threat == null) return 0;
  const u = rand();
  if (u < threat) {
    const v = rand();
    return v < 0.22 ? 5 : v < 0.6 ? 4 : 3; // CR, EN, VU in rough Red List proportions
  }
  if (u < threat + 0.08) return 2; // NT
  return 0;
}
