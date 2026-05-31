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
import * as path from 'path';
import { compile, cleanupOutputDirs, type CompileResult } from './helpers/compile';

const created: CompileResult[] = [];
const run = (fixture: string, options?: Parameters<typeof compile>[1]): CompileResult => {
  const r = compile(fixture, options);
  created.push(r);
  return r;
};

afterAll(() => cleanupOutputDirs(created));

const DIST_PLUGIN = path.resolve(__dirname, '../../dist/react-server-dom-rspack/plugin.js');

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

    it('does not preload initial entry chunks for statically imported client references', () => {
      const result = run('basic-client');
      const key = Object.keys(result.manifest.filePathToModuleMetadata).find((p) =>
        p.endsWith('ClientButton.js'),
      );
      expect(key).toBeTruthy();

      const entry = result.manifest.filePathToModuleMetadata[key!]!;
      const chunkFiles = entry.chunks
        .filter((_chunk, index) => index % 2 === 1)
        .map(String);
      const initialAssets = new Set(
        result.assets.filter((asset) => asset === 'main.js' || asset.startsWith('vendors-')),
      );

      expect(entry.id).toBe('./ClientButton.js');
      expect(initialAssets.size).toBeGreaterThan(0);
      expect(chunkFiles.filter((file) => initialAssets.has(file))).toEqual([]);
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
      expect(jsAssets.some((asset) => /^client\d+\.chunk\.js$/.test(asset))).toBe(true);
      expect(jsAssets.filter((asset) => /vendors|biglib|clientlib/.test(asset))).toEqual([]);

      const clientEntryKey = Object.keys(result.manifest.filePathToModuleMetadata).find((p) =>
        p.endsWith('ClientWidget.js'),
      );
      expect(clientEntryKey).toBeTruthy();

      // Manifest chunks are [id, file, id, file, ...]; odd indices are files.
      const clientChunkFiles = result.manifest.filePathToModuleMetadata[clientEntryKey!]!.chunks
        .filter((_chunk, index) => index % 2 === 1)
        .map(String);
      expect(clientChunkFiles).toEqual(
        expect.arrayContaining([expect.stringMatching(/^client\d+\.chunk\.js$/)]),
      );
      expect(clientChunkFiles.filter((file) => /vendors|clientlib/.test(file))).toEqual([]);
    });
  });

  describe('publicPath handling', () => {
    it('passes publicPath "auto" through verbatim (matches webpack)', () => {
      const result = run('basic-client', { publicPath: 'auto' });
      // Matches webpack plugin behavior: publicPath || "" — since "auto"
      // is truthy, it passes through. The runtime may produce broken URLs
      // like "auto/main.js" but this matches the webpack contract.
      expect(result.manifest.moduleLoading.prefix).toBe('auto');
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
        expect(String(entry.chunks[i]).endsWith('.js')).toBe(true);
      }
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

    it('does not attach the directive detector to node_modules', () => {
      expect(RSC_LOADER_RULE.exclude.test('/app/node_modules/pkg/index.ts')).toBe(true);
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
