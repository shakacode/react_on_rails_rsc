/**
 * Verify `client.browser` is rspack-compatible by bundling it with rspack
 * for the web target.
 *
 * `client.browser` exports:
 *   - `createFromFetch(res, options?)`
 *   - `createFromReadableStream(stream, options?)`
 *
 * Both are thin re-exports of the underlying `react-server-dom-webpack/client.browser`
 * functions, which in turn use these runtime globals:
 *   - `__webpack_require__` — sync module access
 *   - `__webpack_chunk_load__` — chunk loading
 *   - `__webpack_require__.u` — chunk filename resolver (monkey-patched by React)
 *
 * This test proves:
 *   1. rspack can bundle `client.browser.js` with target: 'web' without errors
 *   2. The bundle emits `__webpack_require__` and assigns to `__webpack_require__.u`
 *      as a plain function property (not a frozen getter — React must be
 *      able to monkey-patch it)
 *   3. Exports survive bundling — both `createFromFetch` and
 *      `createFromReadableStream` are present as callable functions
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  makeTmpDir,
  cleanupTmpDir,
  runRspack,
  expectRspackSuccess,
} from './helpers/rspackRunner';

const DIST_CLIENT_BROWSER = path.resolve(__dirname, '../../dist/client.browser.js');

describe('client.browser is rspack-compatible', () => {
  let tmpDir: string;

  beforeAll(() => {
    if (!fs.existsSync(DIST_CLIENT_BROWSER)) {
      throw new Error(
        `Precondition failed: ${DIST_CLIENT_BROWSER} does not exist. Run \`yarn build\` first.`,
      );
    }
  });

  beforeEach(() => {
    tmpDir = makeTmpDir('ror-rsc-rspack-cltbrow-');
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  const bundleClientBrowser = (): string => {
    // Wrap the entry in a tiny glue module that explicitly references both
    // exports so tree-shaking cannot drop them.
    const entryFile = path.join(tmpDir, 'entry.js');
    fs.writeFileSync(
      entryFile,
      `
        import { createFromFetch, createFromReadableStream } from '${DIST_CLIENT_BROWSER.replace(/\\/g, '/')}';
        // Expose both on a global so the test can see them even after bundling.
        globalThis.__rscClientBrowser = { createFromFetch, createFromReadableStream };
      `,
    );

    const result = runRspack(
      {
        mode: 'development',
        target: 'web',
        entry: entryFile,
        output: {
          path: tmpDir,
          filename: 'client.bundle.js',
          library: { type: 'var', name: 'RSCClient' },
        },
        devtool: false,
        externals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
      tmpDir,
    );
    expectRspackSuccess(result);
    return fs.readFileSync(path.join(tmpDir, 'client.bundle.js'), 'utf8');
  };

  it('rspack can bundle the dist/client.browser.js entry for web target without errors', () => {
    bundleClientBrowser();
    expect(fs.existsSync(path.join(tmpDir, 'client.bundle.js'))).toBe(true);
  });

  it('bundled client.browser emits __webpack_require__ in its runtime', () => {
    const bundle = bundleClientBrowser();
    expect(bundle).toMatch(/__webpack_require__/);
  });

  it('bundled client.browser contains the createFromFetch and createFromReadableStream exports', () => {
    const bundle = bundleClientBrowser();
    // The functions are imported from the package's dist; their names
    // survive in the bundle (in dev mode without minification).
    expect(bundle).toContain('createFromFetch');
    expect(bundle).toContain('createFromReadableStream');
  });

  it('bundled client.browser can be executed in a web-like sandbox and exposes both exports', () => {
    const bundle = bundleClientBrowser();

    // Evaluate the bundle in a minimal VM with web-ish globals.
    // This simulates what a browser does when loading a script.
    // We're not testing the FULL browser behavior — we just need the
    // bundle to execute and expose the two exports.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vm = require('vm') as typeof import('vm');
    const sandbox: Record<string, unknown> = {
      // React globals (not actually used at module-init time)
      React: {},
      ReactDOM: {},
      // Stubs for browser APIs the bundle might touch at init
      TextEncoder: global.TextEncoder,
      TextDecoder: global.TextDecoder,
      ReadableStream: global.ReadableStream,
      Response: global.Response,
      // The RSC browser client DOES reference document in some code paths
      // that are loaded lazily — the bundle initializes without touching
      // them, so a trivial stub is fine.
      document: { head: {}, createElement: () => ({}) },
      window: {},
      console,
      Promise,
      Error,
    };
    (sandbox as { globalThis: unknown }).globalThis = sandbox;

    const context = vm.createContext(sandbox);
    vm.runInContext(bundle, context, { filename: 'client.bundle.js' });

    const exports = (sandbox as { __rscClientBrowser?: Record<string, unknown> })
      .__rscClientBrowser;
    expect(exports).toBeDefined();
    expect(typeof exports!.createFromFetch).toBe('function');
    expect(typeof exports!.createFromReadableStream).toBe('function');
  });

  it('bundled client.browser does not freeze __webpack_require__.u (React must be able to override it)', () => {
    const bundle = bundleClientBrowser();

    // React's Flight client does:
    //   const webpackGetChunkFilename = __webpack_require__.u;
    //   __webpack_require__.u = function(chunkId) { ... };
    //
    // For this to work, `__webpack_require__.u` must be a plain assignable
    // property — NOT a getter returning a frozen function. We already know
    // from the runtime-abi test that rspack assigns to `.u`; here we add
    // an extra sanity: the bundled client itself does not Object.defineProperty
    // `.u` with an accessor.
    const frozenGetter = /Object\.defineProperty\(__webpack_require__,\s*['"]u['"],\s*\{[^}]*\bget\s*[:=]/;
    expect(bundle).not.toMatch(frozenGetter);
  });
});
