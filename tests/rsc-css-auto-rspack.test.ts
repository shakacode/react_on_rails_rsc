/**
 * Issue #4598 — rspack parity for the cssWrapper feature: a plain `'use client'`
 * component compiled with `cssWrapper: true` must resolve (via the manifest) to a
 * generated wrapper module, with CSS recorded and the href global injected into the
 * runtime bundle — the same structure the webpack plugin produces (whose decode-time
 * render behavior is verified in the webpack rsc tests).
 */
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'node:url';
import { compile, cleanupOutputDirs, type CompileResult } from './rspack-plugin/helpers/compile';

const FIXTURE = 'rsc-css-auto';
const fixtureUrl = (file: string): string =>
  pathToFileURL(path.join(__dirname, 'rspack-plugin/fixtures', FIXTURE, file)).href;

function entry(result: CompileResult, suffix: string) {
  const entries = result.manifest.filePathToModuleMetadata as Record<
    string,
    { id: unknown; chunks: unknown[]; css?: string[]; name: string }
  >;
  const key = Object.keys(entries).find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no manifest entry ending with ${suffix}`);
  return entries[key]!;
}

const created: CompileResult[] = [];
let client: CompileResult;

beforeAll(() => {
  client = compile(FIXTURE, {
    chunkName: 'client-[request]',
    withCss: true,
    publicPath: '/assets/',
    cssWrapper: true,
  });
  created.push(client);
});
afterAll(() => cleanupOutputDirs(created));

describe('rspack cssWrapper parity (real rspack)', () => {
  it('remaps the client reference to the generated wrapper module and records CSS', () => {
    const styled = entry(client, '/Styled.js');
    expect(String(styled.id)).toContain('rscCssWrapperLoader');
    expect(styled.css && styled.css.length).toBeGreaterThan(0);
    expect(styled.css![0]).toMatch(/\.css$/);
  });

  it('injects the CSS href global (map with the real href) into the runtime bundle', () => {
    const cssHref = entry(client, '/Styled.js').css![0]!;
    const files = fs.readdirSync(client.outputPath).filter((f) => f.endsWith('.js'));
    // The runtime chunk carries the injected setter: Object.assign of a map that
    // contains BOTH the client file URL key AND the real css href value. (The async
    // wrapper chunk references __RSC_CSS_HREFS__ but does not inline the href.)
    const runtimeWithGlobal = files.find((f) => {
      const src = fs.readFileSync(path.join(client.outputPath, f), 'utf8');
      return (
        src.includes('__RSC_CSS_HREFS__') &&
        src.includes('Object.assign') &&
        src.includes(fixtureUrl('Styled.js')) &&
        src.includes(cssHref)
      );
    });
    expect(runtimeWithGlobal).toBeDefined();
  });

  it('emits the generated wrapper code (renders <link precedence>) into the bundle', () => {
    const allJs = fs
      .readdirSync(client.outputPath)
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(client.outputPath, f), 'utf8'))
      .join('\n');
    // The wrapper's self-contained render logic markers.
    expect(allJs).toContain('__rscHrefs');
    expect(allJs).toContain('rsc-css');
  });
});
