/*
 * Copyright (c) 2025-2026 Example Corp (commercial license)
 *
 * A published-shape "use server" module: license header, directive, and a
 * trailing sourceMappingURL pointer with NO .map file on disk. Before the
 * react_on_rails#5079 fix the loader answered the stock node-loader's
 * sourcemap request with this JavaScript source, and JSON.parse failed the
 * build with `SyntaxError: Unexpected token '/' ... is not valid JSON`.
 */
'use server';
export async function greetDangling(name) {
  return `Hello from dangling, ${name}!`;
}
//# sourceMappingURL=server-actions-dangling-map.js.map
