import { pathToFileURL } from 'url';

const ReactFlightWebpackPlugin = require('../src/react-server-dom-webpack/cjs/react-server-dom-webpack-plugin.js');

type AsyncHookCallback = (params: unknown, callback: (error?: Error | null) => void) => void;
type SyncHookCallback = (...args: unknown[]) => void;

describe('ReactFlightWebpackPlugin manifest chunk files', () => {
  it('records the JavaScript chunk when CSS appears first in chunk.files', () => {
    const clientFile = '/app/components/ClientComponent.js';
    // The plugin matches this specific runtime resource to inject client-reference dependency blocks.
    const runtimeFile = require.resolve('../src/react-server-dom-webpack/client.browser.js');
    const plugin = new ReactFlightWebpackPlugin({
      isServer: false,
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
        callback: (error: Error | null, refs?: Array<{ request: string; userRequest: string }>) => void,
      ) => {
        callback(null, [
          { request: clientFile, type: 'client-reference', userRequest: './ClientComponent.js' } as never,
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
    const chunk = {
      id: 'client-chunk',
      files: new Set(['client.css', 'client.js']),
    };
    const module = {
      resource: clientFile,
    };
    const compilation = {
      dependencyFactories: new Map(),
      dependencyTemplates: new Map(),
      warnings: [],
      outputOptions: {
        publicPath: '/assets/',
      },
      entrypoints: new Map(),
      chunkGroups: [
        {
          getBlocks: () => clientReferenceBlocks,
          chunks: [chunk],
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

    const manifestAsset = emittedAssets.get('react-client-manifest.json');
    expect(manifestAsset).toBeDefined();
    const manifestSource = manifestAsset!.source().toString();
    const manifest = JSON.parse(manifestSource);
    const metadata = manifest.filePathToModuleMetadata[pathToFileURL(clientFile).href];

    expect(metadata).toEqual({
      id: './ClientComponent.js',
      chunks: ['client-chunk', 'client.js'],
      name: '*',
    });
  });
});
