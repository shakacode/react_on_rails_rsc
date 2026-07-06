/**
 * Unit tests for the shared entry-scoped client-reference traversal
 * (src/entryClientReferences.ts) with hand-built graph mocks — the
 * bundler-independent behavior: boundary rules, cycle termination,
 * concatenated modules, missing-API handling, and payload serialization.
 * Real-bundler coverage lives in tests/webpack-plugin/ and
 * tests/rspack-plugin/entry-client-references.test.ts.
 */

import * as path from 'path';
import { pathToFileURL } from 'node:url';
import {
  buildEntryClientReferencesPayload,
  collectEntryClientReferences,
  type EntryClientReferencesCompilation,
  type EntryClientReferencesModule,
} from '../src/entryClientReferences';

type MockModule = EntryClientReferencesModule & { deps?: MockModule[] };

const RUNTIME = '/app/node_modules/react-server-dom-webpack/client.node.js';
const isClientReference = (resource: string): boolean => resource.includes('Island');
const isTraversalBoundary = (resource: string): boolean => resource === RUNTIME;

const mockCompilation = (
  entries: Record<string, MockModule[]>,
): EntryClientReferencesCompilation => ({
  entrypoints: {
    forEach(fn) {
      for (const [name, entryModules] of Object.entries(entries)) {
        fn({ getEntrypointChunk: () => entryModules }, name);
      }
    },
  },
  chunkGraph: {
    getChunkEntryModulesIterable: (chunk) => chunk as MockModule[],
  },
  moduleGraph: {
    getOutgoingConnections: (module) => ((module as MockModule).deps ?? []).map((dep) => ({ module: dep })),
  },
});

const collect = (entries: Record<string, MockModule[]>) =>
  collectEntryClientReferences({
    compilation: mockCompilation(entries),
    isClientReference,
    isTraversalBoundary,
  });

describe('collectEntryClientReferences', () => {
  test('records transitive references and stops at the client boundary', () => {
    const behindIsland: MockModule = { resource: '/app/behind-the-boundary.js' };
    const island: MockModule = { resource: '/app/Island.js', deps: [behindIsland] };
    const section: MockModule = { resource: '/app/Section.js', deps: [island] };
    const entry: MockModule = { resource: '/app/page.js', deps: [section] };

    const result = collect({ main: [entry] })!;
    expect(result.get('main')).toEqual(['/app/Island.js']);
  });

  test('does not walk through the runtime module (injected references)', () => {
    const injectedIsland: MockModule = { resource: '/app/InjectedIsland.js' };
    const runtime: MockModule = { resource: RUNTIME, deps: [injectedIsland] };
    const entry: MockModule = { resource: '/app/page.js', deps: [runtime] };

    const result = collect({ main: [entry], runtimeOnly: [runtime] })!;
    expect(result.get('main')).toEqual([]);
    expect(result.get('runtimeOnly')).toEqual([]);
  });

  test('terminates on cycles, with and without identifier()', () => {
    const a: MockModule = { resource: '/app/a.js', identifier: () => 'a' };
    const b: MockModule = { resource: '/app/b.js', identifier: () => 'b' };
    a.deps = [b];
    b.deps = [a, { resource: '/app/CycleIsland.js' }];

    const c: MockModule = { resource: '/app/c.js' };
    c.deps = [c];

    const result = collect({ withIds: [a], selfLoop: [c] })!;
    expect(result.get('withIds')).toEqual(['/app/CycleIsland.js']);
    expect(result.get('selfLoop')).toEqual([]);
  });

  test('records inner client references of concatenated modules', () => {
    const concatenated: MockModule = {
      resource: '/app/wrapper.js',
      modules: [{ resource: '/app/InnerIsland.js' }, { resource: '/app/plain.js' }],
      deps: [{ resource: '/app/SiblingIsland.js' }],
    };
    const result = collect({ main: [concatenated] })!;
    expect(result.get('main')).toEqual(['/app/InnerIsland.js', '/app/SiblingIsland.js']);
  });

  test('does not walk a concatenated module that swallowed the runtime', () => {
    const injectedIsland: MockModule = { resource: '/app/InjectedIsland.js' };
    const concatenated: MockModule = {
      resource: '/app/wrapper.js',
      modules: [{ resource: RUNTIME }, { resource: '/app/InnerIsland.js' }],
      deps: [injectedIsland],
    };
    const result = collect({ main: [concatenated] })!;
    // Inner references are still recorded (over-inclusion is the safe
    // direction) but the wrapper's connections are not walked.
    expect(result.get('main')).toEqual(['/app/InnerIsland.js']);
  });

  test('returns null when graph APIs are missing', () => {
    const base = mockCompilation({ main: [] });
    expect(
      collectEntryClientReferences({
        compilation: { ...base, moduleGraph: {} },
        isClientReference,
        isTraversalBoundary,
      }),
    ).toBeNull();
    expect(
      collectEntryClientReferences({
        compilation: { ...base, chunkGraph: {} },
        isClientReference,
        isTraversalBoundary,
      }),
    ).toBeNull();
    expect(
      collectEntryClientReferences({
        compilation: { ...base, entrypoints: undefined },
        isClientReference,
        isTraversalBoundary,
      }),
    ).toBeNull();
    expect(
      collectEntryClientReferences({
        compilation: {
          ...base,
          entrypoints: { forEach: (fn) => fn({}, 'main') },
        },
        isClientReference,
        isTraversalBoundary,
      }),
    ).toBeNull();
  });
});

describe('buildEntryClientReferencesPayload', () => {
  test('serializes sorted entries with manifest-key hrefs and relative paths', () => {
    const context = path.resolve('/app');
    const islandPath = path.join(context, 'components', 'Island.js');
    const payload = buildEntryClientReferencesPayload({
      entries: new Map([
        ['zeta', []],
        ['alpha', [islandPath]],
      ]),
      compilerContext: context,
      isServer: true,
    });

    expect(payload).toEqual({
      version: 1,
      isServer: true,
      compilerContext: context,
      entries: {
        alpha: {
          clientReferences: [pathToFileURL(islandPath).href],
          relativeClientReferences: ['components/Island.js'],
        },
        zeta: { clientReferences: [], relativeClientReferences: [] },
      },
    });
    expect(Object.keys(payload.entries)).toEqual(['alpha', 'zeta']);
  });
});
