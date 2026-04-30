/**
 * Shared helpers for rspack-compat tests.
 *
 * We run rspack in a child Node process (via helpers/runRspack.js) because
 * Jest's VM sandbox doesn't support dynamic ESM `import()` inside loaders.
 * Running out-of-process matches how rspack is invoked in production.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

export const RUNNER = path.resolve(__dirname, 'runRspack.js');

export const makeTmpDir = (prefix = 'ror-rsc-rspack-'): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), prefix));

export const cleanupTmpDir = (dir: string): void => {
  fs.rmSync(dir, { recursive: true, force: true });
};

export interface RspackResult {
  ok: boolean;
  errors?: string[];
  warnings?: string[];
  outputPath?: string;
}

export const runRspack = (config: unknown, cwd: string): RspackResult => {
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

export const expectRspackSuccess = (result: RspackResult): void => {
  if (!result.ok) {
    throw new Error(`rspack build failed:\n${(result.errors || []).join('\n')}`);
  }
};
