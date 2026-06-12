#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-${npm_config_cache:-${TMPDIR:-/tmp}/react-on-rails-rsc-npm-cache}}"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ror-rsc-artifacts.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

log() {
  printf '\n[verify-release] %s\n' "$*"
}

log "Building distributable files"
yarn run build

log "Packing npm artifact"
PACK_JSON="$TMP_DIR/npm-pack.json"
npm pack --json --ignore-scripts --pack-destination "$TMP_DIR" > "$PACK_JSON"
TARBALL="$(
  node - "$PACK_JSON" "$TMP_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');

const [packJsonPath, packDestination] = process.argv.slice(2);
const packOutput = JSON.parse(fs.readFileSync(packJsonPath, 'utf8'));

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

  if (value && typeof value === 'object' && !Array.isArray(value)) {
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
    throw new Error(`Wildcard export targets are not supported by this verifier: ${exportPath} -> ${target}`);
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

const runtimeEntrypoints = Object.keys(pkg.exports).filter((exportPath) => exportPath !== './package.json');
if (runtimeEntrypoints.length !== 11) {
  throw new Error(`Expected 11 runtime export paths, found ${runtimeEntrypoints.length}: ${runtimeEntrypoints.join(', ')}`);
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
const rootPackage = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
const runtimePackagePath = path.join(packageDir, 'dist/react-server-dom-webpack/package.json');
const runtimePackage = JSON.parse(fs.readFileSync(runtimePackagePath, 'utf8'));
const runtimeVersion = runtimePackage.version;
const expectedPeerRange = `^${runtimeVersion}`;

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

assertEqual(rootPackage.peerDependencies?.react, expectedPeerRange, 'root peerDependencies.react');
assertEqual(rootPackage.peerDependencies?.['react-dom'], expectedPeerRange, 'root peerDependencies.react-dom');
assertEqual(runtimePackage.peerDependencies?.react, expectedPeerRange, 'runtime peerDependencies.react');
assertEqual(runtimePackage.peerDependencies?.['react-dom'], expectedPeerRange, 'runtime peerDependencies.react-dom');

const runtimeDevelopmentBundle = fs.readFileSync(
  path.join(
    packageDir,
    'dist/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.development.js'
  ),
  'utf8'
);

for (const marker of [`version: "${runtimeVersion}"`, `reconcilerVersion: "${runtimeVersion}"`]) {
  if (!runtimeDevelopmentBundle.includes(marker)) {
    throw new Error(`Packaged runtime bundle does not contain ${marker}`);
  }
}

console.log(`  - Runtime version ${runtimeVersion} matches peer policy ${expectedPeerRange}`);
NODE

log "Verifying embedded React runtime version policy"
node "$TMP_DIR/verify-runtime-version.cjs" "$PACKAGE_DIR"

log "Running publint"
yarn publint run "$TARBALL"

log "Running Are The Types Wrong"
yarn attw "$TARBALL" \
  --profile node16 \
  --ignore-rules cjs-only-exports-default \
  --format table \
  --no-emoji \
  --no-color

log "Artifact verification passed"
