/**
 * Verify that `RSCWebpackLoader` runs successfully under rspack.
 *
 * The loader is advertised as a webpack loader but uses only the standard
 * loader-context API (`this.resourcePath`). Rspack implements that API
 * verbatim, so the loader should work unchanged.
 *
 * This test compiles a small source file with a `"use client"` directive
 * through rspack, with our loader attached, and verifies the transformed
 * output contains `registerClientReference` calls — i.e., the loader ran
 * and did its job.
 *
 * We spawn rspack in a child Node process (via runRspack.js) because Jest's
 * VM sandbox does not support dynamic ESM `import()` inside loaders, and
 * the RSC loader uses dynamic import() to load the ESM node-loader.
 * Running rspack out-of-process matches how it's invoked in production.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const DIST_LOADER = path.resolve(__dirname, '../../dist/WebpackLoader.js');
const RUNNER = path.resolve(__dirname, 'helpers/runRspack.js');

const makeTmpDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'ror-rsc-rspack-loader-'));

const cleanupTmpDir = (dir: string): void => {
  fs.rmSync(dir, { recursive: true, force: true });
};

interface RspackResult {
  ok: boolean;
  errors?: string[];
  warnings?: string[];
  outputPath?: string;
}

const runRspack = (config: unknown, cwd: string): RspackResult => {
  const configPath = path.join(cwd, '__rspack_config__.json');
  fs.writeFileSync(configPath, JSON.stringify(config));
  try {
    const out = execFileSync('node', [RUNNER, configPath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out) as RspackResult;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout) as RspackResult;
      } catch {
        /* fallthrough */
      }
    }
    return {
      ok: false,
      errors: [err.stderr || err.message],
    };
  }
};

describe('RSCWebpackLoader runs under rspack', () => {
  let tmpDir: string;

  beforeAll(() => {
    // Precondition: dist/ must be built so rspack can require the loader.
    if (!fs.existsSync(DIST_LOADER)) {
      throw new Error(
        `Precondition failed: ${DIST_LOADER} does not exist. Run \`yarn build\` first.`,
      );
    }
  });

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
  });

  it('loads the loader module without error', () => {
    // Simply require()ing the loader should not throw.
    // If the loader reached into webpack/lib/*, this would fail.
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(DIST_LOADER);
      expect(typeof mod.default).toBe('function');
    }).not.toThrow();
  });

  it('transforms a "use client" file through rspack — rewrites exports as registerClientReference stubs', () => {
    const srcFile = path.join(tmpDir, 'Component.jsx');
    fs.writeFileSync(
      srcFile,
      `'use client';\n\nexport function Header() {\n  return null;\n}\n\nexport default function HomePage() {\n  return null;\n}\n`,
    );

    const result = runRspack(
      {
        mode: 'development',
        target: 'node',
        entry: srcFile,
        output: {
          path: tmpDir,
          filename: 'bundle.js',
          library: { type: 'commonjs2' },
        },
        devtool: false,
        module: {
          rules: [
            {
              test: /\.jsx$/,
              use: [{ loader: DIST_LOADER }],
            },
          ],
        },
        externals: {
          // The transformed output imports from react-on-rails-rsc/server.
          // We don't need to resolve it for this test — we just want to
          // verify the loader RAN and emitted the right shape.
          'react-on-rails-rsc/server': 'commonjs2 react-on-rails-rsc/server',
          'react-server-dom-webpack/server': 'commonjs2 react-server-dom-webpack/server',
        },
      },
      tmpDir,
    );

    if (!result.ok) {
      throw new Error(`rspack build failed:\n${(result.errors || []).join('\n')}`);
    }

    const bundlePath = path.join(tmpDir, 'bundle.js');
    expect(fs.existsSync(bundlePath)).toBe(true);

    const bundle = fs.readFileSync(bundlePath, 'utf8');
    // After loader transform, each export becomes a registerClientReference call.
    // Two exports in source → at least two calls.
    const registerCount = (bundle.match(/registerClientReference/g) || []).length;
    expect(registerCount).toBeGreaterThanOrEqual(2);
    // Loader must remove the original function bodies (user code must not run on server)
    expect(bundle).not.toContain('function Header() {\n  return null;\n}');
    expect(bundle).not.toContain('function HomePage() {\n  return null;\n}');
  });

  it('rspack does not emit any warnings about unknown loader APIs', () => {
    const srcFile = path.join(tmpDir, 'Simple.jsx');
    fs.writeFileSync(
      srcFile,
      `'use client';\nexport default function X() { return null; }\n`,
    );

    const result = runRspack(
      {
        mode: 'development',
        target: 'node',
        entry: srcFile,
        output: {
          path: tmpDir,
          filename: 'bundle.js',
          library: { type: 'commonjs2' },
        },
        devtool: false,
        module: {
          rules: [{ test: /\.jsx$/, use: [{ loader: DIST_LOADER }] }],
        },
        externals: {
          // The transformed output imports from react-on-rails-rsc/server.
          // We don't need to resolve it for this test — we just want to
          // verify the loader RAN and emitted the right shape.
          'react-on-rails-rsc/server': 'commonjs2 react-on-rails-rsc/server',
          'react-server-dom-webpack/server': 'commonjs2 react-server-dom-webpack/server',
        },
      },
      tmpDir,
    );

    if (!result.ok) {
      throw new Error(`rspack build failed:\n${(result.errors || []).join('\n')}`);
    }

    const warnings = result.warnings || [];
    // Filter out warnings that are NOT related to the loader API. The loader
    // itself should not trigger any warnings about unknown loader methods,
    // unsupported loader APIs, or missing bundler hooks.
    const loaderWarnings = warnings.filter((w) =>
      /resourcePath|this\._compiler|this\._compilation|loadModule/i.test(w),
    );
    expect(loaderWarnings).toEqual([]);
  });
});
