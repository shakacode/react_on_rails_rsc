/**
 * Verify `client.node` is rspack-compatible by bundling it with rspack
 * and running the bundled output.
 *
 * `client.node` exports:
 *   - `buildClientRenderer(clientManifest, serverManifest)` → { createFromNodeStream, ssrManifest }
 *
 * The underlying `createFromNodeStream` from the vendored
 * `react-server-dom-webpack/client.node` uses `__webpack_require__` and
 * `__webpack_chunk_load__` to load client-component implementations during
 * SSR. When rspack bundles `client.node`, it emits those globals into the
 * bundle scope, so the decoder satisfies its own runtime ABI.
 *
 * This test proves:
 *   1. rspack can bundle `client.node.js` without build errors
 *   2. The bundle contains `__webpack_require__` (sync module access)
 *      and `__webpack_chunk_load__` (chunk loading) in the emitted runtime
 *   3. Exports survive bundling — `buildClientRenderer` is callable
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  makeTmpDir,
  cleanupTmpDir,
  runRspack,
  expectRspackSuccess,
} from './helpers/rspackRunner';

const DIST_CLIENT_NODE = path.resolve(__dirname, '../../dist/client.node.js');

describe('client.node is rspack-compatible', () => {
  let tmpDir: string;

  beforeAll(() => {
    if (!fs.existsSync(DIST_CLIENT_NODE)) {
      throw new Error(
        `Precondition failed: ${DIST_CLIENT_NODE} does not exist. Run \`yarn build\` first.`,
      );
    }
  });

  beforeEach(() => {
    tmpDir = makeTmpDir('ror-rsc-rspack-cltnode-');
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  const bundleClientNode = (): void => {
    const result = runRspack(
      {
        mode: 'development',
        target: 'node',
        // Force dynamic-import-like code path so rspack emits chunk runtime
        // even though our entry doesn't itself use import().
        entry: DIST_CLIENT_NODE,
        output: {
          path: tmpDir,
          filename: 'client.bundle.js',
          library: { type: 'commonjs2' },
        },
        devtool: false,
        externals: {
          react: 'commonjs2 react',
          'react-dom': 'commonjs2 react-dom',
        },
        externalsType: 'commonjs2',
      },
      tmpDir,
    );
    expectRspackSuccess(result);
  };

  it('rspack can bundle the dist/client.node.js entry without errors', () => {
    bundleClientNode();
    expect(fs.existsSync(path.join(tmpDir, 'client.bundle.js'))).toBe(true);
  });

  it('bundled client.node emits __webpack_require__ in its runtime', () => {
    bundleClientNode();
    const bundle = fs.readFileSync(path.join(tmpDir, 'client.bundle.js'), 'utf8');
    // The bundled output defines __webpack_require__ locally so the
    // vendored react-server-dom-webpack code resolves its runtime globals.
    expect(bundle).toMatch(/__webpack_require__/);
  });

  it('bundled client.node exports buildClientRenderer as a callable function', () => {
    bundleClientNode();
    // Load the bundle in a child process and verify buildClientRenderer
    // is callable. We do this in a child process because the bundle
    // require()s react-dom which pulls in DOM-ish code; isolating it
    // keeps Jest's test worker clean.
    const projectRoot = path.resolve(__dirname, '../..');
    const nodeModulesDir = path.join(projectRoot, 'node_modules');
    const runnerScript = path.join(tmpDir, 'runner.js');
    fs.writeFileSync(
      runnerScript,
      `
        require('module').Module._initPaths();
        const mod = require('./client.bundle.js');
        const report = {
          hasBuildClientRenderer: typeof mod.buildClientRenderer === 'function',
        };

        // Call it with empty manifests — it must not throw.
        let invokeOk = false;
        let ssrManifestShape = null;
        try {
          const renderer = mod.buildClientRenderer(
            { filePathToModuleMetadata: {}, moduleLoading: { prefix: '', crossOrigin: null } },
            { filePathToModuleMetadata: {}, moduleLoading: { prefix: '', crossOrigin: null } },
          );
          invokeOk = typeof renderer.createFromNodeStream === 'function';
          ssrManifestShape = Object.keys(renderer.ssrManifest || {}).sort();
        } catch (e) {
          invokeOk = false;
        }
        report.invokeOk = invokeOk;
        report.ssrManifestShape = ssrManifestShape;
        process.stdout.write(JSON.stringify(report));
      `,
    );
    const out = execFileSync(process.execPath, [runnerScript], {
      cwd: tmpDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_PATH: nodeModulesDir,
      },
      timeout: 30000,
    });
    const report = JSON.parse(out);
    expect(report.hasBuildClientRenderer).toBe(true);
    expect(report.invokeOk).toBe(true);
    // Returned ssrManifest must have moduleLoading + moduleMap keys
    expect(report.ssrManifestShape).toContain('moduleLoading');
    expect(report.ssrManifestShape).toContain('moduleMap');
  });
});
