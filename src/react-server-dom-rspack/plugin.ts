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
 * Symbol. A second loader prepends dynamic imports to the Flight client
 * runtime so file-system-discovered client references become async chunk
 * groups. At `processAssets`, the plugin walks chunk groups and emits the
 * React on Rails client-manifest JSON schema.
 *
 * Output schema matches RoR's existing webpack-side plugin so
 * `buildServerRenderer` / `buildClientRenderer` in server.node.ts /
 * client.node.ts work without changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import { CLIENT_MODULES_KEY, hasUseClientDirective } from './shared';
import type {} from './injection-loader';

function setInjectionState(files: string[], chunkName: string): void {
  const injLoader = require('./injection-loader') as { _discoveredClientFiles: string[]; _chunkName: string };
  injLoader._discoveredClientFiles = files;
  injLoader._chunkName = chunkName;
}

function getGeneratedChunkNames(): Set<string> {
  const injLoader = require('./injection-loader') as { _generatedChunkNames: Set<string> };
  return injLoader._generatedChunkNames;
}

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
    thisCompilation: { tap: (name: string, fn: (compilation: unknown) => void) => void };
  };
  rspack?: { version?: string };
  webpack?: { version?: string };
  inputFileSystem?: { readFileSync?(p: string, enc: string): string };
  resolverFactory?: { get(type: string, options?: unknown): unknown };
  getInfrastructureLogger?(name: string): AnyLogger;
};

type AnyChunkGroup = {
  name?: string;
  chunks: Iterable<unknown>;
};

type AnyEntrypoint = {
  chunks?: Iterable<unknown>;
  getChunks?: () => Iterable<unknown>;
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
  entrypoints?: ReadonlyMap<string, AnyEntrypoint>;
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
  id: string | number | null;
  files: Set<string> | string[];
  canBeInitial?: () => boolean;
};

