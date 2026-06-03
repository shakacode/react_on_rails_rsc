import * as path from 'path';
import { hasUseClientDirective } from './clientReferences';

type AnyCompilation = {
  [key: symbol]: unknown;
  hooks: {
    processAssets: {
      tap: (options: { name: string; stage: number }, callback: () => void) => void;
    };
  };
  emitAsset: (filename: string, source: unknown) => void;
};

type AnyCompiler = {
  context: string;
  webpack?: {
    Compilation: { PROCESS_ASSETS_STAGE_REPORT: number };
    sources: { RawSource: new (source: string) => unknown };
  };
  rspack?: {
    Compilation: { PROCESS_ASSETS_STAGE_REPORT: number };
    sources: { RawSource: new (source: string) => unknown };
  };
  hooks: {
    thisCompilation: {
      tap: (name: string, callback: (compilation: AnyCompilation) => void) => void;
    };
  };
};

type LoaderContextWithCompilation = {
  _compilation?: unknown;
  resourcePath?: string;
  cacheable?: (flag?: boolean) => void;
};

const RSC_CLIENT_REFERENCES_KEY: symbol = Symbol.for(
  'react-on-rails-rsc.discoveredClientReferences',
);

function getClientReferenceSet(compilation: AnyCompilation): Set<string> {
  const existing = compilation[RSC_CLIENT_REFERENCES_KEY];
  if (existing instanceof Set) return existing as Set<string>;

  const refs = new Set<string>();
  compilation[RSC_CLIENT_REFERENCES_KEY] = refs;
  return refs;
}

function existingClientReferenceSet(compilation: AnyCompilation): Set<string> | undefined {
  const existing = compilation[RSC_CLIENT_REFERENCES_KEY];
  return existing instanceof Set ? (existing as Set<string>) : undefined;
}

function resolveBundler(compiler: AnyCompiler) {
  if (compiler.webpack) return compiler.webpack;
  if (compiler.rspack) return compiler.rspack;
  throw new Error('RSCReferenceDiscoveryPlugin requires a compiler with webpack or rspack APIs');
}

export function recordDiscoveredClientReferenceIfNeeded(
  loaderContext: LoaderContextWithCompilation,
  source: string | Buffer,
): boolean {
  const compilation = loaderContext._compilation as AnyCompilation | undefined;
  if (!compilation) return false;

  const refs = existingClientReferenceSet(compilation);
  if (!refs) return false;

  // Recording is a loader side effect. If this loader output is reused from a
  // cache in a later watch rebuild, the side effect can be skipped and the
  // emitted references can become stale.
  loaderContext.cacheable?.(false);

  const resourcePath = loaderContext.resourcePath;
  if (!resourcePath || !hasUseClientDirective(source)) return false;

  refs.add(resourcePath);
  return true;
}

export class RSCReferenceDiscoveryPlugin {
  private readonly filename: string;

  constructor(options: { filename?: string } = {}) {
    this.filename = options.filename || 'rsc-client-references.json';
  }

  apply(compiler: AnyCompiler): void {
    const pluginName = 'RSCReferenceDiscoveryPlugin';
    const bundler = resolveBundler(compiler);

    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {
      getClientReferenceSet(compilation);

      compilation.hooks.processAssets.tap(
        { name: pluginName, stage: bundler.Compilation.PROCESS_ASSETS_STAGE_REPORT },
        () => {
          const refs = Array.from(getClientReferenceSet(compilation)).sort();
          const payload = {
            version: 1,
            compilerContext: compiler.context,
            count: refs.length,
            refs,
            relativeRefs: refs.map((file) =>
              path.relative(compiler.context, file).replace(/\\/g, '/'),
            ),
          };

          compilation.emitAsset(
            this.filename,
            new bundler.sources.RawSource(`${JSON.stringify(payload, null, 2)}\n`),
          );
        },
      );
    });
  }
}

export default RSCReferenceDiscoveryPlugin;
