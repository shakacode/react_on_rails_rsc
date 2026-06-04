import { pathToFileURL } from 'url';

const ReactFlightWebpackPlugin = require('../src/react-server-dom-webpack/cjs/react-server-dom-webpack-plugin.js');

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
}: {
  isServer: boolean;
  chunkGroups: (clientReferenceBlocks: unknown[]) => unknown[];
  getChunkModulesIterable: (chunk: Chunk) => unknown[];
}) => {
  const runtimeFile = require.resolve(
    isServer ? '../src/react-server-dom-webpack/client.node.js' : '../src/react-server-dom-webpack/client.browser.js',
  );
  const plugin = new ReactFlightWebpackPlugin({
    isServer,
    clientReferences: [clientFile],
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
      callback(null, [
        { request: clientFile, type: 'client-reference', userRequest: './ErrorBoundary.tsx' },
      ]);
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
      getModuleId: jest.fn(() => './client/app/components/ErrorBoundary.tsx'),
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
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0])).toContain(
      'Client reference blocks were unavailable for one or more chunk groups',
    );
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

    expect(warnings).toHaveLength(1);
    expect(String(warnings[0])).toContain(
      'Client reference blocks were unavailable for one or more chunk groups',
    );
  });
});
