/**
 * Issue #217 / #4598 — rspack parity for `tests/rsc-css-wrapper-jsx.rsc.test.ts`.
 *
 * Both plugins share `src/webpack/rscCssWrapperLoader.ts`
 * (`src/react-server-dom-rspack/injection-loader.ts` resolves
 * `../webpack/rscCssWrapperLoader`), so the export-enumeration bug and its fix
 * apply to rspack builds too. This compiles the same JSX `"use client"` fixture
 * with real rspack and renders a NAMED export through the generated manifests.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import { pathToFileURL } from 'node:url';
import * as React from 'react';
import { renderToPipeableStream } from '../src/server.node';
import type { BundleManifest } from '../src/types';
import { compile, cleanupOutputDirs, type CompileResult } from './rspack-plugin/helpers/compile';

const { registerClientReference } = require('react-server-dom-webpack/server.node') as {
  registerClientReference: (impl: () => never, id: string, exportName: string) => unknown;
};

jest.setTimeout(180_000);

const FIXTURE = 'rsc-css-jsx';
const fixtureUrl = (file: string): string =>
  pathToFileURL(path.join(__dirname, 'rspack-plugin/fixtures', FIXTURE, file)).href;

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
    configExtra: { exposeClientRuntime: true, output: { library: { type: 'commonjs2' } } },
  });
  created.push(server);
});

afterAll(() => cleanupOutputDirs(created));

const entry = (result: CompileResult, suffix: string) => {
  const entries = result.manifest.filePathToModuleMetadata;
  const key = Object.keys(entries).find((candidate) => candidate.endsWith(suffix));
  if (!key) throw new Error(`no manifest entry ending with ${suffix}`);
  return entries[key]!;
};

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
    client.manifest as unknown as BundleManifest
  );
  const readable = new PassThrough();
  stream.pipe(readable);
  const payload = await text(readable);

  fs.writeFileSync(path.join(server.outputPath, 'payload.txt'), payload);
  fs.writeFileSync(path.join(server.outputPath, 'client-manifest.json'), client.manifestSource);
  fs.writeFileSync(path.join(server.outputPath, 'server-manifest.json'), server.manifestSource);
  fs.writeFileSync(path.join(server.outputPath, 'decode.js'), DECODE_SCRIPT);
  const out = execFileSync(process.execPath, ['decode.js'], {
    cwd: server.outputPath,
    encoding: 'utf8',
    timeout: 60_000,
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

describe('cssWrapper on a JSX client module (real rspack)', () => {
  it('remaps the client reference to the generated wrapper and records CSS', () => {
    const card = entry(client, '/Card.tsx');
    expect(String(card.id)).toContain('rscCssWrapperLoader');
    expect(card.css && card.css.length).toBeGreaterThan(0);
  });

  it('resolves and renders a NAMED export written in JSX, with its <link precedence>', async () => {
    const card = entry(client, '/Card.tsx');
    const { links, text: t, rootType } = await resolveExport('Card');

    // Pre-fix this was 'undefined': the wrapper had no `Card` export at all.
    expect(rootType).not.toBe('undefined');
    expect(links).toEqual([{ rel: 'stylesheet', precedence: 'rsc-css', href: card.css![0]! }]);
    expect(t).toContain('Hi');
  });

  it('still resolves the default export', async () => {
    const card = entry(client, '/Card.tsx');
    const { links, text: t } = await resolveExport('default');

    expect(links).toEqual([{ rel: 'stylesheet', precedence: 'rsc-css', href: card.css![0]! }]);
    expect(t).toContain('Hi');
  });
});

const DECODE_SCRIPT = `
'use strict';
const fs = require('fs');
const { Readable } = require('stream');
const { buildClientRenderer } = require('./main.js');
const clientManifest = JSON.parse(fs.readFileSync('./client-manifest.json', 'utf8'));
const serverManifest = JSON.parse(fs.readFileSync('./server-manifest.json', 'utf8'));
const { createFromNodeStream } = buildClientRenderer(clientManifest, serverManifest);
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
    const root = await createFromNodeStream(stream);
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
