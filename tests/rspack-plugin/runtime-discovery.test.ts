/**
 * Regression test for issue #105 — Rspack RSC build fails to locate the client
 * runtime in a duplicate-install topology.
 *
 * On the 19.2 line the rspack plugin matched the Flight client runtime with a
 * strict `mod.resource === expectedRuntime` equality. When the
 * `react-server-dom-webpack` module rspack records lives at a different install
 * path than the one the plugin's `require.resolve(...)` returns (a second copy
 * in the app's `node_modules`, a pnpm/yarn symlink store, a hoisted vs nested
 * install), the equality fails and the plugin emits:
 *
 *   "Client runtime at react-on-rails-rsc/client was not found.
 *    React Server Components module map file (default) was not created."
 *
 * The webpack plugin never had this problem because it recognizes the runtime
 * by file-name suffix + a `react-server-dom-webpack` `package.json` walk
 * (`isReactOnRailsRSCRuntimeResource`, the #43 duplicate-install fix). This
 * test reproduces the divergent topology and asserts the rspack plugin finds
 * the runtime and still emits a populated module map.
 *
 * Runs rspack in a child Node process (see helpers/runRspackDuplicateRuntime.js)
 * because the loaders use dynamic ESM imports unsupported in Jest's VM sandbox.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const RUNNER = path.resolve(__dirname, 'helpers/runRspackDuplicateRuntime.js');
const DIST_PLUGIN = path.resolve(__dirname, '../../dist/react-server-dom-rspack/plugin.js');

interface RunResult {
  ok: boolean;
  errors?: string[];
  warnings: string[];
  clientEntryKeys: string[];
  pluginResolvedRuntime: string;
  appRuntimeResource: string;
  manifestEmitted: boolean;
}

const runDuplicateRuntime = (isServer: boolean): RunResult => {
  const argsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ror-rsc-dup-args-'));
  const argsFile = path.join(argsDir, 'args.json');
  fs.writeFileSync(argsFile, JSON.stringify({ isServer }));
  try {
    const out = execFileSync('node', [RUNNER, argsFile], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    return JSON.parse(out) as RunResult;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(
      `Duplicate-runtime rspack build failed:\n${err.stderr || err.stdout || err.message}`,
    );
  } finally {
    fs.rmSync(argsDir, { recursive: true, force: true });
  }
};

const RUNTIME_NOT_FOUND = /Client runtime at react-on-rails-rsc\/client was not found/;

describe('RSCRspackPlugin runtime discovery (issue #105)', () => {
  beforeAll(() => {
    if (!fs.existsSync(DIST_PLUGIN)) {
      throw new Error(
        `Precondition: ${DIST_PLUGIN} does not exist. Run \`yarn build\` first.`,
      );
    }
  });

  it('finds the client runtime when rspack records a duplicate-install path (client build)', () => {
    const result = runDuplicateRuntime(false);

    // Sanity: the test is only meaningful if the recorded runtime path and the
    // plugin's resolved path actually diverge. Folded into this build rather
    // than a separate `it` so we do not run an extra full rspack compile just
    // for the divergence assertion.
    expect(result.appRuntimeResource).not.toBe(result.pluginResolvedRuntime);

    expect(result.ok).toBe(true);
    const notFound = result.warnings.find((w) => RUNTIME_NOT_FOUND.test(w));
    expect(notFound).toBeUndefined();
    expect(result.manifestEmitted).toBe(true);

    // A client component directly imported by the entry graph.
    expect(result.clientEntryKeys.some((k) => k.endsWith('ClientButton.js'))).toBe(true);

    // A "use client" component reached ONLY through the plugin's filesystem
    // discovery (never imported by the entry). This requires the injection
    // loader to run on the duplicate-install runtime module — the part the
    // detection-only fix missed. Detection alone suppresses the warning but
    // leaves this entry out of the manifest, so this is the assertion that
    // catches the incomplete module map.
    expect(result.clientEntryKeys.some((k) => k.endsWith('FsDiscoveredClient.js'))).toBe(true);
  });

  it('finds the client runtime when rspack records a duplicate-install path (server build)', () => {
    const result = runDuplicateRuntime(true);
    expect(result.ok).toBe(true);
    const notFound = result.warnings.find((w) => RUNTIME_NOT_FOUND.test(w));
    expect(notFound).toBeUndefined();
    expect(result.manifestEmitted).toBe(true);
    expect(result.clientEntryKeys.some((k) => k.endsWith('ClientButton.js'))).toBe(true);
    expect(result.clientEntryKeys.some((k) => k.endsWith('FsDiscoveredClient.js'))).toBe(true);
  });
});
