/**
 * Issue #4598 — the plugin's `cssWrapper` option AUTO-GENERATES the CSS wrapper.
 * A plain `'use client'` component (which does not render its own <link>) must, on
 * the consume side, resolve to a generated wrapper that renders a render-blocking
 * `<link rel="stylesheet" precedence="rsc-css">` for the component's CSS. Proven on
 * a real webpack build + real Flight round-trip.
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

const FIXTURE = 'rsc-css-auto';
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

describe('cssWrapper auto-generation (real webpack)', () => {
  it('records the component CSS and injects the href global into the runtime bundle', () => {
    const styled = entryEndingWith(client.manifest, '/Styled.js');
    expect(styled.css && styled.css.length).toBeGreaterThan(0);
    const main = fs.readFileSync(path.join(client.outputPath, 'main.js'), 'utf8');
    // The plugin injected the CSS-href global keyed by the client module's file URL.
    expect(main).toContain('__RSC_CSS_HREFS__');
    expect(main).toContain(fixtureUrl('Styled.js'));
    expect(main).toContain(styled.css![0]!);
  });

  it('resolves the reference to the generated wrapper, rendering <link precedence> + component', async () => {
    const styled = entryEndingWith(client.manifest, '/Styled.js');
    const realCssHref = styled.css![0]!;

    const Styled = registerClientReference(
      () => {
        throw new Error('client reference must not run on server');
      },
      fixtureUrl('Styled.js'),
      'default',
    ) as React.ComponentType<{ title: string }>;

    const model = React.createElement(Styled, { title: 'Hi' });
    const stream = renderToPipeableStream(model, client.manifest as BundleManifest);
    const readable = new PassThrough();
    stream.pipe(readable);
    const payload = await text(readable);

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
    // The generated wrapper rendered the render-blocking stylesheet link (href from
    // the injected global) before the component, and forwarded props.
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
