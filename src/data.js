// Tree data: loads the node file and links it into a tree.
// Node format (see CLAUDE.md, "Data model"): id, parent, name, splitMa, species.
import treeFile from '../public/data/tree-human.json';

export const TIME_START_MA = 4000;
export const TIME_END_MA = 0;

/**
 * @returns {{ root: object, byId: Map<string, object>, focus: object, lineage: object[] }}
 * Each node gets `children`, `parentNode` and `species` (summed for inner nodes).
 */
export function loadTree(file = treeFile) {
  const byId = new Map();
  for (const raw of file.nodes) byId.set(raw.id, { ...raw, children: [], parentNode: null });
  let root = null;
  for (const node of byId.values()) {
    if (node.parent == null) root = node;
    else {
      const parent = byId.get(node.parent);
      node.parentNode = parent;
      parent.children.push(node);
    }
  }
  const sum = (node) => {
    if (node.children.length) node.species = node.children.reduce((s, c) => s + sum(c), 0);
    return node.species ?? 1;
  };
  sum(root);

  const focus = byId.get(file.focus);
  const lineage = [];
  for (let n = focus; n; n = n.parentNode) lineage.unshift(n);
  return { root, byId, focus, lineage };
}

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
