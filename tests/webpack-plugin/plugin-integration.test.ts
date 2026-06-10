/**
 * Integration tests for ReactFlightWebpackPlugin against REAL webpack 5
 * compilations (no mocked webpack internals).
 *
 * These verify the dependency-type-based client manifest construction from
 * https://github.com/shakacode/react_on_rails_rsc/issues/22: chunk groups
 * are matched through their `ClientReferenceDependency` async blocks
 * (`chunkGroup.getBlocks()` → `block.dependencies`), so each client
 * component's manifest entry lists exactly the chunks of the one chunk
 * group webpack created for it — not the union of every chunk group the
 * module happens to appear in (the over-preload / overwrite class from
 * issue #19).
 *
 * Covers the verification matrix from docs/open-rsc-work-status.md (CSS +
 * JS chunk file ordering is covered separately by the mock-based
 * react-flight-webpack-plugin-css-order tests):
 *   - splitChunks shared module across several chunk groups
 *   - duplicated module across chunk groups (client importing client)
 *   - runtime chunk exclusion
 *   - `.mjs` chunk files
 *   - concatenated modules
 *   - server (isServer: true) manifest generation
 * and the two risks called out in issue #22: `getBlocks()` /
 * `block.dependencies` working as stable webpack 5 APIs, and the
 * block-created chunk group containing the full set of chunks the
 * component needs (including chunks split out by SplitChunksPlugin).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  compile,
  cleanupOutputDirs,
  entryEndingWith,
  chunkFiles,
  chunkIds,
  type CompileResult,
} from './helpers/compile';

jest.setTimeout(180_000);

const created: CompileResult[] = [];
const run = (fixture: string, options?: Parameters<typeof compile>[1]): CompileResult => {
  const r = compile(fixture, options);
  created.push(r);
  return r;
};

afterAll(() => cleanupOutputDirs(created));

const expectNoWarnings = (result: CompileResult): void => {
  // Wholesale assert (not a substring allowlist) so a new or reworded
  // plugin warning cannot slip through unnoticed.
  expect(result.warnings).toEqual([]);
};

describe('ReactFlightWebpackPlugin (real webpack)', () => {
  describe('splitChunks shared module across chunk groups (issue #22 scenario)', () => {
    // Button.js ('use client') is forced into a `shared-button` chunk that
    // belongs to two chunk groups: Button's own client-reference group and
    // SettingsPage's client-reference group (it imports Button).
    let result: CompileResult;

    beforeAll(() => {
      result = run('split-shared', {
        chunkName: 'client-[request]',
        optimizationExtra: {
          splitChunks: {
            chunks: 'all',
            minSize: 0,
            cacheGroups: {
              default: false,
              defaultVendors: false,
              sharedButton: {
                test: /Button\.js$/,
                name: 'shared-button',
                minChunks: 2,
                enforce: true,
              },
            },
          },
        },
      });
    });

    it('creates the shared chunk (precondition)', () => {
      expect(result.assets.some((a) => a.startsWith('shared-button.'))).toBe(true);
    });

    it("lists exactly Button's own chunk group: the shared chunk holding Button plus the remainder chunk", () => {
      const button = entryEndingWith(result.manifest, '/Button.js');
      const files = chunkFiles(button).sort();

      expect(files).toHaveLength(2);
      expect(files.some((f) => f.startsWith('shared-button.'))).toBe(true);
      expect(files).toContain('client-Button-js.chunk.js');
    });

    it("does not leak other chunk groups' chunks into Button's entry", () => {
      const button = entryEndingWith(result.manifest, '/Button.js');
      const files = chunkFiles(button);

      // Pre-#22 behavior unioned every chunk group containing the shared
      // chunk, dragging in the settings chunk and entry chunks.
      expect(files).not.toContain('main.js');
      expect(files.some((f) => f.includes('SettingsPage'))).toBe(false);
    });

    it("lists exactly SettingsPage's own chunk group", () => {
      const settings = entryEndingWith(result.manifest, '/SettingsPage.js');
      const files = chunkFiles(settings).sort();

      expect(files).toHaveLength(2);
      expect(files.some((f) => f.startsWith('shared-button.'))).toBe(true);
      expect(files).toContain('client-SettingsPage-js.chunk.js');
      expect(files).not.toContain('main.js');
      expect(files).not.toContain('client-Button-js.chunk.js');
    });

    it('only emits manifest entries for the "use client" files', () => {
      const keys = Object.keys(result.manifest.filePathToModuleMetadata).sort();
      expect(keys).toHaveLength(2);
      expect(keys.some((k) => k.endsWith('/Button.js'))).toBe(true);
      expect(keys.some((k) => k.endsWith('/SettingsPage.js'))).toBe(true);
    });

    it('resolves client-reference blocks through real webpack chunk groups (no fallback warning)', () => {
      // Issue #22 risk: `chunkGroup.getBlocks()` / `block.dependencies`
      // must work as public webpack 5 APIs. If they did not, the plugin
      // would emit its "blocks were unavailable" warning and skip entries.
      expectNoWarnings(result);
    });
  });

  describe('duplicated module across chunk groups (issue #19 class, no splitChunks)', () => {
    // SettingsPage imports Button; with no splitChunks, Button's module is
    // duplicated into SettingsPage's chunk, so it appears in two chunk
    // groups. The dependency-type approach must keep the entries separate
    // instead of merging or overwriting chunk lists.
    let result: CompileResult;

    beforeAll(() => {
      result = run('client-imports-client', { chunkName: 'client-[request]' });
    });

    it("Button's entry only lists Button's own chunk", () => {
      const button = entryEndingWith(result.manifest, '/Button.js');
      expect(chunkFiles(button)).toEqual(['client-Button-js.chunk.js']);
    });

    it("SettingsPage's entry only lists SettingsPage's own chunk", () => {
      const settings = entryEndingWith(result.manifest, '/SettingsPage.js');
      expect(chunkFiles(settings)).toEqual(['client-SettingsPage-js.chunk.js']);
    });

    it('keeps ids and chunk ids consistent with webpack named ids', () => {
      const button = entryEndingWith(result.manifest, '/Button.js');
      expect(button.id).toBe('./Button.js');
      expect(button.name).toBe('*');
      expect(chunkIds(button)).toEqual(['client-Button-js']);
      expectNoWarnings(result);
    });
  });

  describe('.mjs chunk files', () => {
    it('records .mjs chunk files in the manifest', () => {
      const result = run('client-imports-client', {
        chunkName: 'client-[request]',
        outputExtra: { chunkFilename: '[name].chunk.mjs' },
      });

      const button = entryEndingWith(result.manifest, '/Button.js');
      expect(chunkFiles(button)).toEqual(['client-Button-js.chunk.mjs']);
      expectNoWarnings(result);
    });
  });

  describe('runtime chunk exclusion', () => {
    it('never lists the webpack runtime chunk in client manifest entries', () => {
      const result = run('client-imports-client', {
        chunkName: 'client-[request]',
        optimizationExtra: { runtimeChunk: 'single' },
      });

      expect(result.assets.some((a) => a.startsWith('runtime'))).toBe(true);
      for (const metadata of Object.values(result.manifest.filePathToModuleMetadata)) {
        const files = chunkFiles(metadata);
        expect(files.some((f) => f.startsWith('runtime'))).toBe(false);
        expect(files).not.toContain('main.js');
      }
      expectNoWarnings(result);
    });
  });

  describe('concatenated modules', () => {
    it('records a client component hoisted into a ConcatenatedModule', () => {
      const result = run('concatenated', {
        chunkName: 'client-[request]',
        optimizationExtra: { concatenateModules: true, usedExports: true },
      });

      // Precondition: concatenation actually happened in Button's chunk —
      // webpack annotates the hoisted module as "./Button.js + 1 modules".
      const chunkSource = fs.readFileSync(
        path.join(result.outputPath, 'client-Button-js.chunk.js'),
        'utf8',
      );
      expect(chunkSource).toContain('./Button.js + 1 modules');

      const button = entryEndingWith(result.manifest, '/Button.js');
      expect(chunkFiles(button)).toEqual(['client-Button-js.chunk.js']);
      // The id must point at the concatenated module so requiring it at
      // runtime yields the hoisted exports.
      expect(button.id).toBe('./Button.js');
      expectNoWarnings(result);
    });
  });

  describe('client component eagerly imported by the entry', () => {
    // Webpack leaves the plugin-created async chunk group for Button empty
    // (and without block metadata) because Button is already available in
    // the parent entry chunk. The manifest must still contain an entry for
    // Button — Flight throws "Could not find the module in React Client
    // Manifest" otherwise — just with no additional chunks to load.
    let result: CompileResult;

    beforeAll(() => {
      result = run('eager-import', { chunkName: 'client-[request]' });
    });

    it('still emits a manifest entry for the eagerly-imported component', () => {
      const button = entryEndingWith(result.manifest, '/Button.js');
      expect(button.id).toBe('./Button.js');
      expect(button.name).toBe('*');
      // Button ships inside the always-loaded entry chunk, so no extra
      // chunks need preloading (the entry runtime chunk is excluded).
      expect(chunkFiles(button)).toEqual([]);
    });

    it('keeps block-derived entries minimal for the other client component', () => {
      const settings = entryEndingWith(result.manifest, '/SettingsPage.js');
      // Button is available from the entry chunk, so SettingsPage's chunk
      // group only ships SettingsPage itself.
      expect(chunkFiles(settings)).toEqual(['client-SettingsPage-js.chunk.js']);
      expectNoWarnings(result);
    });

    it('with a split runtime chunk, the fallback lists the already-loaded entry chunk', () => {
      const splitRuntime = run('eager-import', {
        chunkName: 'client-[request]',
        optimizationExtra: { runtimeChunk: 'single' },
      });
      expect(splitRuntime.assets.some((a) => a.startsWith('runtime'))).toBe(true);

      // With `runtimeChunk: 'single'` the entry chunk is no longer the
      // runtime chunk, so the runtime-chunk exclusion does not filter it:
      // Button's fallback entry records the entry chunk webpack already
      // loaded. A redundant preload, not a correctness issue — webpack's
      // chunk loader no-ops on installed chunks.
      const button = entryEndingWith(splitRuntime.manifest, '/Button.js');
      expect(chunkFiles(button)).toEqual(['main.js']);
      expectNoWarnings(splitRuntime);
    });
  });

  describe('server build (isServer: true)', () => {
    it('emits server manifest entries from the single merged server bundle', () => {
      const result = run('client-imports-client', {
        isServer: true,
        maxChunks: 1,
        chunkName: 'client-[request]',
      });

      const button = entryEndingWith(result.manifest, '/Button.js');
      const settings = entryEndingWith(result.manifest, '/SettingsPage.js');
      expect(chunkFiles(button)).toEqual(['main.js']);
      expect(chunkFiles(settings)).toEqual(['main.js']);
      expect(button.id).toBe('./Button.js');
      expect(settings.id).toBe('./SettingsPage.js');
      expectNoWarnings(result);
    });
  });

  describe('manifest shape', () => {
    it('reflects publicPath and crossOriginLoading in moduleLoading', () => {
      const result = run('client-imports-client', {
        chunkName: 'client-[request]',
        publicPath: '/packs/',
        crossOriginLoading: 'anonymous',
      });

      expect(result.manifest.moduleLoading).toEqual({
        prefix: '/packs/',
        crossOrigin: 'anonymous',
      });
      expectNoWarnings(result);
    });
  });
});