type Bundler = {
  sources: { RawSource: new (source: string, convertToString?: boolean) => unknown };
  Compilation: { PROCESS_ASSETS_STAGE_REPORT: number };
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
   * through the Flight runtime injection loader. This ensures the client/SSR
   * bundle includes every client component even if nothing in the entry graph
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
  exclude: /node_modules/,
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
          discoveredClientFiles = this.resolveAllClientFiles(compiler.context);
          this._resolvedClientFiles = discoveredClientFiles;
          setInjectionState(discoveredClientFiles, this.chunkName);
          callback();
        } catch (err) {
          callback(err instanceof Error ? err : new Error(String(err)));
        }
      },
    );

    // ── Phase 2: inject discovered client files as async chunks ─────
    // A loader on the Flight client runtime module (client.browser.js or
    // client.node.js) prepends dynamic import() statements for every
    // discovered "use client" file. This replicates what the webpack RSC
    // plugin does with AsyncDependenciesBlock: each import() creates an
    // async chunk group attached to the runtime module. rspack does not
    // expose a constructible AsyncDependenciesBlock from JS, so dynamic
    // imports are the only way to create proper async chunks.
    //
    // The loader runs for BOTH client and server bundles (matching the
    // webpack plugin which attaches AsyncDependenciesBlock to both
    // client.browser.js and client.node.js). On the server, the async
    // chunks are merged back into server-bundle.js by
    // LimitChunkCountPlugin, giving every module a proper numeric ID.
    {
      const clientRuntimePath = path.resolve(
        __dirname,
        this.options.isServer
          ? '../react-server-dom-webpack/client.node.js'
          : '../react-server-dom-webpack/client.browser.js',
      );

      const moduleConfig = (compiler.options.module ??= {}) as { rules?: unknown[] };
      const rules = (moduleConfig.rules ??= []) as unknown[];
      const injectionLoaderPath = path.resolve(__dirname, './injection-loader.js');
      const runtimeTest = exactResourceRegexp(clientRuntimePath);

      if (!this.hasLoaderRule(rules, injectionLoaderPath, runtimeTest)) {
        rules.push({
          test: runtimeTest,
          enforce: 'pre' as const,
          use: [{ loader: injectionLoaderPath }],
        });
      }

      // Prevent splitChunks from extracting modules out of the async
      // chunks created by the injection-loader. The RSC streaming HTML
      // injects <script async> tags for each chunk in the client manifest.
      // If splitChunks extracts shared modules into sibling chunks, those
      // siblings race with hydration — React calls requireModule
      // synchronously, and the sibling may not have loaded yet. Keeping
      // each client component's async chunk self-contained matches
      // webpack's AsyncDependenciesBlock behavior where splitChunks does
      // not extract from block-created async chunks.
      if (!this.options.isServer) {
        type SplitChunksConfig = { chunks?: unknown };
        const optimization = (compiler.options as { optimization?: { splitChunks?: SplitChunksConfig } }).optimization;
        const splitChunks = optimization?.splitChunks;
        if (splitChunks) {
          const origChunks = splitChunks.chunks ?? 'async';
          splitChunks.chunks = (chunk: { name?: string }) => {
            if (chunk.name != null && getGeneratedChunkNames().has(chunk.name)) return false;
            if (typeof origChunks === 'function') return origChunks(chunk);
            // Rspack/Webpack chunks expose canBeInitial(); keep the historical
            // fallback for non-standard chunk shapes explicit.
            const canBeInitial = (chunk as { canBeInitial?: () => boolean }).canBeInitial?.();
            if (origChunks === 'initial') return !!canBeInitial;
            if (origChunks === 'async') return !canBeInitial;
            return true; // origChunks === 'all': include every non-generated chunk.
          };
        }
      }
    }

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
          const resolvedClientCount = this._resolvedClientFiles.length;
          const logger = compilation.getLogger?.('RSCRspackPlugin');
          if (resolvedClientCount === 0) {
            logger?.info(
              'No RSC client references resolved; emitting empty manifest. ' +
                'If this is unexpected, check the RSCRspackPlugin clientReferences option.',
            );
          } else {
            logger?.debug(`Resolved ${resolvedClientCount} RSC client reference(s)`);
          }
          const manifest = this.buildManifest(compilation, bundler);
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
    const results = new Set<string>();
    for (const ref of this.clientReferences) {
      if (typeof ref === 'string') {
        // String = direct file reference. The webpack plugin wraps it in
        // a ClientReferenceDependency unconditionally (line 337). We do
        // the same: include it without checking for "use client".
        const resolved = path.resolve(compilerContext, ref);
        try {
          if (fs.statSync(resolved).isFile()) this.addResolvedClientFile(results, resolved);
        } catch { /* not found — skip */ }
        continue;
      }
      const dir = path.resolve(compilerContext, ref.directory);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
      } catch { continue; }
      this.walkDir(dir, dir, ref, results);
    }
    return [...results];
  }

  private walkDir(
    dir: string,
    walkRoot: string,
    ref: ClientReferenceSearchPath,
    out: Set<string>,
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
          if (hasUseClientDirective(source)) this.addResolvedClientFile(out, full);
        } catch {
          // unreadable file — skip
        }
      }
    }
  }

  private addResolvedClientFile(out: Set<string>, filePath: string): void {
    out.add(this.normalizeResourcePath(filePath));
  }

  private normalizeResourcePath(filePath: string): string {
    try {
      return fs.realpathSync.native(filePath);
    } catch {
      return filePath;
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
    const alreadyInjected = this.hasLoaderRule(rules, ourLoaderPath);
    if (!alreadyInjected) rules.unshift(RSC_LOADER_RULE);
  }

  private hasLoaderRule(rules: unknown[], loaderPath: string, test?: RegExp): boolean {
    return rules.some((r) => {
      if (!r || typeof r !== 'object') return false;
      const rule = r as { use?: unknown; test?: unknown };
      if (!Array.isArray(rule.use)) return false;
      const hasLoader = rule.use.some((u) => {
        if (typeof u === 'string') return u === loaderPath;
        if (u && typeof u === 'object') return (u as { loader?: string }).loader === loaderPath;
        return false;
      });
      if (!hasLoader || !test) return hasLoader;
      return (
        rule.test instanceof RegExp &&
        rule.test.source === test.source &&
        rule.test.flags === test.flags
      );
    });
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
    bundler: Bundler,
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

    const resolvedClientFiles = new Set(this._resolvedClientFiles ?? []);
    const initialChunks = this.getInitialChunks(compilation);

    const filePathToModuleMetadata: Record<
      string,
      { id: string | number | null; chunks: (string | number | null)[]; name: string }
    > = {};

    // Walk chunk groups using group-level chunks (matching the webpack
    // plugin, lines 241-294). Each module gets the full list of sibling
    // chunks in its group — this ensures splitChunks dependencies are
    // included.
    for (const chunkGroup of compilation.chunkGroups) {
      const groupChunks = this.getGroupChunks(chunkGroup, initialChunks);

      for (const chunkUnknown of chunkGroup.chunks) {
        const chunk = chunkUnknown as AnyChunk;
        for (const m of compilation.chunkGraph.getChunkModulesIterable(chunk)) {
          const mod = m as AnyModule;

          if (mod.resource === expectedRuntime) clientFileNameFound = true;

          const moduleId = compilation.chunkGraph.getModuleId(mod);
          this.recordModule(mod, moduleId, groupChunks, resolvedClientFiles, filePathToModuleMetadata);
          if (mod.modules) {
            for (const inner of mod.modules) {
              if (inner.resource === expectedRuntime) clientFileNameFound = true;
              this.recordModule(inner, moduleId, groupChunks, resolvedClientFiles, filePathToModuleMetadata);
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

  /** Build the chunks array from all async-loadable chunks in a chunk group. */
  private getGroupChunks(
    chunkGroup: AnyChunkGroup,
    initialChunks: Set<unknown>,
  ): (string | number | null)[] {
    const chunks: (string | number | null)[] = [];
    for (const chunkUnknown of chunkGroup.chunks) {
      const c = chunkUnknown as AnyChunk;
      if (this.isInitialChunk(c, initialChunks)) continue;
      const files = c.files instanceof Set ? c.files : new Set(c.files);
      for (const file of files) {
        if (!file.endsWith('.js')) continue;
        if (file.endsWith('.hot-update.js')) continue;
        chunks.push(c.id, file);
        break;
      }
    }
    return chunks;
  }

  private getInitialChunks(compilation: AnyCompilation): Set<unknown> {
    const initialChunks = new Set<unknown>();
    for (const entrypoint of compilation.entrypoints?.values() ?? []) {
      const chunks =
        typeof entrypoint.getChunks === 'function'
          ? entrypoint.getChunks()
          : entrypoint.chunks;
      if (!chunks) continue;
      for (const chunk of chunks) initialChunks.add(chunk);
    }
    return initialChunks;
  }

  private isInitialChunk(chunk: AnyChunk, initialChunks: Set<unknown>): boolean {
    if (typeof chunk.canBeInitial === 'function') return chunk.canBeInitial();
    return initialChunks.has(chunk);
  }

  /**
   * Record a single module in the manifest if it is a resolved client reference.
   * `moduleId` and `chunks` come from the enclosing context (the chunk
   * group walk or the outer ConcatenatedModule).
   */
  private recordModule(
    module: AnyModule,
    moduleId: string | number | null,
    chunks: (string | number | null)[],
    resolvedClientFiles: Set<string>,
    filePathToModuleMetadata: Record<string, { id: string | number | null; chunks: (string | number | null)[]; name: string }>,
  ): void {
    if (!module.resource) return;
    if (!resolvedClientFiles.has(module.resource)) return;
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

function exactResourceRegexp(resourcePath: string): RegExp {
  // Escape all regex metacharacters so an absolute file path is matched literally.
  return new RegExp(`^${resourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}
