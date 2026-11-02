#!/usr/bin/env node
// Builds public/data/tree-slice.json from real data (CLAUDE.md, build step 4):
//
//   Open Tree of Life (synthetic tree)  -> branching structure, species counts
//   TimeTree (pairwise divergence API)  -> dates of the forks
//   Wikidata (SPARQL)                   -> IUCN conservation status and
//                                          English common names
//
// The slice is the full path from the root to each showcase species, plus
// every sister clade along those paths collapsed to one node with its real
// species count. API responses are cached in raw/cache (never committed),
// so re-runs are fast and polite to the services.
//
// Usage: node scripts/build-slice.mjs   (Node 18+, needs network on first run)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, 'raw', 'cache');
const OUT = path.join(ROOT, 'public', 'data', 'tree-slice.json');
const OT = 'https://api.opentreeoflife.org/v3';
const TT = 'https://timetree.org/api/pairwise';

// One per group in the brief. Alternatives are tried if a name is not in the tree.
const SHOWCASE = [
  { key: 'human', label: 'Human', names: ['Homo sapiens'] },
  { key: 'octopus', label: 'Common octopus', names: ['Octopus vulgaris'] },
  { key: 'oak', label: 'English oak', names: ['Quercus robur'] },
  { key: 'fly-agaric', label: 'Fly agaric', names: ['Amanita muscaria'] },
  { key: 'e-coli', label: 'E. coli', names: ['Escherichia coli'] },
  { key: 'diatom', label: 'A diatom', names: ['Phaeodactylum tricornutum', 'Thalassiosira pseudonana'] },
  { key: 'archaeon', label: 'An archaeon', names: ['Haloferax volcanii', 'Methanocaldococcus jannaschii', 'Sulfolobus acidocaldarius', 'Nitrosopumilus maritimus'] },
];

const MAX_SISTERS = 3; // biggest sister clades kept per fork; the rest are grouped

// Published dates for forks TimeTree has no pairwise estimate for.
const ANCHORS = {
  ott93302: { date: 4200, source: 'Moody et al. 2024, Nature Ecology & Evolution: LUCA about 4.2 billion years ago' },
};

// Placeholder taxa in the source tree that are not real clades.
const JUNK = /environmental|uncultured|unclassified|incertae sedis|unidentified/i;
const ORIGIN_MIN = 4000; // the seed is planted at least this long ago (Ma)

// ---------------------------------------------------------------- fetching

fs.mkdirSync(CACHE, { recursive: true });
let requests = 0;

