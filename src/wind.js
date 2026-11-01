// Gentle wind. One sway function, shared by the wood shader and the leaf
// shader, so leaves move with the twig they hang on.
// Sway grows with height and with how young (flexible) the wood is. Both are
// continuous along the tree, so branches never come apart at forks.

export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
};

export const WIND_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWind;

// age: depth units since the growing tip passed this point (young = bendy).
vec3 windSway(vec3 p, float age) {
  float h = max(p.y, 0.0);
  float flex = 1.0 - 0.8 * smoothstep(0.0, 0.35, age);
  float amp = uWind * 0.01 * pow(h, 1.3) * (0.3 + flex);
  float gust = 0.65 + 0.35 * sin(uTime * 0.21 + p.x * 0.05) * sin(uTime * 0.13 + 1.7);
  vec3 d = vec3(
    sin(uTime * 0.85 + p.x * 0.22 + p.z * 0.13) + 0.35 * sin(uTime * 2.3 + p.y * 0.9),
    0.0,
    0.6 * cos(uTime * 0.67 + p.z * 0.22) + 0.3 * sin(uTime * 1.9 + p.x * 0.8)
  );
  return d * amp * gust;
}
`;
