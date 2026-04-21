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

  it('server.node.ts only imports from its own module tree and types', () => {
    const raw = readSource('server.node.ts');
    // Sanity: imports only from `./types` and `./react-server-dom-webpack/server.node`
    const importLines = raw
      .split('\n')
      .filter((line) => /^\s*import\s/.test(line))
      .map((line) => line.trim());

    for (const line of importLines) {
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      const source = match[1];
      // All imports must be relative (starting with ./ or ../) — no bare module specifiers
      expect(source).toMatch(/^\.\.?\//);
    }
  });

  it('client.node.ts only imports from its own module tree and types', () => {
    const raw = readSource('client.node.ts');
    const importLines = raw
      .split('\n')
      .filter((line) => /^\s*import\s/.test(line))
      .map((line) => line.trim());

    for (const line of importLines) {
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      const source = match[1];
      expect(source).toMatch(/^\.\.?\//);
    }
  });

  it('client.browser.ts only imports from its own module tree', () => {
    const raw = readSource('client.browser.ts');
    const importLines = raw
      .split('\n')
      .filter((line) => /^\s*import\s/.test(line))
      .map((line) => line.trim());

    for (const line of importLines) {
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!match) continue;
      const source = match[1];
      expect(source).toMatch(/^\.\.?\//);
    }
  });

  it('vendored react-server-dom-webpack-node-loader is free of bundler API usage', () => {
    const loaderPath = path.join(
      SRC_DIR,
      'react-server-dom-webpack/esm/react-server-dom-webpack-node-loader.production.js',
    );
    const raw = fs.readFileSync(loaderPath, 'utf8');
    // The node-loader must not touch webpack internals — it's pure source transformation
    expect(raw).not.toMatch(/webpack\/lib\//);
    expect(raw).not.toMatch(/from\s+['"]webpack['"]/);
    // It DOES use webpack-sources — that's an independent npm package, not a webpack internal
    // so we allow it explicitly by name
    const disallowedImports = raw
      .split('\n')
      .filter((line) => /^\s*(import|require)/.test(line))
      .filter((line) => /webpack/.test(line))
      .filter((line) => !/webpack-sources/.test(line));
    expect(disallowedImports).toEqual([]);
  });
});

describe('Static analysis: known-incompatible WebpackPlugin is excluded', () => {
  /**
   * Sanity check — we are NOT claiming WebpackPlugin works with rspack.
   * This test documents that we know it uses webpack/lib/* internals.
   * If someone removes those usages, this test fails and the README should be updated.
   */
  it('WebpackPlugin.ts or its vendored plugin reaches into webpack/lib/*', () => {
    const vendoredPluginPath = path.join(
      SRC_DIR,
      'react-server-dom-webpack/cjs/react-server-dom-webpack-plugin.js',
    );
    const raw = fs.readFileSync(vendoredPluginPath, 'utf8');
    // This is a SANITY check — we expect these to exist because they are the
    // whole reason rspack compat is hard for the plugin.
    expect(raw).toMatch(/require\(["']webpack\/lib\/dependencies\/ModuleDependency["']\)/);
    expect(raw).toMatch(/require\(["']webpack\/lib\/dependencies\/NullDependency["']\)/);
    expect(raw).toMatch(/require\(["']webpack\/lib\/Template["']\)/);
    expect(raw).toMatch(/require\(["']webpack["']\)/);
  });
});