async function cached(key, fetcher) {
  const file = path.join(CACHE, crypto.createHash('sha1').update(key).digest('hex') + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    try {
      requests++;
      const value = await fetcher();
      fs.writeFileSync(file, JSON.stringify(value));
      return value;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function ot(endpoint, body) {
  return cached(`ot ${endpoint} ${JSON.stringify(body)}`, async () => {
    const res = await fetch(`${OT}/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) return { error: json.message ?? `HTTP ${res.status}` };
    return json;
  });
}

/** Divergence time (Ma) between two NCBI taxa, or null if TimeTree has none. */
async function timetree(a, b) {
  const [x, y] = a < b ? [a, b] : [b, a];
  const row = await cached(`tt ${x} ${y}`, async () => {
    const res = await fetch(`${TT}/${x}/${y}`);
    const text = (await res.text()).trim().split('\n');
    if (text.length < 2) return null;
    const head = text[0].split(',');
    const vals = text[1].split(',');
    return Object.fromEntries(head.map((h, i) => [h, vals[i]]));
  });
  if (!row) return null;
  const age = Number(row.adjusted_age || row.precomputed_age);
  return Number.isFinite(age) && age > 0 ? age : null;
}

const WD = 'https://query.wikidata.org/sparql';
async function wikidata(query) {
  return cached(`wd ${query}`, async () => {
    const res = await fetch(`${WD}?query=${encodeURIComponent(query)}`, {
      headers: { accept: 'application/sparql-results+json', 'user-agent': 'TreeOfLife/0.1 (https://github.com/jonasnako/tree-of-life)' },
    });
    if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
    return (await res.json()).results.bindings;
  });
}
// Wikidata has more than one item per IUCN category (older and newer), so
// status items are mapped by their English label.
const IUCN_LABELS = [
  ['least concern', 'LC'],
  ['near threatened', 'NT'],
  ['vulnerable', 'VU'],
  ['critically endangered', 'CR'],
  ['endangered', 'EN'],
  ['extinct in the wild', 'EW'],
  ['extinct', 'EX'],
  ['data deficient', 'DD'],
];
async function iucnCodes(qids) {
  const codes = new Map();
  if (!qids.length) return codes;
  const rows = await wikidata(`SELECT ?s ?label WHERE {
    VALUES ?s { ${qids.map((q) => `wd:${q}`).join(' ')} }
    ?s rdfs:label ?label. FILTER(LANG(?label) = "en")
  }`);
  for (const r of rows) {
    const label = r.label.value.toLowerCase();
    const hit = IUCN_LABELS.find(([words]) => label.includes(words));
    if (hit) codes.set(r.s.value.split('/').pop(), hit[1]);
  }
  return codes;
}
const sparqlString = (s) => `"${s.replace(/["\\]/g, '')}"`;

/** Status and common name for species, matched by scientific name. */
async function speciesFacts(names) {
  const facts = new Map();
  for (let i = 0; i < names.length; i += 80) {
    const chunk = names.slice(i, i + 80);
    const rows = await wikidata(`SELECT ?name ?status ?common WHERE {
      VALUES ?name { ${chunk.map(sparqlString).join(' ')} }
      ?item wdt:P225 ?name.
      OPTIONAL { ?item wdt:P141 ?status. }
      OPTIONAL { ?item wdt:P1843 ?common. FILTER(LANG(?common) = "en") }
    }`);
    for (const r of rows) {
      const f = facts.get(r.name.value) ?? {};
      if (r.status) f.statusItem = r.status.value.split('/').pop();
      if (r.common && (!f.common || r.common.value.length < f.common.length)) f.common = r.common.value;
      facts.set(r.name.value, f);
    }
  }
  const codes = await iucnCodes([...new Set([...facts.values()].map((f) => f.statusItem).filter(Boolean))]);
  for (const f of facts.values()) if (f.statusItem && codes.has(f.statusItem)) f.status = codes.get(f.statusItem);
  return facts;
}

/** English common names for higher taxa (shortest one Wikidata knows). */
async function cladeCommonNames(names) {
  const common = new Map();
  for (let i = 0; i < names.length; i += 80) {
    const chunk = names.slice(i, i + 80);
    // The taxon common name (P1843) if there is one, else the English label
    // when it differs from the scientific name (e.g. Mammalia -> "mammal").
    const rows = await wikidata(`SELECT ?name ?common ?label WHERE {
      VALUES ?name { ${chunk.map(sparqlString).join(' ')} }
      ?item wdt:P225 ?name.
      OPTIONAL { ?item wdt:P1843 ?common. FILTER(LANG(?common) = "en") }
      OPTIONAL { ?item rdfs:label ?label. FILTER(LANG(?label) = "en") }
    }`);
    for (const r of rows) {
      const name = r.name.value;
      let c = r.common?.value;
      if (!c && r.label && r.label.value.toLowerCase() !== name.toLowerCase()) c = r.label.value;
      if (!c) continue;
      if (!common.has(name) || c.length < common.get(name).length) common.set(name, c);
    }
  }
  return common;
}

/** Tips under a node (small sub-trees only): { name, ott }. */
async function tips(nodeId) {
  const sub = await ot('tree_of_life/subtree', { node_id: nodeId, format: 'newick', label_format: 'name_and_id' });
  if (!sub.newick) return [];
  return [...sub.newick.matchAll(/[(,]\s*'?([^():,;']+)'?/g)]
    .map((m) => m[1].replace(/_/g, ' ').trim())
    .map((label) => {
      const id = label.match(/ ott(\d+)$/);
      return { name: id ? label.slice(0, id.index).trim() : label, ott: id ? Number(id[1]) : null };
    })
    .filter((t) => t.name);
}
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Gorilla beringei graueri" or "Amanita crenulata MM 9.01.06" -> the species name. */
const binomial = (name) => {
  const w = name.split(/\s+/);
  return w.length >= 2 && /^[a-z][a-z-]+$/.test(w[1]) && !['sp.', 'cf.', 'aff.'].includes(w[1]) ? `${w[0]} ${w[1]}` : name;
};

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const ncbiOf = (taxon) => {
  const src = (taxon?.tax_sources ?? []).find((s) => s.startsWith('ncbi:'));
  return src ? Number(src.slice(5)) : null;
};
const isExtinct = (taxon) => (taxon?.flags ?? []).some((f) => f === 'extinct' || f === 'extinct_inherited');

const taxonInfo = new Map();
async function taxon(ottId) {
  if (!taxonInfo.has(ottId)) taxonInfo.set(ottId, await ot('taxonomy/taxon_info', { ott_id: ottId }));
  return taxonInfo.get(ottId);
}

/** A named taxon standing in for a node: the node's own taxon, or one from its mrca id. */
async function representative(node) {
  if (node.taxon?.ott_id) {
    const t = await taxon(node.taxon.ott_id);
    if (!t.error) return t;
  }
  const otts = [...String(node.node_id).matchAll(/ott(\d+)/g)].map((m) => Number(m[1]));
  for (const id of otts) {
    const t = await taxon(id);
    if (!t.error && ncbiOf(t)) return t;
  }
  return null;
}

// ---------------------------------------------------------------- build

async function main() {
  console.log('Matching showcase species…');
  const showcase = [];
  for (const sp of SHOWCASE) {
    let found = null;
    for (const name of sp.names) {
      const match = await ot('tnrs/match_names', { names: [name], do_approximate_matching: false });
      const t = match.results?.[0]?.matches?.[0]?.taxon;
      if (!t) continue;
      const info = await ot('tree_of_life/node_info', { ott_id: t.ott_id, include_lineage: true });
      if (info.error) {
        console.log(`  ${name}: not in the synthetic tree (${info.error.slice(0, 60)}), trying next`);
        continue;
      }
      found = { ...sp, name: t.name, ottId: t.ott_id, ncbi: ncbiOf(t), info };
      break;
    }
    if (!found) throw new Error(`No usable species for ${sp.key}`);
    console.log(`  ${found.label}: ${found.name} (ott${found.ottId}, ${found.info.lineage.length} ancestors)`);
    showcase.push(found);
  }

  // Paths, root first.
  const nodes = new Map(); // node_id -> { id, num_tips, taxon, parent, children:Set, showcase:[] }
  for (const sp of showcase) {
    const chain = [sp.info, ...sp.info.lineage].reverse();
    chain.forEach((n, i) => {
      const id = n.node_id;
      if (!nodes.has(id)) nodes.set(id, { id, num_tips: n.num_tips, taxon: n.taxon, parent: i ? chain[i - 1].node_id : null, children: new Set(), showcase: [] });
      nodes.get(id).showcase.push(sp);
      if (i) nodes.get(chain[i - 1].node_id).children.add(id);
    });
  }
  const pathNodes = [...nodes.values()];
  console.log(`Paths: ${pathNodes.length} nodes on the lineages. Fetching their children…`);

  // Children of each inner path node, to find sister clades.
  const inner = pathNodes.filter((n) => n.children.size);
  await pool(inner, 4, async (n) => {
    const sub = await ot('tree_of_life/subtree', { node_id: n.id, format: 'arguson', height_limit: 1 });
    n.allChildren = sub.arguson?.children ?? [];
  });

  // The tree's own taxon records carry no extinct flags; the taxonomy does.
  const fossil = async (c) => {
    if (c.extinct || isExtinct(c.taxon)) return true;
    if (!c.taxon?.ott_id) return false;
    return isExtinct(await taxon(c.taxon.ott_id));
  };

  // Sister clades: living, not on a path; biggest kept, the rest grouped.
  for (const n of inner) {
    let others = n.allChildren.filter((c) => !n.children.has(c.node_id) && c.num_tips > 0 && !JUNK.test(c.taxon?.name ?? ''));
    others.sort((a, b) => b.num_tips - a.num_tips);
    const head = others.slice(0, 12);
    const flags = await pool(head, 4, fossil);
    others = [...head.filter((_, i) => !flags[i]), ...others.slice(12)];
    n.sisters = others.slice(0, MAX_SISTERS);
    const rest = others.slice(MAX_SISTERS);
    n.group = rest.length ? { count: rest.length, num_tips: rest.reduce((s, c) => s + c.num_tips, 0) } : null;
  }

  // Dates: each fork is dated by a showcase species below it against a taxon
  // on the other side (another showcase species if two lineages split here).
  console.log('Dating forks with TimeTree…');
  await pool(inner, 4, async (n) => {
    const sp = n.showcase[0];
    const candidates = [];
    // Another showcase lineage splitting off here is the best partner.
    for (const c of n.children) {
      const below = nodes.get(c).showcase;
      if (!below.includes(sp)) candidates.push(below[0].ncbi);
    }
    for (const s of n.sisters.slice(0, 3)) {
      const rep = await representative(s);
      if (rep) candidates.push(ncbiOf(rep));
    }
    n.date = null;
    n.dateSource = null;
    for (const other of candidates.filter(Boolean)) {
      const age = await timetree(sp.ncbi, other);
      if (age) {
        n.date = age;
        n.dateSource = 'TimeTree';
        break;
      }
    }
    if (!n.date && ANCHORS[n.id]) {
      n.date = ANCHORS[n.id].date;
      n.dateSource = ANCHORS[n.id].source;
    }
  });
  const dated = inner.filter((n) => n.date).length;
  console.log(`  ${dated} of ${inner.length} forks dated directly; the rest are interpolated.`);

  // Make dates consistent (each fork older than the forks below it) and fill gaps.
  const root = pathNodes.find((n) => !n.parent);
  const kids = (n) => [...n.children].map((id) => nodes.get(id));
  const maxValidBelow = (n) => {
    // Oldest directly dated fork strictly below n, with its distance in steps.
    let best = { date: 0, steps: 1 };
    const walk = (m, steps) => {
      for (const k of kids(m)) {
        if (k.valid && k.date > best.date) best = { date: k.date, steps };
        else walk(k, steps + 1);
      }
      if (!m.children.size && best.date === 0) best = { date: 0, steps: Math.max(best.steps, steps) };
    };
    walk(n, 2);
    return best;
  };
  // Valid = dated, younger than every dated ancestor and older than every dated descendant.
  const markValid = (n, ceiling) => {
    n.valid = n.date != null && n.date < ceiling;
    const next = n.valid ? n.date : ceiling;
    kids(n).forEach((k) => markValid(k, next));
  };
  markValid(root, Infinity);
  // A date that undercuts an older descendant is dropped.
  const prune = (n) => {
    kids(n).forEach(prune);
    if (!n.valid) return;
    const below = Math.max(0, ...kids(n).map(oldestValid));
    if (below >= n.date) n.valid = false;
  };
  const oldestValid = (n) => (n.valid ? n.date : Math.max(0, ...kids(n).map(oldestValid)));
  prune(root);
  const fill = (n, parentDate) => {
    if (!n.children.size) {
      n.final = 0;
      return;
    }
    if (n.valid) n.final = n.date;
    else {
      const { date, steps } = maxValidBelow(n);
      const top = parentDate ?? Math.max(ORIGIN_MIN * 0.95, date * 1.05);
      n.final = top - (top - date) / steps;
    }
    kids(n).forEach((k) => fill(k, n.final));
  };
  fill(root, null);
  const origin = Math.max(ORIGIN_MIN, Math.ceil((root.final + 150) / 50) * 50);

  // Names: taxon names; an unnamed clade is named after its biggest named
  // sub-clades (e.g. "Rodentia and Lagomorpha"), or else after a member.
  const nameOf = async (n) => {
    const nodeId = n.node_id ?? n.id;
    if (n.taxon?.name) return n.taxon.name;
    const sub = await ot('tree_of_life/subtree', { node_id: nodeId, format: 'arguson', height_limit: 1 });
    const candidates = (sub.arguson?.children ?? [])
      .filter((c) => c.taxon?.name && !JUNK.test(c.taxon.name))
      .sort((a, b) => b.num_tips - a.num_tips)
      .slice(0, 6);
    const flags = await pool(candidates, 4, fossil);
    const named = candidates.filter((_, i) => !flags[i]).slice(0, 2).map((c) => c.taxon.name);
    if (named.length === 2) return `${named[0]} and ${named[1]}`;
    if (named.length === 1) return `${named[0]} and relatives`;
    const rep = await representative({ node_id: nodeId, taxon: n.taxon });
    return rep ? `Relatives of ${rep.name}` : 'Unnamed clade';
  };

  // Forks left with a single branch (their only sisters were fossils or
  // placeholders) are not forks any more: skip them.
  const isPassThrough = (n) =>
    n.parent && n.children.size === 1 && !n.sisters?.length && !n.group && !showcase.some((s) => s.info.node_id === n.id);
  const keptParent = (n) => {
    let p = n.parent ? nodes.get(n.parent) : null;
    while (p && isPassThrough(p)) p = p.parent ? nodes.get(p.parent) : null;
    return p;
  };

  // Output nodes.
  const out = [];
  const round = (x) => Math.round(x * 100) / 100;
  for (const n of pathNodes) {
    if (isPassThrough(n)) continue;
    const leaf = showcase.find((s) => s.info.node_id === n.id);
    const parent = keptParent(n);
    out.push({
      id: n.id,
      parent: parent?.id ?? null,
      name: leaf ? leaf.name : await nameOf(n),
      common: leaf?.label,
      splitMa: round(parent ? parent.final : origin),
      species: n.num_tips,
      dateSource: n.children.size ? (n.valid ? n.dateSource : 'interpolated') : undefined,
    });
  }
  for (const n of inner) {
    if (isPassThrough(n)) continue;
    for (const s of n.sisters) {
      out.push({ id: s.node_id, parent: n.id, name: await nameOf(s), splitMa: round(n.final), species: s.num_tips });
    }
    if (n.group) {
      out.push({
        id: `${n.id}~others`,
        parent: n.id,
        name: `${n.group.count} smaller lineages`,
        splitMa: round(n.final),
        species: n.group.num_tips,
        grouped: n.group.count,
      });
    }
  }

  // Species leaves and conservation status (step 6). Every tip with ten or
  // fewer species is drawn as one leaf per species, so it lists them with
  // their IUCN status; a showcase species is one leaf.
  console.log('Listing species of small tips and fetching their status from Wikidata…');
  const hasKids = new Set(out.map((o) => o.parent));
  const small = out.filter((o) => !hasKids.has(o.id) && !o.grouped && (o.common || o.species <= 10));
  for (const o of small) {
    if (o.common) {
      o.species = 1;
      o.leaves = [{ name: o.name }];
    } else {
      // Subspecies and strains merge into their species: one leaf each.
      const all = await tips(o.id);
      const bySpecies = new Map();
      for (const t of all) if (!bySpecies.has(binomial(t.name))) bySpecies.set(binomial(t.name), t);
      const list = [...bySpecies.entries()].slice(0, 10);
      // Fossil species (flagged extinct in the taxonomy) keep their place
      // on the twig but grow no leaf.
      const flags = await pool(list, 4, async ([, t]) => (t.ott ? isExtinct(await taxon(t.ott)) : false));
      o.leaves = list.map(([name], i) => (flags[i] ? { name, extinct: true } : { name }));
      o.species = Math.max(1, o.leaves.length);
    }
  }
  const facts = await speciesFacts([...new Set(small.flatMap((o) => o.leaves.map((l) => l.name)))]);
  let rated = 0;
  for (const o of small) {
    for (const l of o.leaves) {
      const f = facts.get(l.name);
      if (f?.status) {
        l.status = f.status;
        rated++;
      }
      if (f?.common) l.common = capitalise(f.common);
    }
  }
  console.log(`  ${small.reduce((s, o) => s + o.leaves.length, 0)} species leaves, ${rated} with an IUCN status.`);

  console.log('Fetching common names for clades…');
  const named = out.filter((o) => !o.common && !o.grouped && /^[A-Z][a-z]+$/.test(o.name));
  const commons = await cladeCommonNames([...new Set(named.map((o) => o.name))]);
  for (const o of named) if (commons.has(o.name)) o.common = capitalise(commons.get(o.name));
  console.log(`  ${named.filter((o) => o.common).length} of ${named.length} clades have a common name.`);

  const file = {
    about:
      'Real-data slice (build step 4): the path from the root to each showcase species, with every living sister clade collapsed to one node. Structure and species counts (tips in the synthetic tree) from the Open Tree of Life; fork dates from TimeTree pairwise divergence times, a published anchor for the root, and interpolation where neither has an estimate (dateSource on each inner node says which). splitMa is when a node split from its sister. Tips of ten or fewer species list their species (leaves) with IUCN conservation status and common names from Wikidata. Fossil-only lineages are left out for now.',
    sources: {
      openTree: 'https://tree.opentreeoflife.org (synthetic tree, v3 API)',
      timeTree: 'https://timetree.org (pairwise divergence times)',
      wikidata: 'https://www.wikidata.org (IUCN conservation status P141, common names P1843)',
      anchors: Object.values(ANCHORS).map((a) => a.source),
    },
    built: new Date().toISOString().slice(0, 10),
    originMa: origin,
    focus: 'human',
    showcase: showcase.map((s) => ({ key: s.key, label: s.label, name: s.name, id: s.info.node_id })),
    nodes: out,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(file, null, 0).replace(/\{"id"/g, '\n{"id"') + '\n');
  console.log(`Wrote ${out.length} nodes to ${path.relative(ROOT, OUT)} (origin ${origin} Ma, ${requests} new requests).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
