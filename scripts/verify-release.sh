#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-${npm_config_cache:-${TMPDIR:-/tmp}/react-on-rails-rsc-npm-cache}}"

TMP_DIR=""
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ror-rsc-artifacts.XXXXXX")"
cleanup() {
  if [[ -n "${TMP_DIR:-}" ]]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

log() {
  printf '\n[verify-release] %s\n' "$*"
}

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 20 )); then
  printf 'verify-release requires Node.js 20 or newer for import.meta.resolve export checks. Found %s.\n' "$(node -p "process.versions.node")" >&2
  exit 1
fi

log "Building distributable files"
yarn run build

log "Packing npm artifact"
PACK_JSON="$TMP_DIR/npm-pack.json"
npm pack --json --pack-destination "$TMP_DIR" > "$PACK_JSON"
TARBALL="$(
  node - "$PACK_JSON" "$TMP_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');

const [packJsonPath, packDestination] = process.argv.slice(2);
const rawPackOutput = fs.readFileSync(packJsonPath, 'utf8');
const packOutputLines = rawPackOutput.split(/\r?\n/);
let packOutput;

for (const [lineIndex, line] of packOutputLines.entries()) {
  if (!line.trimStart().startsWith('[')) {
    continue;
  }

  try {
    packOutput = JSON.parse(packOutputLines.slice(lineIndex).join('\n'));
    break;
  } catch {
    // npm can print lifecycle output before --json output; keep searching.
  }
}

if (!packOutput) {
  throw new Error(`Unable to parse npm pack JSON output: ${rawPackOutput}`);
}

if (!Array.isArray(packOutput) || packOutput.length !== 1 || !packOutput[0].filename) {
  throw new Error(`Unexpected npm pack output: ${JSON.stringify(packOutput)}`);
}

console.log(path.resolve(packDestination, packOutput[0].filename));
NODE
)"
test -f "$TARBALL"
echo "  - Tarball: $TARBALL"

log "Installing packed artifact into a temporary project"
CONSUMER_DIR="$TMP_DIR/consumer"
mkdir -p "$CONSUMER_DIR"
(
  cd "$CONSUMER_DIR"
  yarn init -y >/dev/null
  yarn add --ignore-scripts --silent "$TARBALL"
)

PACKAGE_DIR="$CONSUMER_DIR/node_modules/react-on-rails-rsc"

cat > "$TMP_DIR/verify-package-targets.cjs" <<'NODE'
const fs = require('fs');
const path = require('path');

const packageDir = process.argv[2];
const packageJsonPath = path.join(packageDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const packageRoot = fs.realpathSync(packageDir);

if (!pkg.exports || typeof pkg.exports !== 'object') {
  throw new Error('package.json must define an exports map');
}

const targets = [];

function collectTargets(value, exportPath, conditionPath = []) {
  if (typeof value === 'string') {
    targets.push({ exportPath, conditionPath, target: value });
    return;
  }

  if (value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTargets(item, exportPath, conditionPath);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [condition, nestedValue] of Object.entries(value)) {
      collectTargets(nestedValue, exportPath, conditionPath.concat(condition));
    }
    return;
  }

  throw new Error(`Unsupported exports value for ${exportPath}: ${JSON.stringify(value)}`);
}

for (const [exportPath, value] of Object.entries(pkg.exports)) {
  collectTargets(value, exportPath);
}

for (const { exportPath, conditionPath, target } of targets) {
  if (!target.startsWith('./')) {
    continue;
  }

  if (target.includes('*')) {
    console.warn(`  - Skipping wildcard export target: ${exportPath} -> ${target}`);
    continue;
  }

  const resolvedTarget = path.resolve(packageDir, target);
  if (!fs.existsSync(resolvedTarget)) {
    const conditionLabel = conditionPath.length ? conditionPath.join('.') : '<root>';
    throw new Error(`Missing export target: ${exportPath} (${conditionLabel}) -> ${target}`);
  }

  const realTarget = fs.realpathSync(resolvedTarget);
  if (!realTarget.startsWith(packageRoot + path.sep) && realTarget !== fs.realpathSync(packageJsonPath)) {
    throw new Error(`Export target escapes package root: ${exportPath} -> ${target}`);
  }
}

const expectedRuntimeEntrypoints = [
  '.',
  './client',
  './client.browser',
  './client.node',
  './RSCReferenceDiscoveryPlugin',
  './RspackLoader',
  './RspackPlugin',
  './server',
  './server.node',
  './WebpackLoader',
  './WebpackPlugin',
].sort();
const runtimeEntrypoints = Object.keys(pkg.exports)
  .filter((exportPath) => exportPath !== './package.json')
  .sort();

if (JSON.stringify(runtimeEntrypoints) !== JSON.stringify(expectedRuntimeEntrypoints)) {
  throw new Error(
    [
      'Runtime export paths changed.',
      `Expected: ${expectedRuntimeEntrypoints.join(', ')}`,
      `Actual:   ${runtimeEntrypoints.join(', ')}`,
      'Update the artifact verifier snapshot when the package export surface intentionally changes.',
    ].join('\n')
  );
}

console.log(`  - Verified ${targets.length} export target files across ${runtimeEntrypoints.length} runtime paths plus package.json`);
NODE

cat > "$TMP_DIR/resolve-exports.cjs" <<'NODE'
const fs = require('fs');
const path = require('path');

