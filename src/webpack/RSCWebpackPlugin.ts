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
import { hasUseClientDirective } from '../clientReferences';

// neo-async ships no type definitions; declare the two helpers we use.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const asyncLib = require('neo-async') as {
  map<T, R>(
    arr: ReadonlyArray<T>,
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
  clientManifestFilename?: string;
  serverConsumerManifestFilename?: string;
};

type ModuleMetadata = {
  id: string | number | null;
  chunks: (string | number | null)[];
  css: string[] | null;
  name: string;
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
  /** Inner modules of a ConcatenatedModule. */
  modules?: FlightModule[];
  addBlock?: (block: unknown) => void;
};

type FlightChunk = {
  id: string | number | null;
  files: Iterable<string>;
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
  outputOptions: {
    publicPath?: string;
    crossOriginLoading?: false | 'anonymous' | 'use-credentials';
  };
  entrypoints: { forEach(fn: (entrypoint: FlightEntrypoint) => void): void };
  chunkGroups: Iterable<FlightChunkGroup>;
  chunkGraph: {
    getChunkModulesIterable(chunk: FlightChunk): Iterable<FlightModule>;
    getModuleId(module: FlightModule): string | number | null;
  };
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

const PLUGIN_NAME = 'React Server Plugin';

export class RSCWebpackPlugin {
  readonly isServer: boolean;

  readonly clientReferences: ReadonlyArray<ClientReferencePath>;

  readonly chunkName: string;

  readonly clientManifestFilename: string;

  /**
   * Accepted for option-shape compatibility with React's reference plugin;
   * the previously vendored build never emitted this manifest and neither
   * does this port.
   */
  readonly serverConsumerManifestFilename: string;

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

    const defaultClientManifestFilename = this.isServer
      ? 'react-server-client-manifest.json'
      : 'react-client-manifest.json';
    this.clientManifestFilename =
      options.clientManifestFilename || defaultClientManifestFilename;
    this.serverConsumerManifestFilename =
      options.serverConsumerManifestFilename || 'react-ssr-manifest.json';
  }

  apply(compiler: webpack.Compiler): void {
    const flightCompiler = compiler as unknown as FlightCompiler;
    let resolvedClientReferences: ClientReferenceDependency[] | undefined;
    let clientFileNameFound = false;

    // Phase 1: resolve every configured client reference before the
    // compilation starts so the parser hook below can attach their
    // AsyncDependenciesBlocks to the Flight runtime module.
    flightCompiler.hooks.beforeCompile.tapAsync(PLUGIN_NAME, (params, callback) => {
      const contextResolver = flightCompiler.resolverFactory.get('context', {});
      const normalResolver = flightCompiler.resolverFactory.get('normal');
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
          resolvedClientReferences = resolvedClientRefs;
          callback();
        },
      );
    });

    // Phase 2: when the Flight client runtime module is parsed, attach one
    // named AsyncDependenciesBlock per resolved client reference, creating
    // the chunk groups the manifest is later built from.
    flightCompiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation, params) => {
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
          const filePathToModuleMetadata: Record<string, ModuleMetadata> = {};
          const manifest = {
            moduleLoading: {
              prefix: compilation.outputOptions.publicPath || '',
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
            typeof compilation.outputOptions.publicPath === 'string' &&
            compilation.outputOptions.publicPath !== 'auto'
              ? compilation.outputOptions.publicPath
              : null;
          if (cssPrefix && !cssPrefix.endsWith('/')) {
            cssPrefix += '/';
          }

          let missingClientReferenceBlocksWarningEmitted = false;

          // Records every module of `chunkGroup` whose resource is in
          // `chunkResolvedClientFiles`, listing the chunk group's own
          // chunks (and CSS files) in the manifest entry. Merges into an
          // existing manifest entry (chunks deduped by chunk id, CSS by
          // URL) instead of overwriting it.
          const recordChunkGroup = (
            chunkGroup: FlightChunkGroup,
            chunkResolvedClientFiles: Set<string>,
          ): void => {
            const chunks: (string | number | null)[] = [];

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

            // Record the loadable JS file of every chunk in the group: the
            // chunk loader needs each dependency chunk to run the module, and
            // it no-ops on chunks the page already installed. (CSS-before-JS
            // scan fix: the JS file is found regardless of its position in
            // `chunk.files`.)
            for (const chunk of chunkGroup.chunks) {
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
            for (const chunk of chunkGroup.chunks) {
              const chunkCss: string[] = [];
              for (const file of chunk.files) {
                if (
                  file.endsWith('.css') &&
                  !file.endsWith('.hot-update.css') &&
                  cssPrefix !== null &&
                  (this.isServer || !runtimeChunkFiles.has(file))
                ) {
                  chunkCss.push(cssPrefix + file);
                }
              }
              for (const module of compilation.chunkGraph.getChunkModulesIterable(chunk)) {
                const moduleId = compilation.chunkGraph.getModuleId(module);
                recordModule(moduleId, module, chunkCss);
                if (module.modules) {
                  for (const concatenatedMod of module.modules) {
                    recordModule(moduleId, concatenatedMod, chunkCss);
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
                recordChunkGroup(chunkGroup, chunkResolvedClientFiles);
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
          }

          compilation.emitAsset(
            this.clientManifestFilename,
            new webpack.sources.RawSource(JSON.stringify(manifest, null, 2), false),
          );
        },
      );
    });
  }

  /**
   * Resolves every configured `clientReferences` entry to a
   * `ClientReferenceDependency`:
   *   - string entries are direct file references, included unconditionally;
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
  ): void {
    asyncLib.map<ClientReferencePath, ClientReferenceDependency[]>(
      this.clientReferences,
      (clientReferencePath, cb) => {
        if (typeof clientReferencePath === 'string') {
          cb(null, [new ClientReferenceDependency(clientReferencePath)]);
          return;
        }
        contextResolver.resolve(
          {},
          context,
          clientReferencePath.directory,
          {},
          (err, resolvedDirectory) => {
            if (err) return cb(err);
            contextModuleFactory.resolveDependencies(
              fs,
              {
                resource: resolvedDirectory as string,
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
                  const request = path.join(resolvedDirectory as string, dep.userRequest);
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
                        (fs as ReadFileFs).readFile(resolvedPath, 'utf-8', (err4, content) => {
                          if (err4 || typeof content !== 'string') {
                            return filterCb(null, false);
                          }
                          filterCb(null, hasUseClientDirective(content));
                        });
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
}

export default RSCWebpackPlugin;
