/**
 * PROTOTYPE (issue #4598) — proves the REMAP MECHANISM on real webpack:
 * a SEPARATE wrapper module (Foo.wrapper.js) imports the original client
 * component (Foo.js); the generated client-reference manifest entry for Foo is
 * remapped so Flight resolves the reference to the WRAPPER module (loaded by
 * real webpack), which renders <link rel=stylesheet precedence=rsc-css> + the
 * original Foo with props forwarded. The RSC reference keeps its original
 * $$id/name, and the non-component export stays intact for ordinary imports.
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
import { compile, cleanupOutputDirs, entryEndingWith, type CompileResult } from './webpack-plugin/helpers/compile';

const { registerClientReference } = require('react-server-dom-webpack/server.node') as {
  registerClientReference: (impl: () => never, id: string, exportName: string) => unknown;
};

jest.setTimeout(180_000);

const FIXTURE = 'rsc-css-remap';
const CLIENT_REFERENCE_TAG = Symbol.for('react.client.reference');
const fixtureUrl = (file: string): string =>
  pathToFileURL(path.join(__dirname, 'webpack-plugin/fixtures', FIXTURE, file)).href;

const created: CompileResult[] = [];
let client: CompileResult;
let server: CompileResult;

// Single-chunk builds so every module is in main.js and resolvable by
// __webpack_require__(id) without async chunk loading (keeps the remap proof focused).
const common = { chunkName: 'client-[request]', withCss: true, publicPath: '/assets/', maxChunks: 1 } as const;

beforeAll(() => {
  client = compile(FIXTURE, { ...common });
  created.push(client);
  server = compile(FIXTURE, {
    ...common,
    isServer: true,
    exposeClientRuntime: true,
    outputExtra: { library: { type: 'commonjs2' } },
  });
  created.push(server);
});

afterAll(() => cleanupOutputDirs(created));

/** Find the webpack (named) module id of a module by scanning the built bundle. */
function findModuleId(outputPath: string, suffix: string): string {
  const main = fs.readFileSync(path.join(outputPath, 'main.js'), 'utf8');
  // Named modules are registered as `"<id>": (\n/*...*/ ... )` — the id ends with the file path.
  const re = new RegExp(`["']([^"']*${suffix.replace(/[.]/g, '\\.')})["']\\s*:`, 'g');
  const ids = new Set<string>();
  for (const m of main.matchAll(re)) ids.add(m[1]!);
  const arr = [...ids];
  if (arr.length === 0) throw new Error(`module id for ${suffix} not found in ${outputPath}/main.js`);
  return arr[0]!;
}

