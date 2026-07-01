/**
 * Full-pipeline E2E: packed tarball → webpack+rspack builds → Flight render
 * → SSR HTML → jsdom hydration.
 *
 * Runs against a disposable consumer project prepared by scripts/e2e/run.sh
 * (`yarn test:e2e`): `npm pack` of this repo installed via npm into a temp
 * project (RSC_E2E_PROJECT_DIR), so the suite exercises the published dist/
 * files and the package exports map — not src/.
 *
 * Pipeline, per bundler leg (webpack and rspack share one fixture app in
 * tests/e2e/fixture, two configs in scripts/build.js):
 *
 *   1. Build the client bundle (web target, splitChunks-shared module, CSS
 *      via the extract plugin, split runtime chunk, seeded .hot-update
 *      assets) and the SSR bundle (node target, commonjs2 library) with the
 *      real installed plugins.
 *   2. Assert EXACT per-component manifest chunk lists (post-#54
 *      dependency-chunk-group semantics), CSS hints, runtime-chunk and
 *      .hot-update exclusion.
 *   3. Flight-render the fixture's server-component tree in a child node
 *      process under --conditions=react-server (the condition cannot be
 *      applied to this already-running jest process) and assert the wire
 *      payload embeds the manifest chunk lists and CSS hints verbatim.
 *   4. Decode the payload through the SSR bundle (createFromNodeStream +
 *      react-dom/server inside one bundled module graph) and assert the
 *      client-component boundaries appear fully rendered in the HTML.
 *   5. Hydrate in jsdom against the real client bundle served over HTTP:
 *      zero console errors/warnings, zero recoverable hydration errors,
 *      client components interactive, stylesheet links present, and the
 *      runtime's devtools-embedded version string matches the installed stock
 *      Flight runtime version (the rc.4 "runtime still reports 19.0.3" class
 *      of incident).
 *
 * Known divergences of the rspack leg (current main behavior, asserted
 * below so any change is caught):
 *   - rspack manifest entries carry no `css` field, so the Flight payload
 *     has no stylesheet hints (CSS still reaches the DOM through rspack's
 *     own chunk-CSS runtime).
 *   - the rspack plugin excludes generated client-reference chunks from
 *     splitChunks, so the shared module is duplicated per chunk instead of
 *     being split into a shared chunk.
 *   - rspack chunk names embed the sanitized absolute module path.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const PROJECT_DIR = process.env.RSC_E2E_PROJECT_DIR ?? '';
if (!PROJECT_DIR) {
  throw new Error(
    'RSC_E2E_PROJECT_DIR is not set. Run this suite through `yarn test:e2e` ' +
      '(scripts/e2e/run.sh), which packs the tarball and prepares the consumer project.',
  );
}

const REPO_ROOT = path.resolve(__dirname, '../..');
// Node resolves module paths through symlinks (e.g. /tmp → /private/tmp on
// macOS), so manifest keys use the real path.
const PROJECT_REAL = fs.realpathSync(PROJECT_DIR);
const INSTALLED_PKG = path.join(PROJECT_DIR, 'node_modules', 'react-on-rails-rsc');

type Bundler = 'webpack' | 'rspack';
const requested = process.env.RSC_E2E_BUNDLER ?? 'both';
const BUNDLERS: Bundler[] =
  requested === 'both' ? ['webpack', 'rspack'] : ([requested] as Bundler[]);
if (!BUNDLERS.every((b) => b === 'webpack' || b === 'rspack')) {
  throw new Error(`Invalid RSC_E2E_BUNDLER: ${requested} (use webpack | rspack | both)`);
}

interface ModuleMetadata {
  id: string;
  chunks: (string | number)[];
  css?: string[];
  name: string;
}
interface Manifest {
  moduleLoading: { prefix: string; crossOrigin: string | null };
  filePathToModuleMetadata: Record<string, ModuleMetadata>;
}
interface BuildResult {
  ok: boolean;
  assets: string[];
  warnings: string[];
}
interface HydrateResult {
  ok: boolean;
  valueBeforeClick: string | null;
  valueAfterClick: string | null;
  nestedLabelText: string | null;
  serverMessageText: string | null;
  stylesheetLinks: string[];
  devtoolsRenderers: { version: string; rendererPackageName: string }[];
  recoverableErrors: string[];
  consoleMessages: { level: string; message: string }[];
}

const runNode = <T>(args: string[]): T => {
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, args, {
      cwd: PROJECT_DIR,
      encoding: 'utf8',
      timeout: 240_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(
      `child process failed: node ${args.join(' ')}\n` +
        `stdout: ${err.stdout ?? ''}\nstderr: ${err.stderr ?? ''}\n${err.message}`,
    );
  }
  return JSON.parse(stdout) as T;
};

const readJson = <T>(...segments: string[]): T =>
  JSON.parse(fs.readFileSync(path.join(...segments), 'utf8')) as T;

const STOCK_RUNTIME_PACKAGE_JSON = require.resolve('react-server-dom-webpack/package.json', {
  paths: [INSTALLED_PKG],
});
const STOCK_RUNTIME_DIR = path.dirname(STOCK_RUNTIME_PACKAGE_JSON);

// The intended stock runtime version — the installed dependency and bundled
// devtools registration must report exactly this.
const INTENDED_RUNTIME_VERSION = readJson<{ version: string }>(
  STOCK_RUNTIME_PACKAGE_JSON,
).version;

const componentUrl = (file: string): string =>
  pathToFileURL(path.join(PROJECT_REAL, 'src', 'components', file)).href;

/** rspack expands `[request]` in the injected chunk name to the sanitized absolute path. */
const rspackChunkBase = (file: string): string =>
  `client-${path.join(PROJECT_REAL, 'src', 'components', file).replace(/[^a-zA-Z0-9]/g, '_')}`;

