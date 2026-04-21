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

type AnyChunkGroup = {
  chunks: Iterable<unknown>;
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
    getChunkModulesIterable(chunk: unknown): Iterable<unknown>;
  };
  chunkGroups: Iterable<AnyChunkGroup>;
  outputOptions: {
    publicPath?: string;
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
  id: string | number | null;
  files: Set<string> | string[];
};

type Bundler = {
  sources: { RawSource: new (source: string, convertToString?: boolean) => unknown };
  Compilation: { PROCESS_ASSETS_STAGE_REPORT: number };
  EntryPlugin?: { createDependency(request: string, options: { name: string }): unknown };
  Template?: { toPath(str: string): string };
  WebpackError?: new (message: string) => Error;
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
  private readonly clientReferences: (string | ClientReferenceSearchPath)[];
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
    //
    // When a string is passed, the webpack plugin treats it as a DIRECT
    // file reference (unconditionally included, no "use client" check).
    // We store those separately and handle them in resolveAllClientFiles.
    if (options.clientReferences) {
      const raw = Array.isArray(options.clientReferences)
        ? options.clientReferences
        : [options.clientReferences];
      this.clientReferences = raw.map((ref) =>
        typeof ref === 'string'
          ? ref // keep as string — resolved in resolveAllClientFiles
          : ref,
      );
    } else {
      this.clientReferences = [
        { directory: '.', recursive: true, include: /\.[cm]?[jt]sx?$/ },
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
          // Only run the FS walk for client bundles. Server bundles reach
          // all client components through their entry graph; injection is
          // skipped in finishMake anyway.
          if (!this.options.isServer) {
            discoveredClientFiles = this.resolveAllClientFiles(compiler.context);
          }
          // Stash so buildManifest can filter by discovered files
          this._resolvedClientFiles = discoveredClientFiles;
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
          const manifest = this.buildManifest(compilation, taggedPaths, bundler, logger);
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
  // Mirrors the webpack plugin's `resolveAllClientFiles`. For each
  // `clientReferences` entry:
  //   - string → direct file reference (unconditionally included, matching
  //     the webpack plugin's behavior — no "use client" check)
  //   - search descriptor → walk directory, read files, check for directive
  private resolveAllClientFiles(compilerContext: string): string[] {
    const results: string[] = [];
    for (const ref of this.clientReferences) {
      if (typeof ref === 'string') {
        // String = direct file reference. The webpack plugin wraps it in
        // a ClientReferenceDependency unconditionally (line 337). We do
        // the same: include it without checking for "use client".
        const resolved = path.resolve(compilerContext, ref);
        try {
          if (fs.statSync(resolved).isFile()) results.push(resolved);
        } catch { /* not found — skip */ }
        continue;
      }
      const dir = path.resolve(compilerContext, ref.directory);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
      } catch { continue; }
      this.walkDir(dir, dir, ref, results);
    }
    return results;
  }

  private walkDir(
    dir: string,
    walkRoot: string,
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
      // Use fs.statSync to follow symlinks (Dirent.isFile/isDirectory
      // return false for symlinks). This matches the webpack plugin's
      // behavior which resolves symlinks via the normal resolver.
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }

      if (stat.isDirectory()) {
        if (ref.recursive !== false) this.walkDir(full, walkRoot, ref, out);
      } else if (stat.isFile()) {
        // Test include/exclude against the RELATIVE path from the walk
        // root (e.g. "./components/Button.tsx"), matching the webpack
        // plugin's contextModuleFactory behavior which tests against the
        // relative request path.
        const relPath = './' + path.relative(walkRoot, full);
        if (!ref.include.test(relPath)) continue;
        if (ref.exclude && ref.exclude.test(relPath)) continue;
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
   * Iterates `compilation.chunkGroups` (matching the webpack plugin's
   * pattern) so the `chunks` array for each module reflects ALL chunks
   * in the chunk group — not just the ones directly containing the
   * module. This matters for split-chunk configurations where sibling
   * chunks must be preloaded together.
   */
  private buildManifest(
    compilation: AnyCompilation,
    taggedPaths: Set<string>,
    bundler: Bundler,
    logger?: AnyLogger,
  ): {
    moduleLoading: { prefix: string; crossOrigin: string | null };
    filePathToModuleMetadata: Record<string, { id: string | number | null; chunks: (string | number | null)[]; name: string }>;
  } {
    // Check if the client runtime module was found in this compilation.
    // The webpack plugin emits a warning and skips manifest emission if
    // the runtime is missing (likely a misconfiguration).
    const clientFileNameOnClient = path.resolve(__dirname, '../react-server-dom-webpack/client.browser.js');
    const clientFileNameOnServer = path.resolve(__dirname, '../react-server-dom-webpack/client.node.js');
    const expectedRuntime = this.options.isServer ? clientFileNameOnServer : clientFileNameOnClient;
    let clientFileNameFound = false;

    const resolvedClientFiles = new Set(
      (this._resolvedClientFiles ?? []).map((f: string) => f),
    );

    const filePathToModuleMetadata: Record<
      string,
      { id: string | number | null; chunks: (string | number | null)[]; name: string }
    > = {};

    // Iterate chunkGroups → chunks → modules, matching the webpack
    // plugin's pattern (lines 241-291). For each chunk group, we first
    // build the full `chunks` array (all chunks in the group), then
    // record each module with that array. This ensures sibling chunks
    // from split-chunk configs are included in the preload hints.
    for (const chunkGroup of compilation.chunkGroups) {
      const chunks: (string | number | null)[] = [];
      for (const chunkUnknown of chunkGroup.chunks) {
        const c = chunkUnknown as AnyChunk;
        const files = c.files instanceof Set ? c.files : new Set(c.files);
        for (const file of files) {
          // Match webpack exactly: if the first file is NOT .js, break
          // (skip the chunk). If it's .hot-update.js, break. Otherwise
          // record and break.
          if (!file.endsWith('.js')) break;
          if (file.endsWith('.hot-update.js')) break;
          chunks.push(c.id, file);
          break;
        }
      }

      for (const chunkUnknown of chunkGroup.chunks) {
        const chunk = chunkUnknown as AnyChunk;
        for (const m of compilation.chunkGraph.getChunkModulesIterable(chunk)) {
          const mod = m as AnyModule;

          // Check if this is the client runtime module
          if (mod.resource === expectedRuntime) clientFileNameFound = true;

          const moduleId = compilation.chunkGraph.getModuleId(mod);
          this.recordModule(mod, moduleId, chunks, taggedPaths, resolvedClientFiles, filePathToModuleMetadata);
          // ConcatenatedModule: inner modules use the outer's moduleId
          if (mod.modules) {
            for (const inner of mod.modules) {
              if (inner.resource === expectedRuntime) clientFileNameFound = true;
              this.recordModule(inner, moduleId, chunks, taggedPaths, resolvedClientFiles, filePathToModuleMetadata);
            }
          }
        }
      }
    }

    // Warn if the client runtime was not found (matches webpack plugin
    // lines 206-213). Without the runtime, the manifest is useless.
    if (!clientFileNameFound) {
      const warning = bundler.WebpackError
        ? new bundler.WebpackError(
            `Client runtime at react-on-rails-rsc/client was not found. ` +
              `React Server Components module map file ${this.options.clientManifestFilename ?? '(default)'} was not created.`,
          )
        : new Error(
            `Client runtime at react-on-rails-rsc/client was not found.`,
          );
      compilation.warnings.push(warning);
    }

    const crossOriginRaw = compilation.outputOptions.crossOriginLoading;
    const crossOrigin =
      typeof crossOriginRaw === 'string'
        ? crossOriginRaw === 'use-credentials'
          ? crossOriginRaw
          : 'anonymous'
        : null;

    return {
      moduleLoading: {
        prefix: compilation.outputOptions.publicPath || '',
        crossOrigin,
      },
      filePathToModuleMetadata,
    };
  }

  /** Stash resolved client files so buildManifest can filter by them. */
  private _resolvedClientFiles: string[] = [];

  /**
   * Record a single module in the manifest if it's a tagged client file.
   * `moduleId` and `chunks` come from the enclosing context (the chunk
   * group walk or the outer ConcatenatedModule).
   */
  private recordModule(
    module: AnyModule,
    moduleId: string | number | null,
    chunks: (string | number | null)[],
    taggedPaths: Set<string>,
    resolvedClientFiles: Set<string>,
    filePathToModuleMetadata: Record<string, { id: string | number | null; chunks: (string | number | null)[]; name: string }>,
  ): void {
    if (!module.resource) return;
    if (!resolvedClientFiles.has(module.resource) && !taggedPaths.has(module.resource)) return;
    if (moduleId === null || moduleId === undefined) return;

    const href = url.pathToFileURL(module.resource).href;
    if (filePathToModuleMetadata[href]) {
      // Collision — merge chunks without duplicates (same as webpack)
      const existing = filePathToModuleMetadata[href];
      const seen = new Set<string | number>();
      for (let i = 0; i < existing.chunks.length; i += 2) seen.add(existing.chunks[i]!);
      for (let i = 0; i < chunks.length; i += 2) {
        if (!seen.has(chunks[i]!)) existing.chunks.push(chunks[i]!, chunks[i + 1]!);
      }
    } else {
      filePathToModuleMetadata[href] = {
        id: moduleId,
        chunks: chunks.slice(),
        name: '*',
      };
    }
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
