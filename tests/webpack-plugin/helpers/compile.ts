/**
 * Test helper — compile a fixture with real webpack + ReactFlightWebpackPlugin.
 *
 * Mirrors tests/rspack-plugin/helpers/compile.ts: runs webpack in a child
 * Node process (helpers/runWebpackWithPlugin.js) and returns the parsed
 * client manifest + raw source + emitted asset names + build warnings.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const RUNNER = path.resolve(__dirname, 'runWebpackWithPlugin.js');
const FIXTURES_ROOT = path.resolve(__dirname, '../fixtures');

export interface CompileOptions {
  isServer?: boolean;
  clientManifestFilename?: string;
  /** Passed through to the plugin; RegExps survive the child-process hop. */
  clientReferences?: unknown;
  /** Chunk name template, e.g. 'client-[request]' for readable chunk ids. */
  chunkName?: string;
  publicPath?: string;
  crossOriginLoading?: false | 'anonymous' | 'use-credentials';
  /** Merged into webpack config.output (e.g. { chunkFilename: '[name].chunk.mjs' }). */
  outputExtra?: Record<string, unknown>;
  /** Merged into webpack config.optimization (e.g. { splitChunks: {...} }). */
  optimizationExtra?: Record<string, unknown>;
  /** Applies webpack.optimize.LimitChunkCountPlugin({ maxChunks }). */
  maxChunks?: number;
}

export interface ModuleMetadata {
  id: string | number;
  chunks: (string | number)[];
  css?: string[];
  name: string;
}

export interface CompileResult {
  manifest: {
    moduleLoading: { prefix: string; crossOrigin: string | null };
    filePathToModuleMetadata: Record<string, ModuleMetadata>;
  };
  manifestSource: string;
  manifestPath: string;
  assets: string[];
  warnings: string[];
  outputPath: string;
}

export const compile = (fixture: string, options: CompileOptions = {}): CompileResult => {
  const context = path.join(FIXTURES_ROOT, fixture);
  if (!fs.existsSync(context)) {
    throw new Error(`Fixture not found: ${context}`);
  }

  const outputPath = fs.mkdtempSync(
    path.join(os.tmpdir(), `ror-rsc-webpack-plugin-${fixture}-`),
  );

  const runnerArgs = {
    context,
    outputPath,
    isServer: options.isServer ?? false,
    clientManifestFilename: options.clientManifestFilename,
    clientReferences: serializeForRunner(options.clientReferences),
    chunkName: options.chunkName,
    publicPath: options.publicPath,
    crossOriginLoading: options.crossOriginLoading,
    outputExtra: serializeForRunner(options.outputExtra),
    optimizationExtra: serializeForRunner(options.optimizationExtra),
    maxChunks: options.maxChunks,
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
    throw new Error(`webpack compilation failed:\n${details}`);
  }

  const result = JSON.parse(resultJson) as {
    ok: boolean;
    errors?: string[];
    warnings?: string[];
    assets?: string[];
  };
  if (!result.ok) {
    throw new Error(`webpack build errors:\n${(result.errors ?? []).join('\n')}`);
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
    warnings: result.warnings ?? [],
    outputPath,
  };
};

/** Find the manifest entry whose file:// key ends with the given suffix. */
export const entryEndingWith = (
  manifest: CompileResult['manifest'],
  suffix: string,
): ModuleMetadata => {
  const matches = Object.entries(manifest.filePathToModuleMetadata).filter(([key]) =>
    key.endsWith(suffix),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one manifest entry ending with "${suffix}", found ${matches.length}. ` +
        `Keys: ${Object.keys(manifest.filePathToModuleMetadata).join(', ')}`,
    );
  }
  return matches[0]![1];
};

/** Manifest chunks are encoded as [id, file, id, file, ...] — return the files. */
export const chunkFiles = (metadata: ModuleMetadata): string[] =>
  metadata.chunks.filter((_value, index) => index % 2 === 1).map(String);

/** Manifest chunks are encoded as [id, file, id, file, ...] — return the ids. */
export const chunkIds = (metadata: ModuleMetadata): (string | number)[] =>
  metadata.chunks.filter((_value, index) => index % 2 === 0);

const serializeForRunner = (value: unknown): unknown => {
  if (value instanceof RegExp) {
    return { __type: 'RegExp', source: value.source, flags: value.flags };
  }
  if (Array.isArray(value)) {
    return value.map(serializeForRunner);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, serializeForRunner(child)]),
    );
  }
  return value;
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
