#!/usr/bin/env node
/**
 * Builds the fixture app from the INSTALLED react-on-rails-rsc tarball.
 *
 * Usage: node scripts/build.js <webpack|rspack> <client|ssr>
 *
 * Resolves the bundler, the RSC plugin, and the Flight runtime entirely
 * from this consumer project's node_modules so the packed dist/ output and
 * the package exports map are what gets exercised — not the repo's src/.
 *
 * Output: build/<bundler>/<target>/ inside the project.
 * Stdout: JSON { ok, assets, warnings } or { ok: false, errors }.
 */

'use strict';

const path = require('path');

const bundlerName = process.argv[2];
const target = process.argv[3];
if (!['webpack', 'rspack'].includes(bundlerName) || !['client', 'ssr'].includes(target)) {
  process.stderr.write('Usage: node scripts/build.js <webpack|rspack> <client|ssr>\n');
  process.exit(2);
}

const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'build', bundlerName, target);
const isServer = target === 'ssr';

let runBundler;
let RSCPlugin;
let CssExtractPlugin;
if (bundlerName === 'webpack') {
  runBundler = require('webpack');
  RSCPlugin = require('react-on-rails-rsc/WebpackPlugin').RSCWebpackPlugin;
  CssExtractPlugin = require('mini-css-extract-plugin');
} else {
  const { rspack } = require('@rspack/core');
  runBundler = rspack;
  RSCPlugin = require('react-on-rails-rsc/RspackPlugin').RSCRspackPlugin;
  CssExtractPlugin = rspack.CssExtractRspackPlugin;
}

/**
 * Seeds fake `.hot-update.css` / `.hot-update.js` files onto a client
 * chunk so the manifest's hot-update exclusion is exercised by a real
 * build instead of being vacuously true (one-shot builds never produce
 * hot updates on their own). webpack-only: rspack's JS API does not allow
 * mutating `chunk.files`.
 */
class SeedHotUpdateAssetsPlugin {
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap('SeedHotUpdateAssetsPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        { name: 'SeedHotUpdateAssetsPlugin', stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
        () => {
          for (const chunk of compilation.chunks) {
            if (typeof chunk.name === 'string' && chunk.name.includes('Counter')) {
              for (const ext of ['css', 'js']) {
                const file = `seeded.fake.hot-update.${ext}`;
                compilation.emitAsset(file, new sources.RawSource('/* seeded hot update */'));
                chunk.files.add(file);
              }
            }
          }
        },
      );
    });
  }
}

const plugins = [
  new RSCPlugin({
    isServer,
    chunkName: 'client-[request]',
    clientReferences: [
      {
        directory: path.join(projectRoot, 'src', 'components'),
        recursive: true,
        include: /\.js$/,
      },
    ],
  }),
];
if (!isServer) {
  plugins.push(
    new CssExtractPlugin({ filename: '[name].css', chunkFilename: '[name].chunk.css' }),
  );
  if (bundlerName === 'webpack') {
    plugins.push(new SeedHotUpdateAssetsPlugin());
  }
}

const cssRule = isServer
  ? // The SSR bundle only needs CSS imports to be loadable as modules; the
    // stylesheet hints come from the CLIENT manifest.
    { test: /\.css$/, type: 'asset/source' }
  : { test: /\.css$/, use: [CssExtractPlugin.loader, 'css-loader'] };

const config = {
  mode: 'development',
  context: projectRoot,
  target: isServer ? 'node' : 'web',
  entry: { main: isServer ? './src/ssr-entry.js' : './src/hydrate-entry.js' },
  output: {
    path: outputPath,
    filename: '[name].js',
    chunkFilename: '[name].chunk.js',
    publicPath: isServer ? '' : '/assets/',
    ...(isServer ? { library: { type: 'commonjs2' } } : {}),
  },
  optimization: {
    chunkIds: 'named',
    moduleIds: 'named',
    minimize: false,
    ...(isServer
      ? {}
      : {
          runtimeChunk: 'single',
          splitChunks: {
            chunks: 'all',
            minSize: 0,
            cacheGroups: {
              default: false,
              defaultVendors: false,
              sharedFormat: {
                test: /shared[\\/]format\.js$/,
                name: 'shared-format',
                minChunks: 2,
                enforce: true,
              },
            },
          },
        }),
  },
  module: { rules: [cssRule] },
  devtool: false,
  plugins,
};

runBundler(config, (err, stats) => {
  if (err) {
    process.stdout.write(JSON.stringify({ ok: false, errors: [String((err && err.stack) || err)] }));
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
        errors: (info.errors || []).map((e) => [e.moduleName, e.message].filter(Boolean).join('\n')),
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
