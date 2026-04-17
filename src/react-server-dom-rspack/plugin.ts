/**
 * RSCRspackPlugin — rspack-native equivalent of RSCWebpackPlugin.
 *
 * Emits React on Rails' existing client-manifest JSON schema using only
 * standard rspack public APIs — no dependency on rspack's experimental RSC
 * system (`rspackExperiments.reactServerComponents`, `experiments.rsc`,
 * `react-server-dom-rspack`).
 *
 * Discovery technique: a small loader (`loader.ts`) tags modules containing
 * a `"use client"` directive during parse by adding the module's resource
 * path to a per-compilation Set keyed under the `CLIENT_MODULES_KEY`
 * Symbol. This plugin:
 *   1. Eagerly creates the shared Set in `thisCompilation` (before any
 *      loader runs, to prevent a check-then-set race across workers).
 *   2. At `processAssets` stage `PROCESS_ASSETS_STAGE_REPORT`, reads the
 *      Set, iterates `compilation.modules`, looks up each tagged module's
 *      chunks via `compilation.chunkGraph.getModuleChunks(module)`, and
 *      emits a manifest JSON asset via `compilation.emitAsset`.
 *
 * Output schema matches RoR's existing webpack-side plugin so
 * `buildServerRenderer` / `buildClientRenderer` in server.node.ts /
 * client.node.ts work without changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { CLIENT_MODULES_KEY, hasUseClientDirective } from './shared';

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
    beforeCompile: { tapAsync: (name: string, fn: (params: unknown, cb: (err?: Error | null) => void) => void) => void };
    finishMake: { tapAsync: (name: string, fn: (compilation: unknown, cb: (err?: Error | null) => void) => void) => void };
    thisCompilation: { tap: (name: string, fn: (compilation: unknown) => void) => void };
  };
  rspack?: { version?: string };
  webpack?: { version?: string };
  inputFileSystem?: { readFileSync?(p: string, enc: string): string };
  resolverFactory?: { get(type: string, options?: unknown): unknown };
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
  addInclude?(context: string, dep: unknown, options: { name: string }, cb: (err?: Error | null, module?: unknown) => void): void;
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
  EntryPlugin?: { createDependency(request: string, options: { name: string }): unknown };
  Template?: { toPath(str: string): string };
};

/**
 * A search-path descriptor matching the webpack plugin's `clientReferences`
 * shape. Each entry tells the plugin to walk a directory for files matching
 * `include` (a RegExp), optionally excluding via `exclude`.
 */
export type ClientReferenceSearchPath = {
  directory: string;
  recursive?: boolean;
  include: RegExp;
  exclude?: RegExp;
};

