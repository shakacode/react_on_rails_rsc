#!/usr/bin/env node
/**
 * Child-process runner that reproduces issue #105: the rspack RSC build fails
 * to locate the Flight client runtime when the `react-server-dom-webpack`
 * module rspack records (`mod.resource`) is a DIFFERENT install path than the
 * one the plugin's own `require.resolve('react-server-dom-webpack/client.*')`
 * returns.
 *
 * This is the duplicate-install topology the webpack plugin already handles
 * (its `isReactOnRailsRSCRuntimeResource` walks up to a `react-server-dom-webpack`
 * `package.json`). The rspack plugin must do the same instead of a strict
 * `mod.resource === expectedRuntime` equality check.
 *
 * Setup: a temp app directory with its OWN copy of `react-server-dom-webpack`
 * under `node_modules`, plus a runtime entry that imports the runtime so rspack
 * resolves it against the APP copy — not the package copy the plugin resolves.
 *
 * It also writes a `FsDiscoveredClient.js` "use client" component that is NOT
 * imported by the entry graph. The plugin reaches it only through its
 * filesystem `resolveAllClientFiles` walk and must inject an `import()` for it
 * via the injection loader on the runtime module. If the injection-loader rule
 * matches only the plugin's own resolved runtime path (strict equality), it
 * never matches the duplicate-install runtime module, so this file never
 * reaches the manifest — the incomplete-module-map half of #105.
 *
 * Args JSON shape:
 *   { isServer: boolean }
 *
 * Success stdout: { ok: true, warnings: [...], clientEntryKeys: [...] }
 * Failure stdout: { ok: false, errors: [...], warnings: [...] }
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { rspack } = require('@rspack/core');

const argsFile = process.argv[2];
if (!argsFile) {
  process.stderr.write('Usage: node runRspackDuplicateRuntime.js <args.json>\n');
  process.exit(2);
}
const { isServer } = JSON.parse(fs.readFileSync(argsFile, 'utf8'));

const PKG_ROOT = path.resolve(__dirname, '../../..');
const PLUGIN_PATH = path.join(PKG_ROOT, 'dist/react-server-dom-rspack/plugin.js');
const { RSCRspackPlugin } = require(PLUGIN_PATH);

// The path the plugin resolves the runtime to (the package's own copy).
const pluginResolvedRuntime = require('module')
  .createRequire(PLUGIN_PATH)
  .resolve(isServer ? 'react-server-dom-webpack/client.node' : 'react-server-dom-webpack/client.browser');

// Build a temp "app" with its OWN duplicate copy of react-server-dom-webpack so
// rspack records a divergent mod.resource for the runtime module.
const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ror-rsc-dup-runtime-'));
const appModules = path.join(appDir, 'node_modules');
fs.mkdirSync(appModules, { recursive: true });
fs.cpSync(
  path.join(PKG_ROOT, 'node_modules/react-server-dom-webpack'),
  path.join(appModules, 'react-server-dom-webpack'),
  { recursive: true },
);

const appRuntimeResource = path.join(
  appModules,
  'react-server-dom-webpack',
  isServer ? 'client.node.js' : 'client.browser.js',
);

// The runtime entry. It imports the Flight client runtime so rspack records a
// runtime module — but resolves it against the APP's duplicate copy, NOT the
// package copy the plugin's require.resolve returns. This is the divergent
// `mod.resource` that issue #105 fails on. We deliberately do NOT add the
// package's own dist/client.* wrapper to the entry, because that wrapper would
// pull in the matching package copy and mask the regression.
fs.writeFileSync(
  path.join(appDir, 'runtime.js'),
  `require(${JSON.stringify(isServer ? 'react-server-dom-webpack/client.node' : 'react-server-dom-webpack/client.browser')});\n`,
);
fs.writeFileSync(
  path.join(appDir, 'ClientButton.js'),
  `'use client';\nexport default function ClientButton() { return 'client-button'; }\n`,
);
// A "use client" component that is NOT imported anywhere in the entry graph.
// The plugin discovers it through its filesystem `resolveAllClientFiles` walk
// and must inject an import() for it via the injection loader on the runtime
// module. If the injection-loader rule does not match the (duplicate-install)
// runtime module, this file never becomes an async chunk and never reaches the
// manifest — the incomplete-module-map symptom of #105.
fs.writeFileSync(
  path.join(appDir, 'FsDiscoveredClient.js'),
  `'use client';\nexport default function FsDiscoveredClient() { return 'fs-discovered'; }\n`,
);
fs.writeFileSync(
  path.join(appDir, 'index.js'),
  `import ClientButton from './ClientButton';\nexport default { ClientButton };\n`,
);

const outputPath = path.join(appDir, 'out');

function finish(payload) {
  process.stdout.write(JSON.stringify(payload));
  try {
    fs.rmSync(appDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

const config = {
  mode: 'development',
  target: isServer ? 'node' : 'web',
  context: appDir,
  entry: ['./runtime.js', './index.js'],
  output: {
    path: outputPath,
    filename: '[name].js',
    chunkFilename: '[name].chunk.js',
    publicPath: '',
  },
  optimization: { chunkIds: 'named', moduleIds: 'named', minimize: false },
  devtool: false,
  resolve: {
    // The app's duplicate react-server-dom-webpack copy still needs `react`
    // and `react-dom` (and any transitive deps). Fall back to the package's
    // own node_modules so only react-server-dom-webpack itself is divergent —
    // which is exactly the install path that triggers issue #105.
    modules: ['node_modules', path.join(PKG_ROOT, 'node_modules')],
  },
  plugins: [
    new RSCRspackPlugin({ isServer }),
  ],
};

rspack(config, (err, stats) => {
  if (err) {
    finish({ ok: false, errors: [String(err)] });
    process.exit(1);
    return;
  }
  if (!stats) {
    finish({ ok: false, errors: ['no stats returned'] });
    process.exit(1);
    return;
  }
  const info = stats.toJson({ errors: true, warnings: true, assets: true });
  if (stats.hasErrors()) {
    finish({
      ok: false,
      errors: (info.errors || []).map((e) => e.message),
      warnings: (info.warnings || []).map((w) => w.message),
    });
    process.exit(1);
    return;
  }

  const manifestFilename = isServer
    ? 'react-server-client-manifest.json'
    : 'react-client-manifest.json';
  const manifestPath = path.join(outputPath, manifestFilename);
  let clientEntryKeys = [];
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    clientEntryKeys = Object.keys(manifest.filePathToModuleMetadata || {});
  }

  finish({
    ok: true,
    warnings: (info.warnings || []).map((w) => w.message),
    clientEntryKeys,
    // Diagnostics so the test failure message is actionable.
    pluginResolvedRuntime,
    appRuntimeResource,
    manifestEmitted: fs.existsSync(manifestPath),
  });
});
