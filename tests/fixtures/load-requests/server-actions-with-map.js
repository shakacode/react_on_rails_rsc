/*
 * Copyright (c) 2025-2026 Example Corp (commercial license)
 *
 * A published-shape "use server" module whose sourceMappingURL pointer names a
 * .map file that DOES exist next to it, so the loader must serve the real map.
 */
'use server';
export async function greetWithMap(name) {
  return `Hello from mapped, ${name}!`;
}
//# sourceMappingURL=server-actions-with-map.js.map
