/**
 * RSCWebpackPlugin — the webpack React Server Components plugin, owned as
 * TypeScript source.
 *
 * This is a faithful port of the previously vendored build of React's
 * reference `ReactFlightWebpackPlugin`
 * (`src/react-server-dom-webpack/cjs/react-server-dom-webpack-plugin.js`, now removed)
 * including every historical fork patch and in-repo edit that file accumulated:
 *
 *  - Server-build support: `isServer` option, server manifest emission
 *    (`react-server-client-manifest.json`), and server chunk-group scanning.
 *  - CSS-before-JS chunk scan: CSS and JS files are recorded independently
 *    of their order inside `chunk.files` (#44 regression coverage).
 *  - Runtime-chunk filtering: files of each entrypoint's runtime chunk are
 *    excluded from per-module chunk lists on the client build.
 *  - #54: client manifest entries are built from the chunk group created by
 *    each client reference's `AsyncDependenciesBlock` (matched through the
 *    `ClientReferenceDependency`), with an eager-import fallback pass and a
 *    warning when client-reference blocks are unavailable.
 *  - #52: runtime-chunk CSS and `.hot-update.css` files are excluded from
 *    the CLIENT manifest; the server manifest retains runtime CSS.
 *  - #43: duplicate-package-install runtime detection — the Flight client
 *    runtime is recognized by exact resolved path or by walking up from a
 *    `react-server-dom-webpack/client.*.js` resource to a `package.json`
 *    named `react-server-dom-webpack`.
 *  - #23: manifest entries for a module recorded from several chunk groups
 *    merge their chunk lists (deduped by chunk id) and CSS lists (deduped
 *    by URL). The server build and the #54 fallback pass still rely on
 *    these merge semantics.
 *
 * The `"use client"` directive detection reuses the shared
 * `hasUseClientDirective` helper from `../clientReferences` (also used by
 * the rspack plugin and `RSCReferenceDiscoveryPlugin`).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import webpack = require('webpack');
import { createIsInitialChunk, hasUseClientDirective } from '../clientReferences';
import {
  emitEntryClientReferencesAsset,
  type EntryClientReferencesCompilation,
} from '../entryClientReferences';

// neo-async ships no type definitions; declare the two helpers we use.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const asyncLib = require('neo-async') as {
  map<T, R>(
    arr: ReadonlyArray<T>,
    iterator: (item: T, callback: (err: Error | null, result?: R) => void) => void,
    callback: (err: Error | null, results?: R[]) => void,
  ): void;
  mapLimit<T, R>(
    arr: ReadonlyArray<T>,
    limit: number,
    iterator: (item: T, callback: (err: Error | null, result?: R) => void) => void,
    callback: (err: Error | null, results?: R[]) => void,
  ): void;
  filter<T>(
    arr: ReadonlyArray<T>,
    iterator: (item: T, callback: (err: Error | null, keep?: boolean) => void) => void,
    callback: (err: Error | null, results?: T[]) => void,
  ): void;
};

const ModuleDependency: typeof webpack.dependencies.ModuleDependency =
  webpack.dependencies.ModuleDependency;
const NullDependency: typeof webpack.dependencies.NullDependency =
  webpack.dependencies.NullDependency;
const Template: typeof webpack.Template = webpack.Template;

export class ClientReferenceDependency extends ModuleDependency {
  constructor(request: string) {
    super(request);
  }

  // webpack 5.59 typings model Dependency.type as a readonly property, while
  // current webpack exposes the runtime surface as an accessor.
  // @ts-ignore: @ts-expect-error cannot be used here. The error only appears
  // against 5.59 typings; current webpack typings accept the accessor override.
  override get type(): string {
    return 'client-reference';
  }
}

const clientFileNameOnClient = require.resolve('react-server-dom-webpack/client.browser');
const clientFileNameOnServer = require.resolve('react-server-dom-webpack/client.node');

const runtimeResourceDetectionCache = new Map<string, boolean>();

// Style-import source extensions a client reference may import directly and
// have extracted into a sibling chunk (#112): plain CSS plus the common
// preprocessors. MiniCssExtract preserves the authored resource extension on
// the importing module even though the emitted chunk file is `.css`.
const STYLE_SOURCE_RE = /\.(css|scss|sass|less|styl|pcss)$/i;

/**
 * Detects whether `resource` is the react-on-rails-rsc Flight client runtime
 * the plugin keys its client-reference injection on. Results are memoized
 * because the parser hook runs for every module in the compilation.
 */
function isReactOnRailsRSCRuntimeResource(resource: string | undefined, isServer: boolean): boolean {
  const cacheKey = `${isServer}\0${resource}`;
  const cached = runtimeResourceDetectionCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = detectReactOnRailsRSCRuntimeResource(resource, isServer);
  runtimeResourceDetectionCache.set(cacheKey, result);
  return result;
}

