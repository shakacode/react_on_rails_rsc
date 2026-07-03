#!/usr/bin/env node
/**
 * Child-process runner that compiles a fixture with rspack + RSCRspackPlugin.
 *
 * Called from tests/rspack-plugin/helpers/compile.ts. Reads an args JSON
 * file, runs rspack, writes result JSON to stdout.
 *
 * Args shape (from compile.ts):
 *   {
 *     context: string,
 *     outputPath: string,
 *     isServer: boolean,
 *     clientManifestFilename?: string,
 *     clientReferenceDiagnosticsFilename?: string|false,
 *     clientReferences?: unknown,
 *     publicPath?: string,
 *     crossOriginLoading?: false|'anonymous'|'use-credentials',
 *     withCss?: boolean,
 *     maxChunks?: number,
 *     configExtra?: object,
 *   }
 *
 * Success stdout:  { ok: true, assets: [...] }
 * Failure stdout:  { ok: false, errors: [...], warnings: [...] }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { rspack } = require('@rspack/core');

const { RSCRspackPlugin } = require('../../../dist/react-server-dom-rspack/plugin');

const argsFile = process.argv[2];
if (!argsFile) {
  process.stderr.write('Usage: node runRspackWithPlugin.js <args.json>\n');
  process.exit(2);
}
const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));

const {
  context,
  outputPath,
  isServer,
  clientManifestFilename,
  clientReferenceDiagnosticsFilename,
  clientReferences: rawClientReferences,
  publicPath,
  crossOriginLoading,
  withCss,
  maxChunks,
  configExtra,
} = args;

if (configExtra && Object.prototype.hasOwnProperty.call(configExtra, 'entry')) {
  throw new Error(
    'configExtra.entry is not supported; the test runner must keep the Flight runtime entry.',
  );
}

const runtimeEntries = {
  server: path.resolve(__dirname, '../../../dist/client.node.js'),
  client: path.resolve(__dirname, '../../../dist/client.browser.js'),
};
const missingRuntimeEntries = Object.values(runtimeEntries).filter((entry) => !fs.existsSync(entry));
if (missingRuntimeEntries.length > 0) {
  process.stdout.write(JSON.stringify({
    ok: false,
    errors: missingRuntimeEntries.map((entry) =>
      `Missing ${path.relative(path.resolve(__dirname, '../../..'), entry)}. Run \`yarn build\` first.`,
    ),
  }));
  process.exit(1);
}
const runtimeEntry = isServer ? runtimeEntries.server : runtimeEntries.client;
const clientReferences = reviveFromRunner(rawClientReferences);
const revivedConfigExtra = reviveFromRunner(configExtra);
const plugins = [
  new RSCRspackPlugin({
    isServer: isServer,
    clientManifestFilename: clientManifestFilename,
    clientReferenceDiagnosticsFilename: clientReferenceDiagnosticsFilename,
    clientReferences: clientReferences,
  }),
];
if (withCss) {
  plugins.push(
    new rspack.CssExtractRspackPlugin({
      filename: '[name].css',
      chunkFilename: '[name].chunk.css',
    }),
  );
}
if (typeof maxChunks === 'number') {
  plugins.push(new rspack.optimize.LimitChunkCountPlugin({ maxChunks }));
}

const config = {
  mode: 'development',
  target: isServer ? 'node' : 'web',
  context,
  entry: [runtimeEntry, './index.js'],
  output: {
    path: outputPath,
    filename: '[name].js',
    chunkFilename: '[name].chunk.js',
    publicPath: publicPath ?? '',
    crossOriginLoading: crossOriginLoading ?? false,
  },
  optimization: {
    chunkIds: 'named',
    moduleIds: 'named',
    minimize: false,
  },
  devtool: false,
  ...(withCss
    ? {
        module: {
          rules: [{ test: /\.css$/, use: [rspack.CssExtractRspackPlugin.loader, 'css-loader'] }],
        },
      }
    : {}),
  plugins,
  ...(revivedConfigExtra || {}),
};

rspack(config, (err, stats) => {
  if (err) {
    process.stdout.write(JSON.stringify({ ok: false, errors: [String(err)] }));
    process.exit(1);
  }
  if (!stats) {
    process.stdout.write(JSON.stringify({ ok: false, errors: ['no stats returned'] }));
    process.exit(1);
  }
  const info = stats.toJson({ errors: true, warnings: true, assets: true });
  if (stats.hasErrors()) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        errors: (info.errors || []).map((e) => e.message),
        warnings: (info.warnings || []).map((w) => w.message),
      }),
    );
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({
      ok: true,
      warnings: (info.warnings || []).map((w) => w.message),
      assets: (info.assets || []).map((a) => a.name),
    }),
  );
});

function reviveFromRunner(value) {
  if (value && typeof value === 'object' && value.__type === 'RegExp') {
    if (
      typeof value.source !== 'string' ||
      typeof value.flags !== 'string' ||
      /[^gimsuy]/.test(value.flags)
    ) {
      throw new TypeError('reviveFromRunner: invalid RegExp payload');
    }
    try {
      return new RegExp(value.source, value.flags);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new TypeError(`reviveFromRunner: invalid RegExp source "${value.source}": ${message}`);
    }
  }
  if (Array.isArray(value)) {
    return value.map(reviveFromRunner);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, reviveFromRunner(child)]),
    );
  }
  return value;
}