describe('rsc css remap prototype (real webpack)', () => {
  it('keeps the RSC reference tagged with original $$id/name', () => {
    const Foo = registerClientReference(
      () => {
        throw new Error('client reference must not run on server');
      },
      fixtureUrl('Foo.js'),
      'default',
    ) as { $$typeof?: symbol; $$id?: string };
    expect(Foo.$$typeof).toBe(CLIENT_REFERENCE_TAG);
    expect(Foo.$$id).toBe(`${fixtureUrl('Foo.js')}#default`);
  });

  it('non-component export from the original module survives in the real client bundle', () => {
    // The wrapper re-renders Foo but does not replace the original module: normal
    // imports of Foo.js keep all its exports. The original module (with its
    // non-component export value) is present verbatim in the built client bundle.
    const main = fs.readFileSync(path.join(client.outputPath, 'main.js'), 'utf8');
    expect(main).toContain('helper-value-42');
  });

  it('remaps BOTH manifests: wire I-row carries the wrapper id, and decode resolves the wrapper', async () => {
    // This is the REAL remap the plugin will do at recordModule: rewrite the
    // client + server manifest entries for the client reference to the wrapper
    // module's id/chunks. The client-manifest id flows onto the Flight I-row
    // (browser createFromReadableStream path) AND, via createSSRManifest joining
    // by file URL, into the SSR moduleMap (createFromNodeStream path).
    const clientFoo = entryEndingWith(client.manifest, '/Foo.js');
    const serverFoo = entryEndingWith(server.manifest, '/Foo.js');
    const realCssHref = clientFoo.css![0]!;
    const originalClientFooId = clientFoo.id as string;
    const wrapperClientId = findModuleId(client.outputPath, 'Foo.wrapper.js');
    const wrapperServerId = findModuleId(server.outputPath, 'Foo.wrapper.js');

    // Remap in place (single chunk => wrapper already loadable, no extra chunks).
    clientFoo.id = wrapperClientId;
    clientFoo.chunks = [];
    serverFoo.id = wrapperServerId;
    serverFoo.chunks = [];

    const Foo = registerClientReference(
      () => {
        throw new Error('client reference must not run on server');
      },
      fixtureUrl('Foo.js'),
      'default',
    ) as React.ComponentType<{ title: string; __cssHref: string }>;

    const model = React.createElement(Foo, { title: 'Hi', __cssHref: realCssHref });
    const stream = renderToPipeableStream(model, client.manifest as BundleManifest);
    const readable = new PassThrough();
    stream.pipe(readable);
    const payload = await text(readable);

    // (browser path) The wire I-row metadata must carry the WRAPPER id, not the original.
    const iRow = [...payload.matchAll(/^[0-9a-f]+:I(\[.*\])$/gm)].map(
      (m) => JSON.parse(m[1]!) as [string, string[], string],
    )[0];
    expect(iRow).toBeDefined();
    expect(iRow![0]).toBe(wrapperClientId);
    expect(iRow![0]).not.toBe(originalClientFooId);

    // (SSR-node path) Decode through the real webpack runtime + generated SSR manifest.
    const { ssrManifest } = buildClientRenderer(
      client.manifest as BundleManifest,
      server.manifest as BundleManifest,
    );
    fs.writeFileSync(path.join(server.outputPath, 'payload.txt'), payload);
    fs.writeFileSync(path.join(server.outputPath, 'ssr-manifest.json'), JSON.stringify(ssrManifest));
    fs.writeFileSync(path.join(server.outputPath, 'decode.js'), DECODE_SCRIPT);
    const out = execFileSync(process.execPath, ['decode.js'], {
      cwd: server.outputPath,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const result = JSON.parse(out) as {
      ok: boolean;
      error?: string;
      links?: Array<{ rel?: string; precedence?: string; href?: string }>;
      text?: string;
    };
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.links).toEqual([{ rel: 'stylesheet', precedence: 'rsc-css', href: realCssHref }]);
    expect(result.text).toContain('Hi');
  });
});

const DECODE_SCRIPT = `
'use strict';
const fs = require('fs');
const { Readable } = require('stream');
const { createFromNodeStream } = require('./main.js');
const ssrManifest = JSON.parse(fs.readFileSync('./ssr-manifest.json', 'utf8'));
const stream = Readable.from([fs.readFileSync('./payload.txt')]);
const LAZY = Symbol.for('react.lazy');
const resolveLazy = async (v) => (v && v.$$typeof === LAZY ? await v._payload : v);
const links = [];
let textOut = '';
const walk = async (node) => {
  node = await resolveLazy(node);
  if (node == null || typeof node === 'boolean') return;
  if (typeof node !== 'object') { textOut += String(node); return; }
  if (Array.isArray(node)) { for (const c of node) await walk(c); return; }
  if (node.$$typeof) {
    const type = await resolveLazy(node.type);
    if (type === 'link') { const p = node.props || {}; links.push({ rel: p.rel, precedence: p.precedence, href: p.href }); return; }
    if (typeof type === 'function') { await walk(type(node.props)); return; }
    await walk(node.props && node.props.children);
    return;
  }
};
(async () => {
  try {
    const root = await createFromNodeStream(stream, ssrManifest);
    await walk(root);
    process.stdout.write(JSON.stringify({ ok: true, links, text: textOut }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.stack) || e) }));
  }
})();
`;
