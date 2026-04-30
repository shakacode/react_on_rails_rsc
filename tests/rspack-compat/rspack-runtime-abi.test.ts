/**
 * Verify rspack emits the runtime globals that React's Flight runtime relies on.
 *
 * The Flight client runtime (shipped inside `react-server-dom-webpack`) uses
 * exactly three webpack-shaped globals:
 *
 *   1. `__webpack_require__(id)`        — sync module access
 *   2. `__webpack_chunk_load__(chunkId)` — promise-returning chunk loader
 *   3. `__webpack_require__.u`           — chunk filename resolver (MUTABLE)
 *
 * Rspack documents these three as webpack-compatible. This test asserts that
 * claim empirically: it runs rspack on a tiny source file with a dynamic
 * import, inspects the emitted bundle, and verifies the globals are present
 * AND that `__webpack_require__.u` is defined as an assignable property
 * (React monkey-patches it at runtime).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { rspack } = require('@rspack/core') as typeof import('@rspack/core');

const makeTmpDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'ror-rsc-rspack-abi-'));

const cleanupTmpDir = (dir: string): void => {
  fs.rmSync(dir, { recursive: true, force: true });
};

const runRspack = (
  config: Parameters<typeof rspack>[0],
): Promise<void> =>
  new Promise((resolve, reject) => {
    rspack(config, (err, stats) => {
      if (err) return reject(err);
      if (!stats) return reject(new Error('rspack returned no stats'));
      if (stats.hasErrors()) {
        const info = stats.toJson({ errors: true });
        return reject(
          new Error(
            `rspack build errors:\n${info.errors?.map((e) => e.message).join('\n')}`,
          ),
        );
      }
      resolve();
    });
  });

describe('Rspack runtime ABI — webpack-compatible globals', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it('rspack bundle for web target defines __webpack_require__', async () => {
    const entryFile = path.join(tmpDir, 'entry.js');
    const chunkFile = path.join(tmpDir, 'chunk.js');
    fs.writeFileSync(chunkFile, "module.exports = { value: 42 };");
    fs.writeFileSync(
      entryFile,
      `const promise = import('./chunk.js'); promise.then(m => m.value);`,
    );

    await runRspack({
      mode: 'development',
      target: 'web',
      entry: entryFile,
      output: { path: tmpDir, filename: 'bundle.js' },
      devtool: false,
    });

    const bundle = fs.readFileSync(path.join(tmpDir, 'bundle.js'), 'utf8');
    // __webpack_require__ is the core sync loader
    expect(bundle).toMatch(/__webpack_require__/);
  });

  it('rspack bundle with dynamic import defines __webpack_require__.u (chunk filename fn)', async () => {
    const entryFile = path.join(tmpDir, 'entry.js');
    const chunkA = path.join(tmpDir, 'a.js');
    const chunkB = path.join(tmpDir, 'b.js');
    fs.writeFileSync(chunkA, "module.exports = 'a';");
    fs.writeFileSync(chunkB, "module.exports = 'b';");
    fs.writeFileSync(
      entryFile,
      `
      export function loadA() { return import('./a.js'); }
      export function loadB() { return import('./b.js'); }
      `,
    );

    await runRspack({
      mode: 'development',
      target: 'web',
      entry: entryFile,
      output: { path: tmpDir, filename: 'bundle.js', chunkFilename: '[name].chunk.js' },
      devtool: false,
      // Force code splitting
      optimization: { splitChunks: false },
    });

    const bundle = fs.readFileSync(path.join(tmpDir, 'bundle.js'), 'utf8');
    // `__webpack_require__.u` is the chunk-filename resolver
    // Rspack emits it as `__webpack_require__.u = function(chunkId) { return ... }`
    expect(bundle).toMatch(/__webpack_require__\.u\s*=/);
  });

  it('rspack-emitted __webpack_require__.u is a plain assignable function property (mutable)', async () => {
    // This is critical: React monkey-patches __webpack_require__.u at runtime.
    // If rspack emits it as a getter/readonly, the monkey-patch fails silently.
    const entryFile = path.join(tmpDir, 'entry.js');
    const chunk = path.join(tmpDir, 'chunk.js');
    fs.writeFileSync(chunk, "module.exports = 42;");
    fs.writeFileSync(entryFile, `export default () => import('./chunk.js');`);

    await runRspack({
      mode: 'development',
      target: 'web',
      entry: entryFile,
      output: { path: tmpDir, filename: 'bundle.js', chunkFilename: '[name].chunk.js' },
      devtool: false,
    });

    const bundle = fs.readFileSync(path.join(tmpDir, 'bundle.js'), 'utf8');

    // There should be an assignment to __webpack_require__.u, not a getter via defineProperty({...get}).
    expect(bundle).toMatch(/__webpack_require__\.u\s*=\s*(?:function|\()/);

    // Heuristic check: if someone did Object.defineProperty on .u with a getter, that
    // would be defineProperty... '.u'... { get: ... }. Assert we don't see that shape.
    // (This is a sanity check — rspack has not been observed to do this, but if it
    // ever does, the React monkey-patch breaks.)
    const dangerousShape =
      /Object\.defineProperty\(__webpack_require__,\s*['"]u['"],\s*\{[^}]*\bget\s*[:=]/;
    expect(bundle).not.toMatch(dangerousShape);
  });

  it('rspack bundle defines __webpack_chunk_load__ when chunks exist', async () => {
    // __webpack_chunk_load__ is Rspack's promise-returning chunk loader.
    // React's Flight client calls this directly (not via import()).
    const entryFile = path.join(tmpDir, 'entry.js');
    const chunk = path.join(tmpDir, 'lazy.js');
    fs.writeFileSync(chunk, "module.exports = 'lazy';");
    fs.writeFileSync(entryFile, `export default () => import('./lazy.js');`);

    await runRspack({
      mode: 'development',
      target: 'web',
      entry: entryFile,
      output: { path: tmpDir, filename: 'bundle.js', chunkFilename: '[name].chunk.js' },
      devtool: false,
    });

    const bundle = fs.readFileSync(path.join(tmpDir, 'bundle.js'), 'utf8');
    // Either the literal global OR the internal helper assigned to it should be present.
    // Both webpack and rspack emit something like `__webpack_require__.e = function(chunkId)`
    // and typically expose __webpack_chunk_load__ on the require namespace in web target.
    // We accept either name.
    const hasChunkLoad = /__webpack_chunk_load__/.test(bundle) || /__webpack_require__\.e\b/.test(bundle);
    expect(hasChunkLoad).toBe(true);
  });

  it('rspack bundle for node target also defines __webpack_require__', async () => {
    const entryFile = path.join(tmpDir, 'entry.js');
    const chunk = path.join(tmpDir, 'chunk.js');
    fs.writeFileSync(chunk, "module.exports = 1;");
    fs.writeFileSync(entryFile, `export default () => import('./chunk.js');`);

    await runRspack({
      mode: 'development',
      target: 'node',
      entry: entryFile,
      output: { path: tmpDir, filename: 'bundle.js' },
      devtool: false,
    });

    const bundle = fs.readFileSync(path.join(tmpDir, 'bundle.js'), 'utf8');
    expect(bundle).toMatch(/__webpack_require__/);
  });

  it('rspack reports webpack-compatible version metadata', () => {
    // @rspack/core exposes a `webpackVersion` field indicating the webpack API
    // version it claims to be compatible with. This is documentation, not a
    // runtime guarantee — but its presence signals rspack is designed for
    // the webpack ecosystem.
    const pkg = require('@rspack/core/package.json');
    expect(pkg).toHaveProperty('webpackVersion');
    expect(pkg.webpackVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // Must be webpack 5+ for the runtime API we use
    const majorVersion = parseInt((pkg.webpackVersion as string).split('.')[0] ?? '0', 10);
    expect(majorVersion).toBeGreaterThanOrEqual(5);
  });
});