const webpackChunkBase = (file: string): string => `client-${path.basename(file, '.js')}-js`;

const chunkPair = (base: string): string[] => [base, `${base}.chunk.js`];

/** Flight module-import rows look like `<row id>:I[id, chunks, name]`. */
const importRows = (payload: string): [string, string[], string][] =>
  [...payload.matchAll(/^[0-9a-f]+:I(\[.*\])$/gm)].map(
    (m) => JSON.parse(m[1]!) as [string, string[], string],
  );

/** Flight stylesheet hint rows look like `<row id>:HS[...]` or `:HS[...]`. */
const styleHintRows = (payload: string): [string, string][] =>
  [...payload.matchAll(/^(?:[0-9a-f]+)?:HS(\[.*\])$/gm)].map(
    (m) => JSON.parse(m[1]!) as [string, string],
  );

jest.setTimeout(300_000);

describe.each(BUNDLERS)('%s leg (packed tarball pipeline)', (bundler) => {
  const buildDir = path.join(PROJECT_DIR, 'build', bundler);
  const isWebpack = bundler === 'webpack';
  const base = isWebpack ? webpackChunkBase : rspackChunkBase;

  // Exact post-#54 expectations: each client reference lists the chunks of
  // its own dependency chunk group ([id, file, ...] pairs), minus initial
  // and runtime chunks. NestedLabel is reachable through two groups (its
  // own injected block and ThemeSection's chunk), so its entry is the
  // union. Only webpack splits the shared module into its own chunk and
  // records CSS chunk files.
  const sharedPrefix = isWebpack ? chunkPair('shared-format') : [];
  const expectedClientMetadata: Record<string, ModuleMetadata> = {
    [componentUrl('Counter.js')]: {
      id: './src/components/Counter.js',
      chunks: [...sharedPrefix, ...chunkPair(base('Counter.js'))],
      ...(isWebpack ? { css: [`/assets/${base('Counter.js')}.chunk.css`] } : {}),
      name: '*',
    },
    [componentUrl('NestedLabel.js')]: {
      id: './src/components/NestedLabel.js',
      chunks: [
        ...sharedPrefix,
        ...chunkPair(base('NestedLabel.js')),
        ...(isWebpack ? [] : chunkPair(base('ThemeSection.js'))),
      ],
      ...(isWebpack ? { css: [`/assets/${base('NestedLabel.js')}.chunk.css`] } : {}),
      name: '*',
    },
    [componentUrl('ThemeSection.js')]: {
      id: './src/components/ThemeSection.js',
      chunks: [...sharedPrefix, ...chunkPair(base('ThemeSection.js'))],
      ...(isWebpack ? { css: [`/assets/${base('ThemeSection.js')}.chunk.css`] } : {}),
      name: '*',
    },
  };

  const expectedSsrMetadata: Record<string, ModuleMetadata> = {
    [componentUrl('Counter.js')]: {
      id: './src/components/Counter.js',
      chunks: chunkPair(base('Counter.js')),
      ...(isWebpack ? { css: [] } : {}),
      name: '*',
    },
    [componentUrl('NestedLabel.js')]: {
      id: './src/components/NestedLabel.js',
      chunks: [...chunkPair(base('NestedLabel.js')), ...chunkPair(base('ThemeSection.js'))],
      ...(isWebpack ? { css: [] } : {}),
      name: '*',
    },
    [componentUrl('ThemeSection.js')]: {
      id: './src/components/ThemeSection.js',
      chunks: chunkPair(base('ThemeSection.js')),
      ...(isWebpack ? { css: [] } : {}),
      name: '*',
    },
  };

  let clientBuild: BuildResult;
  let ssrBuild: BuildResult;
  let clientManifest: Manifest;
  let ssrManifest: Manifest;

  beforeAll(() => {
    clientBuild = runNode<BuildResult>(['scripts/build.js', bundler, 'client']);
    ssrBuild = runNode<BuildResult>(['scripts/build.js', bundler, 'ssr']);
    clientManifest = readJson<Manifest>(buildDir, 'client', 'react-client-manifest.json');
    ssrManifest = readJson<Manifest>(buildDir, 'ssr', 'react-server-client-manifest.json');
  });

  it('builds both bundles without warnings', () => {
    expect(clientBuild.ok).toBe(true);
    expect(clientBuild.warnings).toEqual([]);
    expect(ssrBuild.ok).toBe(true);
    expect(ssrBuild.warnings).toEqual([]);
  });

  it('emits the exact per-component client manifest', () => {
    expect(clientManifest.moduleLoading).toEqual({ prefix: '/assets/', crossOrigin: null });
    expect(clientManifest.filePathToModuleMetadata).toEqual(expectedClientMetadata);
  });

  it('emits the exact per-component SSR (server) manifest', () => {
    expect(ssrManifest.moduleLoading).toEqual({ prefix: '', crossOrigin: null });
    expect(ssrManifest.filePathToModuleMetadata).toEqual(expectedSsrMetadata);
  });

  it('excludes the runtime chunk from every client manifest entry', () => {
    // The client build splits the runtime out; it must never be listed for
    // a client reference (the 19.0.5-rc runtime-chunk CSS leak incident).
    expect(clientBuild.assets).toContain('runtime.js');
    for (const metadata of Object.values(clientManifest.filePathToModuleMetadata)) {
      const referenced = [...metadata.chunks.map(String), ...(metadata.css ?? [])];
      expect(referenced.filter((entry) => entry.includes('runtime'))).toEqual([]);
    }
  });

  it('excludes .hot-update assets from every client manifest entry', () => {
    if (isWebpack) {
      // The build seeds fake hot-update files onto the Counter chunk so
      // this exclusion is exercised by a real chunk, not vacuously.
      expect(clientBuild.assets).toContain('seeded.fake.hot-update.css');
      expect(clientBuild.assets).toContain('seeded.fake.hot-update.js');
    }
    for (const metadata of Object.values(clientManifest.filePathToModuleMetadata)) {
      const referenced = [...metadata.chunks.map(String), ...(metadata.css ?? [])];
      expect(referenced.filter((entry) => entry.includes('.hot-update.'))).toEqual([]);
    }
  });

  it('never lists server-only modules in the manifests', () => {
    for (const manifest of [clientManifest, ssrManifest]) {
      const keys = Object.keys(manifest.filePathToModuleMetadata);
      expect(keys.filter((key) => key.includes('/server/'))).toEqual([]);
    }
  });

  describe('Flight → SSR → hydration', () => {
    let payload: string;

    beforeAll(() => {
      // Child process: the react-server condition must be set at process
      // startup, so the Flight render cannot run inside jest itself.
      runNode(['--conditions=react-server', 'scripts/render-flight.js', bundler]);
      payload = fs.readFileSync(path.join(buildDir, 'flight-payload.rsc'), 'utf8');
    });

    it('embeds the manifest chunk lists verbatim in the Flight payload', () => {
      const rows = importRows(payload);
      // Only the two directly-referenced client components appear; the
      // nested NestedLabel resolves inside ThemeSection's chunks.
      expect(rows.map((row) => row[0]).sort()).toEqual([
        './src/components/Counter.js',
        './src/components/ThemeSection.js',
      ]);
      for (const file of ['Counter.js', 'ThemeSection.js']) {
        const metadata = clientManifest.filePathToModuleMetadata[componentUrl(file)]!;
        const row = rows.find((r) => r[0] === metadata.id);
        expect(row).toBeDefined();
        // The browser runtime feeds this list straight into
        // __webpack_chunk_load__ — it must match the manifest verbatim.
        expect(row![1]).toEqual(metadata.chunks.map(String));
        expect(row![2]).toBe('default');
      }
      expect(payload).toContain('rendered-on-server-only');
    });

    it(
      isWebpack
        ? 'emits stylesheet hints for the referenced client components'
        : 'emits no stylesheet hints (rspack manifest has no css metadata — current behavior)',
      () => {
        const hints = styleHintRows(payload);
        if (isWebpack) {
          expect(hints).toEqual([
            [`/assets/${base('Counter.js')}.chunk.css`, 'rsc-css'],
            [`/assets/${base('ThemeSection.js')}.chunk.css`, 'rsc-css'],
          ]);
        } else {
          // Documents the rspack-leg gap: no `css` in the manifest means no
          // Flight stylesheet hints. CSS still reaches the DOM through
          // rspack's chunk-CSS runtime (asserted in the hydration test).
          // If this starts failing, rspack gained CSS hints — tighten the
          // expectations to match the webpack leg.
          expect(hints).toEqual([]);
        }
      },
    );

    it('serializes app-declared resource hints from the public server export', () => {
      expect(payload).toContain(':HD"https://rsc-assets.example.test"');
      expect(payload).toContain(':HC["https://cdn.example.test",""]');
      expect(payload).toContain(':HL["/assets/e2e-critical.css","style"');
      expect(payload).toContain(':HL["/assets/e2e-critical.js","script"');
      expect(payload).toContain('/assets/e2e-font.woff2');
      expect(payload).toContain('"font"');
      expect(payload).toContain('"type":"font/woff2"');
      expect(payload).toContain('/assets/e2e-hero.webp');
      expect(payload).toContain('"fetchPriority":"high"');
      expect(payload).toContain('"imageSizes":"100vw"');
    });

    it('renders the payload to SSR HTML with executed client components', () => {
      const result = runNode<{ ok: boolean; errors: string[] }>([
        'scripts/render-ssr.js',
        bundler,
      ]);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);

      const html = fs.readFileSync(path.join(buildDir, 'ssr.html'), 'utf8');
      // Server-component content…
      expect(html).toContain('<h1>RSC E2E Fixture</h1>');
      expect(html).toContain('rendered-on-server-only');
      // …and the client-component boundaries, fully executed through the
      // SSR bundle's real chunk loading (state, shared module, nesting).
      expect(html).toContain('<div class="counter" data-testid="counter">');
      expect(html).toContain('<span data-testid="counter-value">clicks: 3</span>');
      expect(html).toContain('<section class="theme-section" data-testid="theme-section">');
      expect(html).toContain('<em class="nested-label" data-testid="nested-label">theme: dark</em>');
    });

    it('hydrates in jsdom with zero errors and interactive client components', () => {
      const result = runNode<HydrateResult>(['scripts/hydrate.js', bundler]);

      expect(result.consoleMessages).toEqual([]);
      expect(result.recoverableErrors).toEqual([]);
      expect(result.ok).toBe(true);

      // Hydrated from SSR markup, then interactive after a click.
      expect(result.serverMessageText).toBe('rendered-on-server-only');
      expect(result.nestedLabelText).toBe('theme: dark');
      expect(result.valueBeforeClick).toBe('clicks: 3');
      expect(result.valueAfterClick).toBe('clicks: 4');

      // Stylesheets reach the document head: on webpack via the Flight
      // CSS hints (preinit), on rspack via the chunk-CSS runtime.
      const expectedLinks = isWebpack
        ? [
            `/assets/${base('Counter.js')}.chunk.css`,
            `/assets/${base('ThemeSection.js')}.chunk.css`,
          ]
        : [
            `/assets/${base('Counter.js')}.chunk.css`,
            `/assets/${base('NestedLabel.js')}.chunk.css`,
            `/assets/${base('ThemeSection.js')}.chunk.css`,
          ];
      expect([...result.stylesheetLinks].sort()).toEqual([...expectedLinks].sort());

      // The runtime's embedded version string (captured from the devtools
      // hook registration) must match the intended stock runtime version — catches
      // stale runtime builds like the rc.4 "still reports 19.0.3" incident.
      const flightRenderer = result.devtoolsRenderers.find(
        (renderer) => renderer.rendererPackageName === 'react-server-dom-webpack',
      );
      expect(flightRenderer).toBeDefined();
      expect(flightRenderer!.version).toBe(INTENDED_RUNTIME_VERSION);

      // And react-dom in the client bundle is the consumer-installed copy.
      const reactDomVersion = readJson<{ version: string }>(
        PROJECT_DIR,
        'node_modules',
        'react-dom',
        'package.json',
      ).version;
      const domRenderer = result.devtoolsRenderers.find(
        (renderer) => renderer.rendererPackageName === 'react-dom',
      );
      expect(domRenderer).toBeDefined();
      expect(domRenderer!.version).toBe(reactDomVersion);
    });
  });
});

