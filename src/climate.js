// Earth's climate through deep time, as a few broad strokes that drive the
// environment: sky, light, ground and snow. Values are interpolated between
// key moments; they are a rough sketch of the major episodes, not a
// temperature record.
//
// temp:  -1 deep ice age .. 0 temperate .. +1 hothouse
// arid:   0 wet .. 1 desert
// haze:   0 clear .. 1 thick orange haze (early Earth, no oxygen)
// molten: 1 the young, still-volcanic Earth

const KEYS = [
  // ma, temp, arid, haze, molten, name
  [4350, 1.0, 0.7, 1.0, 1.0, 'Hadean · molten young Earth'],
  [4100, 0.8, 0.6, 1.0, 0.3, 'Hadean · first oceans'],
  [4000, 0.7, 0.5, 0.9, 0.0, 'Archean · warm, hazy, no oxygen'],
  [2500, 0.5, 0.5, 0.7, 0.0, 'Archean · warm, hazy, no oxygen'],
  [2420, -1.0, 0.3, 0.1, 0.0, 'Huronian glaciation'],
  [2150, -1.0, 0.3, 0.0, 0.0, 'Huronian glaciation'],
  [2050, 0.4, 0.5, 0.0, 0.0, 'Great Oxidation · warm'],
  [1800, 0.3, 0.6, 0.0, 0.0, 'The “boring billion”'],
  [730, 0.2, 0.6, 0.0, 0.0, 'The “boring billion”'],
  [715, -1.0, 0.3, 0.0, 0.0, 'Snowball Earth'],
  [640, -1.0, 0.3, 0.0, 0.0, 'Snowball Earth'],
  [625, 0.5, 0.4, 0.0, 0.0, 'Ediacaran · thaw'],
  [530, 0.7, 0.4, 0.0, 0.0, 'Cambrian greenhouse'],
  [450, 0.5, 0.4, 0.0, 0.0, 'Ordovician'],
  [445, -0.7, 0.3, 0.0, 0.0, 'Late Ordovician ice age'],
  [438, 0.4, 0.4, 0.0, 0.0, 'Silurian · warm seas'],
  [360, 0.4, 0.3, 0.0, 0.0, 'Devonian · first forests'],
  [335, -0.6, 0.2, 0.0, 0.0, 'Late Paleozoic ice age'],
  [290, -0.6, 0.3, 0.0, 0.0, 'Late Paleozoic ice age'],
  [265, 0.6, 0.7, 0.0, 0.0, 'Permian · Pangaea dries out'],
  [252, 1.0, 0.95, 0.15, 0.0, 'End-Permian hothouse'],
  [235, 0.8, 0.8, 0.0, 0.0, 'Triassic · hot and dry'],
  [190, 0.6, 0.4, 0.0, 0.0, 'Jurassic greenhouse'],
  [100, 0.7, 0.3, 0.0, 0.0, 'Cretaceous greenhouse'],
  [66, 0.5, 0.35, 0.1, 0.0, 'End-Cretaceous'],
  [56, 0.95, 0.35, 0.0, 0.0, 'Paleocene–Eocene Thermal Maximum'],
  [50, 0.7, 0.3, 0.0, 0.0, 'Eocene greenhouse'],
  [34, 0.15, 0.4, 0.0, 0.0, 'Antarctic ice sheet forms'],
  [15, 0.25, 0.45, 0.0, 0.0, 'Miocene'],
  [3, 0.0, 0.45, 0.0, 0.0, 'Pliocene · cooling'],
  [2.6, -0.55, 0.35, 0.0, 0.0, 'Pleistocene ice ages'],
  [0.02, -0.65, 0.35, 0.0, 0.0, 'Last Glacial Maximum'],
  [0.0117, 0.05, 0.4, 0.0, 0.0, 'Holocene'],
  [0, 0.1, 0.4, 0.0, 0.0, 'Holocene'],
];

const smooth = (t) => t * t * (3 - 2 * t);

/** Climate at a time (Ma), interpolated between key moments. */
export function climateAt(ma) {
  let i = KEYS.findIndex((k) => k[0] <= ma);
  if (i <= 0) i = Math.max(1, i);
  const a = KEYS[i - 1];
  const b = KEYS[i] ?? a;
  const t = a[0] === b[0] ? 0 : smooth(Math.min(1, Math.max(0, (a[0] - ma) / (a[0] - b[0]))));
  const mix = (k) => a[k] + (b[k] - a[k]) * t;
  // Life on land: bare rock until land plants (~470 Ma), mosses, then forests.
  const life = ma > 470 ? 0 : ma > 360 ? 0.5 * smooth((470 - ma) / 110) : 0.5 + 0.5 * smooth(Math.min(1, (360 - ma) / 60));
  return { temp: mix(1), arid: mix(2), haze: mix(3), molten: mix(4), life, name: t < 0.5 ? a[5] : b[5] };
}
