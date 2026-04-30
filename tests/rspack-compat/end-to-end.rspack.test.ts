/**
 * End-to-end integration: encode a React tree to Flight with the
 * rspack-bundled `server.node`, decode it with the rspack-bundled
 * `client.node`, and assert the decoded React tree matches the input.
 *
 * This is the strongest form of the rspack-compat claim: it proves that
 * the full encode → decode pipeline works when BOTH sides are produced
 * by rspack, not webpack.
 *
 * If any runtime global is mis-emitted by rspack, if any internal API
 * diverges, if the Flight wire protocol parses differently, this test
 * catches it.
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
const DIST_CLIENT_NODE = path.resolve(__dirname, '../../dist/client.node.js');

describe('End-to-end: rspack-bundled server encodes, rspack-bundled client decodes', () => {
  let tmpDir: string;

  beforeAll(() => {
    if (!fs.existsSync(DIST_SERVER_NODE) || !fs.existsSync(DIST_CLIENT_NODE)) {
      throw new Error('Precondition failed: dist/ not built. Run `yarn build` first.');
    }
  });

  beforeEach(() => {
    tmpDir = makeTmpDir('ror-rsc-rspack-e2e-');
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it('encodes a React tree with rspack-built server.node and decodes it with rspack-built client.node', () => {
    // 1) Bundle server.node
    const serverResult = runRspack(
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
    expectRspackSuccess(serverResult);

    // 2) Bundle client.node
    const clientResult = runRspack(
      {
        mode: 'development',
        target: 'node',
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
    expectRspackSuccess(clientResult);

    // 3) Child process does the encode + decode.
    //    Important: the encode side needs --conditions=react-server; the
    //    decode side must NOT have it (it needs react-dom for SSR).
    //    So we do encode in one child, capture the stream bytes, then
    //    decode in another child. This matches how RoR runs in prod:
    //    the RSC bundle renders into a stream, and a separate SSR bundle
    //    decodes it.

    const projectRoot = path.resolve(__dirname, '../..');
    const nodeModulesDir = path.join(projectRoot, 'node_modules');

    // Encode step — run under react-server condition
    const encodeScript = path.join(tmpDir, 'encode.js');
    fs.writeFileSync(
      encodeScript,
      `
        require('module').Module._initPaths();
        const React = require('react');
        const { renderToPipeableStream } = require('./server.bundle.js');
        const { PassThrough } = require('stream');

        // A simple tree: fragment with two elements and some text
        const model = React.createElement(
          'div',
          { id: 'rsc-root' },
          React.createElement('h1', null, 'Hello from rspack RSC'),
          React.createElement('p', null, 'encoded in child 1')
        );
        const stream = renderToPipeableStream(model, {
          filePathToModuleMetadata: {},
          moduleLoading: { prefix: '', crossOrigin: null },
        });

        const sink = new PassThrough();
        const chunks = [];
        sink.on('data', (c) => chunks.push(c));
        sink.on('end', () => {
          const payload = Buffer.concat(chunks);
          // Emit base64 to avoid stdout encoding issues
          process.stdout.write(payload.toString('base64'));
        });
        stream.pipe(sink);
      `,
    );
    const payloadB64 = execFileSync(process.execPath, [encodeScript], {
      cwd: tmpDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: '--conditions=react-server',
        NODE_PATH: nodeModulesDir,
      },
      timeout: 30000,
    });
    const rawPayload = Buffer.from(payloadB64, 'base64').toString('utf8');
    // Quick sanity: Flight rows start with `ID:`; row 0 must exist
    expect(rawPayload).toMatch(/^0:/m);
    expect(rawPayload).toContain('Hello from rspack RSC');

    // Decode step — run WITHOUT react-server condition (normal SSR env)
    fs.writeFileSync(path.join(tmpDir, 'payload.b64'), payloadB64);
    const decodeScript = path.join(tmpDir, 'decode.js');
    fs.writeFileSync(
      decodeScript,
      `
        require('module').Module._initPaths();
        const fs = require('fs');
        const { Readable } = require('stream');
        const { buildClientRenderer } = require('./client.bundle.js');

        const payload = Buffer.from(fs.readFileSync('./payload.b64', 'utf8'), 'base64');
        const stream = Readable.from(payload);

        const { createFromNodeStream } = buildClientRenderer(
          { filePathToModuleMetadata: {}, moduleLoading: { prefix: '', crossOrigin: null } },
          { filePathToModuleMetadata: {}, moduleLoading: { prefix: '', crossOrigin: null } },
        );

        (async () => {
          try {
            const element = await createFromNodeStream(stream);
            // Serialize the decoded React element structure for inspection
            const serialize = (node) => {
              if (node == null || typeof node !== 'object') return node;
              if (Array.isArray(node)) return node.map(serialize);
              if (node.$$typeof) {
                return {
                  type: typeof node.type === 'string' ? node.type : 'fn',
                  props: Object.fromEntries(
                    Object.entries(node.props || {}).map(([k, v]) => [k, serialize(v)])
                  ),
                };
              }
              return String(node);
            };
            const out = serialize(element);
            process.stdout.write(JSON.stringify({ ok: true, out }));
          } catch (e) {
            process.stdout.write(JSON.stringify({ ok: false, error: String(e) }));
          }
        })();
      `,
    );
    const decodeOut = execFileSync(process.execPath, [decodeScript], {
      cwd: tmpDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_PATH: nodeModulesDir,
      },
      timeout: 30000,
    });
    const result = JSON.parse(decodeOut);

    if (!result.ok) {
      throw new Error(`decode failed: ${result.error}`);
    }

    // The decoded element should be a <div> with id="rsc-root" and two children.
    expect(result.out.type).toBe('div');
    expect(result.out.props.id).toBe('rsc-root');
    const children = result.out.props.children;
    expect(Array.isArray(children)).toBe(true);
    expect(children.length).toBe(2);
    // First child: h1 with "Hello from rspack RSC"
    expect(children[0].type).toBe('h1');
    expect(children[0].props.children).toBe('Hello from rspack RSC');
    // Second child: p with "encoded in child 1"
    expect(children[1].type).toBe('p');
    expect(children[1].props.children).toBe('encoded in child 1');
  });
});