function detectReactOnRailsRSCRuntimeResource(
  resource: string | undefined,
  isServer: boolean,
): boolean {
  // Fast path: the runtime module of THIS package install.
  if (resource === (isServer ? clientFileNameOnServer : clientFileNameOnClient)) {
    return true;
  }
  if (typeof resource !== 'string') return false;

  // Duplicate-install path (#43): another copy of the stock Flight runtime in the
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

export type ClientReferenceSearchPath = {
  directory: string;
  recursive?: boolean;
  include: RegExp;
  exclude?: RegExp;
};

export type ClientReferencePath = string | ClientReferenceSearchPath;

export type Options = {
  isServer: boolean;
  clientReferences?: ClientReferencePath | ReadonlyArray<ClientReferencePath>;
  chunkName?: string;
  chunkGroupWarningThreshold?: number | false;
  clientManifestFilename?: string;
  serverConsumerManifestFilename?: string;
  clientReferenceDiagnosticsFilename?: string | false;
  entryClientReferencesFilename?: string | false;
};

const DEFAULT_CHUNK_GROUP_WARNING_THRESHOLD = 4;
const MAX_CHUNK_GROUP_WARNINGS = 10;
const CHUNK_GROUP_WARNING_DOCS =
  'https://github.com/shakacode/react_on_rails/blob/main/docs/oss/migrating/rsc-troubleshooting.md';

function normalizeChunkGroupWarningThreshold(
  threshold: number | false | undefined,
): number | false {
  if (threshold === undefined) {
    return DEFAULT_CHUNK_GROUP_WARNING_THRESHOLD;
  }
  if (threshold === false || threshold === 0) {
    return false;
  }
  // Keep the runtime guard for JavaScript callers even though TypeScript
  // narrows typed callers before this point.
  if (
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    !Number.isInteger(threshold) ||
    threshold < 2
  ) {
    throw new Error(
      'React Server Components: chunkGroupWarningThreshold must be false/0 to disable, or an integer at least 2.',
    );
  }
  return threshold;
}

type ModuleMetadata = {
  id: string | number | null;
  chunks: (string | number | null)[];
  css: string[] | null;
  name: string;
};

type AssetSource = {
  size?: () => number;
  source?: () => string | Buffer;
};

type FlightAsset = {
  source?: AssetSource;
};

type ClientReferenceDiagnostics = {
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
};

/**
 * Structural types for the parts of webpack's object graph the plugin
 * touches. The unit-test suites drive `apply()` with hand-built mock
 * compilers/compilations, and webpack's own `Module` type does not expose
 * `resource`/`modules`, so structural types are both the honest contract
 * and what keeps the parity oracle runnable.
 */
type FlightModule = {
  resource?: string;
  type?: string;
  /** Inner modules of a ConcatenatedModule. */
  modules?: FlightModule[];
  addBlock?: (block: unknown) => void;
  buildInfo?: { cacheable?: boolean };
};

type FlightChunk = {
  id: string | number | null;
  files: Iterable<string>;
  // Real webpack only; absent in the unit-test mocks, which are treated as
  // non-initial (see `createIsInitialChunk` in `clientReferences.ts`).
  canBeInitial?: () => boolean;
};

type FlightChunkGroup = {
  chunks: Iterable<FlightChunk>;
  getBlocks?: () => Iterable<FlightBlock> | undefined;
  blocksIterable?: Iterable<FlightBlock>;
};

type FlightBlock = {
  dependencies?: Array<{ type?: string; request?: string }>;
} | null;

type FlightEntrypoint = {
  getRuntimeChunk(): { files: Iterable<string> } | null;
};

type FlightCompilation = {
  dependencyFactories: Map<unknown, unknown>;
  dependencyTemplates: Map<unknown, unknown>;
  warnings: Error[];
  fileDependencies?: WatchDependencySet;
  contextDependencies?: WatchDependencySet;
  missingDependencies?: WatchDependencySet;
  outputOptions: {
    publicPath?: string;
    crossOriginLoading?: false | 'anonymous' | 'use-credentials';
  };
  entrypoints: { forEach(fn: (entrypoint: FlightEntrypoint) => void): void };
  chunkGroups: Iterable<FlightChunkGroup>;
  chunkGraph: {
    getChunkModulesIterable(chunk: FlightChunk): Iterable<FlightModule>;
    getModuleId(module: FlightModule): string | number | null;
    // Real webpack only; absent in the unit-test mocks, which gate the
    // sibling-chunk CSS recovery pass off this method's presence.
    getModuleChunksIterable?(module: FlightModule): Iterable<FlightChunk>;
  };
  // Real webpack only; the unit-test mocks omit it, which disables the
  // sibling-chunk CSS recovery pass (see #112).
  moduleGraph?: {
    getOutgoingConnections(
      module: FlightModule,
    ): Iterable<{ module?: FlightModule | null; resolvedModule?: FlightModule | null }>;
  };
  assets?: Record<string, AssetSource>;
  getAsset?: (filename: string) => FlightAsset | undefined;
  hooks: {
    processAssets: {
      tap(options: { name: string; stage: number }, fn: () => void): void;
    };
  };
  emitAsset(filename: string, source: unknown): void;
};

type FlightParser = {
  state: { module: FlightModule };
  hooks: {
    program: { tap(name: string, fn: () => void): void };
  };
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
  compilation: FlightCompilation,
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

type FlightNormalModuleFactory = {
  hooks: {
    parser: {
      for(type: string): { tap(name: string, fn: (parser: FlightParser) => void): void };
    };
  };
};

type FlightResolver = {
  resolve(
    context: object,
    basePath: string,
    request: string,
    resolveContext: object,
    callback: (err: Error | null, result?: unknown) => void,
  ): void;
};

type FlightContextModuleFactory = {
  resolveDependencies(
    fs: unknown,
    options: {
      resource: string;
      resourceQuery: string;
      recursive: boolean;
      regExp: RegExp;
      include: undefined;
      exclude: RegExp | undefined;
    },
    callback: (err: Error | null, dependencies?: Array<{ userRequest: string }>) => void,
  ): void;
};

type FlightCompiler = {
  context: string;
  resolverFactory: {
    get(type: string, options?: object): FlightResolver;
  };
  inputFileSystem: unknown;
  hooks: {
    beforeCompile: {
      tapAsync(
        name: string,
        fn: (
          params: { contextModuleFactory: FlightContextModuleFactory },
          callback: (err?: Error | null) => void,
        ) => void,
      ): void;
    };
    thisCompilation: {
      tap(
        name: string,
        fn: (
          compilation: FlightCompilation,
          params: { normalModuleFactory: FlightNormalModuleFactory },
        ) => void,
      ): void;
    };
    make: {
      tap(name: string, fn: (compilation: FlightCompilation) => void): void;
    };
  };
};

type ReadFileFs = {
  readFile(
    filePath: string,
    encoding: string,
    callback: (err: Error | null, content?: string) => void,
  ): void;
};

type WatchInputFileSystem = ReadFileFs & {
  readdir(
    filePath: string,
    callback: (err: NodeJS.ErrnoException | null, files?: string[]) => void,
  ): void;
  realpath?(
    filePath: string,
    callback: (err: NodeJS.ErrnoException | null, realPath?: string) => void,
  ): void;
  stat(
    filePath: string,
    callback: (err: NodeJS.ErrnoException | null, stats?: { isDirectory(): boolean }) => void,
  ): void;
};

const PLUGIN_NAME = 'React Server Plugin';
const WATCH_TRAVERSAL_CONCURRENCY = 32;

export class RSCWebpackPlugin {
  readonly isServer: boolean;

  readonly clientReferences: ReadonlyArray<ClientReferencePath>;

  readonly chunkName: string;

  readonly chunkGroupWarningThreshold: number | false;

  readonly clientManifestFilename: string;

  /**
   * Accepted for option-shape compatibility with React's reference plugin;
   * the previously vendored build never emitted this manifest and neither
   * does this port.
   */
  readonly serverConsumerManifestFilename: string;

  readonly clientReferenceDiagnosticsFilename: string | false | undefined;

  /**
   * Opt-in asset listing, for each entrypoint, the client references
   * statically reachable from its module graph (issue #134). Meaningful on
   * the server/RSC build, whose entry trees are the rendered pages; a
   * downstream consumer can join it against the client manifest to scope
   * per-route client-reference metadata.
   */
  readonly entryClientReferencesFilename: string | false | undefined;

  static __internal_isReactOnRailsRSCRuntimeResource = isReactOnRailsRSCRuntimeResource;

  constructor(options: Options) {
    if (!options || typeof options.isServer !== 'boolean') {
      throw new Error(
        'React Server Plugin: You must specify the isServer option as a boolean.',
      );
    }
    this.isServer = options.isServer;

    if (options.clientReferences) {
      this.clientReferences = Array.isArray(options.clientReferences)
        ? options.clientReferences
        : [options.clientReferences as ClientReferencePath];
    } else {
      this.clientReferences = [
        {
          directory: '.',
          recursive: true,
          include: /\.(js|ts|jsx|tsx)$/,
        },
      ];
    }

    if (typeof options.chunkName === 'string') {
      this.chunkName = options.chunkName;
      if (!/\[(index|request)\]/.test(this.chunkName)) {
        this.chunkName += '[index]';
      }
    } else {
      this.chunkName = 'client[index]';
    }

    this.chunkGroupWarningThreshold = normalizeChunkGroupWarningThreshold(
      options.chunkGroupWarningThreshold,
    );

    const defaultClientManifestFilename = this.isServer
      ? 'react-server-client-manifest.json'
      : 'react-client-manifest.json';
    this.clientManifestFilename =
      options.clientManifestFilename || defaultClientManifestFilename;
    this.serverConsumerManifestFilename =
      options.serverConsumerManifestFilename || 'react-ssr-manifest.json';
    this.clientReferenceDiagnosticsFilename = options.clientReferenceDiagnosticsFilename;
    this.entryClientReferencesFilename = options.entryClientReferencesFilename;
  }

  apply(compiler: webpack.Compiler): void {
    const flightCompiler = compiler as unknown as FlightCompiler;
    let resolvedClientReferences: ClientReferenceDependency[] | undefined;
    let clientReferenceWatchDependencies = createClientReferenceWatchDependencies();
    let clientFileNameFound = false;

    // Phase 1: resolve every configured client reference before the
    // compilation starts so the parser hook below can attach their
    // AsyncDependenciesBlocks to the Flight runtime module.
    flightCompiler.hooks.beforeCompile.tapAsync(PLUGIN_NAME, (params, callback) => {
      const contextResolver = flightCompiler.resolverFactory.get('context', {});
      const normalResolver = flightCompiler.resolverFactory.get('normal');
      const nextWatchDependencies = createClientReferenceWatchDependencies();
      this.resolveAllClientFiles(
        flightCompiler.context,
        contextResolver,
        normalResolver,
        flightCompiler.inputFileSystem,
        params.contextModuleFactory,
        (err, resolvedClientRefs) => {
          if (err) {
            callback(err);
            return;
          }
          clientReferenceWatchDependencies = nextWatchDependencies;
          resolvedClientReferences = resolvedClientRefs;
          callback();
        },
        nextWatchDependencies,
      );
    });

    // Phase 2: when the Flight client runtime module is parsed, attach one
    // named AsyncDependenciesBlock per resolved client reference, creating
    // the chunk groups the manifest is later built from.
    flightCompiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation, params) => {
      clientFileNameFound = false;
      addClientReferenceWatchDependencies(compilation, clientReferenceWatchDependencies);

      const normalModuleFactory = params.normalModuleFactory;
      compilation.dependencyFactories.set(ClientReferenceDependency, normalModuleFactory);
      compilation.dependencyTemplates.set(
        ClientReferenceDependency,
        new NullDependency.Template(),
      );

      const handler = (parser: FlightParser) => {
        parser.hooks.program.tap(PLUGIN_NAME, () => {
          const module = parser.state.module;
          if (!isReactOnRailsRSCRuntimeResource(module.resource, this.isServer)) {
            return;
          }
          clientFileNameFound = true;
          // The block list below depends on the latest client-reference
          // discovery result, not on the Flight runtime file contents. Force
          // webpack to rebuild this single runtime module in watch mode so the
          // parser hook re-attaches blocks after client files are added or
          // removed.
          const buildInfo = module.buildInfo;
          if (buildInfo) buildInfo.cacheable = false;
          if (!resolvedClientReferences) return;
          for (let i = 0; i < resolvedClientReferences.length; i++) {
            const dep = resolvedClientReferences[i]!;
            const chunkName = this.chunkName
              .replace(/\[index\]/g, `${i}`)
              .replace(/\[request\]/g, Template.toPath(dep.userRequest));
            const block = new webpack.AsyncDependenciesBlock(
              { name: chunkName },
              undefined,
              dep.request,
            );
            block.addDependency(dep);
            module.addBlock!(block);
          }
        });
      };

      normalModuleFactory.hooks.parser.for('javascript/auto').tap('HarmonyModulesPlugin', handler);
      normalModuleFactory.hooks.parser.for('javascript/esm').tap('HarmonyModulesPlugin', handler);
      normalModuleFactory.hooks.parser
        .for('javascript/dynamic')
        .tap('HarmonyModulesPlugin', handler);
    });

    // Phase 3: emit the client manifest.
    flightCompiler.hooks.make.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: PLUGIN_NAME,
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        () => {
          if (clientFileNameFound === false) {
            compilation.warnings.push(
              new webpack.WebpackError(
                'Client runtime at react-on-rails-rsc/client was not found. React Server Components module map file ' +
                  this.clientManifestFilename +
                  ' was not created.',
              ),
            );
            return;
          }

          const configuredCrossOriginLoading = compilation.outputOptions.crossOriginLoading;
          const crossOrigin =
            typeof configuredCrossOriginLoading === 'string'
              ? configuredCrossOriginLoading === 'use-credentials'
                ? configuredCrossOriginLoading
                : 'anonymous'
              : null;

          const resolvedClientFiles = new Set(
            (resolvedClientReferences || []).map((ref) => ref.request),
          );
          const configuredPublicPath = compilation.outputOptions.publicPath;
          const publicPathIsAuto = configuredPublicPath === 'auto';
          const publicPathIsDynamic =
            publicPathIsAuto || typeof configuredPublicPath === 'function';
          if (publicPathIsDynamic) {
            const publicPathDescription = publicPathIsAuto
              ? "output.publicPath is 'auto'"
              : 'output.publicPath is a function';
            compilation.warnings.push(
              new webpack.WebpackError(
                `React Server Components: ${publicPathDescription}, which cannot be serialized into the RSC manifest. ` +
                  'moduleLoading.prefix will be emitted as an empty string, and CSS files are omitted from the RSC manifest because their final URLs are only known at runtime. ' +
                  'Set output.publicPath to a concrete URL or path to enable Flight chunk loading and stylesheet hints.',
              ),
            );
          }
          const moduleLoadingPrefix =
            publicPathIsDynamic || typeof configuredPublicPath !== 'string'
              ? ''
              : configuredPublicPath;
          const filePathToModuleMetadata: Record<string, ModuleMetadata> = {};
          const manifest = {
            moduleLoading: {
              prefix: moduleLoadingPrefix,
              crossOrigin,
            },
            filePathToModuleMetadata,
          };

          // Runtime-chunk filtering: collect the files of every
          // entrypoint's runtime chunk so the client build can exclude
          // them from per-module chunk lists.
          const runtimeChunkFiles = new Set<string>();
          compilation.entrypoints.forEach((entrypoint) => {
            const runtimeChunk = entrypoint.getRuntimeChunk();
            if (runtimeChunk) {
              for (const runtimeFile of runtimeChunk.files) {
                runtimeChunkFiles.add(runtimeFile);
              }
            }
          });

          let cssPrefix =
            typeof configuredPublicPath === 'string' && configuredPublicPath !== 'auto'
              ? configuredPublicPath
              : null;
          if (cssPrefix && !cssPrefix.endsWith('/')) {
            cssPrefix += '/';
          }

          let missingClientReferenceBlocksWarningEmitted = false;
          const clientReferenceChunkGroupsByResource = new Map<string, Set<FlightChunkGroup>>();
          // The manifest excludes initial chunks' CSS to avoid re-broadcasting
          // entry-pack CSS onto every client reference (#108): an initial
          // chunk's CSS is already delivered render-blocking by the page's own
          // stylesheet links, while an async chunk's CSS has no delivery path
          // besides these manifest hints (#188). This is a compilation-global
          // signal (`canBeInitial()`), so it is conservative for partial
          // multi-pack page loads — see the known limitation in the #188 fix.
          const isInitialChunk = createIsInitialChunk<FlightChunk>();

          // Records every module of `chunkGroup` whose resource is in
          // `chunkResolvedClientFiles`, listing the chunk group's own
          // chunks (and CSS files) in the manifest entry. Merges into an
          // existing manifest entry (chunks deduped by chunk id, CSS by
          // URL) instead of overwriting it. Webpack preserves graph-order
          // chunk pairs here; rspack sorts generated chunk pairs by filename
          // because its chunk iteration order is less stable. Flight ignores
          // pair order, so byte-level cross-bundler parity intentionally does
          // not require sorting the webpack manifest.
          const recordChunkGroup = (
            chunkGroup: FlightChunkGroup,
            chunkResolvedClientFiles: Set<string>,
            trackClientReferencePresence = false,
          ): void => {
            const chunks: (string | number | null)[] = [];

            // `chunkGroup.chunks` is typed as `Iterable<FlightChunk>` and is
            // walked several times below; materialize it once so a one-shot
            // iterator (a non-webpack bundler) cannot silently yield nothing on
            // the later passes.
            const groupChunkList = [...chunkGroup.chunks];

            const isResolvedClientRef = (module: FlightModule): boolean =>
              !!module.resource && chunkResolvedClientFiles.has(module.resource);

            const recordModule = (
              id: string | number | null,
              module: FlightModule,
              moduleCss: readonly string[],
            ): void => {
              if (!module.resource || !chunkResolvedClientFiles.has(module.resource)) {
                return;
              }
              const href = url.pathToFileURL(module.resource).href;
              const existing = filePathToModuleMetadata[href];
              if (existing) {
                const seenChunkIds = new Set<string | number | null>();
                for (let i = 0; i < existing.chunks.length; i += 2) {
                  seenChunkIds.add(existing.chunks[i]!);
                }
                for (let i = 0; i < chunks.length; i += 2) {
                  if (!seenChunkIds.has(chunks[i]!)) {
                    existing.chunks.push(chunks[i]!, chunks[i + 1]!);
                  }
                }
                if (existing.css == null) existing.css = [];
                for (const cssFile of moduleCss) {
                  if (existing.css.indexOf(cssFile) === -1) {
                    existing.css.push(cssFile);
                  }
                }
              } else {
                filePathToModuleMetadata[href] = {
                  id,
                  chunks: chunks.slice(),
                  css: [...moduleCss],
                  name: '*',
                };
              }
            };

            const recordClientReferencePresence = (module: FlightModule): void => {
              if (!trackClientReferencePresence || this.chunkGroupWarningThreshold === false) {
                return;
              }
              // The warning is about physical chunk-group presence, including
              // shared chunks, rather than only direct block dependencies.
              if (!module.resource || !resolvedClientFiles.has(module.resource)) {
                return;
              }
              let chunkGroups = clientReferenceChunkGroupsByResource.get(module.resource);
              if (!chunkGroups) {
                chunkGroups = new Set();
                clientReferenceChunkGroupsByResource.set(module.resource, chunkGroups);
              }
              chunkGroups.add(chunkGroup);
            };

            // Record the loadable JS file of every chunk in the group: the
            // chunk loader needs each dependency chunk to run the module, and
            // it no-ops on chunks the page already installed. (CSS-before-JS
            // scan fix: the JS file is found regardless of its position in
            // `chunk.files`.) JS is intentionally group-wide while CSS below is
            // per-chunk: every chunk must load before any module in the group
            // runs, but a module only needs the CSS extracted from its own
            // chunk. If that contract changes, both loops move together.
            for (const chunk of groupChunkList) {
              let recordedJS = false;
              for (const file of chunk.files) {
                if (
                  (file.endsWith('.js') || file.endsWith('.mjs')) &&
                  !file.endsWith('.hot-update.js') &&
                  !file.endsWith('.hot-update.mjs') &&
                  (this.isServer || !runtimeChunkFiles.has(file)) &&
                  !recordedJS
                ) {
                  chunks.push(chunk.id, file);
                  recordedJS = true;
                }
              }
            }

            // CSS is recorded PER CHUNK and attached only to the client
            // references that chunk contains (#108), instead of group-wide,
            // which re-broadcast every shared dependency chunk's CSS
            // (vendor/common already loaded by the page entry) onto every
            // reference as a render-blocking `<link precedence="rsc-css">` —
            // the dominant FCP/LCP regression on real pages. A reference's own
            // extracted CSS and the #52 runtime-chunk exclusion are preserved.
            const groupChunks = new Set<FlightChunk>(groupChunkList);

            const isRecordableCss = (file: string): boolean =>
              file.endsWith('.css') &&
              !file.endsWith('.hot-update.css') &&
              cssPrefix !== null &&
              (this.isServer || !runtimeChunkFiles.has(file));

            // Sibling-chunk CSS recovery (#112): SplitChunks + MiniCssExtract
            // can place a reference's *own* extracted CSS in a chunk separate
            // from the one holding its JS module (e.g. a cache group that
            // matches the JS file but not its `.css` sibling, or a
            // css/mini-extract cache group that moves the extracted CssModule
            // into a CSS-only chunk). Follow the module's DIRECT `.css`
            // imports to the chunk(s) that carry them, intersected with this
            // chunk group, and merge that CSS. Also follow one non-style child
            // hop when that child belongs to the reference's async chunk group:
            // either it shares one of the reference module's chunks, or webpack
            // split it to a non-initial chunk of this group. Splitting on
            // initial-vs-async (not chunk sharing) keeps a shared local child
            // component's stylesheet — which nothing but these references
            // delivers (#188) — while still excluding vendor/common chunks the
            // page entry already loads render-blocking (#108).
            // Guarded on `moduleGraph`/`getModuleChunksIterable`, which the
            // unit-test mocks omit (they exercise the per-chunk pass only).
            const moduleGraph = compilation.moduleGraph;
            const getModuleChunksIterable =
              compilation.chunkGraph.getModuleChunksIterable?.bind(compilation.chunkGraph);
            const directCssDepFiles = (module: FlightModule): string[] => {
              if (!moduleGraph || !getModuleChunksIterable || cssPrefix === null) return [];
              const files = new Set<string>();
              const moduleChunks = new Set(
                [...getModuleChunksIterable(module)].filter((chunk) => groupChunks.has(chunk)),
              );
              const addCssFromModuleChunks = (cssModule: FlightModule): void => {
                for (const cssChunk of getModuleChunksIterable(cssModule)) {
                  if (!groupChunks.has(cssChunk)) continue;
                  for (const file of cssChunk.files) {
                    if (isRecordableCss(file)) {
                      files.add(cssPrefix + file);
                    }
                  }
                }
              };
              const addDirectStyleImports = (sourceModule: FlightModule): void => {
                for (const connection of moduleGraph.getOutgoingConnections(sourceModule)) {
                  const depModule = connection.module ?? connection.resolvedModule;
                  if (!depModule || !depModule.resource) continue;
                  const depResource = depModule.resource.replace(/[?#].*$/, '');
                  if (!STYLE_SOURCE_RE.test(depResource)) continue;
                  addCssFromModuleChunks(depModule);
                  for (const cssConnection of moduleGraph.getOutgoingConnections(depModule)) {
                    const extractedCssModule = cssConnection.module ?? cssConnection.resolvedModule;
                    if (!extractedCssModule || extractedCssModule.type !== 'css/mini-extract') {
                      continue;
                    }
                    addCssFromModuleChunks(extractedCssModule);
                  }
                }
              };
              const belongsToReferenceChunkGroup = (depModule: FlightModule): boolean => {
                for (const depChunk of getModuleChunksIterable(depModule)) {
                  if (moduleChunks.has(depChunk)) return true;
                  if (groupChunks.has(depChunk) && !isInitialChunk(depChunk)) {
                    return true;
                  }
                }
                return false;
              };
              addDirectStyleImports(module);
              for (const connection of moduleGraph.getOutgoingConnections(module)) {
                // `module` is the resolved destination for most connections;
                // some dependency types leave it null with the target on
                // `resolvedModule`, so fall back to it.
                const depModule = connection.module ?? connection.resolvedModule;
                if (!depModule || !depModule.resource) continue;
                // Match the style-import source (`.css` and the common
                // preprocessor extensions); MiniCssExtract keeps the importing
                // module's resource as the authored file even though the
                // emitted chunk file is always `.css`. Strip any webpack
                // resource query/fragment (`./Button.css?inline`) first.
                const depResource = depModule.resource.replace(/[?#].*$/, '');
                if (STYLE_SOURCE_RE.test(depResource)) continue;
                if (!belongsToReferenceChunkGroup(depModule)) continue;
                addDirectStyleImports(depModule);
              }
              return [...files];
            };

            for (const chunk of groupChunkList) {
              const chunkCss: string[] = [];
              for (const file of chunk.files) {
                if (isRecordableCss(file)) {
                  chunkCss.push(cssPrefix + file);
                }
              }
              for (const module of compilation.chunkGraph.getChunkModulesIterable(chunk)) {
                const moduleId = compilation.chunkGraph.getModuleId(module);
                // Only client references need sibling-CSS recovery; skip the
                // graph walk for the many plain dependency modules
                // `recordModule` would drop anyway. A client reference can also
                // be the root of a ConcatenationModule — its external `.css`
                // imports live on the root, so walking the root recovers them.
                // (A client reference is an async boundary, so webpack does not
                // fold it in as a concatenated *inner* module; inner-module CSS
                // imports therefore aren't a case that arises here.)
                const mayBeClientRef =
                  isResolvedClientRef(module) ||
                  (!!module.modules && module.modules.some(isResolvedClientRef));
                const siblingCss = mayBeClientRef ? directCssDepFiles(module) : [];
                const moduleCss = siblingCss.length
                  ? [...new Set([...chunkCss, ...siblingCss])]
                  : chunkCss;
                recordClientReferencePresence(module);
                recordModule(moduleId, module, moduleCss);
                if (module.modules) {
                  for (const concatenatedMod of module.modules) {
                    recordClientReferencePresence(concatenatedMod);
                    recordModule(moduleId, concatenatedMod, moduleCss);
                  }
                }
              }
            }
          };

          if (this.isServer) {
            // The server bundle has no per-reference chunk groups; record
            // every chunk group that contains a client reference.
            for (const chunkGroup of compilation.chunkGroups) {
              recordChunkGroup(chunkGroup, resolvedClientFiles);
            }
          } else {
            // Match chunk groups through the ClientReferenceDependency
            // attached to the AsyncDependenciesBlock that created them, so
            // each client component's manifest entry lists exactly the
            // chunks of the one chunk group webpack created for it instead
            // of the union of every chunk group the module appears in.
            const chunkGroupsWithBlocks: FlightChunkGroup[] = [];
            for (const chunkGroup of compilation.chunkGroups) {
              // Prefer `getBlocks()`; fall back to the `blocksIterable`
              // getter for webpack-compatible bundlers or builds where
              // `getBlocks` is unavailable (webpack 5 proper has both).
              const blocks =
                typeof chunkGroup.getBlocks === 'function'
                  ? chunkGroup.getBlocks()
                  : chunkGroup.blocksIterable;
              if (!blocks) {
                if (!missingClientReferenceBlocksWarningEmitted) {
                  missingClientReferenceBlocksWarningEmitted = true;
                  compilation.warnings.push(
                    new webpack.WebpackError(
                      'Client reference blocks were unavailable for one or more chunk groups. ' +
                        'React Server Components client manifest entries for affected chunk groups were skipped.',
                    ),
                  );
                }
                continue;
              }
              chunkGroupsWithBlocks.push(chunkGroup);
              const chunkResolvedClientFiles = new Set<string>();
              for (const block of blocks) {
                const dependencies = block && block.dependencies;
                if (!dependencies) continue;
                for (const dep of dependencies) {
                  // The `type` check matches dependencies created by a
                  // duplicate copy of this plugin module (e.g. two
                  // node_modules instances), where `instanceof` fails.
                  if (
                    (dep instanceof ClientReferenceDependency ||
                      dep.type === 'client-reference') &&
                    typeof dep.request === 'string' &&
                    resolvedClientFiles.has(dep.request)
                  ) {
                    chunkResolvedClientFiles.add(dep.request);
                  }
                }
              }
              if (chunkResolvedClientFiles.size > 0) {
                recordChunkGroup(chunkGroup, chunkResolvedClientFiles, true);
              }
            }

            // Client references whose block-created chunk group ended up
            // without any chunk containing them (webpack drops modules
            // that are already available in a parent chunk, e.g. a client
            // component eagerly imported by an entry) have no manifest
            // entry yet, and Flight fails at runtime on missing entries.
            // Fall back to scanning the chunk groups whose blocks were
            // available. The runtime-chunk exclusion keeps the runtime
            // chunk out of the recorded chunk list; with the default
            // config that is the entry chunk itself, while with a split
            // `runtimeChunk` the already-loaded entry chunk is still
            // listed (webpack's chunk loader treats it as a no-op).
            const unrecordedClientFiles = new Set<string>();
            resolvedClientFiles.forEach((file) => {
              if (!filePathToModuleMetadata[url.pathToFileURL(file).href]) {
                unrecordedClientFiles.add(file);
              }
            });
            if (unrecordedClientFiles.size > 0) {
              // Prune recorded files between groups so a later group
              // cannot union its chunks into an entry the fallback
              // already created — the over-preload behavior the block
              // matching above exists to eliminate.
              for (
                let i = 0;
                i < chunkGroupsWithBlocks.length && unrecordedClientFiles.size > 0;
                i++
              ) {
                recordChunkGroup(chunkGroupsWithBlocks[i]!, unrecordedClientFiles);
                unrecordedClientFiles.forEach((file) => {
                  if (filePathToModuleMetadata[url.pathToFileURL(file).href]) {
                    unrecordedClientFiles.delete(file);
                  }
                });
              }
              // Anything still unrecorded has no manifest entry and will
              // crash Flight if it gets rendered ("Could not find the
              // module in React Client Manifest"). Surface the files at
              // build time as a warning — consistent with the other
              // manifest warnings above (including the fatal "client
              // runtime not found" case) and with upstream
              // ReactFlightWebpackPlugin, which warns rather than failing
              // the build. A client reference that is never rendered will
              // not crash, so this stays a warning, not a hard error.
              if (unrecordedClientFiles.size > 0) {
                const missing = Array.from(unrecordedClientFiles);
                compilation.warnings.push(
                  new webpack.WebpackError(
                    'React Server Components: no client manifest entry could be created for ' +
                      missing.length +
                      ' client reference(s). Rendering them will fail at runtime with a missing manifest entry:\n  ' +
                      missing.join('\n  '),
                  ),
                );
              }
            }

            const chunkGroupWarningThreshold = this.chunkGroupWarningThreshold;
            if (chunkGroupWarningThreshold !== false) {
              const chunkGroupWarningEntries = Array.from(clientReferenceChunkGroupsByResource)
                .filter(([, chunkGroups]) => chunkGroups.size >= chunkGroupWarningThreshold)
                .sort(
                  ([leftResource, leftChunkGroups], [rightResource, rightChunkGroups]) =>
                    rightChunkGroups.size - leftChunkGroups.size ||
                    (leftResource < rightResource ? -1 : leftResource > rightResource ? 1 : 0)
                );
              let emittedWarnings = 0;
              let suppressedWarnings = 0;

              for (const [resource, chunkGroups] of chunkGroupWarningEntries) {
                const groupCount = chunkGroups.size;

                if (emittedWarnings >= MAX_CHUNK_GROUP_WARNINGS) {
                  suppressedWarnings += 1;
                  continue;
                }

                emittedWarnings += 1;
                compilation.warnings.push(
                  new webpack.WebpackError(
                    'React Server Components: client reference module ' +
                      resource +
                      ' is present in ' +
                      groupCount +
                      ' client-reference chunk groups. ' +
                      'This can duplicate its client JS/CSS across routes; consider a thin client wrapper or isolating imports to avoid chunk contamination. ' +
                      'See ' +
                      CHUNK_GROUP_WARNING_DOCS +
                      ' for mitigation guidance.',
                  ),
                );
              }

              if (suppressedWarnings > 0) {
                compilation.warnings.push(
                  new webpack.WebpackError(
                    'React Server Components: suppressed ' +
                      suppressedWarnings +
                      ' additional client-reference chunk group warning(s). ' +
                      'Increase chunkGroupWarningThreshold or inspect the module graph to narrow duplicated client references. ' +
                      'See ' +
                      CHUNK_GROUP_WARNING_DOCS +
                      ' for mitigation guidance.',
                  ),
                );
              }
            }
          }

          if (typeof this.clientReferenceDiagnosticsFilename === 'string') {
            const diagnostics = this.buildDiagnostics(compilation, manifest);
            compilation.emitAsset(
              this.clientReferenceDiagnosticsFilename,
              new webpack.sources.RawSource(`${JSON.stringify(diagnostics, null, 2)}\n`, false),
            );
          }

          if (typeof this.entryClientReferencesFilename === 'string') {
            emitEntryClientReferencesAsset({
              compilation: compilation as unknown as EntryClientReferencesCompilation,
              filename: this.entryClientReferencesFilename,
              compilerContext: flightCompiler.context,
              isServer: this.isServer,
              isClientReference: (resource) => resolvedClientFiles.has(resource),
              isTraversalBoundary: (resource) =>
                isReactOnRailsRSCRuntimeResource(resource, this.isServer),
              emitWarning: (message) => {
                compilation.warnings.push(new webpack.WebpackError(message));
              },
              emitAsset: (filename, source) => {
                compilation.emitAsset(
                  filename,
                  new webpack.sources.RawSource(source, false),
                );
              },
            });
          }

          compilation.emitAsset(
            this.clientManifestFilename,
            new webpack.sources.RawSource(JSON.stringify(manifest, null, 2), false),
          );
        },
      );
    });
  }

  private buildDiagnostics(
    compilation: FlightCompilation,
    manifest: {
      moduleLoading: { prefix: string; crossOrigin: string | null };
      filePathToModuleMetadata: Record<string, ModuleMetadata>;
    },
  ): ClientReferenceDiagnostics {
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

        const css =
          metadata.css && metadata.css.length > 0
            ? metadata.css.map((fileName) => ({
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
      manifestFilename: this.clientManifestFilename,
      isServer: this.isServer,
      clientReferenceCount: clientReferences.length,
      totalChunkBytes: sumUniqueKnownBytes(clientReferences),
      clientReferences,
    };
  }

  /**
   * Resolves every configured `clientReferences` entry to a
   * `ClientReferenceDependency`:
   *   - string entries are direct file references, resolved through webpack's
   *     normal resolver so they match the module graph's symlink policy;
   *   - search-path entries are expanded through the context module factory
   *     and filtered to files containing a `"use client"` directive.
   */
  resolveAllClientFiles(
    context: string,
    contextResolver: FlightResolver,
    normalResolver: FlightResolver,
    fs: unknown,
    contextModuleFactory: FlightContextModuleFactory,
    callback: (err: Error | null, result?: ClientReferenceDependency[]) => void,
    watchDependencies = createClientReferenceWatchDependencies(),
  ): void {
    asyncLib.map<ClientReferencePath, ClientReferenceDependency[]>(
      this.clientReferences,
      (clientReferencePath, cb) => {
        if (typeof clientReferencePath === 'string') {
          const configuredRequest = path.resolve(context, clientReferencePath);
          watchDependencies.files.add(configuredRequest);
          normalResolver.resolve({}, context, configuredRequest, {}, (err, resolvedPath) => {
            if (err) {
              watchDependencies.missing.add(configuredRequest);
              const clientRefDep = new ClientReferenceDependency(configuredRequest);
              clientRefDep.userRequest = clientReferencePath;
              cb(null, [clientRefDep]);
              return;
            }
            if (typeof resolvedPath !== 'string') {
              watchDependencies.missing.add(configuredRequest);
              cb(
                new Error(
                  `React Server Components: clientReferences entry "${clientReferencePath}" resolved to a non-file request.`,
                ),
              );
              return;
            }
            watchDependencies.files.add(resolvedPath);
            const clientRefDep = new ClientReferenceDependency(resolvedPath);
            clientRefDep.userRequest = clientReferencePath;
            cb(null, [clientRefDep]);
          });
          return;
        }
        contextResolver.resolve(
          {},
          context,
          clientReferencePath.directory,
          {},
          (err, resolvedDirectory) => {
            if (err) {
              watchDependencies.missing.add(path.resolve(context, clientReferencePath.directory));
              return cb(err);
            }
            const resolvedDirectoryPath = resolvedDirectory as string;
            watchDependencies.contexts.add(resolvedDirectoryPath);
            this.collectClientReferenceContextDependencies(
              fs,
              resolvedDirectoryPath,
              clientReferencePath,
              watchDependencies,
              (contextDependencyErr) => {
                if (contextDependencyErr) return cb(contextDependencyErr);
                contextModuleFactory.resolveDependencies(
                  fs,
                  {
                    resource: resolvedDirectoryPath,
                    resourceQuery: '',
                    recursive:
                      clientReferencePath.recursive === undefined
                        ? true
                        : clientReferencePath.recursive,
                    regExp: clientReferencePath.include,
                    include: undefined,
                    exclude: clientReferencePath.exclude,
                  },
                  (err2, deps) => {
                    if (err2) return cb(err2);
                    const clientRefDeps = (deps || []).map((dep) => {
                      const request = path.join(resolvedDirectoryPath, dep.userRequest);
                      watchDependencies.files.add(request);
                      const clientRefDep = new ClientReferenceDependency(request);
                      clientRefDep.userRequest = dep.userRequest;
                      return clientRefDep;
                    });
                    asyncLib.filter(
                      clientRefDeps,
                      (clientRefDep, filterCb) => {
                        normalResolver.resolve(
                          {},
                          context,
                          clientRefDep.request,
                          {},
                          (err3, resolvedPath) => {
                            if (err3 || typeof resolvedPath !== 'string') {
                              return filterCb(null, false);
                            }
                            watchDependencies.files.add(resolvedPath);
                            (fs as ReadFileFs).readFile(
                              resolvedPath,
                              'utf-8',
                              (err4, content) => {
                                if (err4 || typeof content !== 'string') {
                                  return filterCb(null, false);
                                }
                                filterCb(null, hasUseClientDirective(content));
                              },
                            );
                          },
                        );
                      },
                      cb,
                    );
                  },
                );
              },
            );
          },
        );
      },
      (err, result) => {
        if (err) return callback(err);
        const flattened: ClientReferenceDependency[] = [];
        for (const deps of result || []) {
          flattened.push(...deps);
        }
        callback(null, flattened);
      },
    );
  }

  private collectClientReferenceContextDependencies(
    fs: unknown,
    rootDirectory: string,
    clientReferencePath: ClientReferenceSearchPath,
    watchDependencies: ClientReferenceWatchDependencies,
    callback: (err: Error | null) => void,
  ): void {
    const inputFs = fs as WatchInputFileSystem;
    const recursive = clientReferencePath.recursive !== false;
    const visited = new Set<string>();

    const walk = (directory: string, done: (err?: Error | null) => void): void => {
      const visit = (canonicalDirectory: string): void => {
        if (visited.has(canonicalDirectory)) {
          done();
          return;
        }
        visited.add(canonicalDirectory);
        watchDependencies.contexts.add(directory);

        inputFs.readdir(directory, (readErr, files) => {
          if (readErr) {
            watchDependencies.missing.add(directory);
            done();
            return;
          }

          asyncLib.mapLimit<string, void>(
            (files ?? []).filter((file) => file.indexOf('.') !== 0),
            WATCH_TRAVERSAL_CONCURRENCY,
            (segment, mapDone) => {
              const child = path.join(directory, segment);
              if (clientReferencePath.exclude?.test(child)) {
                mapDone(null);
                return;
              }

              inputFs.stat(child, (statErr, stats) => {
                if (statErr) {
                  watchDependencies.missing.add(child);
                  mapDone(null);
                  return;
                }

                if (recursive && stats?.isDirectory()) {
                  walk(child, (walkErr) => mapDone(walkErr ?? null));
                  return;
                }

                mapDone(null);
              });
            },
            (err) => done(err),
          );
        });
      };

      if (!inputFs.realpath) {
        visit(directory);
        return;
      }

      inputFs.realpath(directory, (realpathErr, realPath) => {
        if (realpathErr) {
          watchDependencies.missing.add(directory);
          done();
          return;
        }
        visit(realPath ?? directory);
      });
    };

    walk(rootDirectory, (err) => callback(err ?? null));
  }
}

function sumUniqueKnownBytes(
  clientReferences: ClientReferenceDiagnostics['clientReferences'],
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
  compilation: FlightCompilation,
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

export default RSCWebpackPlugin;
