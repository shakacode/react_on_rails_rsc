/**
 * End-to-end: the webpack plugin's GENERATED manifests drive a real Flight
 * encode → decode round trip.
 *
 * The manifest-shape tests in tests/webpack-plugin/plugin-integration.test.ts
 * assert that the generated manifests contain the expected chunk lists; this
 * suite closes the remaining loop — the generated metadata is not just the
 * expected shape, it is sufficient for the real webpack runtime to load and
 * execute the client components:
 *
 * 1. Build the split-shared fixture twice with real webpack + the plugin: a
 *    client build (with splitChunks forcing a shared chunk — the issue #22
 *    scenario) and an SSR build (target node, `output.library` exposing the
 *    bundled Flight node client, async chunks left split so chunk loading
 *    really happens).
 * 2. Encode: render client references through src/server.node with the
 *    GENERATED client manifest; assert the wire payload embeds exactly the
 *    chunk list the manifest records for each component (this is the
 *    metadata the browser runtime passes to __webpack_chunk_load__).
 * 3. Decode: a child Node process (without the react-server condition)
 *    requires the SSR bundle and decodes the payload with the bundled
 *    createFromNodeStream + the production createSSRManifest transform
 *    (src/client.node buildClientRenderer). Webpack's require-based chunk
 *    loading pulls in the SSR chunks listed by the generated server
 *    manifest, and the resolved components execute.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import { pathToFileURL } from 'node:url';
import * as React from 'react';
import { renderToPipeableStream } from '../src/server.node';
import { buildClientRenderer } from '../src/client.node';
import type { BundleManifest } from '../src/types';
import {
  compile,
  cleanupOutputDirs,
  entryEndingWith,
  chunkFiles,
  type CompileResult,
} from './webpack-plugin/helpers/compile';

const { registerClientReference } = require('react-server-dom-webpack/server.node') as {
  registerClientReference: (
    proxyImplementation: () => never,
    id: string,
    exportName: string,
  ) => unknown;
};

jest.setTimeout(180_000);

const FIXTURE = 'split-shared';
const fixtureUrl = (file: string): string =>
  pathToFileURL(path.join(__dirname, 'webpack-plugin/fixtures', FIXTURE, file)).href;

const created: CompileResult[] = [];
let client: CompileResult;
let server: CompileResult;

beforeAll(() => {
  client = compile(FIXTURE, {
    chunkName: 'client-[request]',
    optimizationExtra: {
      splitChunks: {
        chunks: 'all',
        minSize: 0,
        cacheGroups: {
          default: false,
          defaultVendors: false,
          sharedButton: {
            test: /Button\.js$/,
            name: 'shared-button',
            minChunks: 2,
            enforce: true,
          },
        },
      },
    },
  });
  created.push(client);

  server = compile(FIXTURE, {
    isServer: true,
    chunkName: 'client-[request]',
    exposeClientRuntime: true,
    outputExtra: { library: { type: 'commonjs2' } },
  });
  created.push(server);
});

afterAll(() => cleanupOutputDirs(created));

const clientReference = (file: string): React.ComponentType =>
  registerClientReference(
    () => {
      throw new Error('client reference should not execute on the server');
    },
    fixtureUrl(file),
    'default',
  ) as React.ComponentType;

const encodePayload = async (): Promise<string> => {
  const Button = clientReference('Button.js');
  const SettingsPage = clientReference('SettingsPage.js');
  const model = React.createElement(
    'div',
    null,
    React.createElement(Button, { key: 'b' }),
    React.createElement(SettingsPage, { key: 's' }),
  );
  const stream = renderToPipeableStream(model, client.manifest as BundleManifest);
  const readable = new PassThrough();
  stream.pipe(readable);
  return text(readable);
};

/** Flight module-import rows look like `<hex row id>:I[id, chunks, name]`. */
const importRows = (payload: string): [string, string[], string][] =>
  [...payload.matchAll(/^[0-9a-f]+:I(\[.*\])$/gm)].map(
    (m) => JSON.parse(m[1]!) as [string, string[], string],
  );

