/**
 * RSCRspackPlugin — rspack-native equivalent of RSCWebpackPlugin.
 *
 * Emits React on Rails' existing client-manifest JSON schema using only
 * standard rspack public APIs — no dependency on rspack's experimental RSC
 * system (`rspackExperiments.reactServerComponents`, `experiments.rsc`,
 * `react-server-dom-rspack`).
 *
 * Discovery technique: the plugin walks configured client-reference paths
 * before compilation and finds files with a `"use client"` directive. A loader
 * then prepends dynamic imports to the Flight client runtime so those
 * file-system-discovered references become async chunk groups. At
 * `processAssets`, the plugin walks chunk groups and emits the React on Rails
 * client-manifest JSON schema.
 *
 * Output schema matches RoR's existing webpack-side plugin so
 * `buildServerRenderer` / `buildClientRenderer` in server.node.ts /
 * client.node.ts work without changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import {
  DEFAULT_CLIENT_REFERENCES_EXCLUDE,
  DEFAULT_CLIENT_REFERENCES_INCLUDE,
} from '../clientReferences';
import {
  getGeneratedChunkNamesForCompiler,
  setInjectionStateForCompiler,
} from './injection-loader';
import { getGeneratedChunkName, hasUseClientDirective } from './shared';

const STYLE_SOURCE_RE = /\.(css|scss|sass|less|styl|pcss)$/i;

// Accept any bundler that looks compatible — webpack 5 or rspack. Typed loose
// because we cannot depend on `@rspack/core` types without making it a hard
// peer dep of a package that should stay webpack-centric.
type AnyLogger = {
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

type TapName = string | { name: string; stage?: number };

type AnyCompiler = {
  options: {
    module?: { rules?: unknown[] };
    optimization?: { splitChunks?: { chunks?: unknown } | false };
    context?: string;
  };
  context: string;
  hooks: {
    beforeCompile: { tapAsync: (name: string, fn: (params: unknown, cb: (err?: Error | null) => void) => void) => void };
    environment?: { tap: (name: TapName, fn: () => void) => void };
    afterEnvironment?: {
      tap: (name: TapName, fn: () => void) => void;
    };
    thisCompilation: {
      tap: (name: TapName, fn: (compilation: unknown) => void) => void;
    };
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
  getRuntimeChunk?: () => { files: Iterable<string> } | null;
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
  moduleGraph?: {
    getOutgoingConnections?: (module: unknown) => Iterable<{
      module?: AnyModule | null;
      resolvedModule?: AnyModule | null;
    }>;
  };
  chunkGroups: Iterable<AnyChunkGroup>;
  outputOptions: {
    publicPath?: string | ((...args: unknown[]) => string);
    crossOriginLoading?: false | 'anonymous' | 'use-credentials';
  };
  entrypoints?: ReadonlyMap<string, AnyEntrypoint>;
  emitAsset(filename: string, source: unknown): void;
  assets?: Record<string, AssetSource>;
  getAsset?: (filename: string) => { source?: AssetSource } | undefined;
  warnings: unknown[];
  compiler: AnyCompiler;
  fileDependencies?: WatchDependencySet;
  contextDependencies?: WatchDependencySet;
  missingDependencies?: WatchDependencySet;
  getLogger?(name: string): AnyLogger;
};

type AssetSource = {
  size?: () => number;
  source?: () => string | Buffer;
};

type WatchDependencySet = {
  add(dependency: string): unknown;
};

type ClientReferenceWatchDependencies = {
  files: Set<string>;
  contexts: Set<string>;
  missing: Set<string>;
};

function createClientReferenceWatchDependencies(): ClientReferenceWatchDependencies {
  return {
    files: new Set<string>(),
    contexts: new Set<string>(),
    missing: new Set<string>(),
  };
}

function addClientReferenceWatchDependencies(
  compilation: AnyCompilation,
  dependencies: ClientReferenceWatchDependencies,
): void {
  for (const file of dependencies.files) {
    compilation.fileDependencies?.add(file);
  }
  for (const context of dependencies.contexts) {
    compilation.contextDependencies?.add(context);
  }
  for (const missing of dependencies.missing) {
    compilation.missingDependencies?.add(missing);
  }
}

type AnyModule = {
  resource?: string;
  modules?: AnyModule[]; // for ConcatenatedModule
  type?: string;
};

type AnyChunk = {
  id: string | number | null;
  files: Set<string> | string[];
  canBeInitial?: () => boolean;
};

type ModuleMetadata = {
  id: string | number | null;
  chunks: (string | number | null)[];
  css?: string[];
  name: string;
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
   * Default: scan the compiler context for JS/TS files while excluding
   * dependency and generated asset directories such as `node_modules`,
   * `vendor/bundle`, and `vendor/cache`.
   */
  clientReferences?: ClientReferencePath | ReadonlyArray<ClientReferencePath>;
  /**
   * Template for naming async chunks created for each client reference.
   * Supports `[index]` (sequential number) and `[request]` (sanitised
   * file path). Default: `"client[index]"`.
   */
  chunkName?: string;
  /**
   * Optional diagnostics asset that lists client references, their emitted
   * chunk files, and known emitted asset byte sizes. Disabled by default.
   */
  clientReferenceDiagnosticsFilename?: string | false;
}

