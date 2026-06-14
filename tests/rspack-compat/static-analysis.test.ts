/**
 * Static analysis: verify the 4 target source files do not import any
 * webpack-specific internals that would break them under rspack.
 *
 * These tests inspect the source code as text — they do not execute it.
 * Runtime behavior is covered by the other tests in this directory.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.resolve(__dirname, '../../src');

const COMPONENT_FILES = [
  'WebpackLoader.ts',
  'server.node.ts',
  'client.node.ts',
  'client.browser.ts',
] as const;

/**
 * Patterns that would make a source file webpack-specific at runtime.
 *
 * Note: `WebpackLoader.ts` imports `LoaderDefinition` from `webpack` but that
 * is a TYPE-ONLY import — stripped by TypeScript at compile time, so it does
 * not actually pull webpack into the runtime bundle. We detect and allow that
 * case explicitly.
 */
const FORBIDDEN_RUNTIME_IMPORTS = [
  /require\(['"]webpack['"]\)/, // value require of the webpack package
  /require\(['"]webpack\/lib\//, // deep require into webpack internals
  /from\s+['"]webpack\/lib\//, // ESM import into webpack internals
];

/**
 * Strip TypeScript type-only imports so we don't false-positive on them.
 * Matches `import type { ... } from '...'` and `import { type X } from '...'`.
 */
const stripTypeOnlyImports = (src: string): string =>
  src
    .replace(/^import\s+type\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s+\{\s*type\s+[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
    // The specific `import { LoaderDefinition } from 'webpack'` is a named type import
    // that TypeScript's emit strips because LoaderDefinition is a type, not a value.
    // We still want to count it as compatible, so remove the whole line if it's ONLY
    // type names being imported.
    .replace(/^import\s+\{\s*LoaderDefinition\s*\}\s+from\s+['"]webpack['"];?\s*$/gm, '');

const readSource = (filename: string): string =>
  fs.readFileSync(path.join(SRC_DIR, filename), 'utf8');

describe('Static analysis: no webpack-specific runtime imports', () => {
  it.each(COMPONENT_FILES)(
    '%s does not require("webpack") or require("webpack/lib/*")',
    (filename) => {
      const rawSource = readSource(filename);
      const runtimeSource = stripTypeOnlyImports(rawSource);

      for (const pattern of FORBIDDEN_RUNTIME_IMPORTS) {
        expect(runtimeSource).not.toMatch(pattern);
      }
    },
  );

  it('WebpackLoader.ts uses only type-only imports from "webpack"', () => {
    const raw = readSource('WebpackLoader.ts');
    // Should have a webpack import at the SOURCE level (it's a TS type)
    expect(raw).toMatch(/from\s+['"]webpack['"]/);
    // But it should be type-only (for LoaderDefinition)
    expect(raw).toMatch(/import\s+\{\s*LoaderDefinition\s*\}\s+from\s+['"]webpack['"]/);
    // No value-level `require('webpack')` or `import webpack from 'webpack'`
    expect(raw).not.toMatch(/require\(['"]webpack['"]\)/);
    expect(raw).not.toMatch(/import\s+webpack\s+from\s+['"]webpack['"]/);
    // No webpack.* or webpackSomething.* runtime property access
    expect(raw).not.toMatch(/\bwebpack\.[A-Za-z]/);
  });

  it('server.node.ts imports only package types, react-dom hints, and stock Flight server runtime', () => {
    const raw = readSource('server.node.ts');
    const importLines = raw
      .split('\n')
      .filter((line) => /^\s*import\s/.test(line))
      .map((line) => line.trim());

    const allowedBareImports = new Set(['react-dom', 'react-server-dom-webpack/server.node']);
    for (const line of importLines) {
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      const source = match[1]!;
      expect(source.match(/^\.\.?\//) || allowedBareImports.has(source)).toBeTruthy();
    }
  });

  it('client.node.ts imports only package types and stock Flight client runtime', () => {
    const raw = readSource('client.node.ts');
    const importLines = raw
      .split('\n')
      .filter((line) => /^\s*import\s/.test(line))
      .map((line) => line.trim());

    const allowedBareImports = new Set(['react-server-dom-webpack/client.node']);
    for (const line of importLines) {
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      const source = match[1]!;
      expect(source.match(/^\.\.?\//) || allowedBareImports.has(source)).toBeTruthy();
    }
  });

  it('client.browser.ts imports only stock Flight browser runtime', () => {
    const raw = readSource('client.browser.ts');
    const importLines = raw
      .split('\n')
      .filter((line) => /^\s*import\s/.test(line))
      .map((line) => line.trim());

    const allowedBareImports = new Set(['react-server-dom-webpack/client.browser']);
    for (const line of importLines) {
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      const source = match[1]!;
      expect(source.match(/^\.\.?\//) || allowedBareImports.has(source)).toBeTruthy();
    }
  });
});

describe('Static analysis: known-incompatible WebpackPlugin is excluded', () => {
  /**
   * Sanity check — we are NOT claiming WebpackPlugin works with rspack.
   * This test documents that we know its plugin implementation uses
   * webpack-only value-level APIs (dependencies.ModuleDependency,
   * AsyncDependenciesBlock, Template) that rspack does not expose to JS.
   * If someone removes those usages, this test fails and the README should be updated.
   */
  it('WebpackPlugin.ts implementation (webpack/RSCWebpackPlugin.ts) uses webpack-only value APIs', () => {
    const pluginPath = path.join(SRC_DIR, 'webpack/RSCWebpackPlugin.ts');
    const raw = fs.readFileSync(pluginPath, 'utf8');
    // This is a SANITY check — we expect these to exist because they are the
    // whole reason rspack compat is hard for the plugin.
    expect(raw).toMatch(/import\s+webpack\s*=\s*require\(['"]webpack['"]\)/);
    expect(raw).toMatch(/webpack\.dependencies\.ModuleDependency/);
    expect(raw).toMatch(/webpack\.dependencies\.NullDependency/);
    expect(raw).toMatch(/webpack\.Template/);
    expect(raw).toMatch(/webpack\.AsyncDependenciesBlock/);
  });
});
