// Tree data: loads the node file and links it into a tree.
// Node format (see CLAUDE.md, "Data model"): id, parent, name, splitMa, species.
// The file is built from real data by scripts/build-slice.mjs.
import treeFile from '../public/data/tree-slice.json';

export const TIME_END_MA = 0;

/**
 * @returns {{ root, byId, originMa, showcase, focus, lineage }}
 * Each node gets `children` and `parentNode`. `focus` is the followed
 * species and `lineage` its path from the root; change it with setFocus().
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
  // Species counts come with the file; fill any gaps from the children.
  const sum = (node) => {
    const below = node.children.reduce((s, c) => s + sum(c), 0);
    if (!node.species) node.species = Math.max(1, below);
    return node.species;
  };
  sum(root);

  const showcase = (file.showcase ?? []).map((s) => ({ ...s, node: byId.get(s.id) })).filter((s) => s.node);
  const tree = { root, byId, originMa: file.originMa ?? 4000, showcase, focus: null, lineage: [] };
  setFocus(tree, file.focus ?? showcase[0]?.key);
  return tree;
}

/** Follow a showcase species (by key) or any node (by id). */
export function setFocus(tree, keyOrId) {
  const pick = tree.showcase.find((s) => s.key === keyOrId);
  const focus = pick?.node ?? tree.byId.get(keyOrId) ?? tree.root;
  tree.focus = focus;
  tree.focusLabel = pick?.label ?? focus.name;
  tree.lineage = [];
  for (let n = focus; n; n = n.parentNode) tree.lineage.unshift(n);
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
