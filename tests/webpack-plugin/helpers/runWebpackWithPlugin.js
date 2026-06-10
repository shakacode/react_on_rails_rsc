#!/usr/bin/env node
/**
 * Child-process runner that compiles a fixture with real webpack +
 * ReactFlightWebpackPlugin (the fork in src/react-server-dom-webpack).
 *
 * Called from tests/webpack-plugin/helpers/compile.ts. Reads an args JSON
 * file, runs webpack, writes result JSON to stdout. Mirrors the pattern of
 * tests/rspack-plugin/helpers/runRspackWithPlugin.js: webpack runs in a
 * child Node process so Jest's VM sandbox never interferes with webpack's
 * module resolution or loader execution.
 *
 * The entry always includes the real Flight client runtime
 * (src/react-server-dom-webpack/client.browser.js, or client.node.js for
 * server builds). The plugin keys its AsyncDependenciesBlock injection on
 * that module resource (the exact path, or a copy inside a package named
 * react-on-rails-rsc), so the runtime must be part of the bundle for
 * client-reference chunk groups to exist.
 *
 * Args shape (from compile.ts):
 *   {
 *     context: string,
 *     outputPath: string,
 *     isServer: boolean,
 *     clientManifestFilename?: string,
 *     clientReferences?: unknown,   // RegExps encoded as {__type:'RegExp',...}
 *     chunkName?: string,
 *     publicPath?: string,
 *     crossOriginLoading?: false|'anonymous'|'use-credentials',
 *     outputExtra?: object,         // merged into config.output
 *     optimizationExtra?: object,   // merged into config.optimization
 *     maxChunks?: number,           // applies webpack LimitChunkCountPlugin
 *   }
 *
 * Success stdout:  { ok: true, assets: [...], warnings: [...] }
 * Failure stdout:  { ok: false, errors: [...], warnings: [...] }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

const ReactFlightWebpackPlugin = require('../../../src/react-server-dom-webpack/cjs/react-server-dom-webpack-plugin.js');

const argsFile = process.argv[2];
if (!argsFile) {
  process.stderr.write('Usage: node runWebpackWithPlugin.js <args.json>\n');
  process.exit(2);
}
const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));

const {
  context,
  outputPath,
  isServer,
  clientManifestFilename,
  clientReferences: rawClientReferences,
  chunkName,
  publicPath,
  crossOriginLoading,
  outputExtra,
  optimizationExtra,
  maxChunks,
} = args;

const runtimeEntry = path.resolve(
  __dirname,
  isServer
    ? '../../../src/react-server-dom-webpack/client.node.js'
    : '../../../src/react-server-dom-webpack/client.browser.js',
);

const clientReferences = reviveFromRunner(rawClientReferences);
const revivedOutputExtra = reviveFromRunner(outputExtra);
const revivedOptimizationExtra = reviveFromRunner(optimizationExtra);

const plugins = [
  new ReactFlightWebpackPlugin({
    isServer,
    clientManifestFilename,
    clientReferences,
    chunkName,
  }),
];
if (typeof maxChunks === 'number') {
  plugins.push(new webpack.optimize.LimitChunkCountPlugin({ maxChunks }));
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
    publicPath: publicPath !== undefined ? publicPath : '',
    crossOriginLoading: crossOriginLoading !== undefined ? crossOriginLoading : false,
    ...(revivedOutputExtra || {}),
  },
  optimization: {
    chunkIds: 'named',
    moduleIds: 'named',
    minimize: false,
    ...(revivedOptimizationExtra || {}),
  },
  devtool: false,
  plugins,
};

webpack(config, (err, stats) => {
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
