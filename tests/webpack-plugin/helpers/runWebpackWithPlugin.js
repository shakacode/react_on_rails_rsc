#!/usr/bin/env node
/**
 * Child-process runner that compiles a fixture with real webpack +
 * RSCWebpackPlugin (the TypeScript plugin built to dist/webpack).
 *
 * Called from tests/webpack-plugin/helpers/compile.ts. Reads an args JSON
 * file, runs webpack, writes result JSON to stdout. Mirrors the pattern of
 * tests/rspack-plugin/helpers/runRspackWithPlugin.js: webpack runs in a
 * child Node process so Jest's VM sandbox never interferes with webpack's
 * module resolution or loader execution.
 *
 * The entry always includes the real stock Flight client runtime
 * (react-server-dom-webpack/client.browser, or client.node for server
 * builds). The plugin keys its AsyncDependenciesBlock injection on that
 * module resource, so the runtime must be part of the bundle for
 * client-reference chunk groups to exist.
 *
 * Args shape (from compile.ts):
 *   {
 *     context: string,
 *     outputPath: string,
 *     isServer: boolean,
 *     clientManifestFilename?: string,
 *     clientReferenceDiagnosticsFilename?: string|false,
 *     entryClientReferencesFilename?: string|false,
 *     clientReferences?: unknown,   // RegExps encoded as {__type:'RegExp',...}
 *     chunkName?: string,
 *     publicPath?: string,
 *     crossOriginLoading?: false|'anonymous'|'use-credentials',
 *     outputExtra?: object,         // merged into config.output
 *     optimizationExtra?: object,   // merged into config.optimization
 *     maxChunks?: number,           // applies webpack LimitChunkCountPlugin
 *     extraEntries?: object,        // additional entrypoints: name -> request
 *     withCss?: boolean,            // wires css-loader + MiniCssExtractPlugin
 *     exposeClientRuntime?: boolean, // append helpers/exposeClientRuntime.js
 *                                    // to `main` so `output.library` exports
 *                                    // the bundled Flight node client
 *   }
 *
 * Success stdout:  { ok: true, assets: [...], warnings: [...] }
 * Failure stdout:  { ok: false, errors: [...], warnings: [...] }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

const pluginDistPath = path.resolve(__dirname, '../../../dist/webpack/RSCWebpackPlugin.js');
if (!fs.existsSync(pluginDistPath)) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      errors: [
        `Missing ${path.relative(path.resolve(__dirname, '../../..'), pluginDistPath)}. Run \`yarn build\` first.`,
      ],
    }),
  );
  process.exit(1);
}
const { RSCWebpackPlugin: ReactFlightWebpackPlugin } = require(pluginDistPath);

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
  clientReferenceDiagnosticsFilename,
  entryClientReferencesFilename,
  clientReferences: rawClientReferences,
  chunkName,
  publicPath,
  crossOriginLoading,
  outputExtra,
  optimizationExtra,
  maxChunks,
  extraEntries,
  withCss,
  exposeClientRuntime,
} = args;

const runtimeEntry = require.resolve(
  isServer ? 'react-server-dom-webpack/client.node' : 'react-server-dom-webpack/client.browser',
);

const clientReferences = reviveFromRunner(rawClientReferences);
const revivedOutputExtra = reviveFromRunner(outputExtra);
const revivedOptimizationExtra = reviveFromRunner(optimizationExtra);

const plugins = [
  new ReactFlightWebpackPlugin({
    isServer,
    clientManifestFilename,
    clientReferenceDiagnosticsFilename,
    entryClientReferencesFilename,
    clientReferences,
    chunkName,
  }),
];
if (typeof maxChunks === 'number') {
  plugins.push(new webpack.optimize.LimitChunkCountPlugin({ maxChunks }));
}
let MiniCssExtractPlugin;
if (withCss) {
  MiniCssExtractPlugin = require('mini-css-extract-plugin');
  plugins.push(
    new MiniCssExtractPlugin({
      filename: '[name].css',
      chunkFilename: '[name].chunk.css',
    }),
  );
}

// The runtime entry must come first in `main` so the plugin's block
// injection happens in the default entrypoint. With `output.library`,
// webpack exports the LAST entry module, so the optional runtime re-export
// goes at the end.
const mainEntry = [runtimeEntry, './index.js'];
if (exposeClientRuntime) {
  mainEntry.push(path.resolve(__dirname, 'exposeClientRuntime.js'));
}

const config = {
  mode: 'development',
  target: isServer ? 'node' : 'web',
  context,
  entry: { main: mainEntry, ...(extraEntries || {}) },
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
  ...(withCss
    ? {
        module: {
          rules: [{ test: /\.css$/, use: [MiniCssExtractPlugin.loader, 'css-loader'] }],
        },
      }
    : {}),
  devtool: false,
  plugins,
};

webpack(config, (err, stats) => {
  if (err) {
    // Keep the stack and webpack's `details` — fatal config/loader errors
    // are unreadable from the message alone.
    const details = [err.stack || String(err), err.details].filter(Boolean);
    process.stdout.write(JSON.stringify({ ok: false, errors: [details.join('\n')] }));
    process.exit(1);
  }
  if (!stats) {
    process.stdout.write(JSON.stringify({ ok: false, errors: ['no stats returned'] }));
    process.exit(1);
  }
  const info = stats.toJson({ errors: true, warnings: true, assets: true, modules: true });
  if (stats.hasErrors()) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        errors: (info.errors || []).map((e) =>
          [e.moduleName, e.message, e.details].filter(Boolean).join('\n'),
        ),
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
      modules: compactModules(info.modules || []),
    }),
  );
});

function compactModules(modules) {
  return modules.map((module) => ({
    name: module.name,
    identifier: module.identifier,
    moduleType: module.moduleType,
    modules: module.modules ? compactModules(module.modules) : undefined,
  }));
}

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