const packageDir = process.argv[2];
const conditionLabel = process.argv[3] || 'default';
const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const packageName = pkg.name;

for (const exportPath of Object.keys(pkg.exports)) {
  const specifier = exportPath === '.' ? packageName : `${packageName}/${exportPath.slice(2)}`;
  const resolved = require.resolve(specifier, { paths: [path.dirname(packageDir)] });
  console.log(`  - ${conditionLabel} require.resolve ${specifier} -> ${path.relative(packageDir, resolved)}`);
}
NODE

IMPORT_RESOLVE_PROBE="$CONSUMER_DIR/import-resolve-exports.mjs"
cat > "$IMPORT_RESOLVE_PROBE" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const packageDir = process.argv[2];
const conditionLabel = process.argv[3] || 'default';
const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const packageName = pkg.name;

for (const exportPath of Object.keys(pkg.exports)) {
  const specifier = exportPath === '.' ? packageName : `${packageName}/${exportPath.slice(2)}`;
  const resolved = import.meta.resolve(specifier);
  console.log(`  - ${conditionLabel} import.meta.resolve ${specifier} -> ${path.relative(packageDir, new URL(resolved).pathname)}`);
}
NODE

log "Verifying package exports and resolver conditions"
node "$TMP_DIR/verify-package-targets.cjs" "$PACKAGE_DIR"
node "$TMP_DIR/resolve-exports.cjs" "$PACKAGE_DIR" default
node --conditions=react-server "$TMP_DIR/resolve-exports.cjs" "$PACKAGE_DIR" react-server
node "$IMPORT_RESOLVE_PROBE" "$PACKAGE_DIR" default
node --conditions=react-server "$IMPORT_RESOLVE_PROBE" "$PACKAGE_DIR" react-server

cat > "$TMP_DIR/verify-runtime-version.cjs" <<'NODE'
const fs = require('fs');
const path = require('path');

const packageDir = process.argv[2];
const runtimePackagePath = require.resolve('react-server-dom-webpack/package.json', {
  paths: [packageDir],
});
const runtimePackageDir = path.dirname(runtimePackagePath);

function readFileSafe(filePath, context) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `verify-runtime-version: cannot read ${filePath} (${context}); is the stock runtime dependency installed?\n` +
      `  ${error.message}`
    );
  }
}

const rootPackage = JSON.parse(readFileSafe(path.join(packageDir, 'package.json'), 'root package.json'));
const runtimePackage = JSON.parse(readFileSafe(runtimePackagePath, 'runtime package.json'));
const runtimeVersion = runtimePackage.version;
const expectedPeerRange = `^${runtimeVersion}`;
const expectedRuntimeDependencyRange = `~${runtimeVersion}`;

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

function parseVersion(version, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`${label} expected X.Y.Z, got ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function assertCaretRangeIncludesVersion(range, version, label) {
  const match = /^\^(\d+\.\d+\.\d+)$/.exec(range || '');
  if (!match) {
    throw new Error(`${label} expected a caret X.Y.Z range that includes ${version}, got ${range}`);
  }

  const minimum = parseVersion(match[1], label);
  const target = parseVersion(version, 'runtime version');
  if (minimum.major !== target.major || compareVersions(minimum, target) > 0) {
    throw new Error(`${label} ${range} does not include stock runtime ${version}`);
  }
}

// Keep the package manifest bound to the exact stock runtime patch validated by
// this release. A newer 19.2.x lockfile resolution must update package.json too.
assertEqual(
  rootPackage.dependencies?.['react-server-dom-webpack'],
  expectedRuntimeDependencyRange,
  'root dependencies.react-server-dom-webpack'
);
assertCaretRangeIncludesVersion(
  rootPackage.peerDependencies?.react,
  runtimeVersion,
  'root peerDependencies.react'
);
assertCaretRangeIncludesVersion(
  rootPackage.peerDependencies?.['react-dom'],
  runtimeVersion,
  'root peerDependencies.react-dom'
);
assertEqual(runtimePackage.peerDependencies?.react, expectedPeerRange, 'runtime peerDependencies.react');
assertEqual(runtimePackage.peerDependencies?.['react-dom'], expectedPeerRange, 'runtime peerDependencies.react-dom');

const runtimeDevelopmentBundle = readFileSafe(
  path.join(
    runtimePackageDir,
    'cjs/react-server-dom-webpack-client.browser.development.js'
  ),
  'development bundle'
);

for (const marker of [`version: "${runtimeVersion}"`, `reconcilerVersion: "${runtimeVersion}"`]) {
  if (!runtimeDevelopmentBundle.includes(marker)) {
    throw new Error(`Packaged runtime bundle does not contain ${marker}`);
  }
}

console.log(
  `  - Stock runtime version ${runtimeVersion} is pinned by package dependency ${expectedRuntimeDependencyRange}, root peers, and runtime peer policy ${expectedPeerRange}`
);
NODE

log "Verifying stock React runtime version policy"
node "$TMP_DIR/verify-runtime-version.cjs" "$PACKAGE_DIR"

log "Running publint"
yarn run publint "$TARBALL"

log "Running Are The Types Wrong"
# Keep the Node 16 profile to catch legacy Node resolver regressions; this
# package still supports consumers on older bundler/runtime stacks.
yarn run attw "$TARBALL" \
  --profile node16 \
  --ignore-rules cjs-only-exports-default \
  --format table \
  --no-emoji \
  --no-color

log "Artifact verification passed"
