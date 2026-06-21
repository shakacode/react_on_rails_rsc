import { pathToFileURL } from 'url';

const { RSCWebpackPlugin: ReactFlightWebpackPlugin } = require('../src/webpack/RSCWebpackPlugin');

type AsyncHookCallback = (params: unknown, callback: (error?: Error | null) => void) => void;
type SyncHookCallback = (...args: unknown[]) => void;
type ClientReference = {
  request: string;
  userRequest: string;
  type?: string;
};

type Chunk = {
  id: string;
  files: Set<string>;
};

const clientFile = '/app/components/ErrorBoundary.tsx';

const buildManifest = ({
  isServer,
  chunkGroups,
  getChunkModulesIterable,
  clientFiles = [clientFile],
  pluginOptions = {},
}: {
  isServer: boolean;
  chunkGroups: (clientReferenceBlocks: unknown[]) => unknown[];
  getChunkModulesIterable: (chunk: Chunk) => unknown[];
  /** Client references to resolve. Defaults to the single shared `clientFile`. */
  clientFiles?: string[];
  pluginOptions?: {
    chunkGroupWarningThreshold?: number | false;
  };
}) => {
  const runtimeFile = require.resolve(
    isServer ? 'react-server-dom-webpack/client.node' : 'react-server-dom-webpack/client.browser',
  );
  const plugin = new ReactFlightWebpackPlugin({
    isServer,
    clientReferences: clientFiles,
    ...pluginOptions,
  });

  plugin.resolveAllClientFiles = jest.fn(
    (
      _context: string,
      _contextResolver: unknown,
      _normalResolver: unknown,
      _fs: unknown,
      _contextModuleFactory: unknown,
      callback: (error: Error | null, refs?: ClientReference[]) => void,
    ) => {
      callback(
        null,
        clientFiles.map((request) => ({
          request,
          type: 'client-reference',
          userRequest: '.' + request,
        })),
      );
    },
  );

  const beforeCompileCallbacks: AsyncHookCallback[] = [];
  const thisCompilationCallbacks: SyncHookCallback[] = [];
  const makeCallbacks: SyncHookCallback[] = [];
  const compiler = {
    context: '/app',
    resolverFactory: {
      get: jest.fn(() => ({})),
    },
    inputFileSystem: {},
    hooks: {
      beforeCompile: {
        tapAsync: (_name: string, callback: AsyncHookCallback) => {
          beforeCompileCallbacks.push(callback);
        },
      },
      thisCompilation: {
        tap: (_name: string, callback: SyncHookCallback) => {
          thisCompilationCallbacks.push(callback);
        },
      },
      make: {
        tap: (_name: string, callback: SyncHookCallback) => {
          makeCallbacks.push(callback);
        },
      },
    },
  };

  plugin.apply(compiler);
  beforeCompileCallbacks[0]!(
    { contextModuleFactory: {} },
    (error?: Error | null) => {
      if (error) throw error;
    },
  );

  const programCallbacks: Array<() => void> = [];
  const clientReferenceBlocks: unknown[] = [];
  const parser = {
    state: {
      module: {
        resource: runtimeFile,
        addBlock: jest.fn((block: unknown) => {
          clientReferenceBlocks.push(block);
        }),
      },
    },
    hooks: {
      program: {
        tap: (_name: string, callback: () => void) => {
          programCallbacks.push(callback);
        },
      },
    },
  };
  const normalModuleFactory = {
    hooks: {
      parser: {
        for: jest.fn(() => ({
          tap: (_name: string, callback: (parserArg: typeof parser) => void) => {
            callback(parser);
          },
        })),
      },
    },
  };
  const emittedAssets = new Map<string, { source(): string | Buffer }>();
  const warnings: unknown[] = [];
  const processAssetCallbacks: Array<() => void> = [];
  const compilation = {
    dependencyFactories: new Map(),
    dependencyTemplates: new Map(),
    warnings,
    outputOptions: {
      publicPath: '/assets/',
    },
    entrypoints: new Map(),
    chunkGroups: chunkGroups(clientReferenceBlocks),
    chunkGraph: {
      getChunkModulesIterable: jest.fn(getChunkModulesIterable),
      // Derive the module id from the resource so multi-file scenarios get
      // distinct ids. For the default `clientFile` this still yields
      // './client/app/components/ErrorBoundary.tsx'.
      getModuleId: jest.fn((module: { resource?: string }) => './client' + (module.resource ?? '')),
    },
    hooks: {
      processAssets: {
        tap: (_options: unknown, callback: () => void) => {
          processAssetCallbacks.push(callback);
        },
      },
    },
    emitAsset: (filename: string, source: { source(): string | Buffer }) => {
      emittedAssets.set(filename, source);
    },
  };

  thisCompilationCallbacks[0]!(compilation, { normalModuleFactory });
  programCallbacks[0]!();
  expect(clientReferenceBlocks).not.toHaveLength(0);
  makeCallbacks[0]!(compilation);
  processAssetCallbacks[0]!();

  const manifestAsset = emittedAssets.get(
    isServer ? 'react-server-client-manifest.json' : 'react-client-manifest.json',
  );
  expect(manifestAsset).toBeDefined();

  return {
    manifest: JSON.parse(manifestAsset!.source().toString()),
    warnings,
  };
};

