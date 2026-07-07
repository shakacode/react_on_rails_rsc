/**
 * Unit + integration tests for RSCRspackPlugin.
 *
 * Pattern modeled on `rspack-manifest-plugin`'s test suite: one fixture
 * directory per scenario, a shared `compile()` helper, assertions on the
 * parsed manifest JSON.
 *
 * Runs rspack in a child Node process (see helpers/runRspackWithPlugin.js).
 */

import * as fs from 'fs';
import { execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { compile, cleanupOutputDirs, type CompileResult } from './helpers/compile';

const created: CompileResult[] = [];
const run = (fixture: string, options?: Parameters<typeof compile>[1]): CompileResult => {
  const r = compile(fixture, options);
  created.push(r);
  return r;
};

type ManifestChunks =
  CompileResult['manifest']['filePathToModuleMetadata'][string]['chunks'];

// Manifest chunks are encoded as [id, file, id, file, ...].
const manifestChunkFiles = (chunks: ManifestChunks): string[] =>
  chunks.filter((_chunk, index) => index % 2 === 1).map(String);

const readDiagnosticCss = (result: CompileResult, entryFileSuffix: string): string => {
  const entry = result.clientReferenceDiagnostics?.clientReferences.find((reference) =>
    reference.file.endsWith(entryFileSuffix),
  );
  expect(entry).toBeTruthy();
  return (entry!.css ?? [])
    .map(({ file }) => {
      const assetName = file.replace(/^\/assets\//, '');
      return fs.readFileSync(path.join(result.outputPath, assetName), 'utf8');
    })
    .join('\n');
};

const manifestMetadataFor = (
  result: CompileResult,
  entryFileSuffix: string,
): CompileResult['manifest']['filePathToModuleMetadata'][string] => {
  const entry = Object.entries(result.manifest.filePathToModuleMetadata).find(([file]) =>
    file.endsWith(entryFileSuffix),
  );
  expect(entry).toBeTruthy();
  return entry![1];
};

const readManifestCss = (result: CompileResult, entryFileSuffix: string): string =>
  (manifestMetadataFor(result, entryFileSuffix).css ?? [])
    .map((file) => {
      const assetName = file.replace(/^\/assets\//, '');
      return fs.readFileSync(path.join(result.outputPath, assetName), 'utf8');
    })
    .join('\n');

const staticIslandClientReferences = (include: RegExp) => [
  { directory: '.', recursive: false, include },
];

const splitStaticIslandVendors = {
  optimization: {
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
  },
};

const splitStaticIslandCssOnlyChunks = {
  optimization: {
    splitChunks: {
      chunks: 'all',
      minSize: 0,
      cacheGroups: {
        default: false,
        defaultVendors: false,
        styles: {
          name: 'styles',
          type: 'css/mini-extract',
          chunks: 'all',
          enforce: true,
        },
      },
    },
  },
};

const splitStaticIslandMixedCssOnlyChunk = {
  optimization: {
    splitChunks: {
      chunks: 'all',
      minSize: 0,
      cacheGroups: {
        default: false,
        defaultVendors: false,
        splitIslandStyles: {
          test: /MixedSplitIsland\.css$/,
          name: 'styles',
          type: 'css/mini-extract',
          chunks: 'all',
          enforce: true,
        },
      },
    },
  },
};

afterAll(() => cleanupOutputDirs(created));

const DIST_PLUGIN = path.resolve(__dirname, '../../dist/react-server-dom-rspack/plugin.js');
const DIST_INJECTION_LOADER = path.resolve(
  __dirname,
  '../../dist/react-server-dom-rspack/injection-loader.js',
);
const DIST_RSPACK_LOADER = path.resolve(
  __dirname,
  '../../dist/react-server-dom-rspack/loader.js',
);
const MULTICOMPILER_CHILD_TIMEOUT_MS = 30_000;
const MULTICOMPILER_JEST_TIMEOUT_MS = MULTICOMPILER_CHILD_TIMEOUT_MS + 5_000;

describe('RSCRspackPlugin', () => {
  beforeAll(() => {
    if (!fs.existsSync(DIST_PLUGIN)) {
      throw new Error(
        `Precondition: ${DIST_PLUGIN} does not exist. Run \`yarn build\` first.`,
      );
    }
  });

  describe('manifest emission', () => {
    it('emits a manifest at `react-client-manifest.json` by default for client', () => {
      const result = run('basic-client', { isServer: false });
      expect(result.assets).toContain('react-client-manifest.json');
    });

    it('emits at `react-server-client-manifest.json` by default for server', () => {
      const result = run('basic-client', { isServer: true });
      expect(result.assets).toContain('react-server-client-manifest.json');
    });

    it('supports a custom manifest filename', () => {
      const result = run('basic-client', {
        isServer: false,
        clientManifestFilename: 'my-custom-manifest.json',
      });
      expect(result.assets).toContain('my-custom-manifest.json');
      expect(result.assets).not.toContain('react-client-manifest.json');
    });

    it('skips manifest emission when the client runtime is missing without entry-scope opt-in', () => {
      let error: Error | undefined;
      try {
        run('basic-client', { isServer: false, omitRuntimeEntry: true });
      } catch (e) {
        error = e as Error;
      }

      expect(error?.message).toContain('Manifest not emitted');
      expect(error?.message).toContain('react-client-manifest.json');
    });

    it('produces valid JSON', () => {
      const result = run('basic-client');
      expect(() => JSON.parse(result.manifestSource)).not.toThrow();
    });

    it('is deterministic across identical builds', () => {
      const a = run('basic-client');
      const b = run('basic-client');
      expect(a.manifestSource).toBe(b.manifestSource);
    });
  });

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
    });

    it('shows a tiny island avoiding unrelated app/vendor chunks', () => {
      const result = run('static-islands', {
        clientReferences: staticIslandClientReferences(/TinyIsland\.js$/),
        clientReferenceDiagnosticsFilename: diagnosticsFilename,
        configExtra: splitStaticIslandVendors,
      });

      expect(result.assets).toContain('vendors-app.js');
      const tinyKey = Object.keys(result.manifest.filePathToModuleMetadata).find((p) =>
        p.endsWith('/TinyIsland.js'),
      );
      expect(tinyKey).toBeTruthy();
      const tiny = result.manifest.filePathToModuleMetadata[tinyKey!]!;
      expect(manifestChunkFiles(tiny.chunks).join(',')).not.toContain('vendors');

      const diagnosticEntry = result.clientReferenceDiagnostics?.clientReferences[0]!;
      expect(diagnosticEntry.file).toContain('/TinyIsland.js');
      expect(diagnosticEntry.chunks.map((chunk) => chunk.file).join(',')).not.toContain('vendors');
      expect(diagnosticEntry.totalBytes).toBeGreaterThan(0);
    });

    it('reports a larger byte total for the heavy island chunk', () => {
      const tinyResult = run('static-islands', {
        clientReferences: staticIslandClientReferences(/TinyIsland\.js$/),
        clientReferenceDiagnosticsFilename: diagnosticsFilename,
        configExtra: splitStaticIslandVendors,
      });
      const heavyResult = run('static-islands', {
        clientReferences: staticIslandClientReferences(/HeavyIsland\.js$/),
        clientReferenceDiagnosticsFilename: diagnosticsFilename,
        configExtra: splitStaticIslandVendors,
      });

      const heavyEntry = heavyResult.clientReferenceDiagnostics?.clientReferences[0]!;
      expect(heavyEntry.file).toContain('/HeavyIsland.js');
      expect(heavyEntry.chunks).toHaveLength(1);
      expect(heavyEntry.chunks[0]!.bytes).toBeGreaterThan(0);
      expect(heavyEntry.totalBytes).toBeGreaterThan(
        tinyResult.clientReferenceDiagnostics!.clientReferences[0]!.totalBytes,
      );
      expect(heavyResult.clientReferenceDiagnostics?.totalChunkBytes).toBe(heavyEntry.totalBytes);
    });

    it('includes CSS asset bytes in static island diagnostics', () => {
      const result = run('static-islands', {
        clientReferences: staticIslandClientReferences(/^\.\/StyledIsland\.js$/),
        clientReferenceDiagnosticsFilename: diagnosticsFilename,
        publicPath: '/assets',
        withCss: true,
      });

      expect(result.assets).toContain('client0.chunk.css');

      const manifestEntry = Object.entries(result.manifest.filePathToModuleMetadata).find(([file]) =>
        file.endsWith('/StyledIsland.js'),
      )?.[1];
      expect(manifestEntry?.css).toEqual(['/assets/client0.chunk.css']);

      const diagnosticEntry = result.clientReferenceDiagnostics?.clientReferences[0]!;
      expect(diagnosticEntry.file).toContain('/StyledIsland.js');
      expect(diagnosticEntry.css).toEqual([
        {
          file: '/assets/client0.chunk.css',
          bytes: expect.any(Number),
        },
      ]);
      expect(diagnosticEntry.totalBytes).toBe(
        diagnosticEntry.chunks[0]!.bytes! + diagnosticEntry.css![0]!.bytes!,
      );
      expect(result.clientReferenceDiagnostics?.totalChunkBytes).toBe(diagnosticEntry.totalBytes);
    });

    it("does not attach an importing island's CSS to an imported client reference", () => {
      const result = run('static-islands', {
        clientReferences: staticIslandClientReferences(
          /^\.\/(?:ParentStyledIsland|StyledIsland)\.js$/,
        ),
        clientReferenceDiagnosticsFilename: diagnosticsFilename,
        publicPath: '/assets',
        withCss: true,
      });

      const childCss = readDiagnosticCss(result, '/StyledIsland.js');
      const parentCss = readDiagnosticCss(result, '/ParentStyledIsland.js');

      expect(childCss).toContain('.styled-island');
      expect(childCss).not.toContain('.parent-styled-island');
      expect(parentCss).toContain('.parent-styled-island');
    });

    it("scopes manifest CSS to the referenced island's chunk group when diagnostics are disabled", () => {
      const result = run('static-islands', {
        clientReferences: staticIslandClientReferences(
          /^\.\/(?:ParentStyledIsland|StyledIsland)\.js$/,
        ),
        publicPath: '/assets',
        withCss: true,
      });

      const childCss = readManifestCss(result, '/StyledIsland.js');
      const parentCss = readManifestCss(result, '/ParentStyledIsland.js');

      expect(childCss).toContain('.styled-island');
      expect(childCss).not.toContain('.parent-styled-island');
      expect(parentCss).toContain('.parent-styled-island');
    });

    it('keeps CSS-only split chunk styles in the server manifest', () => {
      const result = run('static-islands', {
        isServer: true,
        clientReferences: staticIslandClientReferences(/^\.\/StyledIsland\.js$/),
        publicPath: '/assets',
        withCss: true,
        configExtra: splitStaticIslandCssOnlyChunks,
      });

      expect(result.assets).toContain('styles.chunk.css');
      expect(manifestMetadataFor(result, '/StyledIsland.js').css).toEqual([
        '/assets/styles.chunk.css',
      ]);
      expect(readManifestCss(result, '/StyledIsland.js')).toContain('.styled-island');
    });

    it('keeps mixed chunk-local and CSS-only split styles in the server manifest', () => {
      const result = run('static-islands', {
        isServer: true,
        clientReferences: staticIslandClientReferences(/^\.\/MixedStyledIsland\.js$/),
        publicPath: '/assets',
        withCss: true,
        configExtra: splitStaticIslandMixedCssOnlyChunk,
      });

      const cssFiles = manifestMetadataFor(result, '/MixedStyledIsland.js').css ?? [];
      expect(result.assets).toEqual(
        expect.arrayContaining(['client0.chunk.css', 'styles.chunk.css']),
      );
      expect(cssFiles).toEqual(
        expect.arrayContaining(['/assets/client0.chunk.css', '/assets/styles.chunk.css']),
      );
      expect(cssFiles).toHaveLength(2);

      const css = readManifestCss(result, '/MixedStyledIsland.js');
      expect(css).toContain('.mixed-styled-island');
      expect(css).toContain('.mixed-split-island');
    });

    it("scopes server diagnostics CSS to the referenced island's chunk group", () => {
      const result = run('static-islands', {
        isServer: true,
        clientReferences: staticIslandClientReferences(
          /^\.\/(?:ParentStyledIsland|StyledIsland)\.js$/,
        ),
        clientReferenceDiagnosticsFilename: diagnosticsFilename,
        publicPath: '/assets',
        withCss: true,
      });

      const childCss = readDiagnosticCss(result, '/StyledIsland.js');
      const parentCss = readDiagnosticCss(result, '/ParentStyledIsland.js');

      expect(childCss).toContain('.styled-island');
      expect(childCss).not.toContain('.parent-styled-island');
      expect(parentCss).toContain('.parent-styled-island');
      expect(result.clientReferenceDiagnostics?.isServer).toBe(true);
    });

    it('keeps server diagnostics CSS when chunks merge into the initial bundle', () => {
      const result = run('static-islands', {
        isServer: true,
        clientReferences: staticIslandClientReferences(
          /^\.\/(?:ParentStyledIsland|StyledIsland)\.js$/,
        ),
        clientReferenceDiagnosticsFilename: diagnosticsFilename,
        publicPath: '/assets',
        withCss: true,
        maxChunks: 1,
      });

      expect(result.assets).toContain('main.css');

      const childCss = readDiagnosticCss(result, '/StyledIsland.js');
      const parentCss = readDiagnosticCss(result, '/ParentStyledIsland.js');

      expect(childCss).toContain('.styled-island');
      expect(parentCss).toContain('.parent-styled-island');
      expect(result.clientReferenceDiagnostics?.isServer).toBe(true);
    });
  });

  describe('top-level manifest shape', () => {
    it('has exactly `moduleLoading` and `filePathToModuleMetadata` keys', () => {
      const result = run('basic-client');
      expect(Object.keys(result.manifest).sort()).toEqual([
        'filePathToModuleMetadata',
        'moduleLoading',
      ]);
    });

    it('moduleLoading contains prefix and crossOrigin', () => {
      const result = run('basic-client');
      expect(result.manifest.moduleLoading).toHaveProperty('prefix');
      expect(result.manifest.moduleLoading).toHaveProperty('crossOrigin');
    });

    it('moduleLoading.prefix reflects output.publicPath', () => {
      const result = run('basic-client', { publicPath: '/packs/dev/' });
      expect(result.manifest.moduleLoading.prefix).toBe('/packs/dev/');
    });

    it('moduleLoading.crossOrigin is null when crossOriginLoading is false', () => {
      const result = run('basic-client', { crossOriginLoading: false });
      expect(result.manifest.moduleLoading.crossOrigin).toBeNull();
    });

    it('moduleLoading.crossOrigin is "anonymous" when crossOriginLoading is anonymous', () => {
      const result = run('basic-client', { crossOriginLoading: 'anonymous' });
      expect(result.manifest.moduleLoading.crossOrigin).toBe('anonymous');
    });

    it('moduleLoading.crossOrigin is "use-credentials" when configured as such', () => {
      const result = run('basic-client', { crossOriginLoading: 'use-credentials' });
      expect(result.manifest.moduleLoading.crossOrigin).toBe('use-credentials');
    });
  });

  describe('client-module detection', () => {
    it('includes files with "use client" directive', () => {
      const result = run('basic-client');
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('ClientButton.js'))).toBe(true);
    });

    it('excludes files without "use client"', () => {
      const result = run('basic-client');
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('ServerHeader.js'))).toBe(false);
      expect(paths.some((p) => p.endsWith('index.js'))).toBe(false);
    });

    it('detects multiple client files (including nested)', () => {
      const result = run('multiple-clients');
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.length).toBe(3);
      expect(paths.some((p) => p.endsWith('/A.js'))).toBe(true);
      expect(paths.some((p) => p.endsWith('/nested/B.js'))).toBe(true);
      expect(paths.some((p) => p.endsWith('/nested/C.js'))).toBe(true);
    });

    it('includes unreachable "use client" files via FS-walk discovery (matches webpack)', () => {
      // With the default clientReferences (FS walk of the context dir),
      // Dead.js IS discovered and injected — even though no entry imports
      // it. This matches the webpack plugin's behavior: in RSC, the
      // server-component tree may render a client file that the client
      // entry never directly imports. The plugin must include it so the
      // manifest is complete for the RSC runtime.
      const result = run('dead-code');
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('Used.js'))).toBe(true);
      expect(paths.some((p) => p.endsWith('Dead.js'))).toBe(true);
    });

    it('excludes dependency and generated directories from the default FS walk', () => {
      const result = run('default-excludes');
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);

      expect(paths.some((p) => p.endsWith('/app/javascript/AppClient.js'))).toBe(true);
      expect(paths.some((p) => p.includes('/vendor/bundle/'))).toBe(false);
      expect(paths.some((p) => p.includes('/vendor/cache/'))).toBe(false);
      expect(paths.some((p) => p.includes('/node_modules/'))).toBe(false);
      expect(paths.some((p) => p.includes('/public/assets/'))).toBe(false);
      expect(paths.some((p) => p.includes('/app/assets/vite/'))).toBe(false);
    });

    it('produces an empty manifest when no client files exist', () => {
      const result = run('no-client');
      expect(result.manifest.filePathToModuleMetadata).toEqual({});
    });

    it('honors explicit clientReferences instead of recording every imported "use client" file', () => {
      const result = run('multiple-clients', { clientReferences: ['./A.js'] });
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.length).toBe(1);
      expect(paths[0]).toContain('/A.js');
    });

    it('excludes default initial entry chunks for statically imported client references', () => {
      const result = run('basic-client');
      const key = Object.keys(result.manifest.filePathToModuleMetadata).find((p) =>
        p.endsWith('ClientButton.js'),
      );
      expect(key).toBeTruthy();

      const entry = result.manifest.filePathToModuleMetadata[key!]!;
      const chunkFiles = manifestChunkFiles(entry.chunks);

      expect(result.assets).toContain('main.js');
      expect(entry.id).toBe('./ClientButton.js');
      expect(entry.css).toEqual([]);
      expect(chunkFiles).not.toContain('main.js');
    });

    it('records split-runtime entry chunks for statically imported client references', () => {
      const result = run('basic-client', {
        configExtra: {
          optimization: {
            runtimeChunk: 'single',
            chunkIds: 'named',
            moduleIds: 'named',
            minimize: false,
          },
        },
      });
      const key = Object.keys(result.manifest.filePathToModuleMetadata).find((p) =>
        p.endsWith('ClientButton.js'),
      );
      expect(key).toBeTruthy();

      const entry = result.manifest.filePathToModuleMetadata[key!]!;
      const chunkFiles = manifestChunkFiles(entry.chunks);
      const initialAssets = new Set<string>(
        result.assets.filter((asset) => asset === 'main.js' || asset === 'runtime.js'),
      );

      expect(entry.id).toBe('./ClientButton.js');
      expect(initialAssets.size).toBeGreaterThan(0);
      expect(chunkFiles.filter((file) => initialAssets.has(file))).toEqual(['main.js']);
      expect(chunkFiles).not.toContain('runtime.js');
    });

    it('records non-runtime vendor chunks for statically imported client references', () => {
      const result = run('eager-vendor', {
        configExtra: {
          optimization: {
            chunkIds: 'named',
            moduleIds: 'named',
            minimize: false,
            splitChunks: {
              chunks: 'all',
              minSize: 0,
              cacheGroups: {
                default: false,
                defaultVendors: false,
                clientVendor: {
                  test: /react-dom/,
                  name: 'vendors-client',
                  enforce: true,
                },
              },
            },
          },
        },
      });
      const key = Object.keys(result.manifest.filePathToModuleMetadata).find((p) =>
        p.endsWith('ClientWidget.js'),
      );
      expect(key).toBeTruthy();

      const entry = result.manifest.filePathToModuleMetadata[key!]!;
      const chunkFiles = manifestChunkFiles(entry.chunks);

      expect(result.assets).toContain('main.js');
      expect(result.assets).toContain('vendors-client.js');
      expect(entry.id).toBe('./ClientWidget.js');
      expect(chunkFiles).toContain('vendors-client.js');
      expect(chunkFiles).not.toContain('main.js');
    });

    it('omits eager entry CSS when the entry chunk is also the runtime chunk', () => {
      const result = run('eager-css', {
        publicPath: '/assets/',
        withCss: true,
      });
      const entry = manifestMetadataFor(result, 'Button.js');

      expect(result.assets).toContain('main.css');
      expect(entry.id).toBe('./Button.js');
      expect(entry.css).toEqual([]);
    });

    it('records eager entry CSS when runtimeChunk is split out', () => {
      const result = run('eager-css', {
        publicPath: '/assets/',
        withCss: true,
        configExtra: {
          optimization: {
            runtimeChunk: 'single',
            chunkIds: 'named',
            moduleIds: 'named',
            minimize: false,
          },
        },
      });
      const entry = manifestMetadataFor(result, 'Button.js');
      const chunkFiles = manifestChunkFiles(entry.chunks);

      expect(result.assets).toContain('main.css');
      expect(entry.id).toBe('./Button.js');
      expect(entry.css).toEqual(['/assets/main.css']);
      expect(chunkFiles).toContain('main.js');
      expect(chunkFiles).not.toContain('runtime.js');
    });

    it('preserves client references discovered through symlinked directories', () => {
      const fixtureRoot = path.join(__dirname, 'fixtures/symlink-client');
      const targetPath = path.join(__dirname, 'fixtures/symlink-target');
      const linkPath = path.join(fixtureRoot, 'linked');
      fs.rmSync(linkPath, { force: true, recursive: true });
      fs.symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');

      try {
        const result = run('symlink-client', {
          clientReferences: [{ directory: './linked', recursive: true, include: /\.js$/ }],
        });
        const paths = Object.keys(result.manifest.filePathToModuleMetadata);
        expect(paths.some((p) => p.endsWith('/symlink-target/SymlinkButton.js'))).toBe(true);
      } finally {
        fs.rmSync(linkPath, { force: true, recursive: true });
      }
    });
  });

  describe('server manifest parity (isServer: true)', () => {
    // Regression tests for the server-manifest bug: the plugin previously
    // skipped the FS walk and addInclude injection for isServer:true. This
    // caused "use client" files NOT in the server entry's import tree to be
    // missing from the server manifest, making createSSRManifest() throw
    // "Server module metadata not found for <file>".
    //
    // Uses the dead-code fixture: index.js imports Used.js but NOT Dead.js.
    // Both have "use client". The FS walk discovers both; addInclude injects
    // Dead.js into the module graph even though no entry imports it.
    let clientResult: CompileResult;
    let serverResult: CompileResult;

    beforeAll(() => {
      clientResult = run('dead-code', { isServer: false });
      serverResult = run('dead-code', { isServer: true });
    });

    it('includes unreachable "use client" files in the server manifest', () => {
      const paths = Object.keys(serverResult.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('Used.js'))).toBe(true);
      expect(paths.some((p) => p.endsWith('Dead.js'))).toBe(true);
    });

    it('client and server manifests have the same entry keys', () => {
      // createSSRManifest() iterates every client manifest entry and looks
      // it up in the server manifest. If any key is missing, it throws.
      const clientKeys = Object.keys(clientResult.manifest.filePathToModuleMetadata).sort();
      const serverKeys = Object.keys(serverResult.manifest.filePathToModuleMetadata).sort();
      expect(clientKeys).toEqual(serverKeys);
    });
  });

  describe('production mode', () => {
    // The `production-client` fixture has `sideEffects: ["./*.js"]` in
    // its package.json and actually invokes `ClientButton()` — this is
    // required for client modules to survive production tree-shaking
    // and remain in the emitted chunk (as they would in a real RSC app
    // where client components are actually rendered).
    it('emits a valid manifest in production mode', () => {
      const result = run('production-client', {
        configExtra: { mode: 'production', optimization: { minimize: false } },
      });
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('ClientButton.js'))).toBe(true);
      for (const entry of Object.values(result.manifest.filePathToModuleMetadata)) {
        expect(entry.chunks.length % 2).toBe(0);
      }
    });

    it('emits valid manifest with concatenateModules enabled', () => {
      // If rspack chooses to scope-hoist any client module into a
      // ConcatenatedModule, the plugin's outer-id reuse path must
      // record it anyway. If rspack declines to hoist (side-effects
      // heuristic) the plugin's normal path records it. Either way,
      // the client module must appear in the manifest.
      const result = run('production-client', {
        configExtra: {
          mode: 'production',
          optimization: {
            concatenateModules: true,
            minimize: false,
            chunkIds: 'named',
            moduleIds: 'named',
          },
        },
      });
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('ClientButton.js'))).toBe(true);
    });
  });

  describe('splitChunks integration', () => {
    type CapturedTap = {
      name: string | { name: string; stage?: number };
      callback: () => void;
    };

    const createSplitChunksCompiler = (initialSplitChunks?: { chunks?: unknown }) => {
      const environmentTaps: CapturedTap[] = [];
      const afterEnvironmentTaps: CapturedTap[] = [];
      const optimization = {} as { splitChunks?: { chunks?: unknown } };
      if (initialSplitChunks) optimization.splitChunks = initialSplitChunks;

      return {
        compiler: {
          context: path.resolve(__dirname, 'fixtures/default-splitchunks'),
          options: { module: {}, optimization },
          hooks: {
            beforeCompile: { tapAsync: jest.fn() },
            environment: {
              tap: (name: CapturedTap['name'], callback: () => void) =>
                environmentTaps.push({ name, callback }),
            },
            afterEnvironment: {
              tap: (name: CapturedTap['name'], callback: () => void) =>
                afterEnvironmentTaps.push({ name, callback }),
            },
            thisCompilation: { tap: jest.fn() },
          },
        },
        environmentTaps,
        afterEnvironmentTaps,
      };
    };

    const runInjectionLoaderForCompiler = (
      injectionLoader: { default?: unknown },
      compiler: object | undefined,
      source = 'runtime();',
      context: { emitWarning?: (warning: Error) => void } = {},
    ): string => {
      const loader = (injectionLoader.default ?? injectionLoader) as (
        this: {
          cacheable: (flag: boolean) => void;
          _compiler?: object;
          emitWarning?: (warning: Error) => void;
        },
        source: string,
      ) => string;

      return loader.call({ cacheable: jest.fn(), _compiler: compiler, ...context }, source);
    };

    it('keeps client-reference injection scoped in a real rspack MultiCompiler build', () => {
      const outputRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ror-rsc-rspack-plugin-multicompiler-'),
      );

      try {
        const firstOutput = path.join(outputRoot, 'first');
        const secondOutput = path.join(outputRoot, 'second');
        const runtimeEntry = path.resolve(__dirname, '../../dist/client.browser.js');
        const staticIslandsFixture = path.resolve(__dirname, 'fixtures/static-islands');
        const script = `
          const fs = require('fs');
          const path = require('path');
          const { rspack } = require('@rspack/core');
          const { RSCRspackPlugin } = require(${JSON.stringify(DIST_PLUGIN)});

          const firstOutput = ${JSON.stringify(firstOutput)};
          const secondOutput = ${JSON.stringify(secondOutput)};
          for (const outputPath of [firstOutput, secondOutput]) {
            fs.mkdirSync(outputPath, { recursive: true });
          }

          const makeConfig = (name, context, outputPath, include, chunkName) => ({
            name,
            mode: 'development',
            target: 'web',
            context,
            entry: [${JSON.stringify(runtimeEntry)}, './index.js'],
            output: {
              path: outputPath,
              filename: '[name].js',
              chunkFilename: '[name].chunk.js',
              publicPath: '',
            },
            optimization: {
              chunkIds: 'named',
              moduleIds: 'named',
              minimize: false,
            },
            devtool: false,
            plugins: [
              new RSCRspackPlugin({
                isServer: false,
                clientReferences: [{ directory: '.', recursive: false, include }],
                chunkName,
              }),
            ],
          });

          const readOutput = (outputPath) => ({
            assets: fs.readdirSync(outputPath).sort(),
            manifest: JSON.parse(
              fs.readFileSync(path.join(outputPath, 'react-client-manifest.json'), 'utf8'),
            ),
          });

          rspack([
            makeConfig(
              'first',
              ${JSON.stringify(staticIslandsFixture)},
              firstOutput,
              /TinyIsland\\.js$/,
              'first-[index]',
            ),
            makeConfig(
              'second',
              ${JSON.stringify(staticIslandsFixture)},
              secondOutput,
              /HeavyIsland\\.js$/,
              'second-[index]',
            ),
          ], (err, stats) => {
            const finish = (result) => {
              process.stdout.write(JSON.stringify(result));
              process.exit(result.ok ? 0 : 1);
            };

            if (err) {
              finish({ ok: false, errors: [String(err)] });
              return;
            }
            if (!stats) {
              finish({ ok: false, errors: ['no stats returned'] });
              return;
            }

            const info = stats.toJson({
              errors: true,
              warnings: true,
              assets: true,
              children: true,
            });
            const warnings = (info.children || [])
              .flatMap((child) => child.warnings || [])
              .map((warning) => warning.message || String(warning));

            if (stats.hasErrors()) {
              finish({
                ok: false,
                errors: (info.children || [])
                  .flatMap((child) => child.errors || [])
                  .map((error) => error.message || String(error)),
                warnings,
              });
              return;
            }

            finish({
              ok: true,
              first: readOutput(firstOutput),
              second: readOutput(secondOutput),
              warnings,
            });
          });
        `;

        let raw: string;
        try {
          raw = execFileSync(process.execPath, ['-e', script], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: MULTICOMPILER_CHILD_TIMEOUT_MS,
          });
        } catch (error) {
          const childError = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
          const stdout = childError.stdout?.toString() ?? '';
          const stderr = childError.stderr?.toString() ?? '';
          throw new Error(
            [
              `rspack MultiCompiler child process failed: ${childError.message}`,
              stdout && `stdout:\n${stdout}`,
              stderr && `stderr:\n${stderr}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          );
        }
        const result = JSON.parse(raw) as {
          ok: true;
          first: { assets: string[]; manifest: CompileResult['manifest'] };
          second: { assets: string[]; manifest: CompileResult['manifest'] };
          warnings: string[];
        };
        const firstFiles = Object.keys(result.first.manifest.filePathToModuleMetadata);
        const secondFiles = Object.keys(result.second.manifest.filePathToModuleMetadata);

        expect(result.ok).toBe(true);
        expect(result.warnings.join('\n')).not.toContain('RSCRspackPlugin injection loader');
        expect(firstFiles.some((file) => file.endsWith('/TinyIsland.js'))).toBe(true);
        expect(firstFiles.join('\n')).not.toContain('/HeavyIsland.js');
        expect(secondFiles.some((file) => file.endsWith('/HeavyIsland.js'))).toBe(true);
        expect(secondFiles.join('\n')).not.toContain('/TinyIsland.js');
        expect(result.first.assets).toContain('first-0.chunk.js');
        expect(result.first.assets).not.toContain('second-0.chunk.js');
        expect(result.second.assets).toContain('second-0.chunk.js');
        expect(result.second.assets).not.toContain('first-0.chunk.js');
      } finally {
        fs.rmSync(outputRoot, { recursive: true, force: true });
      }
    }, MULTICOMPILER_JEST_TIMEOUT_MS);

    it('scopes injected files and chunk names to the loader compiler context', () => {
      const injectionLoader = require(DIST_INJECTION_LOADER);
      const firstCompiler = {};
      const secondCompiler = {};
      const firstFile = path.join(__dirname, 'fixtures/basic-client/ClientButton.js');
      const secondFile = path.join(__dirname, 'fixtures/basic-client/ServerHeader.js');

      injectionLoader.setInjectionStateForCompiler(firstCompiler, [firstFile], 'first-[index]');
      injectionLoader.setInjectionStateForCompiler(secondCompiler, [secondFile], 'second-[index]');

      const firstSource = runInjectionLoaderForCompiler(injectionLoader, firstCompiler);
      const secondSource = runInjectionLoaderForCompiler(injectionLoader, secondCompiler);

      expect(firstSource).toContain('webpackChunkName: "first-0"');
      expect(firstSource).toContain(JSON.stringify(firstFile));
      expect(firstSource).not.toContain(JSON.stringify(secondFile));
      expect(secondSource).toContain('webpackChunkName: "second-0"');
      expect(secondSource).toContain(JSON.stringify(secondFile));
      expect(secondSource).not.toContain(JSON.stringify(firstFile));
      expect(
        Array.from(injectionLoader.getGeneratedChunkNamesForCompiler(firstCompiler)),
      ).toEqual(['first-0']);
      expect(
        Array.from(injectionLoader.getGeneratedChunkNamesForCompiler(secondCompiler)),
      ).toEqual(['second-0']);
    });

    it('keeps legacy fallback state populated when the loader has no compiler context', () => {
      const injectionLoader = require(DIST_INJECTION_LOADER);
      const compiler = {};
      const clientFile = path.join(__dirname, 'fixtures/basic-client/ClientButton.js');

      injectionLoader.setInjectionStateForCompiler(compiler, [clientFile], 'fallback-[index]');

      const source = runInjectionLoaderForCompiler(injectionLoader, undefined);

      expect(source).toContain('webpackChunkName: "fallback-0"');
      expect(source).toContain(JSON.stringify(clientFile));
      expect(Array.from(injectionLoader.getGeneratedChunkNamesForCompiler(undefined))).toEqual([
        'fallback-0',
      ]);
    });

    it('warns once for compiler-less fallback invocations', () => {
      jest.isolateModules(() => {
        const injectionLoader = require(DIST_INJECTION_LOADER);
        const emitWarning = jest.fn();

        runInjectionLoaderForCompiler(injectionLoader, undefined, 'runtime();', { emitWarning });
        runInjectionLoaderForCompiler(injectionLoader, undefined, 'runtime();', { emitWarning });

        expect(emitWarning).toHaveBeenCalledTimes(1);
        expect((emitWarning.mock.calls[0]![0] as Error).message).toContain(
          'without a compiler context',
        );
      });
    });

    it('warns once per unknown compiler context', () => {
      const injectionLoader = require(DIST_INJECTION_LOADER);
      const firstCompiler = {};
      const secondCompiler = {};
      const firstEmitWarning = jest.fn();
      const secondEmitWarning = jest.fn();

      runInjectionLoaderForCompiler(injectionLoader, firstCompiler, 'runtime();', {
        emitWarning: firstEmitWarning,
      });
      runInjectionLoaderForCompiler(injectionLoader, firstCompiler, 'runtime();', {
        emitWarning: firstEmitWarning,
      });
      runInjectionLoaderForCompiler(injectionLoader, secondCompiler, 'runtime();', {
        emitWarning: secondEmitWarning,
      });

      expect(firstEmitWarning).toHaveBeenCalledTimes(1);
      expect((firstEmitWarning.mock.calls[0]![0] as Error).message).toContain(
        'unknown compiler context',
      );
      expect(secondEmitWarning).toHaveBeenCalledTimes(1);
      expect((secondEmitWarning.mock.calls[0]![0] as Error).message).toContain(
        'unknown compiler context',
      );
    });

    it('keeps splitChunks generated chunk filters scoped by compiler', () => {
      const { RSCRspackPlugin } = require(DIST_PLUGIN);
      const injectionLoader = require(DIST_INJECTION_LOADER);
      const firstSplitChunks: { chunks?: unknown } = { chunks: 'async' };
      const secondSplitChunks: { chunks?: unknown } = { chunks: 'async' };
      const first = createSplitChunksCompiler(firstSplitChunks);
      const second = createSplitChunksCompiler(secondSplitChunks);

      new RSCRspackPlugin({ isServer: false }).apply(first.compiler);
      new RSCRspackPlugin({ isServer: false }).apply(second.compiler);

      for (const { callback } of first.environmentTaps) callback();
      for (const { callback } of second.environmentTaps) callback();

      injectionLoader.setGeneratedChunkNamesForCompiler(first.compiler, ['first-client']);
      injectionLoader.setGeneratedChunkNamesForCompiler(second.compiler, ['second-client']);

      const firstGuard = firstSplitChunks.chunks as (chunk: {
        name?: string;
        canBeInitial?: () => boolean;
      }) => boolean;
      const secondGuard = secondSplitChunks.chunks as (chunk: {
        name?: string;
        canBeInitial?: () => boolean;
      }) => boolean;

      expect(firstGuard({ name: 'first-client', canBeInitial: () => false })).toBe(false);
      expect(firstGuard({ name: 'second-client', canBeInitial: () => false })).toBe(true);
      expect(secondGuard({ name: 'second-client', canBeInitial: () => false })).toBe(false);
      expect(secondGuard({ name: 'first-client', canBeInitial: () => false })).toBe(true);
    });

    it('installs the default splitChunks guard before RspackOptionsApply snapshots options', () => {
      const { RSCRspackPlugin } = require(DIST_PLUGIN);
      const injectionLoader = require(DIST_INJECTION_LOADER);
      const splitChunks: { chunks?: unknown } = {};
      const { compiler, environmentTaps, afterEnvironmentTaps } = createSplitChunksCompiler();

      injectionLoader.setGeneratedChunkNamesForCompiler(compiler, ['client0']);

      new RSCRspackPlugin({ isServer: false }).apply(compiler);
      compiler.options.optimization.splitChunks = splitChunks;
      splitChunks.chunks = 'async';

      for (const { callback } of environmentTaps) callback();
      expect(typeof splitChunks.chunks).toBe('function');

      // A later environment-stage tap can still replace the selector; the
      // afterEnvironment tap runs late enough to reinstall before
      // RspackOptionsApply snapshots splitChunks for the native plugin.
      splitChunks.chunks = 'all';
      for (const { callback } of afterEnvironmentTaps) callback();

      expect(environmentTaps).toHaveLength(1);
      expect(afterEnvironmentTaps).toHaveLength(1);
      expect(environmentTaps[0]!.name).toEqual({
        name: 'RSCRspackPlugin.splitChunksGuard',
        stage: Number.MAX_SAFE_INTEGER,
      });
      expect(afterEnvironmentTaps[0]!.name).toEqual({
        name: 'RSCRspackPlugin.splitChunksGuard',
        stage: Number.MAX_SAFE_INTEGER,
      });

      const chunksCapturedByRspackOptionsApply = splitChunks.chunks as (chunk: {
        name?: string;
        canBeInitial?: () => boolean;
      }) => boolean;
      expect(chunksCapturedByRspackOptionsApply({ name: 'client0', canBeInitial: () => false })).toBe(
        false,
      );
      expect(
        chunksCapturedByRspackOptionsApply({ name: 'client99', canBeInitial: () => false }),
      ).toBe(true);
      expect(chunksCapturedByRspackOptionsApply({ name: 'main', canBeInitial: () => true })).toBe(
        true,
      );
    });

    it('keeps generated client chunks isolated with rspack default optimization config', () => {
      const result = run('default-splitchunks');
      const jsAssets = result.assets.filter((asset) => asset.endsWith('.js')).sort();

      expect(jsAssets).toContain('main.js');
      expect(jsAssets.some((asset) => /^client\d+\.chunk\.js$/.test(asset))).toBe(true);
      expect(jsAssets.filter((asset) => /vendors|biglib|clientlib/.test(asset))).toEqual([]);

      const clientEntryKey = Object.keys(result.manifest.filePathToModuleMetadata).find((p) =>
        p.endsWith('ClientWidget.js'),
      );
      expect(clientEntryKey).toBeTruthy();

      const clientChunkFiles = manifestChunkFiles(
        result.manifest.filePathToModuleMetadata[clientEntryKey!]!.chunks,
      );
      expect(clientChunkFiles).toEqual(
        expect.arrayContaining([expect.stringMatching(/^client\d+\.chunk\.js$/)]),
      );
      expect(clientChunkFiles.filter((file) => /vendors|clientlib/.test(file))).toEqual([]);
    });

    it('preserves default async chunk selection while excluding generated client-reference chunks', () => {
      const result = run('default-splitchunks', {
        configExtra: {
          optimization: {
            chunkIds: 'named',
            moduleIds: 'named',
            minimize: false,
            splitChunks: {
              minSize: 0,
              cacheGroups: {
                forcedVendor: {
                  // No `test` filter: match all eligible modules so the old
                  // undefined-as-all bug extracts biglib from the initial chunk.
                  name: 'vendors-biglib',
                  minChunks: 1,
                  enforce: true,
                },
              },
            },
          },
        },
      });
      const jsAssets = result.assets.filter((asset) => asset.endsWith('.js')).sort();

      expect(jsAssets).toContain('main.js');
      // Generated client-reference chunks use the default `client[index]` chunkName.
      expect(jsAssets.some((asset) => /^client\d+\.chunk\.js$/.test(asset))).toBe(true);
      expect(jsAssets.filter((asset) => /vendors|biglib|clientlib/.test(asset))).toEqual([]);

      const clientEntryKey = Object.keys(result.manifest.filePathToModuleMetadata).find((p) =>
        p.endsWith('ClientWidget.js'),
      );
      expect(clientEntryKey).toBeTruthy();

      const clientChunkFiles = manifestChunkFiles(
        result.manifest.filePathToModuleMetadata[clientEntryKey!]!.chunks,
      );
      expect(clientChunkFiles).toEqual(
        expect.arrayContaining([expect.stringMatching(/^client\d+\.chunk\.js$/)]),
      );
      expect(clientChunkFiles.filter((file) => /vendors|clientlib/.test(file))).toEqual([]);
    });

    it('preserves explicit all chunk selection for non-generated chunks', () => {
      const result = run('default-splitchunks', {
        configExtra: {
          optimization: {
            chunkIds: 'named',
            moduleIds: 'named',
            minimize: false,
            splitChunks: {
              chunks: 'all',
              minSize: 0,
              cacheGroups: {
                forcedVendor: {
                  name: 'vendors-biglib',
                  minChunks: 1,
                  enforce: true,
                },
              },
            },
          },
        },
      });
      const jsAssets = result.assets.filter((asset) => asset.endsWith('.js')).sort();

      expect(jsAssets).toContain('vendors-biglib.js');

      const clientEntryKey = Object.keys(result.manifest.filePathToModuleMetadata).find((p) =>
        p.endsWith('ClientWidget.js'),
      );
      expect(clientEntryKey).toBeTruthy();

      const clientChunkFiles = manifestChunkFiles(
        result.manifest.filePathToModuleMetadata[clientEntryKey!]!.chunks,
      );
      expect(clientChunkFiles.filter((file) => /vendors|clientlib/.test(file))).toEqual([]);
    });
  });

  describe('publicPath handling', () => {
    it('warns and avoids emitting literal publicPath "auto"', () => {
      const result = run('basic-client', { publicPath: 'auto' });
      expect(result.manifest.moduleLoading.prefix).toBe('');
      expect(result.warnings.join('\n')).toContain("output.publicPath is 'auto'");
    });

    it('warns and avoids serializing function-valued publicPath', () => {
      const { RSCRspackPlugin } = require(DIST_PLUGIN);
      const plugin = new RSCRspackPlugin({ isServer: false });
      const warnings: Error[] = [];
      const internals = plugin as {
        buildManifest: (
          compilation: unknown,
          bundler: unknown,
          diagnosticsCssFiles: Map<string, string[]>,
        ) => { moduleLoading: { prefix: string } };
      };

      const manifest = internals.buildManifest(
        {
          outputOptions: { publicPath: () => '/assets/' },
          entrypoints: new Map(),
          chunkGroups: [],
          chunkGraph: { getChunkModulesIterable: () => [] },
          warnings,
        },
        { WebpackError: Error },
        new Map(),
      );

      expect(manifest.moduleLoading.prefix).toBe('');
      expect(warnings.map((warning) => warning.message).join('\n')).toContain(
        'output.publicPath is a function',
      );
    });

    it('preserves an absolute URL publicPath', () => {
      const result = run('basic-client', {
        publicPath: 'https://cdn.example.com/packs/',
      });
      expect(result.manifest.moduleLoading.prefix).toBe(
        'https://cdn.example.com/packs/',
      );
    });

    it('uses empty string when publicPath is unset (default)', () => {
      // publicPath defaults to '' in the runner; verify the default is not
      // some rspack-internal sentinel leaking through.
      const result = run('basic-client');
      expect(result.manifest.moduleLoading.prefix).toBe('');
    });
  });

  describe('directive edge cases', () => {
    let result: CompileResult;

    beforeAll(() => {
      result = run('directive-edge-cases');
    });

    it('accepts single-quoted directive', () => {
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('SingleQuote.js'))).toBe(true);
    });

    it('accepts double-quoted directive', () => {
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('DoubleQuote.js'))).toBe(true);
    });

    it('accepts directive with trailing semicolon', () => {
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('WithSemicolon.js'))).toBe(true);
    });

    it('accepts directive without trailing semicolon', () => {
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('NoSemicolon.js'))).toBe(true);
    });

    it('accepts directive with leading whitespace', () => {
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('LeadingWhitespace.js'))).toBe(true);
    });

    it('rejects directive that is only inside a comment', () => {
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('DirectiveInComment.js'))).toBe(false);
    });

    it('rejects directive that appears AFTER an import statement', () => {
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      expect(paths.some((p) => p.endsWith('DirectiveAfterImport.js'))).toBe(false);
    });
  });

  describe('per-entry manifest entries', () => {
    it('keys are file:// URLs', () => {
      const result = run('basic-client');
      for (const key of Object.keys(result.manifest.filePathToModuleMetadata)) {
        expect(key.startsWith('file://')).toBe(true);
      }
    });

    it('each entry has `id`, `chunks`, `name`', () => {
      const result = run('basic-client');
      const entries = Object.values(result.manifest.filePathToModuleMetadata);
      expect(entries.length).toBeGreaterThan(0);
      const entry = entries[0]!;
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('chunks');
      expect(entry).toHaveProperty('name');
    });

    it('each entry name is "*"', () => {
      const result = run('multiple-clients');
      for (const entry of Object.values(result.manifest.filePathToModuleMetadata)) {
        expect(entry.name).toBe('*');
      }
    });

    it('each entry `id` is a string and non-empty', () => {
      const result = run('basic-client');
      for (const entry of Object.values(result.manifest.filePathToModuleMetadata)) {
        expect(typeof entry.id).toBe('string');
        expect(entry.id.length).toBeGreaterThan(0);
      }
    });

    it('each entry `chunks` is a flat array of [chunkId, chunkFile, ...]', () => {
      const result = run('basic-client');
      const entries = Object.values(result.manifest.filePathToModuleMetadata);
      expect(entries.length).toBeGreaterThan(0);
      const entry = entries[0]!;
      expect(Array.isArray(entry.chunks)).toBe(true);
      // Even length: pairs of (id, file)
      expect(entry.chunks.length % 2).toBe(0);
      // Every second entry should look like a filename
      for (let i = 1; i < entry.chunks.length; i += 2) {
        expect(typeof entry.chunks[i]).toBe('string');
        expect(String(entry.chunks[i])).toMatch(/\.m?js$/);
      }
    });

    it('records .mjs chunk files', () => {
      const result = run('basic-client', {
        outputFilename: '[name].mjs',
        outputChunkFilename: '[name].chunk.mjs',
        configExtra: {
          optimization: {
            runtimeChunk: 'single',
            chunkIds: 'named',
            moduleIds: 'named',
            minimize: false,
          },
        },
      });
      const key = Object.keys(result.manifest.filePathToModuleMetadata).find((p) =>
        p.endsWith('ClientButton.js'),
      );
      expect(key).toBeTruthy();

      const chunkFiles = manifestChunkFiles(
        result.manifest.filePathToModuleMetadata[key!]!.chunks,
      );
      expect(chunkFiles).toEqual(['main.mjs']);
      expect(chunkFiles).not.toContain('runtime.mjs');
    });
  });

  describe('plugin option validation', () => {
    // Importing from dist so we don't need TS types here.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { RSC_LOADER_RULE, RSCRspackPlugin } = require(DIST_PLUGIN);

    it('throws when options is null', () => {
      expect(() => new RSCRspackPlugin(null)).toThrow(/isServer/);
    });

    it('throws when options is undefined', () => {
      expect(() => new RSCRspackPlugin(undefined)).toThrow(/isServer/);
    });

    it('throws when isServer is undefined', () => {
      expect(() => new RSCRspackPlugin({})).toThrow(/isServer/);
    });

    it('throws when isServer is a string', () => {
      expect(() => new RSCRspackPlugin({ isServer: 'yes' })).toThrow(/isServer/);
    });

    it('throws when isServer is null', () => {
      expect(() => new RSCRspackPlugin({ isServer: null })).toThrow(/isServer/);
    });

    it('accepts isServer: true', () => {
      expect(() => new RSCRspackPlugin({ isServer: true })).not.toThrow();
    });

    it('accepts isServer: false', () => {
      expect(() => new RSCRspackPlugin({ isServer: false })).not.toThrow();
    });

    it('accepts a custom clientManifestFilename alongside isServer', () => {
      expect(
        () =>
          new RSCRspackPlugin({
            isServer: false,
            clientManifestFilename: 'custom.json',
          }),
      ).not.toThrow();
    });

    it('keeps the historical loader rule export as a no-op compatibility rule', () => {
      expect(RSC_LOADER_RULE.exclude.test('/app/node_modules/pkg/index.ts')).toBe(true);
      expect(RSC_LOADER_RULE.use).toEqual([{ loader: DIST_RSPACK_LOADER }]);
    });

    it('injects only the runtime loader needed for filesystem-discovered client references', () => {
      const compiler = {
        context: path.resolve(__dirname, 'fixtures/basic-client'),
        options: { module: {} as { rules?: unknown[] } },
        hooks: {
          beforeCompile: { tapAsync: jest.fn() },
          environment: { tap: jest.fn() },
          afterEnvironment: { tap: jest.fn() },
          thisCompilation: { tap: jest.fn() },
        },
      };

      new RSCRspackPlugin({ isServer: false }).apply(compiler);

      const rules = (compiler.options.module.rules ?? []) as Array<{ use?: unknown }>;
      const ruleLoaders = rules.flatMap((rule: { use?: unknown }) =>
        Array.isArray(rule.use)
          ? rule.use.map((entry) =>
              typeof entry === 'string'
                ? entry
                : (entry as { loader?: string } | undefined)?.loader,
            )
          : [],
      );

      expect(ruleLoaders).not.toContain(DIST_RSPACK_LOADER);
      expect(ruleLoaders).toContain(DIST_INJECTION_LOADER);
    });
  });

  describe('manifest-entry path encoding', () => {
    // The plugin's per-entry key is `url.pathToFileURL(resource).href`.
    // The runtime consumer looks entries up by exact match, so the format
    // is load-bearing: percent-encoded for non-ASCII, `file:///` prefix,
    // no trailing slash for files. Pin it explicitly rather than relying
    // on substring checks so future key-format drift is loud.
    it('emits an exact file:// URL for the client entry key', () => {
      const result = run('basic-client');
      const url = require('url');
      const path = require('path');
      const expected = url.pathToFileURL(
        path.join(__dirname, 'fixtures/basic-client/ClientButton.js'),
      ).href;
      expect(
        Object.keys(result.manifest.filePathToModuleMetadata),
      ).toContain(expected);
    });
  });
});
