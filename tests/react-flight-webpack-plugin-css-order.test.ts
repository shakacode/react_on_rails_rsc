import { pathToFileURL } from 'url';

const ReactFlightWebpackPlugin = require('../src/react-server-dom-webpack/cjs/react-server-dom-webpack-plugin.js');

type AsyncHookCallback = (params: unknown, callback: (error?: Error | null) => void) => void;
type SyncHookCallback = (...args: unknown[]) => void;
type ClientReference = {
  request: string;
  userRequest: string;
  type?: string;
};

type ChunkDef = {
  id: string;
  files: string[];
};

const emitManifestMetadata = ({
  files,
  publicPath = '/assets/',
  isServer = false,
  chunks: chunkDefs,
  entrypoints: entrypointDefs,
}: {
  files?: string[];
  publicPath?: string;
  isServer?: boolean;
  chunks?: ChunkDef[];
  entrypoints?: Array<{ runtimeChunk: ChunkDef }>;
}) => {
  const clientFile = '/app/components/ClientComponent.js';
  // The plugin matches this specific runtime resource to inject client-reference dependency blocks.
  const runtimeFile = require.resolve(
    isServer ? '../src/react-server-dom-webpack/client.node.js' : '../src/react-server-dom-webpack/client.browser.js',
  );
  const plugin = new ReactFlightWebpackPlugin({
    isServer,
    clientReferences: [clientFile],
  });

  // Keep this focused on manifest generation once the plugin has discovered the client reference.
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
        { request: clientFile, type: 'client-reference', userRequest: './ClientComponent.js' },
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

  expect(beforeCompileCallbacks).toHaveLength(1);
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
  const processAssetCallbacks: Array<() => void> = [];
  const resolvedChunks = (chunkDefs ?? [{ id: 'client-chunk', files: files ?? [] }]).map((c) => ({
    id: c.id,
    files: new Set(c.files),
  }));
  const module = {
    resource: clientFile,
  };
  const entrypoints = new Map<string, { getRuntimeChunk: () => (typeof resolvedChunks)[0] | null }>();
  if (entrypointDefs) {
    for (let i = 0; i < entrypointDefs.length; i++) {
      const runtimeChunkObj = resolvedChunks.find((c) => c.id === entrypointDefs[i]!.runtimeChunk.id) ?? {
        id: entrypointDefs[i]!.runtimeChunk.id,
        files: new Set(entrypointDefs[i]!.runtimeChunk.files),
      };
      entrypoints.set(`entry-${i}`, { getRuntimeChunk: () => runtimeChunkObj });
    }
  }
  const compilation = {
    dependencyFactories: new Map(),
    dependencyTemplates: new Map(),
    warnings: [],
    outputOptions: {
      publicPath,
    },
    entrypoints,
    chunkGroups: [
      {
        getBlocks: () => clientReferenceBlocks,
        chunks: resolvedChunks,
      },
    ],
    chunkGraph: {
      getChunkModulesIterable: jest.fn(() => [module]),
      getModuleId: jest.fn(() => './ClientComponent.js'),
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

  expect(thisCompilationCallbacks).toHaveLength(1);
  thisCompilationCallbacks[0]!(compilation, { normalModuleFactory });
  expect(programCallbacks).toHaveLength(3);
  programCallbacks.forEach((callback) => callback());
  expect(clientReferenceBlocks).not.toHaveLength(0);
  expect(makeCallbacks).toHaveLength(1);
  makeCallbacks[0]!(compilation);
  expect(processAssetCallbacks).toHaveLength(1);
  processAssetCallbacks[0]!();

  const manifestAsset = emittedAssets.get(
    isServer ? 'react-server-client-manifest.json' : 'react-client-manifest.json',
  );
  expect(manifestAsset).toBeDefined();
  const manifestSource = manifestAsset!.source().toString();
  const manifest = JSON.parse(manifestSource);
  return manifest.filePathToModuleMetadata[pathToFileURL(clientFile).href];
};

describe('ReactFlightWebpackPlugin manifest chunk files', () => {
  it('records the JavaScript chunk when CSS appears first in chunk.files', () => {
    const metadata = emitManifestMetadata({ files: ['client.css', 'client.js'] });

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['client-chunk', 'client.js'],
      css: ['/assets/client.css'],
      name: '*',
    });
  });

  it('records CSS that appears after JavaScript in chunk.files', () => {
    const metadata = emitManifestMetadata({ files: ['client.js', 'client.css'] });

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['client-chunk', 'client.js'],
      css: ['/assets/client.css'],
      name: '*',
    });
  });

  it('normalizes CSS hrefs when webpack publicPath omits the trailing slash', () => {
    const metadata = emitManifestMetadata({
      files: ['client.css', 'client.js'],
      publicPath: '/assets',
    });

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['client-chunk', 'client.js'],
      css: ['/assets/client.css'],
      name: '*',
    });
  });

  it('records mjs chunks as JavaScript assets', () => {
    const metadata = emitManifestMetadata({ files: ['client.css', 'client.mjs'] });

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['client-chunk', 'client.mjs'],
      css: ['/assets/client.css'],
      name: '*',
    });
  });

  it('does not record mjs hot-update chunks as JavaScript assets', () => {
    const metadata = emitManifestMetadata({
      files: ['client.css', 'client.hot-update.mjs', 'client.mjs'],
    });

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['client-chunk', 'client.mjs'],
      css: ['/assets/client.css'],
      name: '*',
    });
  });

  it('records relative CSS hrefs for an explicit empty webpack publicPath', () => {
    const metadata = emitManifestMetadata({
      files: ['client.css', 'client.js'],
      publicPath: '',
    });

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['client-chunk', 'client.js'],
      css: ['client.css'],
      name: '*',
    });
  });

  it('does not record document-relative CSS hrefs for the webpack publicPath auto sentinel', () => {
    const metadata = emitManifestMetadata({
      files: ['client.css', 'client.js'],
      publicPath: 'auto',
    });

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['client-chunk', 'client.js'],
      css: [],
      name: '*',
    });
  });

  it('does not record CSS files from runtime chunks in the client manifest', () => {
    const runtimeChunk = { id: 'runtime', files: ['runtime.js', 'runtime.css'] };
    const clientChunk = { id: 'client-chunk', files: ['client.js', 'client.css'] };
    const metadata = emitManifestMetadata({
      chunks: [runtimeChunk, clientChunk],
      entrypoints: [{ runtimeChunk }],
    });

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['client-chunk', 'client.js'],
      css: ['/assets/client.css'],
      name: '*',
    });
  });

  it('still records all CSS files from a non-runtime chunk', () => {
    const metadata = emitManifestMetadata({
      chunks: [{ id: 'client-chunk', files: ['a.css', 'b.css', 'client.js'] }],
    });

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['client-chunk', 'client.js'],
      css: ['/assets/a.css', '/assets/b.css'],
      name: '*',
    });
  });

  it('still records runtime-owned CSS on the server manifest', () => {
    const runtimeChunk = { id: 'runtime', files: ['runtime.js', 'runtime.css'] };
    const metadata = emitManifestMetadata({
      isServer: true,
      chunks: [runtimeChunk],
      entrypoints: [{ runtimeChunk }],
    });

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['runtime', 'runtime.js'],
      css: ['/assets/runtime.css'],
      name: '*',
    });
  });

  it('does not record hot-update CSS files', () => {
    const metadata = emitManifestMetadata({
      chunks: [{ id: 'client-chunk', files: ['client.hot-update.css', 'client.css', 'client.js'] }],
    });

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['client-chunk', 'client.js'],
      css: ['/assets/client.css'],
      name: '*',
    });
  });
});
