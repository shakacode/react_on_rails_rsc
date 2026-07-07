/**
 * Integration tests for the entry-scoped client-reference asset (issue #134)
 * against REAL webpack 5 compilations.
 *
 * The `entry-scoped` fixture has three entrypoints with distinct reachability
 * shapes plus one unimported client reference:
 *   - `main` reaches TinyIsland transitively through a plain server module,
 *   - `static` reaches no client reference at all,
 *   - `dynamic` reaches LazyIsland only through a dynamic `import()`,
 *   - OtherIsland is discovered by the filesystem walk and injected through
 *     the Flight runtime, but imported by no entry — it must stay in the
 *     manifest (parity) while appearing in no entry's reference list
 *     (the traversal must not walk the runtime module's injected imports).
 */

import { pathToFileURL } from 'node:url';
import * as path from 'path';
import { compile, cleanupOutputDirs, type CompileResult } from './helpers/compile';

jest.setTimeout(180_000);

const FIXTURE = 'entry-scoped';
const ASSET = 'react-entry-client-references.json';
const fixtureHref = (file: string): string =>
  pathToFileURL(path.join(__dirname, 'fixtures', FIXTURE, file)).href;

const created: CompileResult[] = [];
const run = (options?: Parameters<typeof compile>[1]): CompileResult => {
  const r = compile(FIXTURE, options);
  created.push(r);
  return r;
};

afterAll(() => cleanupOutputDirs(created));

const EXTRA_ENTRIES = { static: './static.js', dynamic: './dynamic.js' };
const flattenModuleStats = (modules: CompileResult['modules']): CompileResult['modules'] =>
  modules.flatMap((module) => [module, ...flattenModuleStats(module.modules ?? [])]);
const expectConcatenatedModule = (result: CompileResult): void => {
  const modules = flattenModuleStats(result.modules);
  expect(
    modules.some(
      (module) =>
        module.name?.includes(' + ') ||
        module.identifier?.includes('|') ||
        module.modules?.length,
    ),
  ).toBe(true);
};
const expectScopedEntries = (payload: CompileResult['entryClientReferences']): void => {
  expect(payload!.version).toBe(1);
  expect(payload!.isServer).toBe(true);
  expect(Object.keys(payload!.entries).sort()).toEqual(['dynamic', 'main', 'static']);

  // Transitive sync import through a server module.
  expect(payload!.entries.main!.clientReferences).toEqual([fixtureHref('TinyIsland.js')]);
  expect(payload!.entries.main!.relativeClientReferences).toEqual(['TinyIsland.js']);

  // Server-only entry: empty set, even though the runtime injection makes
  // every discovered reference loadable from every entry.
  expect(payload!.entries.static!.clientReferences).toEqual([]);

  // Dynamic import() edges count as reachable.
  expect(payload!.entries.dynamic!.clientReferences).toEqual([fixtureHref('LazyIsland.js')]);

  // The unimported reference appears in no entry list.
  for (const entry of Object.values(payload!.entries)) {
    expect(entry.clientReferences).not.toContain(fixtureHref('OtherIsland.js'));
  }
};

describe('entryClientReferencesFilename (webpack)', () => {
  test('scopes client references to each entry graph on the server build', () => {
    const result = run({
      isServer: true,
      extraEntries: EXTRA_ENTRIES,
      entryClientReferencesFilename: ASSET,
    });

    expect(result.warnings).toEqual([]);
    expect(result.assets).toContain(ASSET);

    const payload = result.entryClientReferences!;
    expectScopedEntries(payload);
    // ...but manifest parity is untouched: it is still a manifest entry, and
    // the per-entry hrefs are exact manifest join keys.
    const manifestKeys = Object.keys(result.manifest.filePathToModuleMetadata);
    expect(manifestKeys).toContain(fixtureHref('OtherIsland.js'));
    expect(manifestKeys).toContain(fixtureHref('TinyIsland.js'));
    expect(manifestKeys).toContain(fixtureHref('LazyIsland.js'));
  });

  test('keeps scopes when webpack concatenates modules', () => {
    const result = run({
      isServer: true,
      extraEntries: EXTRA_ENTRIES,
      entryClientReferencesFilename: ASSET,
      optimizationExtra: { concatenateModules: true },
    });

    expectScopedEntries(result.entryClientReferences);
    expectConcatenatedModule(result);
  });

  test('also works on the client build (docs prescribe the server build)', () => {
    const result = run({
      isServer: false,
      extraEntries: EXTRA_ENTRIES,
      entryClientReferencesFilename: ASSET,
    });

    const payload = result.entryClientReferences!;
    expect(payload.isServer).toBe(false);
    expect(payload.entries.main!.clientReferences).toEqual([fixtureHref('TinyIsland.js')]);
    expect(payload.entries.static!.clientReferences).toEqual([]);
  });

  test('is opt-in and does not change the manifest', () => {
    const withOption = run({
      isServer: true,
      extraEntries: EXTRA_ENTRIES,
      entryClientReferencesFilename: ASSET,
    });
    const withoutOption = run({ isServer: true, extraEntries: EXTRA_ENTRIES });

    expect(withoutOption.assets).not.toContain(ASSET);
    expect(withoutOption.manifestSource).toBe(withOption.manifestSource);
  });
});
