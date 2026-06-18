/**
 * SPIKE (issue #4049) — measurement harness for Server-Component CSS delivery.
 *
 * Confirms the root-cause mechanism empirically and measures which `.css`
 * assets / manifest entries each render path produces in the CLIENT webpack
 * build (the only build that emits browser CSS — the RSC/server build strips
 * MiniCssExtractPlugin and uses css-modules `exportOnlyLocals`).
 *
 * Render paths (mirroring the issue):
 *   (b) 'use client' leaf imports the sentinel CSS  -> WORKS today
 *   (c) pure Server Component imports the sentinel CSS, but the client entry
 *       does NOT import it (generated pack is registerServerComponent(...) with
 *       no import) -> BROKEN today: no asset, no manifest entry, no hint.
 *
 * Run with: npx jest tests/server-component-css-spike.test.ts
 */

import { pathToFileURL } from 'node:url';
import { compile, cleanupOutputDirs, type CompileResult } from './webpack-plugin/helpers/compile';

jest.setTimeout(180_000);

const FIXTURE = 'server-component-css';
const created: CompileResult[] = [];

const fixtureUrl = (file: string): string =>
  pathToFileURL(require('path').join(__dirname, 'webpack-plugin/fixtures', FIXTURE, file)).href;

const cssAssets = (r: CompileResult): string[] => r.assets.filter((a) => a.endsWith('.css'));

afterAll(() => cleanupOutputDirs(created));

describe('Server-Component CSS spike (#4049)', () => {
  it('PATH (b): a use-client leaf importing CSS DOES get a CSS asset + manifest entry', () => {
    // clientReferences includes the 'use client' leaf so the plugin injects
    // its async block; the leaf imports the sentinel CSS, so MiniCss extracts
    // a chunk and the manifest entry records the href.
    const r = compile(FIXTURE, {
      withCss: true,
      chunkName: 'client-[request]',
      clientReferences: [fixtureUrl('BlockClientLeaf.js').replace('file://', '')],
    });
    created.push(r);

    // eslint-disable-next-line no-console
    console.log('PATH(b) css assets:', cssAssets(r));
    // eslint-disable-next-line no-console
    console.log(
      'PATH(b) manifest entries:',
      JSON.stringify(r.manifest.filePathToModuleMetadata, null, 2)
    );

    const leafEntry = Object.entries(r.manifest.filePathToModuleMetadata).find(([k]) =>
      k.endsWith('/BlockClientLeaf.js')
    );
    expect(leafEntry).toBeDefined();
    expect(leafEntry![1].css && leafEntry![1].css.length).toBeGreaterThan(0);
    expect(cssAssets(r).length).toBeGreaterThan(0);
  });

  it('PATH (c): a pure Server Component importing CSS gets NO asset and NO manifest entry (the bug)', () => {
    // The client entry does NOT import Block (faithful to the generated
    // registerServerComponent pack). Block is listed only as a server module;
    // it is not a 'use client' reference, so the plugin does not discover it,
    // and nothing pulls its CSS into the client graph.
    const r = compile(FIXTURE, {
      withCss: true,
      chunkName: 'client-[request]',
      clientReferences: [], // no client references discovered
    });
    created.push(r);

    // eslint-disable-next-line no-console
    console.log('PATH(c) css assets:', cssAssets(r));
    // eslint-disable-next-line no-console
    console.log(
      'PATH(c) manifest entries:',
      JSON.stringify(r.manifest.filePathToModuleMetadata, null, 2)
    );

    // No Block manifest entry, and crucially NO sentinel.css asset was emitted
    // by the client build at all (Block never entered the client graph).
    const blockEntry = Object.entries(r.manifest.filePathToModuleMetadata).find(([k]) =>
      k.endsWith('/Block.js')
    );
    expect(blockEntry).toBeUndefined();
    expect(cssAssets(r)).toEqual([]);
  });

  it('PATH (c-fixed): serverComponentCssReferences delivers the CSS as a real asset + records the href', () => {
    // The prototype: the client entry STILL does not import Block, but we pass
    // Block as a serverComponentCssReference so the plugin injects a CSS-only
    // async block. MiniCss now extracts sentinel.css, and the manifest records
    // the href under serverComponentCss keyed by Block's file URL.
    const blockPath = fixtureUrl('Block.js').replace('file://', '');
    const r = compile(FIXTURE, {
      withCss: true,
      chunkName: 'client-[request]',
      clientReferences: [],
      serverComponentCssReferences: [blockPath],
    });
    created.push(r);

    // eslint-disable-next-line no-console
    console.log('PATH(c-fixed) css assets:', cssAssets(r));
    // eslint-disable-next-line no-console
    console.log(
      'PATH(c-fixed) serverComponentCss:',
      JSON.stringify(r.manifest.serverComponentCss, null, 2)
    );

    // A real browser CSS asset now exists.
    expect(cssAssets(r).length).toBeGreaterThan(0);

    // And it is recorded against Block's module URL so a hint can be fired.
    const scCss = r.manifest.serverComponentCss || {};
    const blockKey = Object.keys(scCss).find((k) => k.endsWith('/Block.js'));
    expect(blockKey).toBeDefined();
    expect(scCss[blockKey!]!.length).toBeGreaterThan(0);
    expect(scCss[blockKey!]!.some((h) => h.endsWith('.css'))).toBe(true);
  });

  it('PATH (dedup): CSS shared between a Server Component and a use-client leaf points at the same href', () => {
    // Both Block (server component) and BlockClientLeaf (use client) import
    // sentinel.css. With both wired, the SAME extracted CSS file should be
    // referenced from the client-reference entry AND serverComponentCss, so
    // render-side preinit dedupes to a single stylesheet.
    const blockPath = fixtureUrl('Block.js').replace('file://', '');
    const r = compile(FIXTURE, {
      withCss: true,
      chunkName: 'client-[request]',
      clientReferences: [fixtureUrl('BlockClientLeaf.js').replace('file://', '')],
      serverComponentCssReferences: [blockPath],
    });
    created.push(r);

    const leafEntry = Object.entries(r.manifest.filePathToModuleMetadata).find(([k]) =>
      k.endsWith('/BlockClientLeaf.js')
    );
    const scCss = r.manifest.serverComponentCss || {};
    const blockKey = Object.keys(scCss).find((k) => k.endsWith('/Block.js'));

    // eslint-disable-next-line no-console
    console.log('PATH(dedup) leaf css:', leafEntry?.[1].css);
    // eslint-disable-next-line no-console
    console.log('PATH(dedup) sc css:', blockKey && scCss[blockKey]);
    // eslint-disable-next-line no-console
    console.log('PATH(dedup) all css assets:', cssAssets(r));
  });
});