describe('installed tarball version integrity', () => {
  it('installs the intended stock runtime version next to the packed package', () => {
    const installedRuntimeVersion = readJson<{ version: string }>(
      STOCK_RUNTIME_PACKAGE_JSON,
    ).version;
    expect(installedRuntimeVersion).toBe(INTENDED_RUNTIME_VERSION);

    // And every version string embedded in the installed runtime sources.
    const cjsDir = path.join(STOCK_RUNTIME_DIR, 'cjs');
    const embedded: Record<string, string[]> = {};
    for (const file of fs.readdirSync(cjsDir)) {
      if (!file.endsWith('.js')) continue;
      const source = fs.readFileSync(path.join(cjsDir, file), 'utf8');
      const versions = [
        ...source.matchAll(/\b(?:version|reconcilerVersion):\s*"([0-9][^"]*)"/g),
      ].map((m) => m[1]!);
      if (versions.length > 0) embedded[file] = versions;
    }
    // At least the development browser client embeds its version via the
    // devtools registration — if this goes empty the assertion is vacuous.
    expect(Object.keys(embedded).length).toBeGreaterThan(0);
    for (const [file, versions] of Object.entries(embedded)) {
      for (const version of versions) {
        expect({ file, version }).toEqual({ file, version: INTENDED_RUNTIME_VERSION });
      }
    }

    // The installed package itself is the version this repo packs.
    const repoVersion = readJson<{ version: string }>(REPO_ROOT, 'package.json').version;
    const installedVersion = readJson<{ version: string }>(INSTALLED_PKG, 'package.json').version;
    expect(installedVersion).toBe(repoVersion);
  });
});