// Legacy rule export kept for consumers that imported the historical symbol.
// RSCRspackPlugin no longer injects this rule; the loader it references is a
// no-op compatibility pass-through and does not disable rspack caching.
export const RSC_LOADER_RULE = {
  test: /\.[cm]?[jt]sx?$/,
  exclude: /node_modules/,
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
    // Default: scan the context directory for JS/TS files, but skip dependency
    // and generated asset directories that can contain Rails gem templates.
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
        {
          directory: '.',
          recursive: true,
          include: DEFAULT_CLIENT_REFERENCES_INCLUDE,
          exclude: DEFAULT_CLIENT_REFERENCES_EXCLUDE,
        },
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

    // ── Phase 1: FS-walk discovery (before compilation starts) ──────
    // Mirrors the webpack plugin's `beforeCompile` / `resolveAllClientFiles`.
    // We synchronously walk each `clientReferences` search path, read files
    // from disk, check for a `"use client"` directive, and stash the
    // absolute paths.  This list is used in Phase 2 to inject async chunks.
    let discoveredClientFiles: string[] = [];
    let clientReferenceWatchDependencies = createClientReferenceWatchDependencies();

    compiler.hooks.beforeCompile.tapAsync(
      'RSCRspackPlugin',
      (_params: unknown, callback: (err?: Error | null) => void) => {
        try {
          const nextWatchDependencies = createClientReferenceWatchDependencies();
          discoveredClientFiles = this.resolveAllClientFiles(
            compiler.context,
            nextWatchDependencies,
          );
          clientReferenceWatchDependencies = nextWatchDependencies;
          this._resolvedClientFiles = discoveredClientFiles;
          setInjectionStateForCompiler(compiler, discoveredClientFiles, this.chunkName);
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
      const moduleConfig = (compiler.options.module ??= {}) as { rules?: unknown[] };
      const rules = (moduleConfig.rules ??= []) as unknown[];
      const injectionLoaderPath = path.resolve(__dirname, './injection-loader.js');
      const isServer = this.options.isServer;

      // Match the runtime module with the robust `isRuntimeResource` matcher
      // rather than the plugin's own resolved path. In a duplicate-install
      // topology the bundle's runtime module lives at a DIFFERENT path than
      // `require.resolve` returns; a strict-path `test` would never match it,
      // so the injection loader would never prepend the import() statements
      // for filesystem-discovered "use client" files and the manifest would
      // stay incomplete (#105). This mirrors the webpack plugin, which keys
      // injection on the same matcher (RSCWebpackPlugin's
      // `isReactOnRailsRSCRuntimeResource`). A function `test` is supported by
      // rspack/webpack and `isRuntimeResource` is memoized + suffix-guarded so
      // the per-module cost is negligible.
      //
      // One compiler builds one bundle (client OR server), so deduping on the
      // loader path alone is sufficient.
      if (!this.hasLoaderRule(rules, injectionLoaderPath)) {
        rules.push({
          test: (resource: string) => isRuntimeResource(resource, isServer),
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
        const guardedSplitChunks = new WeakMap<{ chunks?: unknown }, unknown>();
        const installSplitChunksGuard = () => {
          const splitChunks = compiler.options.optimization?.splitChunks;
          if (!splitChunks) return;
          if (
            guardedSplitChunks.has(splitChunks) &&
            guardedSplitChunks.get(splitChunks) === splitChunks.chunks
          ) {
            return;
          }

          const origChunks = splitChunks.chunks ?? 'async';
          const guardedChunks = (chunk: { name?: string }) => {
            if (chunk.name != null && getGeneratedChunkNamesForCompiler(compiler).has(chunk.name)) {
              return false;
            }
            if (typeof origChunks === 'function') return origChunks(chunk);
            // Rspack/Webpack chunks expose canBeInitial(); keep the historical
            // fallback for non-standard chunk shapes explicit.
            const canBeInitial = (chunk as { canBeInitial?: () => boolean }).canBeInitial?.();
            if (origChunks === 'initial') return !!canBeInitial;
            if (origChunks === 'async') return !canBeInitial;
            return true; // origChunks === 'all': include every non-generated chunk.
          };
          guardedSplitChunks.set(splitChunks, guardedChunks);
          splitChunks.chunks = guardedChunks;
        };

        // Rspack attaches optimization defaults after user plugin apply() and
        // before RspackOptionsApply constructs the native SplitChunksPlugin.
        // Install late in those pre-options hooks so SplitChunksPlugin snapshots
        // the guarded selector, and reinstall if an earlier hook overwrote it.
        const splitChunksGuardTap = {
          name: 'RSCRspackPlugin.splitChunksGuard',
          stage: Number.MAX_SAFE_INTEGER,
        };
        if (compiler.hooks.environment) {
          compiler.hooks.environment.tap(splitChunksGuardTap, installSplitChunksGuard);
        }
        if (compiler.hooks.afterEnvironment) {
          compiler.hooks.afterEnvironment.tap(splitChunksGuardTap, installSplitChunksGuard);
        }
      }
    }

    // ── Phase 3: manifest emission ──────────────────────────────────
    compiler.hooks.thisCompilation.tap('RSCRspackPlugin', (compilationUnknown) => {
      const compilation = compilationUnknown as AnyCompilation;
      addClientReferenceWatchDependencies(compilation, clientReferenceWatchDependencies);

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
          const diagnosticsCssFiles = new Map<string, string[]>();
          const manifest = this.buildManifest(compilation, bundler, diagnosticsCssFiles);
          logger?.debug(
            `Emitting ${manifestFilename} with ` +
              `${Object.keys(manifest.filePathToModuleMetadata).length} entries`,
          );
          if (typeof this.options.clientReferenceDiagnosticsFilename === 'string') {
            const diagnostics = this.buildDiagnostics(
              compilation,
              manifest,
              manifestFilename,
              diagnosticsCssFiles,
            );
            compilation.emitAsset(
              this.options.clientReferenceDiagnosticsFilename,
              new bundler.sources.RawSource(`${JSON.stringify(diagnostics, null, 2)}\n`, false),
            );
          }
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
  private resolveAllClientFiles(
    compilerContext: string,
    watchDependencies: ClientReferenceWatchDependencies,
  ): string[] {
    const results = new Set<string>();
    for (const ref of this.clientReferences) {
      if (typeof ref === 'string') {
        // String = direct file reference. The webpack plugin wraps it in
        // a ClientReferenceDependency unconditionally (line 337). We do
        // the same: include it without checking for "use client".
        const resolved = path.resolve(compilerContext, ref);
        watchDependencies.files.add(resolved);
        try {
          if (fs.statSync(resolved).isFile()) this.addResolvedClientFile(results, resolved);
        } catch {
          watchDependencies.missing.add(resolved);
        }
        continue;
      }
      const dir = path.resolve(compilerContext, ref.directory);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
      } catch {
        watchDependencies.missing.add(dir);
        continue;
      }
      watchDependencies.contexts.add(dir);
      this.walkDir(dir, dir, ref, results, watchDependencies);
    }
    return [...results];
  }

  private walkDir(
    dir: string,
    walkRoot: string,
    ref: ClientReferenceSearchPath,
    out: Set<string>,
    watchDependencies = createClientReferenceWatchDependencies(),
  ): void {
    watchDependencies.contexts.add(dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      watchDependencies.missing.add(dir);
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
        const relPath = './' + path.relative(walkRoot, full).replace(/\\/g, '/');
        if (ref.exclude && ref.exclude.test(relPath)) continue;
        if (ref.recursive !== false) this.walkDir(full, walkRoot, ref, out, watchDependencies);
      } else if (stat.isFile()) {
        // Test include/exclude against the RELATIVE path from the walk
        // root (e.g. "./components/Button.tsx"), matching the webpack
        // plugin's contextModuleFactory behavior which tests against the
        // relative request path.
        const relPath = './' + path.relative(walkRoot, full).replace(/\\/g, '/');
        if (!ref.include.test(relPath)) continue;
        if (ref.exclude && ref.exclude.test(relPath)) continue;
        watchDependencies.files.add(full);
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
   * Build the RoR-shape manifest from filesystem-discovered client references.
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
    diagnosticsCssFiles: Map<string, string[]>,
  ): {
    moduleLoading: { prefix: string; crossOrigin: string | null };
    filePathToModuleMetadata: Record<string, ModuleMetadata>;
  } {
    // Check if the client runtime module was found in this compilation.
    // The webpack plugin emits a warning and skips manifest emission if
    // the runtime is missing (likely a misconfiguration).
    //
    // The runtime is recognized by `isRuntimeResource` rather than strict
    // path equality so a duplicate `react-server-dom-webpack` install — a
    // second copy in the app's node_modules, a pnpm/yarn symlink store, or a
    // hoisted-vs-nested layout — still counts as the runtime (#105). This
    // mirrors the webpack plugin's `isReactOnRailsRSCRuntimeResource` (#43).
    let clientFileNameFound = false;

    const resolvedClientFiles = new Set(this._resolvedClientFiles ?? []);
    const generatedChunkNamesByResource = this.getGeneratedChunkNamesByResource();
    const runtimeChunkFiles = this.getRuntimeChunkFiles(compilation);

    const filePathToModuleMetadata: Record<string, ModuleMetadata> = {};
    const isResolvedClientReference = (resource: string | undefined): resource is string =>
      !!resource && resolvedClientFiles.has(resource);
    const configuredPublicPath = compilation.outputOptions.publicPath;
    const publicPathIsAuto = configuredPublicPath === 'auto';
    const publicPathIsDynamic = publicPathIsAuto || typeof configuredPublicPath === 'function';
    if (publicPathIsDynamic) {
      const publicPathDescription = publicPathIsAuto
        ? "output.publicPath is 'auto'"
        : 'output.publicPath is a function';
      const warning = bundler.WebpackError
        ? new bundler.WebpackError(
            `React Server Components: ${publicPathDescription}, which cannot be serialized into the RSC manifest. ` +
              'moduleLoading.prefix will be emitted as an empty string, and CSS files are omitted from the RSC manifest because their final URLs are only known at runtime. ' +
              'Set output.publicPath to a concrete URL or path to enable Flight chunk loading and stylesheet hints.',
          )
        : new Error(
            `React Server Components: ${publicPathDescription}, which cannot be serialized into the RSC manifest.`,
          );
      compilation.warnings.push(warning);
    }
    let cssPrefix =
      typeof configuredPublicPath === 'string' && !publicPathIsAuto
        ? configuredPublicPath
        : null;
    if (cssPrefix && !cssPrefix.endsWith('/')) {
      cssPrefix += '/';
    }

    // Walk chunk groups using group-level chunks (matching the webpack
    // plugin, lines 241-294). Each module gets the full list of sibling
    // chunks in its group — this ensures splitChunks dependencies are
    // included.
    for (const chunkGroup of compilation.chunkGroups) {
      const groupChunkList = [...chunkGroup.chunks].map((chunk) => chunk as AnyChunk);
      const normalizedChunkGroup = { name: chunkGroup.name, chunks: groupChunkList };
      const groupAssets = this.getGroupAssets(
        normalizedChunkGroup,
        runtimeChunkFiles,
        cssPrefix,
      );
      const groupChunks = new Set<AnyChunk>(groupChunkList);
      const getOutgoingConnections =
        compilation.moduleGraph?.getOutgoingConnections?.bind(compilation.moduleGraph);

      const directCssDepFiles = (module: AnyModule): string[] => {
        if (!getOutgoingConnections || cssPrefix === null) return [];
        const files = new Set<string>();
        const addCssFromModuleChunks = (cssModule: AnyModule): void => {
          for (const cssChunkUnknown of compilation.chunkGraph.getModuleChunks(cssModule)) {
            const cssChunk = cssChunkUnknown as AnyChunk;
            if (!groupChunks.has(cssChunk)) continue;
            for (const cssFile of this.getChunkCss(cssChunk, runtimeChunkFiles, cssPrefix)) {
              files.add(cssFile);
            }
          }
        };

        for (const connection of getOutgoingConnections(module)) {
          const depModule = connection.module ?? connection.resolvedModule;
          if (!depModule?.resource) continue;
          const depResource = depModule.resource.replace(/[?#].*$/, '');
          if (!STYLE_SOURCE_RE.test(depResource)) continue;
          addCssFromModuleChunks(depModule);
          for (const cssConnection of getOutgoingConnections(depModule)) {
            const extractedCssModule = cssConnection.module ?? cssConnection.resolvedModule;
            if (!extractedCssModule || extractedCssModule.type !== 'css/mini-extract') continue;
            addCssFromModuleChunks(extractedCssModule);
          }
        }

        return [...files];
      };

      const mergeDirectCss = (chunkCss: string[], module: AnyModule): string[] => {
        const siblingCss = directCssDepFiles(module);
        return siblingCss.length > 0 ? [...new Set([...chunkCss, ...siblingCss])] : chunkCss;
      };

      for (const chunk of groupChunkList) {
        const chunkCss = this.getChunkCss(chunk, runtimeChunkFiles, cssPrefix);
        for (const m of compilation.chunkGraph.getChunkModulesIterable(chunk)) {
          const mod = m as AnyModule;

          if (isRuntimeResource(mod.resource, this.options.isServer)) clientFileNameFound = true;

          const moduleId = compilation.chunkGraph.getModuleId(mod);
          if (isResolvedClientReference(mod.resource)) {
            const moduleCss = this.getCssForModule(
              mod.resource,
              normalizedChunkGroup,
              mergeDirectCss(chunkCss, mod),
              generatedChunkNamesByResource,
            );
            this.recordModule(
              mod,
              moduleId,
              groupAssets.chunks,
              moduleCss,
              resolvedClientFiles,
              filePathToModuleMetadata,
              diagnosticsCssFiles,
            );
          }
          if (mod.modules) {
            for (const inner of mod.modules) {
              if (isRuntimeResource(inner.resource, this.options.isServer)) clientFileNameFound = true;
              if (!isResolvedClientReference(inner.resource)) continue;
              const moduleCss = this.getCssForModule(
                inner.resource,
                normalizedChunkGroup,
                mergeDirectCss(chunkCss, inner),
                generatedChunkNamesByResource,
              );
              this.recordModule(
                inner,
                moduleId,
                groupAssets.chunks,
                moduleCss,
                resolvedClientFiles,
                filePathToModuleMetadata,
                diagnosticsCssFiles,
              );
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
        prefix: publicPathIsAuto
          ? ''
          : typeof configuredPublicPath === 'string'
            ? configuredPublicPath
            : '',
        crossOrigin,
      },
      filePathToModuleMetadata,
    };
  }

  private buildDiagnostics(
    compilation: AnyCompilation,
    manifest: {
      moduleLoading: { prefix: string; crossOrigin: string | null };
      filePathToModuleMetadata: Record<string, ModuleMetadata>;
    },
    manifestFilename: string,
    diagnosticsCssFiles: ReadonlyMap<string, string[]>,
  ): {
    version: 1;
    manifestFilename: string;
    isServer: boolean;
    clientReferenceCount: number;
    totalChunkBytes: number;
    clientReferences: Array<{
      file: string;
      id: string | number | null;
      name: string;
      totalBytes: number;
      chunks: Array<{ id: string | number | null; file: string; bytes: number | null }>;
      css?: Array<{ file: string; bytes: number | null }>;
    }>;
  } {
    const clientReferences = Object.entries(manifest.filePathToModuleMetadata)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([file, metadata]) => {
        const chunks = [];
        for (let i = 0; i < metadata.chunks.length; i += 2) {
          const chunkFile = String(metadata.chunks[i + 1]);
          chunks.push({
            id: metadata.chunks[i] ?? null,
            file: chunkFile,
            bytes: getCompilationAssetSize(compilation, chunkFile, manifest.moduleLoading.prefix),
          });
        }
        const cssFiles = diagnosticsCssFiles.get(file);
        const css =
          cssFiles && cssFiles.length > 0
            ? cssFiles.map((fileName) => ({
                file: fileName,
                bytes: getCompilationAssetSize(compilation, fileName, manifest.moduleLoading.prefix),
              }))
            : undefined;
        const totalBytes = [...chunks, ...(css || [])].reduce(
          (sum, entry) => sum + (entry.bytes ?? 0),
          0,
        );
        return {
          file,
          id: metadata.id,
          name: metadata.name,
          totalBytes,
          chunks,
          ...(css ? { css } : {}),
        };
      });

    return {
      version: 1,
      manifestFilename,
      isServer: this.options.isServer,
      clientReferenceCount: clientReferences.length,
      totalChunkBytes: sumUniqueKnownBytes(clientReferences),
      clientReferences,
    };
  }

  /** Stash resolved client files so buildManifest can filter by them. */
  private _resolvedClientFiles: string[] = [];

  /** Build the chunks array from all async-loadable chunks in a chunk group. */
  private getGroupAssets(
    chunkGroup: AnyChunkGroup,
    runtimeChunkFiles: ReadonlySet<string>,
    cssPrefix: string | null,
  ): { chunks: (string | number | null)[]; css: string[] } {
    const chunks: (string | number | null)[] = [];
    const css: string[] = [];
    for (const chunkUnknown of chunkGroup.chunks) {
      const c = chunkUnknown as AnyChunk;
      const files = c.files instanceof Set ? c.files : new Set(c.files);
      let recordedJs = false;
      css.push(...this.getChunkCss(c, runtimeChunkFiles, cssPrefix));
      for (const file of files) {
        const isRuntimeFile = runtimeChunkFiles.has(file);
        const isJavaScriptFile = file.endsWith('.js') || file.endsWith('.mjs');
        const isHotUpdateFile = file.endsWith('.hot-update.js') || file.endsWith('.hot-update.mjs');
        if (
          recordedJs ||
          !isJavaScriptFile ||
          isHotUpdateFile ||
          (!this.options.isServer && isRuntimeFile)
        ) {
          continue;
        }
        chunks.push(c.id, file);
        recordedJs = true;
      }
    }
    return { chunks: this.sortChunkPairs(chunks), css };
  }

  private getChunkCss(
    chunk: AnyChunk,
    runtimeChunkFiles: ReadonlySet<string>,
    cssPrefix: string | null,
  ): string[] {
    if (cssPrefix === null) return [];
    const css: string[] = [];
    const files = chunk.files instanceof Set ? chunk.files : new Set(chunk.files);
    for (const file of files) {
      if (
        file.endsWith('.css') &&
        !file.endsWith('.hot-update.css') &&
        (this.options.isServer || !runtimeChunkFiles.has(file))
      ) {
        css.push(cssPrefix + file);
      }
    }
    return css;
  }

  private getGeneratedChunkNamesByResource(): ReadonlyMap<string, string> {
    return new Map(
      (this._resolvedClientFiles ?? []).map((file, index) => [
        file,
        getGeneratedChunkName(this.chunkName, file, index),
      ]),
    );
  }

  private getCssForModule(
    resource: string | undefined,
    chunkGroup: AnyChunkGroup,
    css: string[],
    generatedChunkNamesByResource: ReadonlyMap<string, string>,
  ): string[] {
    if (!resource || css.length === 0) return css;
    const generatedChunkName = generatedChunkNamesByResource.get(resource);
    if (!generatedChunkName) return css;
    return this.chunkGroupHasName(chunkGroup, generatedChunkName) ? css : [];
  }

  private chunkGroupHasName(chunkGroup: AnyChunkGroup, generatedChunkName: string): boolean {
    if (chunkGroup.name === generatedChunkName) return true;
    for (const chunkUnknown of chunkGroup.chunks) {
      const chunk = chunkUnknown as { name?: string };
      if (chunk.name === generatedChunkName) return true;
    }
    return false;
  }

  private sortChunkPairs(chunks: (string | number | null)[]): (string | number | null)[] {
    const pairs: Array<[string | number | null, string | number | null]> = [];
    for (let i = 0; i < chunks.length; i += 2) {
      pairs.push([chunks[i] ?? null, chunks[i + 1] ?? null]);
    }

    // Rspack 2 can report sibling chunks in a different order; keep the
    // manifest deterministic while preserving the complete chunk set.
    pairs.sort(([leftId, leftFile], [rightId, rightFile]) => {
      const leftFileText = String(leftFile ?? '');
      const rightFileText = String(rightFile ?? '');
      if (leftFileText < rightFileText) return -1;
      if (leftFileText > rightFileText) return 1;

      const leftIdText = String(leftId ?? '');
      const rightIdText = String(rightId ?? '');
      if (leftIdText < rightIdText) return -1;
      if (leftIdText > rightIdText) return 1;
      return 0;
    });

    return pairs.flatMap(([id, file]) => [id, file]);
  }

  private getRuntimeChunkFiles(compilation: AnyCompilation): Set<string> {
    const runtimeChunkFiles = new Set<string>();
    for (const entrypoint of compilation.entrypoints?.values() ?? []) {
      const runtimeChunk =
        typeof entrypoint.getRuntimeChunk === 'function'
          ? entrypoint.getRuntimeChunk()
          : null;
      if (!runtimeChunk) continue;
      for (const file of runtimeChunk.files) runtimeChunkFiles.add(file);
    }
    return runtimeChunkFiles;
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
    css: string[],
    resolvedClientFiles: Set<string>,
    filePathToModuleMetadata: Record<string, ModuleMetadata>,
    diagnosticsCssFiles: Map<string, string[]>,
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
      existing.chunks = this.sortChunkPairs(existing.chunks);
      this.recordManifestCssFiles(existing, css);
      this.recordDiagnosticsCssFiles(href, css, diagnosticsCssFiles);
    } else {
      const metadata: ModuleMetadata = {
        id: moduleId,
        chunks: this.sortChunkPairs(chunks),
        name: '*',
      };
      this.recordManifestCssFiles(metadata, css);
      filePathToModuleMetadata[href] = metadata;
      this.recordDiagnosticsCssFiles(href, css, diagnosticsCssFiles);
    }
  }

  private recordManifestCssFiles(metadata: ModuleMetadata, css: string[]): void {
    if (css.length === 0) return;
    if (!metadata.css) metadata.css = [];
    for (const cssFile of css) {
      if (!metadata.css.includes(cssFile)) metadata.css.push(cssFile);
    }
  }

  private recordDiagnosticsCssFiles(
    href: string,
    css: string[],
    diagnosticsCssFiles: Map<string, string[]>,
  ): void {
    if (css.length === 0) return;
    const existing = diagnosticsCssFiles.get(href) ?? [];
    for (const cssFile of css) {
      if (!existing.includes(cssFile)) existing.push(cssFile);
    }
    diagnosticsCssFiles.set(href, existing);
  }
}

function sumUniqueKnownBytes(
  clientReferences: Array<{
    chunks: Array<{ file: string; bytes: number | null }>;
    css?: Array<{ file: string; bytes: number | null }>;
  }>,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const reference of clientReferences) {
    for (const chunk of [...reference.chunks, ...(reference.css ?? [])]) {
      if (chunk.bytes === null || seen.has(chunk.file)) continue;
      seen.add(chunk.file);
      total += chunk.bytes;
    }
  }
  return total;
}

function getCompilationAssetSize(
  compilation: AnyCompilation,
  file: string,
  publicPath: string,
): number | null {
  const candidates = new Set<string>();
  const addCandidate = (candidate: string): void => {
    candidates.add(candidate);
    if (candidate.startsWith('/')) {
      candidates.add(candidate.slice(1));
    }
  };

  addCandidate(file);
  if (publicPath && publicPath !== 'auto' && file.startsWith(publicPath)) {
    addCandidate(file.slice(publicPath.length));
  }

  for (const candidate of candidates) {
    const source = compilation.getAsset?.(candidate)?.source ?? compilation.assets?.[candidate];
    const size = getSourceSize(source);
    if (size !== null) return size;
  }
  return null;
}

function getSourceSize(source: AssetSource | undefined): number | null {
  if (!source) return null;
  if (typeof source.size === 'function') {
    const size = source.size();
    return Number.isFinite(size) ? size : null;
  }
  if (typeof source.source === 'function') {
    const value = source.source();
    return typeof value === 'string' ? Buffer.byteLength(value) : value.length;
  }
  return null;
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

function tryResolveRuntime(request: string): string | undefined {
  try {
    return require.resolve(request);
  } catch {
    return undefined;
  }
}

// The runtime module the plugin keys client-reference detection on, resolved
// from THIS package install. Used as the fast-path match for the common
// single-install layout.
const clientFileNameOnClient = tryResolveRuntime('react-server-dom-webpack/client.browser');
const clientFileNameOnServer = tryResolveRuntime('react-server-dom-webpack/client.node');

const runtimeResourceDetectionCache = new Map<string, boolean>();

/**
 * Detects whether `resource` is the react-on-rails-rsc Flight client runtime
 * the plugin keys its client-reference injection on.
 *
 * A strict `resource === require.resolve(...)` check is not enough: rspack
 * records `mod.resource` from the bundle's own resolution, which can be a
 * DIFFERENT install path than the plugin's `require.resolve` returns — a
 * second `react-server-dom-webpack` copy in the app's node_modules, a
 * pnpm/yarn symlink store, or a hoisted-vs-nested layout. When the paths
 * diverge the strict check fails and the module map is skipped (#105).
 *
 * This mirrors the webpack plugin's `isReactOnRailsRSCRuntimeResource` (#43):
 * the fast path matches the resolved runtime of this install, then a
 * duplicate-install path recognizes the runtime by file-name suffix confirmed
 * by walking up to a `react-server-dom-webpack` package.json. Results are
 * memoized because this runs for every module in the compilation.
 */
function isRuntimeResource(resource: string | undefined, isServer: boolean): boolean {
  if (typeof resource !== 'string') return false;
  const cacheKey = `${isServer}\0${resource}`;
  const cached = runtimeResourceDetectionCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = detectRuntimeResource(resource, isServer);
  runtimeResourceDetectionCache.set(cacheKey, result);
  return result;
}

function detectRuntimeResource(resource: string, isServer: boolean): boolean {
  // Fast path: the runtime module of THIS package install.
  const expected = isServer ? clientFileNameOnServer : clientFileNameOnClient;
  if (expected !== undefined && resource === expected) return true;

  // Duplicate-install path: another copy of the stock Flight runtime in the
  // module graph still counts as the runtime. Recognize it by file-name
  // suffix, then confirm by walking up to a package.json whose `name` is
  // `react-server-dom-webpack`.
  const normalizedResource = path.normalize(resource);
  const expectedSuffix = path.join(
    'react-server-dom-webpack',
    isServer ? 'client.node.js' : 'client.browser.js',
  );
  if (!normalizedResource.endsWith(path.sep + expectedSuffix)) return false;

  let dir = path.dirname(normalizedResource);
  for (let i = 0; i < 20; i++) {
    const packageJsonPath = path.join(dir, 'package.json');
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
        name?: string;
      };
      if (packageJson.name === 'react-server-dom-webpack') return true;
    } catch (x) {
      const code = (x as NodeJS.ErrnoException).code;
      if (!(x instanceof SyntaxError) && code !== 'ENOENT' && code !== 'ENOTDIR') {
        return false;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
  return false;
}
