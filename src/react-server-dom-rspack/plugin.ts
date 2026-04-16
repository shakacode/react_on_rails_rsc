/**
 * RSCRspackPlugin — rspack-native equivalent of RSCWebpackPlugin.
 *
 * Emits React on Rails' existing manifest schemas
 * (`react-client-manifest.json` and `react-ssr-manifest.json`) using only
 * standard rspack public APIs — no dependency on rspack's experimental RSC
 * system (`rspackExperiments.reactServerComponents`, `experiments.rsc`,
 * `react-server-dom-rspack`).
 *
 * Discovery technique: a small loader (`loader.ts`) tags modules containing
 * a `"use client"` directive at parse time. This plugin collects tagged
 * modules via `compilation.hooks.finishModules`, walks the chunk graph via
 * `compilation.chunkGraph.getModuleChunks(module)`, and emits the manifest
 * JSON at `processAssets` stage `PROCESS_ASSETS_STAGE_REPORT`.
 *
 * Output schema matches RoR's existing webpack-side plugin so
 * `buildServerRenderer` / `buildClientRenderer` in server.node.ts /
 * client.node.ts work without changes.
 */

import * as path from 'path';
import * as url from 'url';
import { CLIENT_MODULES_KEY } from './shared';

// Accept any bundler that looks compatible — webpack 5 or rspack. Typed loose
// because we cannot depend on `@rspack/core` types without making it a hard
// peer dep of a package that should stay webpack-centric.
type AnyLogger = {
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

type AnyCompiler = {
  options: {
    module?: { rules?: unknown[] };
    context?: string;
  };
  context: string;
  hooks: {
    thisCompilation: { tap: (name: string, fn: (compilation: unknown) => void) => void };
  };
  rspack?: { version?: string };
  webpack?: { version?: string };
  getInfrastructureLogger?(name: string): AnyLogger;
};

type AnyCompilation = {
  hooks: {
    processAssets: {
      tap: (opts: { name: string; stage: number }, fn: () => void) => void;
    };
  };
  chunkGraph: {
    getModuleChunks(module: unknown): Iterable<unknown>;
    getModuleId(module: unknown): string | number | null;
  };
  outputOptions: {
    // `publicPath` can be a string (`'/packs/'`, `'auto'`), a function
    // (rspack/webpack 5: `(pathData) => string`), or undefined. Typed
    // loosely so buildManifest can inspect the raw value and normalize.
    publicPath?: string | ((...args: unknown[]) => string);
    crossOriginLoading?: false | 'anonymous' | 'use-credentials';
  };
  emitAsset(filename: string, source: unknown): void;
  warnings: unknown[];
  compiler: AnyCompiler;
  getLogger?(name: string): AnyLogger;
};

// Helper to read/write our private Symbol key on the compilation. Using a
// symbol requires a cast because TS structural types can't easily express
// "indexable by this specific symbol." All accesses funnel through this
// pair so the cast is isolated.
type SymbolIndexable = Record<symbol, unknown>;
const getTagSet = (compilation: AnyCompilation): Set<string> | undefined =>
  (compilation as unknown as SymbolIndexable)[CLIENT_MODULES_KEY] as Set<string> | undefined;
const setTagSet = (compilation: AnyCompilation, set: Set<string>): void => {
  (compilation as unknown as SymbolIndexable)[CLIENT_MODULES_KEY] = set;
};

type AnyModule = {
  resource?: string;
  modules?: AnyModule[]; // for ConcatenatedModule
};

type AnyChunk = {
  id?: string | number | null;
  files: Set<string> | string[];
};

type Bundler = {
  sources: { RawSource: new (source: string, convertToString?: boolean) => unknown };
  Compilation: { PROCESS_ASSETS_STAGE_REPORT: number };
};

export interface Options {
  /**
   * Whether the plugin is applied to the server bundle (as opposed to the
   * client bundle). Determines the default manifest filename and which
   * runtime module the plugin looks for the client runtime against.
   */
  isServer: boolean;
  /**
   * Override the client manifest filename. Defaults to
   * `react-client-manifest.json` for client, `react-server-client-manifest.json`
   * for server, matching the webpack plugin's defaults.
   */
  clientManifestFilename?: string;
}

// Default loader rule — applied to all JS/TS files so our directive detector
// sees every user module.
export const RSC_LOADER_RULE = {
  test: /\.[cm]?[jt]sx?$/,
  // `enforce: 'pre'` ensures we run before any transpiling loader, so we see
  // the original source text and can detect "use client" even in TS/JSX files
  // that other loaders will later transform.
  enforce: 'pre' as const,
  use: [{ loader: require.resolve('./loader') }],
};

export class RSCRspackPlugin {
  private readonly options: Options;

  constructor(options: Options) {
    if (!options || typeof options.isServer !== 'boolean') {
      throw new Error(
        'RSCRspackPlugin: You must specify the `isServer` option as a boolean.',
      );
    }
    this.options = options;
  }

  apply(compiler: AnyCompiler): void {
    const defaultFilename = this.options.isServer
      ? 'react-server-client-manifest.json'
      : 'react-client-manifest.json';
    const manifestFilename = this.options.clientManifestFilename ?? defaultFilename;

    // Determine which bundler this is so we can pull Compilation / sources
    // from the correct namespace. We keep both paths so the plugin can run
    // under webpack (for future consolidation) as well as rspack, but the
    // webpack path is not the primary target.
    const bundler = this.resolveBundler(compiler);

    // Inject the tagging loader so every JS/TS module passes through it.
    // We do this at apply-time so users don't have to add the rule manually.
    this.ensureLoaderRule(compiler);

    compiler.hooks.thisCompilation.tap('RSCRspackPlugin', (compilationUnknown) => {
      const compilation = compilationUnknown as AnyCompilation;

      // Eagerly create the shared Set so the loader never races on
      // initialization. Rspack can run JS loaders across a worker pool;
      // two modules finishing simultaneously could both observe
      // `existing === undefined` under a check-then-set pattern and one
      // would clobber the other. By pre-creating the Set here (which runs
      // exactly once per compilation, before any loader), the loader's
      // only job is a safe `set.add(resourcePath)`.
      if (!getTagSet(compilation)) {
        setTagSet(compilation, new Set<string>());
      }

      // At `processAssets` stage REPORT, walk the chunk graph and build
      // the manifest. The tagged set lives on
      // `compilation[CLIENT_MODULES_KEY]`.
      compilation.hooks.processAssets.tap(
        {
          name: 'RSCRspackPlugin',
          stage: bundler.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        () => {
          const taggedPaths = getTagSet(compilation) ?? new Set<string>();
          const logger = compilation.getLogger?.('RSCRspackPlugin');
          if (taggedPaths.size === 0) {
            // Zero tagged modules almost always means the loader never ran
            // (e.g., the auto-injected rule was overridden by user config,
            // or the user's own rules.test regex didn't match). Push an
            // info log — not a warning, because a legitimate RSC project
            // with only server components has no client references.
            logger?.info(
              'No "use client" modules detected; emitting empty manifest. ' +
                'If this is unexpected, ensure the RSC loader rule runs on your source files.',
            );
          } else {
            logger?.debug(`Tagged ${taggedPaths.size} "use client" module(s)`);
          }
          const manifest = this.buildManifest(compilation, taggedPaths, logger);
          logger?.debug(
            `Emitting ${manifestFilename} with ` +
              `${Object.keys(manifest.filePathToModuleMetadata).length} entries`,
          );
          compilation.emitAsset(
            manifestFilename,
            new bundler.sources.RawSource(JSON.stringify(manifest, null, 2), false),
          );
        },
      );
    });
  }

  /**
   * Resolves the bundler runtime namespace. Prefers `compiler.rspack` (if
   * present — rspack sets this), falls back to `compiler.webpack` (webpack 5
   * convention), then tries `require('webpack')` as a last resort.
   *
   * This means the same plugin code works under both rspack and webpack
   * without an explicit bundler option, as long as the bundler exposes the
   * convention-standard `Compilation` and `sources` types.
   */
  private resolveBundler(compiler: AnyCompiler): Bundler {
    const maybe = (compiler as unknown as { rspack?: Bundler; webpack?: Bundler });
    if (maybe.rspack && isBundler(maybe.rspack)) return maybe.rspack;
    if (maybe.webpack && isBundler(maybe.webpack)) return maybe.webpack;
    // Last resort: try `@rspack/core` and `webpack` at runtime. We try rspack
    // first so that rspack-installed projects prefer it.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      const rsp = require('@rspack/core') as Bundler;
      if (isBundler(rsp)) return rsp;
    } catch {
      /* not installed; fall through */
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    return require('webpack') as Bundler;
  }

  /**
   * Injects the tagging loader rule into compiler.options.module.rules at
   * position 0 (so it runs `pre` relative to user rules). Idempotent — if
   * the rule is already present, do nothing.
   */
  private ensureLoaderRule(compiler: AnyCompiler): void {
    const moduleConfig = (compiler.options.module ??= {}) as { rules?: unknown[] };
    const rules = (moduleConfig.rules ??= []) as unknown[];
    // Detect duplicate injection by checking for our loader path.
    const ourLoaderPath = require.resolve('./loader');
    const alreadyInjected = rules.some((r) => {
      if (!r || typeof r !== 'object') return false;
      const rule = r as { use?: unknown };
      if (!Array.isArray(rule.use)) return false;
      return rule.use.some((u) => {
        if (typeof u === 'string') return u === ourLoaderPath;
        if (u && typeof u === 'object') return (u as { loader?: string }).loader === ourLoaderPath;
        return false;
      });
    });
    if (!alreadyInjected) rules.unshift(RSC_LOADER_RULE);
  }

  /**
   * Build the RoR-shape manifest from the tagged module set.
   *
   * Walks the compilation's modules to find the ones we tagged, then for each
   * uses `chunkGraph.getModuleChunks(module)` to build the `chunks` array.
   */
  private buildManifest(
    compilation: AnyCompilation,
    taggedPaths: Set<string>,
    logger?: AnyLogger,
  ): {
    moduleLoading: { prefix: string; crossOrigin: string | null };
    filePathToModuleMetadata: Record<string, { id: string; chunks: (string | number)[]; name: string }>;
  } {
    const filePathToModuleMetadata: Record<
      string,
      { id: string; chunks: (string | number)[]; name: string }
    > = {};

    // Iterate compilation.modules (both webpack and rspack expose it).
    const modulesIterable = (compilation as unknown as { modules: Iterable<AnyModule> }).modules;

    /**
     * Record a tagged module in the manifest under the given moduleId.
     *
     * `idOverride` lets the caller force a specific moduleId — needed for
     * `ConcatenatedModule` inner modules, which have no moduleId of their
     * own (scope hoisting folded them into their parent) and must instead
     * be recorded under the parent's moduleId. This matches the webpack
     * reference plugin's behavior (see the vendored
     * react-server-dom-webpack-plugin.js — its `recordModule(moduleId, ...)`
     * is called both on the outer module and, passing the same moduleId,
     * on each inner concatenated module).
     */
    const recordModule = (module: AnyModule, idOverride?: string | number): void => {
      if (!module.resource || !taggedPaths.has(module.resource)) return;
      const href = url.pathToFileURL(module.resource).href;
      const id = idOverride ?? compilation.chunkGraph.getModuleId(module);
      if (id === null || id === undefined) {
        // A tagged client module has no moduleId — it will not appear in
        // the manifest, so the runtime cannot resolve it. Most likely a
        // tree-shaken / dead-code-eliminated module. Warn so the user can
        // investigate rather than seeing an opaque "Could not find module"
        // at render time.
        logger?.warn(
          `"use client" module has no moduleId and will be omitted from the manifest: ${module.resource}`,
        );
        return;
      }

      const chunks: (string | number)[] = [];
      for (const chunkUnknown of compilation.chunkGraph.getModuleChunks(module)) {
        const chunk = chunkUnknown as AnyChunk;
        const files = chunk.files instanceof Set ? chunk.files : new Set(chunk.files);
        for (const file of files) {
          if (file.endsWith('.js') && !file.endsWith('.hot-update.js')) {
            if (chunk.id !== null && chunk.id !== undefined) {
              // Stringify chunk.id to match the entry `id` stringification
              // below — keeps the manifest values a uniform string type
              // rather than a mix of string / number.
              chunks.push(String(chunk.id));
            }
            chunks.push(file);
            break;
          }
        }
      }

      if (filePathToModuleMetadata[href]) {
        // Collision (multiple visits for same resource, e.g. via
        // ConcatenatedModule iteration) — merge chunks without duplicates.
        const existing = filePathToModuleMetadata[href];
        const seen = new Set<string | number>();
        for (let i = 0; i < existing.chunks.length; i += 2) seen.add(existing.chunks[i]!);
        for (let i = 0; i < chunks.length; i += 2) {
          if (!seen.has(chunks[i]!)) existing.chunks.push(chunks[i]!, chunks[i + 1]!);
        }
      } else {
        filePathToModuleMetadata[href] = {
          id: String(id),
          chunks,
          name: '*',
        };
      }
    };

    for (const m of modulesIterable) {
      const mod = m as AnyModule;
      recordModule(mod);
      // Handle ConcatenatedModule (scope-hoisted). Inner modules have no
      // moduleId of their own — chunkGraph.getModuleId(inner) returns null,
      // so a naive recursion would silently drop every concatenated client
      // component from the manifest. Instead, reuse the OUTER module's
      // moduleId for each inner recording, which is exactly what the
      // webpack reference plugin does and what the runtime expects.
      if (mod.modules) {
        const outerId = compilation.chunkGraph.getModuleId(mod);
        if (outerId !== null && outerId !== undefined) {
          for (const inner of mod.modules) recordModule(inner, outerId);
        }
      }
    }

    const crossOriginRaw = compilation.outputOptions.crossOriginLoading;
    const crossOrigin =
      crossOriginRaw === 'use-credentials'
        ? 'use-credentials'
        : crossOriginRaw === 'anonymous'
          ? 'anonymous'
          : null;

    // publicPath normalization:
    // - A plain URL/path string: use verbatim.
    // - `'auto'`: resolved at runtime by the bundler; there is no compile-
    //   time answer, and the literal string `"auto"` in the manifest would
    //   be concatenated with chunk filenames at load time, producing
    //   `"auto/main.js"` — a broken URL. Fall back to empty string and warn
    //   so the user can configure an explicit publicPath for RSC.
    // - A function or unknown non-string type: fall back to empty.
    const rawPrefix = compilation.outputOptions.publicPath;
    let prefix: string;
    if (typeof rawPrefix === 'string' && rawPrefix !== 'auto') {
      prefix = rawPrefix;
    } else {
      if (rawPrefix === 'auto') {
        logger?.warn(
          "output.publicPath is 'auto', which cannot be resolved at build time. " +
            'Set an explicit publicPath for the RSC manifest to reference chunks correctly.',
        );
      } else if (typeof rawPrefix === 'function') {
        logger?.warn(
          'output.publicPath is a function, which the RSC manifest cannot serialize. ' +
            'Set a string publicPath for reliable chunk resolution.',
        );
      }
      prefix = '';
    }

    return {
      moduleLoading: {
        prefix,
        crossOrigin,
      },
      filePathToModuleMetadata,
    };
  }
}

// Also export as default to match how `WebpackPlugin` is imported elsewhere.
export default RSCRspackPlugin;

function isBundler(b: unknown): b is Bundler {
  if (!b || typeof b !== 'object') return false;
  const obj = b as { sources?: unknown; Compilation?: unknown };
  return (
    !!obj.sources &&
    typeof obj.sources === 'object' &&
    typeof (obj.sources as { RawSource?: unknown }).RawSource === 'function' &&
    !!obj.Compilation &&
    typeof obj.Compilation === 'function' &&
    typeof (obj.Compilation as { PROCESS_ASSETS_STAGE_REPORT?: unknown }).PROCESS_ASSETS_STAGE_REPORT === 'number'
  );
}
