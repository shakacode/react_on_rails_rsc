#!/usr/bin/env node
/**
 * Flight render — MUST run under `--conditions=react-server` (the harness
 * launches it in a child process; the condition cannot be applied to an
 * already-running test process).
 *
 * Usage: node --conditions=react-server scripts/render-flight.js <webpack|rspack>
 *
 * Renders the fixture's server-component tree with the GENERATED client
 * manifest through the installed package's `server.node` export (this
 * exercises the exports map under the react-server condition) and writes
 * the Flight payload to build/<bundler>/flight-payload.rsc.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { PassThrough } = require('stream');

const bundlerName = process.argv[2];
// The bundlers resolve symlinks (e.g. /tmp → /private/tmp on macOS), so the
// manifest keys use real paths; the registered reference IDs must match.
const projectRoot = fs.realpathSync(path.resolve(__dirname, '..'));
const buildDir = path.join(projectRoot, 'build', bundlerName);

// The public wrapper (exports-map entry)…
const { renderToPipeableStream } = require('react-on-rails-rsc/server.node');
// …and registerClientReference from the raw Flight runtime export, which
// re-exports the same stock react-server-dom-webpack runtime the wrapper uses.
const { registerClientReference } = require('react-on-rails-rsc/server');

const createApp = require('../src/server/App.js');

const clientManifest = JSON.parse(
  fs.readFileSync(path.join(buildDir, 'client', 'react-client-manifest.json'), 'utf8'),
);

const clientReference = (file) =>
  registerClientReference(
    () => {
      throw new Error(`client reference ${file} must not execute on the RSC server`);
    },
    pathToFileURL(path.join(projectRoot, 'src', 'components', file)).href,
    'default',
  );

const model = createApp({
  Counter: clientReference('Counter.js'),
  ThemeSection: clientReference('ThemeSection.js'),
});

const errors = [];
const stream = renderToPipeableStream(model, clientManifest, {
  onError(error) {
    errors.push(String((error && error.stack) || error));
  },
});

const sink = new PassThrough();
let payload = '';
sink.on('data', (chunk) => {
  payload += chunk;
});
sink.on('end', () => {
  fs.writeFileSync(path.join(buildDir, 'flight-payload.rsc'), payload);
  process.stdout.write(
    JSON.stringify({ ok: errors.length === 0, errors, payloadLength: payload.length }),
  );
  process.exitCode = errors.length === 0 ? 0 : 1;
});
stream.pipe(sink);
