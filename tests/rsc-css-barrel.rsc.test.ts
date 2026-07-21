/**
 * Issue #4598 — a `'use client'` barrel that `export *`s a styled component must
 * still wrap the re-exported component so it emits its <link precedence> (no FOUC).
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

const FIXTURE = 'rsc-css-barrel';
const fixtureUrl = (file: string): string =>
  pathToFileURL(path.join(__dirname, 'webpack-plugin/fixtures', FIXTURE, file)).href;

const created: CompileResult[] = [];
let client: CompileResult;
let server: CompileResult;

const common = { chunkName: 'client-[request]', withCss: true, publicPath: '/assets/', cssWrapper: true } as const;

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

it('wraps a component re-exported through an export * barrel', async () => {
  const barrel = entryEndingWith(client.manifest, '/Barrel.client.js');
  expect(barrel.css && barrel.css.length).toBeGreaterThan(0);

  // The client reference is the barrel's re-exported `Styled` export.
  const Styled = registerClientReference(
    () => {
      throw new Error('client reference must not run on server');
    },
    fixtureUrl('Barrel.client.js'),
    'Styled',
  ) as React.ComponentType<{ title: string }>;

  const stream = renderToPipeableStream(React.createElement(Styled, { title: 'Hi' }), client.manifest as BundleManifest);
  const readable = new PassThrough();
  stream.pipe(readable);
  const payload = await text(readable);

  const { ssrManifest } = buildClientRenderer(client.manifest as BundleManifest, server.manifest as BundleManifest);
  fs.writeFileSync(path.join(server.outputPath, 'payload.txt'), payload);
  fs.writeFileSync(path.join(server.outputPath, 'ssr-manifest.json'), JSON.stringify(ssrManifest));
  fs.writeFileSync(path.join(server.outputPath, 'decode.js'), DECODE_SCRIPT);
  const out = execFileSync(process.execPath, ['decode.js'], { cwd: server.outputPath, encoding: 'utf8', timeout: 30_000 });
  const result = JSON.parse(out) as {
    ok: boolean;
    error?: string;
    links?: Array<{ rel?: string; precedence?: string; href?: string }>;
    text?: string;
  };

  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(result.links).toEqual([{ rel: 'stylesheet', precedence: 'rsc-css', href: barrel.css![0]! }]);
  expect(result.text).toContain('Hi');
});

const DECODE_SCRIPT = `
'use strict';
const fs = require('fs');
const { Readable } = require('stream');
const { createFromNodeStream } = require('./main.js');
const ssrManifest = JSON.parse(fs.readFileSync('./ssr-manifest.json', 'utf8'));
const stream = Readable.from([fs.readFileSync('./payload.txt')]);
const LAZY = Symbol.for('react.lazy');
const FORWARD_REF = Symbol.for('react.forward_ref');
const MEMO = Symbol.for('react.memo');
const resolveLazy = async (v) => (v && v.$$typeof === LAZY ? await v._payload : v);
const links = [];
let textOut = '';
const walk = async (node) => {
  node = await resolveLazy(node);
  if (node == null || typeof node === 'boolean') return;
  if (typeof node !== 'object') { textOut += String(node); return; }
  if (Array.isArray(node)) { for (const c of node) await walk(c); return; }
  if (node.$$typeof) {
    let type = await resolveLazy(node.type);
    if (type && type.$$typeof === MEMO) type = type.type;
    if (type === 'link') { const p = node.props || {}; links.push({ rel: p.rel, precedence: p.precedence, href: p.href }); return; }
    if (type && type.$$typeof === FORWARD_REF) { await walk(type.render(node.props, null)); return; }
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