export type ClientReferencePath = string | ClientReferenceSearchPath;

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
  /**
   * Where to look for `"use client"` files. Each entry is either:
   *   - A string (absolute path to a single file), or
   *   - A search descriptor: `{ directory, recursive?, include, exclude? }`
   *
   * The plugin FS-walks each descriptor at `beforeCompile` time, reads
   * every matching file, checks for the `"use client"` directive, and
   * injects the discovered files into the bundle as named async chunks
   * (via `compilation.addInclude`). This ensures the client/SSR bundle
   * includes every client component even if nothing in the entry graph
   * explicitly imports it — matching the webpack plugin's behavior.
   *
   * Default: `[{ directory: ".", recursive: true, include: /\.(js|ts|jsx|tsx)$/ }]`
   * (scan the entire compiler context directory).
   */
  clientReferences?: ClientReferencePath | ReadonlyArray<ClientReferencePath>;
  /**
   * Template for naming async chunks created for each client reference.
   * Supports `[index]` (sequential number) and `[request]` (sanitised
   * file path). Default: `"client[index]"`.
   */
  chunkName?: string;
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
  private readonly clientReferences: ClientReferenceSearchPath[];
  private readonly chunkName: string;

  constructor(options: Options) {
    if (!options || typeof options.isServer !== 'boolean') {
      throw new Error(
        'RSCRspackPlugin: You must specify the `isServer` option as a boolean.',
      );
    }
    this.options = options;

    // Normalize clientReferences exactly like the webpack plugin.
    // Default: scan the entire context directory for JS/TS files.
    if (options.clientReferences) {
      const raw = Array.isArray(options.clientReferences)
        ? options.clientReferences
        : [options.clientReferences];
      this.clientReferences = raw.map((ref) =>
        typeof ref === 'string'
          ? { directory: ref, recursive: true, include: /\.(js|ts|jsx|tsx)$/ }
          : ref,
      ) as ClientReferenceSearchPath[];
    } else {
      this.clientReferences = [
        { directory: '.', recursive: true, include: /\.(js|ts|jsx|tsx)$/ },
      ];
    }

    // Normalize chunkName — must contain [index] or [request].
    const cn = typeof options.chunkName === 'string' ? options.chunkName : 'client[index]';
    this.chunkName = /\[(index|request)\]/.test(cn) ? cn : cn + '[index]';
  }

  apply(compiler: AnyCompiler): void {
    const defaultFilename = this.options.isServer
      ? 'react-server-client-manifest.json'
      : 'react-client-manifest.json';
    const manifestFilename = this.options.clientManifestFilename ?? defaultFilename;

    const bundler = this.resolveBundler(compiler);

    // Inject the tagging loader so every JS/TS module passes through it.
    this.ensureLoaderRule(compiler);

    // ── Phase 1: FS-walk discovery (before compilation starts) ──────
    // Mirrors the webpack plugin's `beforeCompile` / `resolveAllClientFiles`.
    // We synchronously walk each `clientReferences` search path, read files
    // from disk, check for a `"use client"` directive, and stash the
    // absolute paths.  This list is used in Phase 2 to inject async chunks.
    let discoveredClientFiles: string[] = [];

    compiler.hooks.beforeCompile.tapAsync(
      'RSCRspackPlugin',
      (_params: unknown, callback: (err?: Error | null) => void) => {
        try {
          discoveredClientFiles = this.resolveAllClientFiles(compiler.context);
          callback();
        } catch (err) {
          callback(err instanceof Error ? err : new Error(String(err)));
        }
      },
    );

    // ── Phase 2: inject discovered client files as async chunks ─────
    // At `finishMake` every entry module has been built but assets have not
    // been sealed yet. For each discovered "use client" file, we call
    // `compilation.addInclude` with an EntryDependency created via
    // `EntryPlugin.createDependency`. This causes rspack to resolve and
    // build each file as a named async chunk — the same result the webpack
    // plugin achieves by calling `module.addBlock(new AsyncDependenciesBlock(...))`.
    compiler.hooks.finishMake.tapAsync(
      'RSCRspackPlugin',
      (compilationUnknown: unknown, callback: (err?: Error | null) => void) => {
        const compilation = compilationUnknown as AnyCompilation;
        // Only inject async chunks for the CLIENT bundle (isServer: false).
        // The server bundle's entry graph already reaches all client files
        // through the component tree (it renders them for SSR). Injecting
        // there would conflict with LimitChunkCountPlugin({maxChunks:1})
        // and the literal `filename: 'server-bundle.js'`.
        if (this.options.isServer || !discoveredClientFiles.length || !compilation.addInclude || !bundler.EntryPlugin) {
          callback();
          return;
        }

        const toPath = bundler.Template?.toPath ?? ((s: string) => s.replace(/[^a-zA-Z0-9_!§$()=\-^°]+/g, '_'));
        const context = compiler.context;
        let pending = discoveredClientFiles.length;
        let errored = false;

        for (let i = 0; i < discoveredClientFiles.length; i++) {
          const file = discoveredClientFiles[i]!;
          const name = this.chunkName
            .replace(/\[index\]/g, String(i))
            .replace(/\[request\]/g, toPath(path.relative(context, file)));

          const dep = bundler.EntryPlugin.createDependency(file, { name });
          compilation.addInclude(context, dep, { name }, (err) => {
            if (err && !errored) {
              errored = true;
              callback(err);
              return;
            }
            if (--pending === 0 && !errored) callback();
          });
        }
      },
    );

    // ── Phase 3: tag set + manifest emission ────────────────────────
    compiler.hooks.thisCompilation.tap('RSCRspackPlugin', (compilationUnknown) => {
      const compilation = compilationUnknown as AnyCompilation;

      // Eagerly create the shared Set so the loader never races on init.
      if (!getTagSet(compilation)) {
        setTagSet(compilation, new Set<string>());
      }

      compilation.hooks.processAssets.tap(
        {
          name: 'RSCRspackPlugin',
          stage: bundler.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        () => {
          const taggedPaths = getTagSet(compilation) ?? new Set<string>();
          const logger = compilation.getLogger?.('RSCRspackPlugin');
          if (taggedPaths.size === 0) {
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

  // ── FS-walk discovery ───────────────────────────────────────────────
  // Mirrors the webpack plugin's `resolveAllClientFiles`. Walks each
  // `clientReferences` search path synchronously, reads file content,
  // checks for a `"use client"` directive (reusing the same detector
  // the loader uses), and returns absolute paths.
  private resolveAllClientFiles(compilerContext: string): string[] {
    const results: string[] = [];
    for (const ref of this.clientReferences) {
      const dir = path.resolve(compilerContext, ref.directory);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      this.walkDir(dir, ref, results);
    }
    return results;
  }

  private walkDir(
    dir: string,
    ref: ClientReferenceSearchPath,
    out: string[],
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules by default — the webpack plugin also doesn't
        // recurse into them unless the user explicitly configures it.
        if (entry.name === 'node_modules') continue;
        if (ref.recursive !== false) this.walkDir(full, ref, out);
      } else if (entry.isFile()) {
        if (!ref.include.test(entry.name)) continue;
        if (ref.exclude && ref.exclude.test(entry.name)) continue;
        try {
          const source = fs.readFileSync(full, 'utf-8');
          if (hasUseClientDirective(source)) out.push(full);
        } catch {
          // unreadable file — skip
        }
      }
    }
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
     * Record a tagged module in the manifest.
     *
     * `chunkSource` and `idOverride` let the caller force both the chunks
     * and the moduleId — needed for `ConcatenatedModule` inner modules,
     * which have no moduleId and do not appear in the chunk graph on
     * their own (scope hoisting folded them into their parent). Inner
     * modules must be recorded under the PARENT's moduleId AND the
     * parent's chunk set, because at runtime the parent is what actually
     * loads. This matches the webpack reference plugin's behavior: its
     * `recordModule(moduleId, ...)` is called both on the outer module
     * and, passing the same moduleId, on each inner concatenated module,
     * while walking the outer module's chunk group.
     */
    const recordModule = (
      module: AnyModule,
      chunkSource: AnyModule,
      idOverride?: string | number,
    ): void => {
      if (!module.resource || !taggedPaths.has(module.resource)) return;
      const href = url.pathToFileURL(module.resource).href;
      const id = idOverride ?? compilation.chunkGraph.getModuleId(chunkSource);
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
      for (const chunkUnknown of compilation.chunkGraph.getModuleChunks(chunkSource)) {
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
      // Record the module itself (chunks+id come from the module).
      recordModule(mod, mod);
      // Handle ConcatenatedModule (scope-hoisted). Inner modules have no
      // moduleId and are NOT in the chunk graph on their own —
      // chunkGraph.getModuleId(inner) returns null, getModuleChunks(inner)
      // returns empty. A naive recursion would silently drop every
      // concatenated client component from the manifest. Instead, pass
      // the OUTER module as the chunk/id source so the inner entry ends
      // up with the parent's id and chunks — which is what the runtime
      // actually loads, since the parent is the one in the chunk.
      if (mod.modules) {
        for (const inner of mod.modules) recordModule(inner, mod);
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
  // Both rspack and webpack export a top-level FUNCTION (the bundler
  // constructor), so we must accept 'function' as well as 'object'.
  if (!b || (typeof b !== 'object' && typeof b !== 'function')) return false;
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
