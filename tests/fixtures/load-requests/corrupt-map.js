/*
 * A "use server" module whose .map file exists but contains invalid JSON.
 * The loader must fall back to the empty map instead of crashing the build.
 */
'use server';
export async function greetCorrupt(name) {
  return `Hello from corrupt, ${name}!`;
}
//# sourceMappingURL=corrupt-map.js.map
