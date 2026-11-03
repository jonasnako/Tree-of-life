// Small pictures for labels and info cards (built by scripts/build-slice.mjs
// from Wikimedia Commons via Wikidata; see public/data/images.json).
import data from '../public/data/images.json';

const named = (n) => {
  while (n?.placeholder) n = n.parentNode;
  return n;
};

/** Picture for a node (a clade, or a one-species tip), or null. */
export function imageFor(node) {
  const n = named(node);
  if (!n) return null;
  const i = data.images[`id:${n.id}`] ?? (n.leaves?.length === 1 ? data.images[`sp:${n.leaves[0].name}`] : undefined);
  return i == null ? null : data.pictures[i];
}

/** Picture for a species by scientific name, or null. */
export function speciesImage(name) {
  const i = data.images[`sp:${name}`];
  return i == null ? null : data.pictures[i];
}

export const commonsLink = (file) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`;
