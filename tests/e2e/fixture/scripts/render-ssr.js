#!/usr/bin/env node
/**
 * SSR render — runs WITHOUT the react-server condition (normal SSR env).
 *
 * Usage: node scripts/render-ssr.js <webpack|rspack>
 *
 * Loads the SSR bundle (commonjs2 library), decodes the captured Flight
 * payload with `createFromNodeStream` + the generated client/server
 * manifests (real chunk loading inside the bundle's own runtime), then
 * renders the decoded tree to HTML with the react-dom/server instance
 * bundled alongside the Flight client. Writes build/<bundler>/ssr.html.
 *
 * The react-dom render is started BEFORE the payload stream flows so the
 * Flight client's stylesheet hints are dispatched while the render request
 * is active.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { PassThrough, Readable } = require('stream');

const bundlerName = process.argv[2];
const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.join(projectRoot, 'build', bundlerName);

const ssrBundle = require(path.join(buildDir, 'ssr', 'main.js'));
const { buildClientRenderer, React, ReactDOMServer } = ssrBundle;

const clientManifest = JSON.parse(
  fs.readFileSync(path.join(buildDir, 'client', 'react-client-manifest.json'), 'utf8'),
);
const serverManifest = JSON.parse(
  fs.readFileSync(path.join(buildDir, 'ssr', 'react-server-client-manifest.json'), 'utf8'),
);
const payload = fs.readFileSync(path.join(buildDir, 'flight-payload.rsc'), 'utf8');

const { createFromNodeStream } = buildClientRenderer(clientManifest, serverManifest);
const treePromise = createFromNodeStream(Readable.from([Buffer.from(payload, 'utf8')]));

const Root = () => React.use(treePromise);

const errors = [];
const finish = (ok, html) => {
  if (html !== undefined) fs.writeFileSync(path.join(buildDir, 'ssr.html'), html);
  process.stdout.write(JSON.stringify({ ok, errors, htmlLength: html ? html.length : 0 }));
  process.exit(ok ? 0 : 1);
};

const stream = ReactDOMServer.renderToPipeableStream(React.createElement(Root), {
  onError(error) {
    errors.push(String((error && error.stack) || error));
  },
  onShellError(error) {
    errors.push(`shell: ${String((error && error.stack) || error)}`);
    finish(false);
  },
  onAllReady() {
    const sink = new PassThrough();
    let html = '';
    sink.on('data', (chunk) => {
      html += chunk;
    });
    sink.on('end', () => finish(errors.length === 0, html));
    stream.pipe(sink);
  },
});
