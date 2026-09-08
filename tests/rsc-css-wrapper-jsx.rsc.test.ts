/**
 * Issue #217 / #4598 — the render-time consequence of the `cssWrapper` loader's
 * export enumeration, on a REAL webpack build.
 *
 * With `cssWrapper: true` the client manifest points at a GENERATED wrapper
 * module, not at the client file, and the wrapper only exports the names it
 * enumerated. The loader is requested with a `!!` prefix, so it always sees raw
 * JSX/TSX. The old `es-module-lexer` enumeration threw on
 * `<section className="...">{...}</section>` and silently fell back to
 * `['default']`, so `Card` resolved to `undefined` at decode time and rendering
 * it failed with an invalid element type — while the server-side stub (#216)
 * still advertised it.
 *
 * Every pre-existing cssWrapper fixture is written with `React.createElement`,
 * which lexes fine; this one is written in JSX on purpose.
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
  type CompileResult,
} from './webpack-plugin/helpers/compile';

const { registerClientReference } = require('react-server-dom-webpack/server.node') as {
  registerClientReference: (impl: () => never, id: string, exportName: string) => unknown;
};

jest.setTimeout(180_000);

const FIXTURE = 'rsc-css-jsx';
const fixtureUrl = (file: string): string =>
  pathToFileURL(path.join(__dirname, 'webpack-plugin/fixtures', FIXTURE, file)).href;

const created: CompileResult[] = [];
let client: CompileResult;
let server: CompileResult;

const common = {
  chunkName: 'client-[request]',
  withCss: true,
  withTsx: true,
  publicPath: '/assets/',
  cssWrapper: true,
} as const;

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

async function resolveExport(exportName: string): Promise<{
  links: Array<{ rel?: string; precedence?: string; href?: string }>;
  text: string;
  rootType: string;
}> {
  const ref = registerClientReference(
    () => {
      throw new Error('client reference must not run on server');
    },
    fixtureUrl('Card.tsx'),
    exportName
  ) as React.ComponentType<{ title: string }>;
  const stream = renderToPipeableStream(
    React.createElement(ref, { title: 'Hi' }),
    client.manifest as BundleManifest
  );
  const readable = new PassThrough();
  stream.pipe(readable);
  const payload = await text(readable);
  const { ssrManifest } = buildClientRenderer(
    client.manifest as BundleManifest,
    server.manifest as BundleManifest
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
    links?: [];
    text?: string;
    rootType?: string;
  };
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  return { links: result.links ?? [], text: result.text ?? '', rootType: result.rootType ?? '' };
}

describe('cssWrapper on a JSX client module (real webpack)', () => {
  it('records the client component CSS against the wrapper module', () => {
    const card = entryEndingWith(client.manifest, '/Card.tsx');
    expect(String(card.id)).toContain('rscCssWrapperLoader');
    expect(card.css && card.css.length).toBeGreaterThan(0);
  });

  it('resolves and renders a NAMED export written in JSX, with its <link precedence>', async () => {
    const card = entryEndingWith(client.manifest, '/Card.tsx');
    const { links, text: t, rootType } = await resolveExport('Card');

    // Pre-fix this was 'undefined': the wrapper had no `Card` export at all.
    expect(rootType).not.toBe('undefined');
    expect(links).toEqual([{ rel: 'stylesheet', precedence: 'rsc-css', href: card.css![0]! }]);
    expect(t).toContain('Hi');
  });

  it('resolves and renders a second named export written in JSX', async () => {
    const card = entryEndingWith(client.manifest, '/Card.tsx');
    const { links, text: t, rootType } = await resolveExport('Badge');

    expect(rootType).not.toBe('undefined');
    expect(links).toEqual([{ rel: 'stylesheet', precedence: 'rsc-css', href: card.css![0]! }]);
    expect(t).toContain('Hi');
  });

  it('still resolves the default export', async () => {
    const card = entryEndingWith(client.manifest, '/Card.tsx');
    const { links, text: t } = await resolveExport('default');

    expect(links).toEqual([{ rel: 'stylesheet', precedence: 'rsc-css', href: card.css![0]! }]);
    expect(t).toContain('Hi');
  });

  it('does not wrap the TypeScript type-only export', () => {
    const wrapper = fs
      .readdirSync(client.outputPath)
      .filter((file) => file.endsWith('.js'))
      .map((file) => fs.readFileSync(path.join(client.outputPath, file), 'utf8'))
      .join('\n');

    expect(wrapper).toContain('__rscWrap');
    expect(wrapper).not.toContain('CardProps');
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
    // A missing export on the generated wrapper resolves to \`undefined\` here,
    // which is React's "Element type is invalid" at real render time.
    const resolvedType = await resolveLazy(root && root.type);
    const rootType = resolvedType === undefined ? 'undefined' : typeof resolvedType;
    await walk(root);
    process.stdout.write(JSON.stringify({ ok: true, links, text: textOut, rootType }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: String((e && e.stack) || e) }));
  }
})();
`;
