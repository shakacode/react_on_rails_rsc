/**
 * Verify `server.node` is rspack-compatible by bundling it with rspack
 * and running the bundled output.
 *
 * `server.node` exports:
 *   - `buildServerRenderer(clientManifest)`
 *   - `renderToPipeableStream(model, clientManifest, options?)`
 *
 * Both wrap `renderToPipeableStream` from the vendored
 * `react-server-dom-webpack/server.node`. The goal of this test is to
 * prove that:
 *
 *   1. rspack can bundle `server.node.js` without build errors
 *   2. The resulting bundle can be required from Node and the exports match
 *   3. `renderToPipeableStream` actually runs and returns a pipeable stream
 *      of Flight-encoded data
 *
 * We run the bundle in a child Node process for two reasons:
 *   (a) Jest's VM sandbox doesn't support native streams/workers reliably
 *   (b) The rspack-bundled code uses the RSC export condition at require
 *       time, which must be set via NODE_CONDITIONS in the child env
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

const DIST_SERVER_NODE = path.resolve(__dirname, '../../dist/server.node.js');

describe('server.node is rspack-compatible', () => {
  let tmpDir: string;

  beforeAll(() => {
    if (!fs.existsSync(DIST_SERVER_NODE)) {
      throw new Error(
        `Precondition failed: ${DIST_SERVER_NODE} does not exist. Run \`yarn build\` first.`,
      );
    }
  });

  beforeEach(() => {
    tmpDir = makeTmpDir('ror-rsc-rspack-srvnode-');
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it('rspack can bundle the dist/server.node.js entry without errors', () => {
    // Bundle dist/server.node.js as the entry point.
    // We mark react, react-dom, and the vendored react-server-dom-webpack as
    // external so the bundle stays small and doesn't duplicate React.
    const result = runRspack(
      {
        mode: 'development',
        target: 'node',
        entry: DIST_SERVER_NODE,
        output: {
          path: tmpDir,
          filename: 'server.bundle.js',
          library: { type: 'commonjs2' },
        },
        devtool: false,
        externals: {
          // Bare module specifiers are marked as commonjs externals so rspack
          // doesn't try to bundle them. Node built-ins (util, crypto,
          // async_hooks) are automatically external for target: 'node'.
          react: 'commonjs2 react',
          'react-dom': 'commonjs2 react-dom',
        },
        externalsType: 'commonjs2',
      },
      tmpDir,
    );

    expectRspackSuccess(result);
    expect(fs.existsSync(path.join(tmpDir, 'server.bundle.js'))).toBe(true);
  });

  it('bundled server.node exports renderToPipeableStream and buildServerRenderer', () => {
    runBundleAndGetResult(tmpDir, 'exports');
  });

  it('bundled server.node can renderToPipeableStream over a plain model', () => {
    // End-to-end: the rspack-bundled server, when loaded with the
    // react-server export condition, must actually encode a React tree
    // into a Flight stream.
    runBundleAndGetResult(tmpDir, 'render');
  });
});

/**
 * Helper: bundle dist/server.node.js with rspack, then require the bundle
 * in a child Node process and run a small smoke test against it.
 */
function runBundleAndGetResult(tmpDir: string, op: 'exports' | 'render'): void {
  const result = runRspack(
    {
      mode: 'development',
      target: 'node',
      entry: DIST_SERVER_NODE,
      output: {
        path: tmpDir,
        filename: 'server.bundle.js',
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

  // Write the runner script that will load the bundle and execute the op
  const runnerScript = path.join(tmpDir, 'runner.js');
  // The child process must resolve `react` / `react-dom` from the project's
  // node_modules. We include the project's node_modules in NODE_PATH so the
  // bundle and runner can find them.
  const projectRoot = path.resolve(__dirname, '../..');
  const nodeModulesDir = path.join(projectRoot, 'node_modules');
  const childEnv = {
    ...process.env,
    // NODE_CONDITIONS is Jest-specific; Node.js itself uses the CLI flag
    // --conditions=react-server (set via NODE_OPTIONS).
    NODE_OPTIONS: '--conditions=react-server',
    NODE_PATH: nodeModulesDir,
  };

  if (op === 'exports') {
    fs.writeFileSync(
      runnerScript,
      `
        require('module').Module._initPaths();
        const mod = require('./server.bundle.js');
        const report = {
          hasRenderToPipeableStream: typeof mod.renderToPipeableStream === 'function',
          hasBuildServerRenderer: typeof mod.buildServerRenderer === 'function',
        };
        process.stdout.write(JSON.stringify(report));
      `,
    );
    const out = execFileSync(process.execPath, [runnerScript], {
      cwd: tmpDir,
      encoding: 'utf8',
      env: childEnv,
    });
    const report = JSON.parse(out);
    expect(report.hasRenderToPipeableStream).toBe(true);
    expect(report.hasBuildServerRenderer).toBe(true);
  } else {
    // Render a plain React tree through the rspack-bundled server.node
    // and verify we get a Flight-encoded stream back.
    fs.writeFileSync(
      runnerScript,
      `
        require('module').Module._initPaths();
        const React = require('react');
        const { renderToPipeableStream } = require('./server.bundle.js');
        const { PassThrough } = require('stream');

        const model = React.createElement('h1', null, 'Hello RSC');
        // Empty client manifest — this model has no "use client" references
        const clientManifest = {
          filePathToModuleMetadata: {},
          moduleLoading: { prefix: '', crossOrigin: null },
        };
        const stream = renderToPipeableStream(model, clientManifest);
        const sink = new PassThrough();
        const chunks = [];
        sink.on('data', (c) => chunks.push(c));
        sink.on('end', () => {
          const payload = Buffer.concat(chunks).toString('utf8');
          process.stdout.write(JSON.stringify({ payload }));
        });
        stream.pipe(sink);
      `,
    );
    const out = execFileSync(process.execPath, [runnerScript], {
      cwd: tmpDir,
      encoding: 'utf8',
      env: childEnv,
      timeout: 30000,
    });
    const { payload } = JSON.parse(out);
    // Flight payload is line-delimited, each line starts with an ID. The
    // root element should be encoded as row "0".
    expect(payload).toMatch(/^0:/m);
    expect(payload).toContain('h1');
    expect(payload).toContain('Hello RSC');
  }
}
