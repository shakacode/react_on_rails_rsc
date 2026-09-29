/*
 * A directive-less module with a dangling sourceMappingURL pointer. The stock
 * node-loader's cheap `indexOf` gate returns it untouched before any parsing
 * or sourcemap fetching, so its output must stay byte-identical.
 */
export function plainHelper(value) {
  return `plain:${value}`;
}
//# sourceMappingURL=plain-module-with-map-pointer.js.map
