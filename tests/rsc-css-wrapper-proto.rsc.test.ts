/**
 * PROTOTYPE (issue #4598): proves on a REAL webpack RSC build that a client
 * component which renders its own <link rel="stylesheet" precedence="rsc-css">
 * (i.e. the OUTPUT of the planned CSS wrapper) works end-to-end:
 *   - RSC build turns it into a tagged client reference (body never runs on server);
 *   - client/SSR build compiles the real component;
 *   - Flight encode -> decode through the GENERATED manifests + REAL webpack chunk
 *     loading resolves the component, which renders the <link> with the real
 *     manifest CSS href, with props forwarded;
 *   - the non-component named export is unaffected.
 * (React's actual FOUC blocking on such a <link> is already proven separately.)
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

const FIXTURE = 'rsc-css-proto';
const CLIENT_REFERENCE_TAG = Symbol.for('react.client.reference');
const fixtureUrl = (file: string): string =>
  pathToFileURL(path.join(__dirname, 'webpack-plugin/fixtures', FIXTURE, file)).href;

const created: CompileResult[] = [];
let client: CompileResult;
let server: CompileResult;

beforeAll(() => {
  client = compile(FIXTURE, { chunkName: 'client-[request]', withCss: true, publicPath: '/assets/' });
  created.push(client);
  server = compile(FIXTURE, {
    isServer: true,
    chunkName: 'client-[request]',
    withCss: true,
    publicPath: '/assets/',
    exposeClientRuntime: true,
    outputExtra: { library: { type: 'commonjs2' } },
  });
  created.push(server);
});

afterAll(() => cleanupOutputDirs(created));

describe('rsc css wrapper prototype (real webpack)', () => {
  it('records the client component CSS in the generated manifest', () => {
    const styled = entryEndingWith(client.manifest, '/Styled.js');
    expect(styled.css && styled.css.length).toBeGreaterThan(0);
    expect(styled.css![0]).toMatch(/\.css$/);
  });

  it('keeps the client reference tagged on the RSC server', () => {
    const Styled = registerClientReference(
      () => {
        throw new Error('client reference must not run on server');
      },
      fixtureUrl('Styled.js'),
      'default',
    ) as { $$typeof?: symbol };
    expect(Styled.$$typeof).toBe(CLIENT_REFERENCE_TAG);
  });

  it('decodes through real webpack and renders the <link precedence> + forwarded props', async () => {
    const styled = entryEndingWith(client.manifest, '/Styled.js');
    const realCssHref = styled.css![0]!;

    const Styled = registerClientReference(
      () => {
        throw new Error('client reference must not run on server');
      },
      fixtureUrl('Styled.js'),
      'default',
    ) as React.ComponentType<{ title: string; cssHref: string }>;

    const model = React.createElement(Styled, { title: 'Hi', cssHref: realCssHref });
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
    // The client component, loaded via REAL webpack chunk loading, rendered its
    // <link rel="stylesheet" precedence="rsc-css" href={realManifestCss}>.
    expect(result.links).toEqual([
      { rel: 'stylesheet', precedence: 'rsc-css', href: realCssHref },
    ]);
    // Props forwarded through the reference resolution.
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
    if (type === 'link') {
      const p = node.props || {};
      links.push({ rel: p.rel, precedence: p.precedence, href: p.href });
      return;
    }
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
