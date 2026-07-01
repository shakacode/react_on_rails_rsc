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
 *   - CSS chunk files (mini-css-extract-plugin) and cssPrefix handling
 *   - multiple entrypoints
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

const staticIslandClientReferences = (include: RegExp) => [
  { directory: '.', recursive: false, include },
];

const splitStaticIslandVendors = {
  splitChunks: {
    chunks: 'all',
    minSize: 0,
    cacheGroups: {
      default: false,
      defaultVendors: false,
      appVendor: {
        test: /app-vendor\.js$/,
        name: 'vendors-app',
        enforce: true,
      },
      heavyVendor: {
        test: /heavy-vendor\.js$/,
        name: 'vendors-heavy',
        enforce: true,
      },
    },
  },
};

describe('ReactFlightWebpackPlugin (real webpack)', () => {
  describe('static island diagnostics', () => {
    const diagnosticsFilename = 'rsc-client-reference-diagnostics.json';

    it('emits empty diagnostics for an explicitly server-only static page config', () => {
      const result = run('static-islands', {
        clientReferences: [],
        clientReferenceDiagnosticsFilename: diagnosticsFilename,
      });

      expect(result.manifest.filePathToModuleMetadata).toEqual({});
      expect(result.assets).toContain(diagnosticsFilename);
      expect(result.clientReferenceDiagnostics).toEqual({
        version: 1,
        manifestFilename: 'react-client-manifest.json',
        isServer: false,
        clientReferenceCount: 0,
        totalChunkBytes: 0,
        clientReferences: [],
      });
      expectNoWarnings(result);
    });

    it('shows a tiny island avoiding unrelated app/vendor chunks', () => {
      const result = run('static-islands', {
        chunkName: 'client-[request]',
        clientReferences: staticIslandClientReferences(/TinyIsland\.js$/),
        clientReferenceDiagnosticsFilename: diagnosticsFilename,
        optimizationExtra: splitStaticIslandVendors,
      });

      expect(result.assets).toContain('vendors-app.js');

      const tiny = entryEndingWith(result.manifest, '/TinyIsland.js');
      expect(chunkFiles(tiny)).toEqual(['client-TinyIsland-js.chunk.js']);

      const diagnostics = result.clientReferenceDiagnostics;
      expect(diagnostics?.clientReferenceCount).toBe(1);
      const diagnosticEntry = diagnostics?.clientReferences[0]!;
      expect(diagnosticEntry.file).toContain('/TinyIsland.js');
      expect(diagnosticEntry.chunks.map((chunk) => chunk.file)).toEqual([
        'client-TinyIsland-js.chunk.js',
      ]);
      expect(diagnosticEntry.chunks[0]!.bytes).toBeGreaterThan(0);
      expect(diagnosticEntry.totalBytes).toBe(diagnosticEntry.chunks[0]!.bytes);
      expect(diagnosticEntry.chunks.map((chunk) => chunk.file).join(',')).not.toContain('vendors');
      expectNoWarnings(result);
    });

    it('reports the heavy island vendor chunk and byte size', () => {
      const result = run('static-islands', {
        chunkName: 'client-[request]',
        clientReferences: staticIslandClientReferences(/HeavyIsland\.js$/),
        clientReferenceDiagnosticsFilename: diagnosticsFilename,
        optimizationExtra: splitStaticIslandVendors,
      });

      const heavy = entryEndingWith(result.manifest, '/HeavyIsland.js');
      expect(chunkFiles(heavy)).toEqual(
        expect.arrayContaining(['client-HeavyIsland-js.chunk.js', 'vendors-heavy.chunk.js']),
      );

      const diagnosticEntry = result.clientReferenceDiagnostics?.clientReferences[0]!;
      const heavyVendor = diagnosticEntry.chunks.find((chunk) => chunk.file === 'vendors-heavy.chunk.js');
      expect(heavyVendor?.bytes).toBeGreaterThan(0);
      expect(diagnosticEntry.totalBytes).toBeGreaterThan(heavyVendor!.bytes!);
      expect(result.clientReferenceDiagnostics?.totalChunkBytes).toBe(diagnosticEntry.totalBytes);
      expectNoWarnings(result);
    });
  });

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

  describe('per-chunk CSS scoping: a shared dependency chunk does not broadcast its CSS', () => {
    // Button and SettingsPage are independent 'use client' components, each
    // with its own CSS, that both import a non-client `shared` module carrying
    // shared.css. splitChunks forces `shared` into a chunk present in both
    // client-reference chunk groups. Per-chunk scoping attaches a chunk's CSS
    // only to the client references that chunk contains: shared.css lives in
    // the shared chunk (whose only module is the non-client `shared`), so it is
    // attached to neither reference, while each component keeps its own CSS.
    // The pre-fix group-wide collection attached shared.css to both references.
    let result: CompileResult;

    beforeAll(() => {
      result = run('split-shared-css', {
        chunkName: 'client-[request]',
        publicPath: '/assets/',
        withCss: true,
        optimizationExtra: {
          splitChunks: {
            chunks: 'all',
            minSize: 0,
            cacheGroups: {
              default: false,
              defaultVendors: false,
              shared: {
                test: /shared\.(js|css)$/,
                name: 'shared',
                minChunks: 2,
                enforce: true,
              },
            },
          },
        },
      });
    });

    it('extracts the shared chunk CSS as its own asset (precondition)', () => {
      expect(result.assets).toContain('shared.chunk.css');
    });

    it("keeps each client reference's own CSS", () => {
      const button = entryEndingWith(result.manifest, '/Button.js');
      const settings = entryEndingWith(result.manifest, '/SettingsPage.js');
      expect(button.css).toContain('/assets/client-Button-js.chunk.css');
      expect(settings.css).toContain('/assets/client-SettingsPage-js.chunk.css');
    });

    it("does not broadcast the shared chunk's CSS onto either reference", () => {
      const button = entryEndingWith(result.manifest, '/Button.js');
      const settings = entryEndingWith(result.manifest, '/SettingsPage.js');
      expect(button.css ?? []).not.toContain('/assets/shared.chunk.css');
      expect(settings.css ?? []).not.toContain('/assets/shared.chunk.css');
    });

    it('produces no fallback warning', () => {
      expectNoWarnings(result);
    });
  });

  describe('sibling-chunk CSS recovery: own CSS split from its JS module (#112)', () => {
    // Button ('use client') imports Button.css; Other ('use client') imports
    // Button, so Button's JS is shared across two client-reference chunk
    // groups. splitChunks (matching only Button.js) moves that JS into a shared
    // chunk, while MiniCssExtract leaves Button.css in the per-reference
    // sibling chunk — so Button's own CSS lives in a chunk that does not
    // contain Button's module. The per-chunk pass alone would leave Button's
    // entry with no CSS; the #112 recovery pass follows Button's direct
    // Button.css import to its chunk (intersected with Button's group) and
    // restores it.
    let result: CompileResult;

    beforeAll(() => {
      result = run('split-js-css', {
        chunkName: 'client-[request]',
        publicPath: '/assets/',
        withCss: true,
        optimizationExtra: {
          splitChunks: {
            chunks: 'all',
            minSize: 0,
            cacheGroups: {
              default: false,
              defaultVendors: false,
              sharedButtonJs: {
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

    it("splits Button's JS into the shared chunk while its CSS stays in the sibling chunk (precondition)", () => {
      expect(result.assets).toContain('shared-button.chunk.js');
      expect(result.assets).toContain('client-Button-js.chunk.css');
      const button = entryEndingWith(result.manifest, '/Button.js');
      // Button's JS module is in the shared chunk, which carries no CSS.
      expect(chunkFiles(button)).toContain('shared-button.chunk.js');
    });

    it("recovers Button's own CSS from its sibling chunk", () => {
      const button = entryEndingWith(result.manifest, '/Button.js');
      expect(button.css).toContain('/assets/client-Button-js.chunk.css');
    });

    it("does not attach another group's copy of Button's CSS to Button", () => {
      const button = entryEndingWith(result.manifest, '/Button.js');
      // Button.css is also extracted into Other's chunk, but that chunk is not
      // in Button's chunk group, so its copy must not be hinted for Button.
      expect(button.css ?? []).not.toContain('/assets/client-Other-js.chunk.css');
    });

    it("attaches Other's own copy of the CSS to Other, not Button's", () => {
      const other = entryEndingWith(result.manifest, '/Other.js');
      // Other renders Button, so its chunk carries its own extracted copy of
      // the styles; it must be hinted Other's copy and not Button's.
      expect(other.css).toContain('/assets/client-Other-js.chunk.css');
      expect(other.css ?? []).not.toContain('/assets/client-Button-js.chunk.css');
    });

    it('produces no fallback warning', () => {
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

  describe('CSS chunk files (mini-css-extract-plugin)', () => {
    it("records a chunk group's CSS under `css` with the normalized publicPath prefix", () => {
      const result = run('css-import', {
        chunkName: 'client-[request]',
        clientReferenceDiagnosticsFilename: 'rsc-client-reference-diagnostics.json',
        // No trailing slash on purpose: the plugin must normalize the
        // cssPrefix by appending one.
        publicPath: '/assets',
        withCss: true,
      });
      expect(result.assets).toContain('client-Button-js.chunk.css');

      const button = entryEndingWith(result.manifest, '/Button.js');
      expect(button.css).toEqual(['/assets/client-Button-js.chunk.css']);
      // CSS files belong in `css`, never in the JS chunk pair list.
      expect(chunkFiles(button)).toEqual(['client-Button-js.chunk.js']);
      const diagnosticEntry = result.clientReferenceDiagnostics?.clientReferences[0]!;
      expect(diagnosticEntry.css).toEqual([
        {
          file: '/assets/client-Button-js.chunk.css',
          bytes: expect.any(Number),
        },
      ]);
      expectNoWarnings(result);
    });
  });

  describe('multiple entrypoints', () => {
    it("does not leak another entrypoint's chunks into a client component's entry", () => {
      const result = run('multi-entry', {
        chunkName: 'client-[request]',
        extraEntries: { admin: './admin.js' },
      });
      // Precondition: the second entrypoint was built and eagerly bundles
      // Button into its own chunk.
      expect(result.assets).toContain('admin.js');

      const button = entryEndingWith(result.manifest, '/Button.js');
      expect(chunkFiles(button)).toEqual(['client-Button-js.chunk.js']);
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
      // webpack annotates the hoisted module as "./Button.js + N modules"
      // (pattern-matched so a format tweak in a webpack upgrade fails
      // loudly here instead of silently).
      const chunkSource = fs.readFileSync(
        path.join(result.outputPath, 'client-Button-js.chunk.js'),
        'utf8',
      );
      expect(chunkSource).toMatch(/\.\/Button\.js \+ \d+ modules/);

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

  describe('CSS on a client component reached only via the fallback', () => {
    it("collects the entry chunk group's CSS for an eagerly-imported component", () => {
      // Button is eagerly imported by the entry, so its injected async
      // chunk group is empty and it is recorded only by the fallback scan.
      // Button imports CSS, so the fallback's recordChunkGroup must collect
      // the extracted CSS file from the entry chunk group (the CSS branch on
      // the fallback path, untested by the block-matched css-import case).
      // `runtimeChunk: 'single'` splits the runtime out so the entry chunk
      // (which carries Button's CSS) is no longer the runtime chunk and is
      // therefore not removed by the runtime-chunk exclusion.
      const result = run('eager-css', {
        chunkName: 'client-[request]',
        publicPath: '/assets/',
        withCss: true,
        optimizationExtra: { runtimeChunk: 'single' },
      });
      expect(result.assets).toContain('main.css');

      const button = entryEndingWith(result.manifest, '/Button.js');
      expect(button.css).toEqual(['/assets/main.css']);
      expect(chunkFiles(button)).toEqual(['main.js']);
      expectNoWarnings(result);
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

    it('unions every chunk group containing the module when chunks stay split', () => {
      const result = run('client-imports-client', {
        isServer: true,
        chunkName: 'client-[request]',
      });

      // Server builds record all chunk groups against the full client
      // file set: Button's module is duplicated into SettingsPage's chunk
      // (no splitChunks), so Button's entry unions both groups' chunks.
      const button = entryEndingWith(result.manifest, '/Button.js');
      const settings = entryEndingWith(result.manifest, '/SettingsPage.js');
      expect(chunkFiles(button).sort()).toEqual([
        'client-Button-js.chunk.js',
        'client-SettingsPage-js.chunk.js',
      ]);
      expect(chunkFiles(settings)).toEqual(['client-SettingsPage-js.chunk.js']);
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

    it("passes 'use-credentials' crossOriginLoading through unchanged", () => {
      const result = run('client-imports-client', {
        chunkName: 'client-[request]',
        crossOriginLoading: 'use-credentials',
      });

      expect(result.manifest.moduleLoading.crossOrigin).toBe('use-credentials');
      expectNoWarnings(result);
    });

    it('records a null crossOrigin when crossOriginLoading is disabled', () => {
      const result = run('client-imports-client', {
        chunkName: 'client-[request]',
        crossOriginLoading: false,
      });

      // `output.crossOriginLoading: false` is not a string, so the plugin
      // normalizes it to null rather than coercing to 'anonymous'.
      expect(result.manifest.moduleLoading.crossOrigin).toBeNull();
      expectNoWarnings(result);
    });
  });
});
