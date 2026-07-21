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
  clientReferenceDiagnosticsFilename?: string | false;
  entryClientReferencesFilename?: string | false;
  publicPath?: string;
  crossOriginLoading?: false | 'anonymous' | 'use-credentials';
  clientReferences?: unknown;
  withCss?: boolean;
  cssWrapper?: boolean;
  chunkName?: string;
  /** Applies rspack.optimize.LimitChunkCountPlugin({ maxChunks }). */
  maxChunks?: number;
  outputFilename?: string;
  outputChunkFilename?: string;
  /** Drops the Flight runtime entry to assert missing-runtime behavior. */
  omitRuntimeEntry?: boolean;
  /** Additional entrypoints (name -> request) besides the default `main`. */
  extraEntries?: Record<string, string>;
  /** Additional rspack config to merge. Use sparingly. */
  configExtra?: Record<string, unknown>;
}

export interface CompileResult {
  manifest: {
    moduleLoading: { prefix: string; crossOrigin: string | null };
    filePathToModuleMetadata: Record<
      string,
      { id: string; chunks: (string | number)[]; css: string[]; name: string }
    >;
  };
  manifestSource: string;
  manifestPath: string;
  clientReferenceDiagnostics?: {
    version: 1;
    manifestFilename: string;
    isServer: boolean;
    clientReferenceCount: number;
    totalChunkBytes: number;
    clientReferences: Array<{
      file: string;
      id: string | number | null;
      name: string;
      totalBytes: number;
      chunks: Array<{ id: string | number | null; file: string; bytes: number | null }>;
      css?: Array<{ file: string; bytes: number | null }>;
    }>;
  };
  clientReferenceDiagnosticsSource?: string;
  entryClientReferences?: EntryClientReferences;
  assets: string[];
  warnings: string[];
  modules: BuildModuleStat[];
  outputPath: string;
}

export interface BuildModuleStat {
  name?: string;
  identifier?: string;
  moduleType?: string;
  modules?: BuildModuleStat[];
}

export interface EntryClientReferences {
  version: 1;
  isServer: boolean;
  compilerContext: string;
  entries: Record<
    string,
    { clientReferences: string[]; relativeClientReferences: string[] }
  >;
}

export const compile = (fixture: string, options: CompileOptions = {}): CompileResult => {
  const context = path.join(FIXTURES_ROOT, fixture);
  if (!fs.existsSync(context)) {
    throw new Error(`Fixture not found: ${context}`);
  }

  const outputPath = fs.mkdtempSync(
    path.join(os.tmpdir(), `ror-rsc-rspack-plugin-${fixture}-`),
  );
  try {
    return compileInto(context, outputPath, options);
  } catch (e) {
    // Failed compiles never reach the caller's cleanup list — remove the
    // tmp dir here so they don't leak.
    fs.rmSync(outputPath, { recursive: true, force: true });
    throw e;
  }
};

const compileInto = (
  context: string,
  outputPath: string,
  options: CompileOptions,
): CompileResult => {
  const runnerArgs = {
    context,
    outputPath,
    isServer: options.isServer ?? false,
    clientManifestFilename: options.clientManifestFilename,
    clientReferenceDiagnosticsFilename: options.clientReferenceDiagnosticsFilename,
    entryClientReferencesFilename: options.entryClientReferencesFilename,
    clientReferences: serializeForRunner(options.clientReferences),
    publicPath: options.publicPath,
    crossOriginLoading: options.crossOriginLoading,
    withCss: options.withCss,
    cssWrapper: options.cssWrapper,
    chunkName: options.chunkName,
    maxChunks: options.maxChunks,
    outputFilename: options.outputFilename,
    outputChunkFilename: options.outputChunkFilename,
    omitRuntimeEntry: options.omitRuntimeEntry,
    extraEntries: options.extraEntries,
    configExtra: serializeForRunner(options.configExtra ?? {}),
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
    modules?: BuildModuleStat[];
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
  const diagnosticsFilename = options.clientReferenceDiagnosticsFilename;
  const diagnosticsPath =
    typeof diagnosticsFilename === 'string' ? path.join(outputPath, diagnosticsFilename) : undefined;
  const clientReferenceDiagnosticsSource =
    diagnosticsPath && fs.existsSync(diagnosticsPath)
      ? fs.readFileSync(diagnosticsPath, 'utf8')
      : undefined;
  const clientReferenceDiagnostics = clientReferenceDiagnosticsSource
    ? (JSON.parse(clientReferenceDiagnosticsSource) as CompileResult['clientReferenceDiagnostics'])
    : undefined;
  const entryReferencesFilename = options.entryClientReferencesFilename;
  const entryReferencesPath =
    typeof entryReferencesFilename === 'string'
      ? path.join(outputPath, entryReferencesFilename)
      : undefined;
  const entryClientReferences =
    entryReferencesPath && fs.existsSync(entryReferencesPath)
      ? (JSON.parse(fs.readFileSync(entryReferencesPath, 'utf8')) as EntryClientReferences)
      : undefined;

  return {
    manifest,
    manifestSource,
    manifestPath,
    clientReferenceDiagnostics,
    clientReferenceDiagnosticsSource,
    entryClientReferences,
    assets: result.assets ?? [],
    warnings: result.warnings ?? [],
    modules: result.modules ?? [],
    outputPath,
  };
};

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
