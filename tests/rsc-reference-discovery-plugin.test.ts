import * as path from 'path';
import {
  recordDiscoveredClientReferenceIfNeeded,
  RSCReferenceDiscoveryPlugin,
} from '../src/RSCReferenceDiscoveryPlugin';

class FakeRawSource {
  private readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  source(): string {
    return this.value;
  }
}

type FakeCompilation = {
  [key: symbol]: unknown;
  hooks: {
    processAssets: {
      tap: jest.Mock;
    };
  };
  emitAsset: jest.Mock;
};

const createCompilation = (): {
  compilation: FakeCompilation;
  getProcessAssetsCallback: () => () => void;
} => {
  let processAssetsCallback: (() => void) | undefined;
  const compilation = {
    hooks: {
      processAssets: {
        tap: jest.fn((_options, callback) => {
          processAssetsCallback = callback;
        }),
      },
    },
    emitAsset: jest.fn(),
  } as FakeCompilation;

  return {
    compilation,
    getProcessAssetsCallback: () => {
      if (!processAssetsCallback) throw new Error('processAssets callback was not registered');
      return processAssetsCallback;
    },
  };
};

const createCompiler = (context: string): {
  compiler: {
    context: string;
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_REPORT: number };
      sources: { RawSource: typeof FakeRawSource };
    };
    hooks: { thisCompilation: { tap: jest.Mock } };
  };
  getThisCompilationCallback: () => (compilation: FakeCompilation) => void;
} => {
  let thisCompilationCallback: ((compilation: FakeCompilation) => void) | undefined;
  const compiler = {
    context,
    webpack: {
      Compilation: { PROCESS_ASSETS_STAGE_REPORT: 5000 },
      sources: { RawSource: FakeRawSource },
    },
    hooks: {
      thisCompilation: {
        tap: jest.fn((_name, callback) => {
          thisCompilationCallback = callback;
        }),
      },
    },
  };

  return {
    compiler,
    getThisCompilationCallback: () => {
      if (!thisCompilationCallback) throw new Error('thisCompilation callback was not registered');
      return thisCompilationCallback;
    },
  };
};

describe('RSCReferenceDiscoveryPlugin', () => {
  it('emits references recorded by RSCWebpackLoader', () => {
    const context = path.join(__dirname, 'fixtures');
    const component = path.join(context, 'components', 'ClientComponent.jsx');
    const { compiler, getThisCompilationCallback } = createCompiler(context);
    const { compilation, getProcessAssetsCallback } = createCompilation();

    new RSCReferenceDiscoveryPlugin({ filename: 'custom-rsc-client-references.json' }).apply(
      compiler,
    );
    getThisCompilationCallback()(compilation);

    const cacheable = jest.fn();
    const recorded = recordDiscoveredClientReferenceIfNeeded(
      { _compilation: compilation, resourcePath: component, cacheable },
      "'use client';\nexport default function ClientComponent() { return null; }\n",
    );

    expect(recorded).toBe(true);
    expect(cacheable).toHaveBeenCalledWith(false);

    getProcessAssetsCallback()();

    expect(compilation.emitAsset).toHaveBeenCalledTimes(1);
    const [filename, source] = compilation.emitAsset.mock.calls[0]!;
    expect(filename).toBe('custom-rsc-client-references.json');

    const payload = JSON.parse((source as FakeRawSource).source()) as {
      version: number;
      compilerContext: string;
      count: number;
      refs: string[];
      relativeRefs: string[];
    };
    expect(payload).toEqual({
      version: 1,
      compilerContext: context,
      count: 1,
      refs: [component],
      relativeRefs: ['components/ClientComponent.jsx'],
    });
  });

  it('does not record when the emitter plugin is not active for the compilation', () => {
    const cacheable = jest.fn();
    const recorded = recordDiscoveredClientReferenceIfNeeded(
      {
        _compilation: { hooks: { processAssets: { tap: jest.fn() } }, emitAsset: jest.fn() },
        resourcePath: '/app/Client.jsx',
        cacheable,
      },
      "'use client';\nexport default function Client() { return null; }\n",
    );

    expect(recorded).toBe(false);
    expect(cacheable).not.toHaveBeenCalled();
  });

  it('marks loader output non-cacheable when active even for non-client modules', () => {
    const { compiler, getThisCompilationCallback } = createCompiler('/app');
    const { compilation } = createCompilation();
    new RSCReferenceDiscoveryPlugin().apply(compiler);
    getThisCompilationCallback()(compilation);

    const cacheable = jest.fn();
    const recorded = recordDiscoveredClientReferenceIfNeeded(
      { _compilation: compilation, resourcePath: '/app/Server.jsx', cacheable },
      'export default function Server() { return null; }\n',
    );

    expect(recorded).toBe(false);
    expect(cacheable).toHaveBeenCalledWith(false);
  });
});
