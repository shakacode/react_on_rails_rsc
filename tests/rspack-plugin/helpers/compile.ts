/**
 * Test helper — compile a fixture with rspack + RSCRspackPlugin.
 *
 * Pattern borrowed from `rspack-manifest-plugin`'s test suite. Runs rspack in
 * a child Node process (via `helpers/runRspackWithPlugin.js`) because Jest's
 * VM sandbox does not support dynamic ESM imports from loaders on Node 20.
 *
 * Returns the parsed manifest + raw manifest source + all emitted assets.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const RUNNER = path.resolve(__dirname, 'runRspackWithPlugin.js');
const FIXTURES_ROOT = path.resolve(__dirname, '../fixtures');

export interface CompileOptions {
  isServer?: boolean;
  clientManifestFilename?: string;
  publicPath?: string;
  crossOriginLoading?: false | 'anonymous' | 'use-credentials';
  /** Additional rspack config to merge. Use sparingly. */
  configExtra?: Record<string, unknown>;
}

export interface CompileResult {
  manifest: {
    moduleLoading: { prefix: string; crossOrigin: string | null };
    filePathToModuleMetadata: Record<
      string,
      { id: string; chunks: (string | number)[]; name: string }
    >;
  };
  manifestSource: string;
  manifestPath: string;
  assets: string[];
  outputPath: string;
}

export const compile = (fixture: string, options: CompileOptions = {}): CompileResult => {
  const context = path.join(FIXTURES_ROOT, fixture);
  if (!fs.existsSync(context)) {
    throw new Error(`Fixture not found: ${context}`);
  }

  const outputPath = fs.mkdtempSync(
    path.join(os.tmpdir(), `ror-rsc-rspack-plugin-${fixture}-`),
  );

  const runnerArgs = {
    context,
    outputPath,
    isServer: options.isServer ?? false,
    clientManifestFilename: options.clientManifestFilename,
    publicPath: options.publicPath,
    crossOriginLoading: options.crossOriginLoading,
    configExtra: options.configExtra ?? {},
  };
  const argsFile = path.join(outputPath, '__args__.json');
  fs.writeFileSync(argsFile, JSON.stringify(runnerArgs));

  let resultJson: string;
  try {
    resultJson = execFileSync('node', [RUNNER, argsFile], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    const details = err.stderr || err.stdout || err.message;
    throw new Error(`rspack compilation failed:\n${details}`);
  }

  const result = JSON.parse(resultJson) as {
    ok: boolean;
    errors?: string[];
    warnings?: string[];
    assets?: string[];
    outputPath?: string;
  };
  if (!result.ok) {
    throw new Error(`rspack build errors:\n${(result.errors ?? []).join('\n')}`);
  }

  const defaultFilename = (options.isServer ?? false)
    ? 'react-server-client-manifest.json'
    : 'react-client-manifest.json';
  const manifestFilename = options.clientManifestFilename ?? defaultFilename;
  const manifestPath = path.join(outputPath, manifestFilename);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Manifest not emitted at ${manifestPath}. Assets: ${(result.assets ?? []).join(', ')}`,
    );
  }
  const manifestSource = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestSource) as CompileResult['manifest'];

  return {
    manifest,
    manifestSource,
    manifestPath,
    assets: result.assets ?? [],
    outputPath,
  };
};

/**
 * Cleanup all tmp output dirs created by `compile()`. Call in `afterAll`.
 */
export const cleanupOutputDirs = (results: CompileResult[]): void => {
  for (const r of results) {
    if (r.outputPath && fs.existsSync(r.outputPath)) {
      fs.rmSync(r.outputPath, { recursive: true, force: true });
    }
  }
};