describe('webpack plugin end-to-end (generated manifests through real Flight)', () => {
  it('embeds exactly the generated client manifest chunk lists in the wire payload', async () => {
    const payload = await encodePayload();
    const rows = importRows(payload);

    for (const file of ['/Button.js', '/SettingsPage.js']) {
      const metadata = entryEndingWith(client.manifest, file);
      const row = rows.find((r) => r[0] === metadata.id);
      expect(row).toBeDefined();
      // The browser runtime feeds this list straight into
      // __webpack_chunk_load__ — it must be the manifest entry verbatim.
      expect(row![1]).toEqual(metadata.chunks);
    }
  });

  it('decodes the payload through the SSR bundle, loading real webpack chunks', async () => {
    // Precondition: the SSR build really split the client components into
    // async chunks — otherwise the decode below would not exercise webpack's
    // chunk loading at all.
    const serverButton = entryEndingWith(server.manifest, '/Button.js');
    expect(chunkFiles(serverButton)).not.toEqual([]);
    expect(chunkFiles(serverButton)).not.toContain('main.js');

    const payload = await encodePayload();
    const { ssrManifest } = buildClientRenderer(
      client.manifest as BundleManifest,
      server.manifest as BundleManifest,
    );

    fs.writeFileSync(path.join(server.outputPath, 'payload.txt'), payload);
    fs.writeFileSync(
      path.join(server.outputPath, 'ssr-manifest.json'),
      JSON.stringify(ssrManifest),
    );
    // The decode must run inside the SSR bundle's webpack runtime (its
    // __webpack_require__ / __webpack_chunk_load__), in a process WITHOUT
    // the react-server condition — matching production SSR.
    fs.writeFileSync(path.join(server.outputPath, 'decode.js'), DECODE_SCRIPT);

    const out = execFileSync(process.execPath, ['decode.js'], {
      cwd: server.outputPath,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const result = JSON.parse(out) as { ok: boolean; rendered?: string; error?: string };

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    // The components executed, including the cross-chunk import inside
    // Button — proving the SSR chunks listed in the generated server
    // manifest were loaded by webpack's real chunk loader.
    expect(result.rendered).toContain('button:shared-module');
    expect(result.rendered).toContain('settings:button:shared-module');
  });
});

const DECODE_SCRIPT = `
'use strict';
const fs = require('fs');
const { Readable } = require('stream');
// main.js was built with output.library commonjs2 + exposeClientRuntime, so
// it exports the bundled Flight node client.
const { createFromNodeStream } = require('./main.js');

const ssrManifest = JSON.parse(fs.readFileSync('./ssr-manifest.json', 'utf8'));
const stream = Readable.from([fs.readFileSync('./payload.txt')]);

// Resolve the decoded tree to text. The fixture components return plain
// strings, so rendering is: call function components, concatenate children,
// and await Flight's lazy references. Client references arrive as elements
// whose TYPE is a lazy — awaiting its payload yields the module export once
// the referenced chunks have loaded.
const LAZY = Symbol.for('react.lazy');
const resolveLazy = async (value) =>
  value && value.$$typeof === LAZY ? await value._payload : value;

const render = async (node) => {
  node = await resolveLazy(node);
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) {
    let out = '';
    for (const child of node) out += await render(child);
    return out;
  }
  if (node.$$typeof) {
    const type = await resolveLazy(node.type);
    if (typeof type === 'function') return render(type(node.props));
    return render(node.props && node.props.children);
  }
  return String(node);
};

(async () => {
  try {
    const root = await createFromNodeStream(stream, ssrManifest);
    const rendered = await render(root);
    process.stdout.write(JSON.stringify({ ok: true, rendered }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.stack) || e) }));
  }
})();
`;
