// Gentle wind. One sway function, shared by the wood shader and the leaf
// shader (and mirrored in JavaScript for labels), so everything that hangs on
// a twig moves with it.
// Sway grows with height (up to a point) and with how young (flexible) the wood is. Both are
// continuous along the tree, so branches never come apart at forks.

export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.45 },
};

export const WIND_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWind;

// age: depth units since the growing tip passed this point (young = bendy).
vec3 windSway(vec3 p, float age) {
  float h = max(p.y, 0.0);
  float flex = 1.0 - 0.8 * smoothstep(0.0, 0.35, age);
  float amp = uWind * 0.01 * pow(min(h, 12.0), 1.3) * (0.3 + flex);
  float gust = 0.65 + 0.35 * sin(uTime * 0.17 + p.x * 0.05) * sin(uTime * 0.11 + 1.7);
  vec3 d = vec3(
    sin(uTime * 0.45 + p.x * 0.18 + p.z * 0.11) + 0.15 * sin(uTime * 1.1 + p.y * 0.7),
    0.0,
    0.6 * cos(uTime * 0.37 + p.z * 0.18) + 0.12 * sin(uTime * 0.9 + p.x * 0.6)
  );
  return d * amp * gust;
}
`;

/** JavaScript twin of windSway, for things drawn outside the shaders (labels). */
export function windSway(p, age, out) {
  const t = windUniforms.uTime.value;
  const h = Math.max(p.y, 0);
  const s = Math.min(1, Math.max(0, age / 0.35));
  const flex = 1 - 0.8 * s * s * (3 - 2 * s);
  const amp = windUniforms.uWind.value * 0.01 * Math.pow(Math.min(h, 12), 1.3) * (0.3 + flex);
  const gust = 0.65 + 0.35 * Math.sin(t * 0.17 + p.x * 0.05) * Math.sin(t * 0.11 + 1.7);
  return out.set(
    (Math.sin(t * 0.45 + p.x * 0.18 + p.z * 0.11) + 0.15 * Math.sin(t * 1.1 + p.y * 0.7)) * amp * gust,
    0,
    (0.6 * Math.cos(t * 0.37 + p.z * 0.18) + 0.12 * Math.sin(t * 0.9 + p.x * 0.6)) * amp * gust,
  );
}
