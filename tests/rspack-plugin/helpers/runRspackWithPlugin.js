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
 *     publicPath?: string,
 *     crossOriginLoading?: false|'anonymous'|'use-credentials',
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
  publicPath,
  crossOriginLoading,
  configExtra,
} = args;

const config = {
  mode: 'development',
  target: 'web',
  context,
  entry: './index.js',
  output: {
    path: outputPath,
    filename: 'main.js',
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
  plugins: [
    new RSCRspackPlugin({
      isServer: isServer,
      clientManifestFilename: clientManifestFilename,
    }),
  ],
  ...(configExtra || {}),
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