const buildDuplicateClientReferenceFixture = (
  groupCount: number,
  pluginOptions: { chunkGroupWarningThreshold?: number | false } = {},
  sharedFiles: string[] = [clientFile],
) => {
  const wrapperFiles = Array.from(
    { length: groupCount },
    (_value, index) => `/app/pages/Page${index}.tsx`,
  );
  const chunks = wrapperFiles.map((_file, index) => ({
    id: `client${index}`,
    files: new Set([`js/client${index}.chunk.js`]),
  }));

  return buildManifest({
    isServer: false,
    clientFiles: [...sharedFiles, ...wrapperFiles],
    pluginOptions,
    chunkGroups: (clientReferenceBlocks) =>
      chunks.map((chunk, index) => ({
        getBlocks: () => [clientReferenceBlocks[sharedFiles.length + index]!],
        chunks: [chunk],
      })),
    getChunkModulesIterable: (chunk) => {
      const index = chunks.indexOf(chunk);
      return [{ resource: wrapperFiles[index]! }, ...sharedFiles.map((resource) => ({ resource }))];
    },
  });
};

const duplicateClientReferenceWarnings = (warnings: unknown[]) =>
  warnings.filter((warning) =>
    String(warning).includes('client-reference chunk group'),
  );

describe('ReactFlightWebpackPlugin client-reference chunk selection', () => {
  it('does not merge unrelated entry chunks into the client manifest entry', () => {
    const clientModule = { resource: clientFile };
    const clientChunk = { id: 'client0', files: new Set(['js/client0.chunk.js']) };
    const unrelatedEntryChunk = {
      id: 'generated/ServerComponentRouter',
      files: new Set(['js/generated/ServerComponentRouter.js']),
    };

    const { manifest } = buildManifest({
      isServer: false,
      chunkGroups: (clientReferenceBlocks) => [
        {
          getBlocks: () => [],
          chunks: [unrelatedEntryChunk],
        },
        {
          getBlocks: () => clientReferenceBlocks,
          chunks: [clientChunk],
        },
      ],
      getChunkModulesIterable: () => [clientModule],
    });

    expect(manifest.filePathToModuleMetadata[pathToFileURL(clientFile).href]).toEqual({
      id: './client/app/components/ErrorBoundary.tsx',
      chunks: ['client0', 'js/client0.chunk.js'],
      css: [],
      name: '*',
    });
  });

  it('uses blocksIterable when getBlocks is unavailable', () => {
    const clientModule = { resource: clientFile };
    const clientChunk = { id: 'client0', files: new Set(['js/client0.chunk.js']) };

    const { manifest } = buildManifest({
      isServer: false,
      chunkGroups: (clientReferenceBlocks) => [
        {
          blocksIterable: clientReferenceBlocks,
          chunks: [clientChunk],
        },
      ],
      getChunkModulesIterable: () => [clientModule],
    });

    expect(manifest.filePathToModuleMetadata[pathToFileURL(clientFile).href]).toEqual({
      id: './client/app/components/ErrorBoundary.tsx',
      chunks: ['client0', 'js/client0.chunk.js'],
      css: [],
      name: '*',
    });
  });

  it('keeps generating server manifest metadata from server chunk groups without client-reference blocks', () => {
    const serverModule = { resource: clientFile };
    const serverChunk = { id: 'server-bundle', files: new Set(['server-bundle.js']) };

    const { manifest } = buildManifest({
      isServer: true,
      chunkGroups: () => [
        {
          chunks: [serverChunk],
        },
      ],
      getChunkModulesIterable: () => [serverModule],
    });

    expect(manifest.filePathToModuleMetadata[pathToFileURL(clientFile).href]).toEqual({
      id: './client/app/components/ErrorBoundary.tsx',
      chunks: ['server-bundle', 'server-bundle.js'],
      css: [],
      name: '*',
    });
  });

  it('dedupes CSS when merging a client reference recorded from several server chunk groups', () => {
    const serverModule = { resource: clientFile };
    const firstChunk = {
      id: 'server-a',
      files: new Set(['server-a.js', 'shared.css', 'a.css']),
    };
    const secondChunk = {
      id: 'server-b',
      files: new Set(['server-b.js', 'shared.css', 'b.css']),
    };

    // The server build records every chunk group; the second group merges
    // into the existing entry, so `shared.css` must not be duplicated.
    const { manifest } = buildManifest({
      isServer: true,
      chunkGroups: () => [{ chunks: [firstChunk] }, { chunks: [secondChunk] }],
      getChunkModulesIterable: () => [serverModule],
    });

    expect(manifest.filePathToModuleMetadata[pathToFileURL(clientFile).href]).toEqual({
      id: './client/app/components/ErrorBoundary.tsx',
      chunks: ['server-a', 'server-a.js', 'server-b', 'server-b.js'],
      css: ['/assets/shared.css', '/assets/a.css', '/assets/b.css'],
      name: '*',
    });
  });

  it('does not warn about duplicated client-reference chunk groups on the server build', () => {
    const serverModule = { resource: clientFile };
    const serverChunks = Array.from({ length: 4 }, (_value, index) => ({
      id: `server-${index}`,
      files: new Set([`server-${index}.js`]),
    }));

    const { warnings } = buildManifest({
      isServer: true,
      chunkGroups: () => serverChunks.map((chunk) => ({ chunks: [chunk] })),
      getChunkModulesIterable: () => [serverModule],
    });

    expect(duplicateClientReferenceWarnings(warnings)).toEqual([]);
  });

  it('warns when a client chunk group cannot expose client-reference blocks', () => {
    const clientModule = { resource: clientFile };
    const clientChunk = { id: 'client0', files: new Set(['js/client0.chunk.js']) };

    const { manifest, warnings } = buildManifest({
      isServer: false,
      chunkGroups: () => [
        {
          name: 'client-entry',
          chunks: [clientChunk],
        },
      ],
      getChunkModulesIterable: () => [clientModule],
    });

    expect(manifest.filePathToModuleMetadata).toEqual({});
    expect(warnings).toHaveLength(2);
    expect(String(warnings[0])).toContain(
      'Client reference blocks were unavailable for one or more chunk groups',
    );
    // Blockless chunk groups are also excluded from the fallback scan, so
    // the post-fallback check must name the client file that got no entry.
    expect(String(warnings[1])).toContain('no client manifest entry could be created');
    expect(String(warnings[1])).toContain(clientFile);
  });

  it('warns only once when several client chunk groups cannot expose client-reference blocks', () => {
    const clientModule = { resource: clientFile };
    const firstChunk = { id: 'client0', files: new Set(['js/client0.chunk.js']) };
    const secondChunk = { id: 'client1', files: new Set(['js/client1.chunk.js']) };

    const { warnings } = buildManifest({
      isServer: false,
      chunkGroups: () => [
        {
          name: 'client-entry',
          chunks: [firstChunk],
        },
        {
          name: 'admin-entry',
          chunks: [secondChunk],
        },
      ],
      getChunkModulesIterable: () => [clientModule],
    });

    const blockWarnings = warnings.filter((w) =>
      String(w).includes('Client reference blocks were unavailable for one or more chunk groups'),
    );
    expect(blockWarnings).toHaveLength(1);
  });

  it('warns with the file path when a client reference gets no manifest entry', () => {
    const clientChunk = { id: 'client0', files: new Set(['js/client0.chunk.js']) };

    const { manifest, warnings } = buildManifest({
      isServer: false,
      chunkGroups: (clientReferenceBlocks) => [
        {
          getBlocks: () => clientReferenceBlocks,
          chunks: [clientChunk],
        },
      ],
      // The client module ends up in no chunk (e.g. resource/request
      // mismatch or tree-shaking), so neither the block matching nor the
      // fallback can record it.
      getChunkModulesIterable: () => [],
    });

    expect(manifest.filePathToModuleMetadata).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0])).toContain('no client manifest entry could be created');
    expect(String(warnings[0])).toContain(clientFile);
  });

  it('fallback records only the first chunk group containing a parent-available client reference', () => {
    const clientModule = { resource: clientFile };
    const firstChunk = { id: 'entryA', files: new Set(['entryA.js']) };
    const secondChunk = { id: 'entryB', files: new Set(['entryB.js']) };

    // Neither group block-matches the client reference (their blocks carry
    // no client-reference dependencies), so the entry can only come from
    // the fallback scan. The module sits in both groups; without pruning
    // between groups the fallback would union entryB into the entry — the
    // over-preload behavior the block matching exists to eliminate.
    const { manifest, warnings } = buildManifest({
      isServer: false,
      chunkGroups: () => [
        { getBlocks: () => [], chunks: [firstChunk] },
        { getBlocks: () => [], chunks: [secondChunk] },
      ],
      getChunkModulesIterable: () => [clientModule],
    });

    expect(warnings).toEqual([]);
    expect(manifest.filePathToModuleMetadata[pathToFileURL(clientFile).href]).toEqual({
      id: './client/app/components/ErrorBoundary.tsx',
      chunks: ['entryA', 'entryA.js'],
      css: [],
      name: '*',
    });
  });

  it('fallback advances past the first group to record references that live only in a later group', () => {
    // Two client references, each parent-available in a DIFFERENT chunk
    // group, so neither block-matches and each can only be recorded by the
    // fallback. fileA lives only in group A, fileB only in group B. The
    // fallback must keep scanning after group A (where it records fileA and
    // prunes it) into group B to record fileB — a single-pass fallback that
    // only looked at the first group would drop fileB and warn.
    const fileA = clientFile;
    const fileB = '/app/components/Other.tsx';
    const moduleA = { resource: fileA };
    const moduleB = { resource: fileB };
    const groupAChunk = { id: 'groupA', files: new Set(['groupA.js']) };
    const groupBChunk = { id: 'groupB', files: new Set(['groupB.js']) };

    const { manifest, warnings } = buildManifest({
      isServer: false,
      clientFiles: [fileA, fileB],
      chunkGroups: () => [
        { getBlocks: () => [], chunks: [groupAChunk] },
        { getBlocks: () => [], chunks: [groupBChunk] },
      ],
      // Each group exposes only its own client module.
      getChunkModulesIterable: (chunk) =>
        (chunk as { id: string }).id === 'groupA' ? [moduleA] : [moduleB],
    });

    expect(warnings).toEqual([]);
    expect(manifest.filePathToModuleMetadata[pathToFileURL(fileA).href]).toEqual({
      id: './client/app/components/ErrorBoundary.tsx',
      chunks: ['groupA', 'groupA.js'],
      css: [],
      name: '*',
    });
    // fileB is recorded only if the fallback advanced to the second group.
    expect(manifest.filePathToModuleMetadata[pathToFileURL(fileB).href]).toEqual({
      id: './client/app/components/Other.tsx',
      chunks: ['groupB', 'groupB.js'],
      css: [],
      name: '*',
    });
  });

  it('warns once by default when a client reference appears in four client-reference chunk groups', () => {
    const { warnings } = buildDuplicateClientReferenceFixture(4);

    const duplicateWarnings = duplicateClientReferenceWarnings(warnings);
    expect(duplicateWarnings).toHaveLength(1);
    expect(String(duplicateWarnings[0])).toContain(clientFile);
    expect(String(duplicateWarnings[0])).toContain('4 client-reference chunk groups');
    expect(String(duplicateWarnings[0])).toContain(
      'https://github.com/shakacode/react_on_rails/blob/main/docs/oss/migrating/rsc-troubleshooting.md',
    );
    expect(String(duplicateWarnings[0])).toContain('thin client wrapper');
  });

  it('does not warn below the default client-reference chunk group threshold', () => {
    const { warnings } = buildDuplicateClientReferenceFixture(3);

    expect(duplicateClientReferenceWarnings(warnings)).toEqual([]);
  });

  it('honors a configured client-reference chunk group warning threshold', () => {
    const { warnings } = buildDuplicateClientReferenceFixture(3, {
      chunkGroupWarningThreshold: 3,
    });

    const duplicateWarnings = duplicateClientReferenceWarnings(warnings);
    expect(duplicateWarnings).toHaveLength(1);
    expect(String(duplicateWarnings[0])).toContain('3 client-reference chunk groups');
  });

  it('accepts the minimum client-reference chunk group warning threshold', () => {
    const { warnings } = buildDuplicateClientReferenceFixture(2, {
      chunkGroupWarningThreshold: 2,
    });

    const duplicateWarnings = duplicateClientReferenceWarnings(warnings);
    expect(duplicateWarnings).toHaveLength(1);
    expect(String(duplicateWarnings[0])).toContain('2 client-reference chunk groups');
  });

  it.each([false, 0] as const)(
    'disables client-reference chunk group warnings when the threshold is %p',
    (chunkGroupWarningThreshold) => {
      const { warnings } = buildDuplicateClientReferenceFixture(4, {
        chunkGroupWarningThreshold,
      });

      expect(duplicateClientReferenceWarnings(warnings)).toEqual([]);
    },
  );

  it.each([1, 2.5] as const)(
    'rejects an invalid warning threshold of %p',
    (chunkGroupWarningThreshold) => {
      expect(() =>
        buildDuplicateClientReferenceFixture(4, {
          chunkGroupWarningThreshold,
        }),
      ).toThrow('chunkGroupWarningThreshold must be an integer at least 2');
    },
  );

  it('caps duplicate client-reference chunk group warnings and emits a summary', () => {
    const sharedFiles = Array.from(
      { length: 12 },
      (_value, index) => `/app/components/Shared${index}.tsx`,
    );

    const { warnings } = buildDuplicateClientReferenceFixture(4, {}, sharedFiles);

    const duplicateWarnings = duplicateClientReferenceWarnings(warnings);
    expect(duplicateWarnings).toHaveLength(11);
    expect(duplicateWarnings.filter((warning) => String(warning).includes('Shared'))).toHaveLength(
      10,
    );
    expect(String(duplicateWarnings[10])).toContain(
      'suppressed 2 additional client-reference chunk group warning(s)',
    );
  });
});
