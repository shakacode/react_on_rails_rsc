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

    it('excludes unreachable "use client" files (dead code)', () => {
      const result = run('dead-code');
      const paths = Object.keys(result.manifest.filePathToModuleMetadata);
      // Used.js is imported -> must be in manifest
      expect(paths.some((p) => p.endsWith('Used.js'))).toBe(true);
      // Dead.js is NOT imported anywhere -> must NOT be in manifest
      // This is the key advantage of module-graph walking over FS walking.
      expect(paths.some((p) => p.endsWith('Dead.js'))).toBe(false);
    });

    it('produces an empty manifest when no client files exist', () => {
      const result = run('no-client');
      expect(result.manifest.filePathToModuleMetadata).toEqual({});
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
    it('throws if `isServer` is not a boolean', () => {
      // Importing from dist so we don't need TS types here.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const { RSCRspackPlugin } = require(DIST_PLUGIN);
      expect(() => new RSCRspackPlugin({} as unknown as { isServer: boolean })).toThrow(
        /isServer/,
      );
      expect(
        () => new RSCRspackPlugin({ isServer: 'yes' } as unknown as { isServer: boolean }),
      ).toThrow(/isServer/);
    });
  });
});
