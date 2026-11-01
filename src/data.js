// Tree data. Same node format the full tree will use (see CLAUDE.md, "Data model"):
// id, parentId, name, splitMa (when the lineage begins), species (descendant count).
// Step 1 has a single node: the first lineage, growing from the origin of life to today.

export const TIME_START_MA = 4000;
export const TIME_END_MA = 0;

export const nodes = [
  {
    id: 'ott-root',
    parentId: null,
    name: 'Life',
    splitMa: 4000,
    species: 1,
  },
];

// Geological eons, oldest first, for the label under the counter.
export const eons = [
  { name: 'Hadean', startMa: 4600 },
  { name: 'Archean', startMa: 4000 },
  { name: 'Proterozoic', startMa: 2500 },
  { name: 'Phanerozoic', startMa: 538.8 },
];

export function eonAt(ma) {
  let current = eons[0];
  for (const eon of eons) if (ma <= eon.startMa) current = eon;
  return current.name;
}
