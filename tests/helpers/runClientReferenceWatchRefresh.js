#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const argsFile = process.argv[2];
if (!argsFile) {
  process.stderr.write('Usage: node runClientReferenceWatchRefresh.js <args.json>\n');
  process.exit(2);
}

const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
const projectRoot = path.resolve(__dirname, '../..');
const context = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), `ror-rsc-${args.bundler}-${args.scenario}-`))
);
const outputPath = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), `ror-rsc-${args.bundler}-${args.scenario}-out-`))
);

const indexPath = path.join(context, 'index.js');
const clientsDir = path.join(context, 'components');
const clientPath = (name) => path.join(clientsDir, `${name}.js`);

const writeIndex = (label) => {
  fs.writeFileSync(indexPath, `export const marker = ${JSON.stringify(label)};\n`);
};

const writeClient = (name) => {
  fs.writeFileSync(
    clientPath(name),
    `'use client';\nexport default function ${name}() {\n  return ${JSON.stringify(name)};\n}\n`
  );
};

writeIndex('initial');
fs.mkdirSync(clientsDir);
writeClient('InitialClient');
if (args.scenario === 'remove') {
  writeClient('RemovedClient');
}

runWatch()
  .then((result) => {
    process.stdout.write(JSON.stringify(result));
  })
  .catch((error) => {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        bundler: args.bundler,
        scenario: args.scenario,
        errors: [error && error.stack ? error.stack : String(error)],
        snapshots: [],
      })
    );
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(context, { recursive: true, force: true });
    fs.rmSync(outputPath, { recursive: true, force: true });
  });

function runWatch() {
  return new Promise((resolve) => {
    const { compiler, manifestFilename } = createCompiler(args.bundler);
    const snapshots = [];
    let finished = false;
    let watching;

    const timeout = setTimeout(() => {
      finish({
        ok: false,
        errors: [`Timed out waiting for ${args.bundler} ${args.scenario} watch rebuild`],
      });
    }, 60_000);

    const finish = (partial) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      const result = {
        ok: partial.ok,
        bundler: args.bundler,
        scenario: args.scenario,
        errors: partial.errors,
        snapshots,
      };

      const closeCompiler = () => {
        if (typeof compiler.close === 'function') {
          compiler.close(() => resolve(result));
          return;
        }
        resolve(result);
      };

      if (watching) {
        watching.close(closeCompiler);
      } else {
        closeCompiler();
      }
    };

    watching = compiler.watch({ aggregateTimeout: 20, poll: 50 }, (err, stats) => {
      if (finished) return;
      if (err) {
        finish({ ok: false, errors: [err.stack || String(err)] });
        return;
      }
      if (!stats) {
        finish({ ok: false, errors: ['watch callback did not receive stats'] });
        return;
      }

      const snapshot = createSnapshot(stats, manifestFilename);
      snapshots.push(snapshot);

      if (snapshot.errors.length > 0) {
        finish({ ok: false, errors: snapshot.errors });
        return;
      }

      if (snapshots.length === 1) {
        if (args.scenario === 'add') {
          writeClient('AddedClient');
        } else if (args.scenario === 'remove') {
          fs.rmSync(clientPath('RemovedClient'), { force: true });
        } else {
          finish({ ok: false, errors: [`Unknown scenario: ${args.scenario}`] });
        }
        return;
      }

      finish({ ok: true });
    });
  });
}

function createCompiler(bundler) {
  if (bundler === 'rspack') {
    const { rspack } = require('@rspack/core');
    const { RSCRspackPlugin } = require(path.join(
      projectRoot,
      'dist/react-server-dom-rspack/plugin.js'
    ));
    const runtimeEntry = path.join(projectRoot, 'dist/client.browser.js');
    const manifestFilename = 'react-client-manifest.json';
    return {
      manifestFilename,
      compiler: rspack({
        mode: 'development',
        target: 'web',
        context,
        entry: [runtimeEntry, './index.js'],
        output: {
          path: outputPath,
          filename: '[name].js',
          chunkFilename: '[name].chunk.js',
          publicPath: '',
          crossOriginLoading: false,
        },
        optimization: {
          chunkIds: 'named',
          moduleIds: 'named',
          minimize: false,
        },
        devtool: false,
        plugins: [new RSCRspackPlugin({ isServer: false })],
      }),
    };
  }

  if (bundler === 'webpack') {
    const webpack = require('webpack');
    const { RSCWebpackPlugin } = require(path.join(
      projectRoot,
      'dist/webpack/RSCWebpackPlugin.js'
    ));
    const runtimeEntry = require.resolve('react-server-dom-webpack/client.browser');
    const manifestFilename = 'react-client-manifest.json';
    return {
      manifestFilename,
      compiler: webpack({
        mode: 'development',
        target: 'web',
        context,
        entry: { main: [runtimeEntry, './index.js'] },
        output: {
          path: outputPath,
          filename: '[name].js',
          chunkFilename: '[name].chunk.js',
          publicPath: '',
          crossOriginLoading: false,
        },
        optimization: {
          chunkIds: 'named',
          moduleIds: 'named',
          minimize: false,
        },
        devtool: false,
        plugins: [new RSCWebpackPlugin({ isServer: false })],
      }),
    };
  }

  throw new Error(`Unknown bundler: ${bundler}`);
}

function createSnapshot(stats, manifestFilename) {
  const info = stats.toJson({ errors: true, warnings: true, assets: true });
  const manifestPath = path.join(outputPath, manifestFilename);
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : undefined;

  return {
    errors: (info.errors || []).map(formatProblem),
    warnings: (info.warnings || []).map(formatProblem),
    assets: (info.assets || []).map((asset) => asset.name),
    manifestKeys: manifest ? Object.keys(manifest.filePathToModuleMetadata) : [],
  };
}

function formatProblem(problem) {
  return [problem.moduleName, problem.message, problem.details].filter(Boolean).join('\n');
}
