#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');

const originalPackageJson = fs.readFileSync(packageJsonPath, 'utf8');
const packageJson = JSON.parse(originalPackageJson);

const env = process.env;
const label = env.COMPAT_LABEL || 'compatibility matrix leg';
const skipInstall = env.COMPAT_SKIP_INSTALL === '1';
const WEBPACK_PEER_MIN = { major: 5, minor: 59, patch: 0 };

const packageSpecs = compactObject({
  react: env.COMPAT_REACT,
  'react-dom': env.COMPAT_REACT_DOM || env.COMPAT_REACT,
  'react-server-dom-webpack': env.COMPAT_REACT_SERVER_DOM_WEBPACK,
  webpack: env.COMPAT_WEBPACK,
  '@rspack/core': env.COMPAT_RSPACK,
  '@types/react': env.COMPAT_TYPES_REACT,
  '@types/react-dom': env.COMPAT_TYPES_REACT_DOM,
});

if (Object.keys(packageSpecs).length === 0) {
  throw new Error('No compatibility package overrides were provided.');
}

validateRequestedSpecs(packageSpecs);

const compatibilitySkipReason = getCompatibilitySkipReason(packageSpecs);
if (compatibilitySkipReason) {
  assertGitPathClean('package.json');
  assertGitPathClean('yarn.lock');
  setGithubOutput('skip', '1');
  setGithubOutput('skip-reason', compatibilitySkipReason);
  writeSummary(label, packageSpecs, {}, compatibilitySkipReason);
  console.log(`[compat] ${label}: skipped because ${compatibilitySkipReason}`);
  process.exit(0);
}

setGithubOutput('skip', '0');

try {
  if (skipInstall) {
    console.log(`[compat] ${label}: skipping yarn install because COMPAT_SKIP_INSTALL=1`);
  } else {
    const nextPackageJson = {
      ...packageJson,
      devDependencies: {
        ...packageJson.devDependencies,
        ...packageSpecs,
      },
      resolutions: {
        ...(packageJson.resolutions || {}),
        ...packageSpecs,
      },
    };

    fs.writeFileSync(packageJsonPath, `${JSON.stringify(nextPackageJson, null, 2)}\n`);

    run('yarn', ['install', '--pure-lockfile', '--non-interactive']);
  }
} finally {
  fs.writeFileSync(packageJsonPath, originalPackageJson);
}

if (skipInstall) {
  assertGitPathClean('package.json');
  assertGitPathClean('yarn.lock');
  console.log(`[compat] ${label}: requested specs validated; skipping install and installed-version checks`);
  process.exit(0);
}

const installed = Object.fromEntries(
  Object.entries(packageSpecs).map(([packageName, spec]) => [
    packageName,
    readInstalledVersion(packageName, spec),
  ])
);

for (const [packageName, spec] of Object.entries(packageSpecs)) {
  const actualVersion = installed[packageName];
  if (!matchesSpec(packageName, actualVersion, spec)) {
    throw new Error(
      `${packageName} installed ${actualVersion}, which does not satisfy requested compatibility spec ${spec}`
    );
  }
}

assertGitPathClean('package.json');
assertGitPathClean('yarn.lock');
writeSummary(label, packageSpecs, installed);

console.log(`[compat] ${label}: installed requested compatibility packages`);
for (const [packageName, version] of Object.entries(installed)) {
  console.log(`[compat]   ${packageName}@${version}`);
}
console.log('[compat] package.json restored and yarn.lock remained clean');

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => typeof value === 'string' && value.trim() !== '')
  );
}

function run(command, args) {
  console.log(`[compat] Running ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
  }
}

function readInstalledVersion(packageName, spec) {
  const packageJsonFile = path.join(rootDir, 'node_modules', ...packageName.split('/'), 'package.json');
  if (!fs.existsSync(packageJsonFile)) {
    throw new Error(`${packageName}@${spec} was not installed at ${packageJsonFile}`);
  }

  return JSON.parse(fs.readFileSync(packageJsonFile, 'utf8')).version;
}

function validateRequestedSpecs(specs) {
  for (const [packageName, spec] of Object.entries(specs)) {
    if (
      packageName === 'react' ||
      packageName === 'react-dom' ||
      packageName === 'react-server-dom-webpack'
    ) {
      assertReactSpec(packageName, spec);
    }

    if (packageName === 'webpack') {
      assertWebpackSpec(spec);
    }

    if (packageName === '@rspack/core') {
      assertRspackSpec(spec);
    }
  }
}

function getCompatibilitySkipReason(specs) {
  const incompatibleSpecs = [];
  const packageFloors = {
    react: packageJson.peerDependencies?.react,
    'react-dom': packageJson.peerDependencies?.['react-dom'],
    'react-server-dom-webpack': packageJson.dependencies?.['react-server-dom-webpack'],
  };

  for (const [packageName, floorSpec] of Object.entries(packageFloors)) {
    const requestedSpec = specs[packageName];
    if (!requestedSpec || !floorSpec) continue;
    if (isCanarySpec(requestedSpec) || isCanarySpec(floorSpec)) continue;
    if (!rangeCanSatisfyFloor(requestedSpec, floorSpec)) {
      incompatibleSpecs.push(
        `${packageName}@${requestedSpec} cannot satisfy package floor ${floorSpec}`
      );
    }
  }

  if (incompatibleSpecs.length === 0) return '';

  return `requested matrix packages are outside this package release line: ${incompatibleSpecs.join(
    '; '
  )}`;
}

function rangeCanSatisfyFloor(requestedSpec, floorSpec) {
  const requestedRange = getSimpleRangeBounds(requestedSpec);
  const floorRange = getSimpleRangeBounds(floorSpec);

  return (
    compareVersions(requestedRange.lower, floorRange.upperExclusive) < 0 &&
    compareVersions(floorRange.lower, requestedRange.upperExclusive) < 0
  );
}

function getSimpleRangeBounds(spec) {
  const lower = parseVersion(stripSimpleRangePrefix(spec));

  if (spec.startsWith('^')) {
    return {
      lower,
      upperExclusive:
        lower.major > 0
          ? { major: lower.major + 1, minor: 0, patch: 0 }
          : lower.minor > 0
            ? { major: 0, minor: lower.minor + 1, patch: 0 }
            : { major: 0, minor: 0, patch: lower.patch + 1 },
    };
  }

  if (spec.startsWith('~')) {
    return {
      lower,
      upperExclusive: { major: lower.major, minor: lower.minor + 1, patch: 0 },
    };
  }

  return {
    lower,
    upperExclusive: { major: lower.major, minor: lower.minor, patch: lower.patch + 1 },
  };
}

function assertReactSpec(packageName, spec) {
  if (isCanarySpec(spec)) return;

  const version = parseVersion(stripSimpleRangePrefix(spec));
  if (version.major !== 19 || (version.minor === 0 && version.patch < 4)) {
    throw new Error(`${packageName}@${spec} is outside the supported React compatibility matrix`);
  }
}

function assertWebpackSpec(spec) {
  if (spec.startsWith('^')) {
    const version = parseVersion(stripSimpleRangePrefix(spec));
    if (version.major !== 5) {
      throw new Error(`webpack@${spec} is outside the supported webpack 5.x compatibility matrix`);
    }
    // Broad 5.x caret ranges (for example, ^5.0.0) cannot be checked against
    // the 5.59.0 peer minimum until yarn resolves a concrete version.
    // matchesSpec() enforces the floor after installation.
    return;
  }

  const version = parseVersion(stripSimpleRangePrefix(spec));
  if (version.major !== 5 || compareVersions(version, WEBPACK_PEER_MIN) < 0) {
    throw new Error(
      `webpack@${spec} is below the supported peer minimum ${formatVersion(WEBPACK_PEER_MIN)}`
    );
  }
}

function assertRspackSpec(spec) {
  if (spec === '^1' || spec === '1.x') return;

  const version = parseVersion(stripSimpleRangePrefix(spec));
  if (version.major !== 1) {
    throw new Error(`@rspack/core@${spec} is outside the supported rspack 1.x compatibility matrix`);
  }
}

function matchesSpec(packageName, actualVersion, spec) {
  if (isCanarySpec(spec)) return actualVersion.includes('canary');
  if (spec === '^1' || spec === '1.x') {
    return parseVersion(actualVersion).major === 1;
  }

  if (spec.startsWith('^')) {
    const expected = parseVersion(stripSimpleRangePrefix(spec));
    const actual = parseVersion(actualVersion);
    // Webpack's peer minimum is 5.59.0; enforce it even when the requested
    // range is wider, such as ^5.0.0.
    const effective =
      packageName === 'webpack' && compareVersions(expected, WEBPACK_PEER_MIN) < 0
        ? WEBPACK_PEER_MIN
        : expected;
    return actual.major === effective.major && compareVersions(actual, effective) >= 0;
  }

  if (spec.startsWith('~')) {
    const expected = parseVersion(spec.slice(1));
    const actual = parseVersion(actualVersion);
    return (
      actual.major === expected.major &&
      actual.minor === expected.minor &&
      compareVersions(actual, expected) >= 0
    );
  }

  return actualVersion === spec;
}

function isCanarySpec(spec) {
  return spec === 'canary' || spec.includes('-canary');
}

function stripSimpleRangePrefix(spec) {
  return spec.replace(/^[~^]/, '');
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version specifier: ${version}`);
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

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function assertGitPathClean(relativePath) {
  const result = spawnSync('git', ['status', '--porcelain', '--', relativePath], {
    cwd: rootDir,
    stdio: 'pipe',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git status failed for ${relativePath} (exit ${result.status})`);
  }

  if ((result.stdout || '').toString().trim() !== '') {
    throw new Error(`${relativePath} changed during compatibility install`);
  }
}

function setGithubOutput(name, value) {
  if (!env.GITHUB_OUTPUT) return;
  fs.appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function writeSummary(runLabel, requestedSpecs, installedVersions, skipReason = '') {
  if (!env.GITHUB_STEP_SUMMARY) return;

  const rows = Object.keys(requestedSpecs)
    .sort()
    .map(
      (packageName) =>
        `| \`${packageName}\` | \`${requestedSpecs[packageName]}\` | \`${
          installedVersions[packageName] || 'not installed'
        }\` |`
    );

  fs.appendFileSync(
    env.GITHUB_STEP_SUMMARY,
    [
      `## ${runLabel}`,
      '',
      '| Package | Requested | Installed |',
      '| --- | --- | --- |',
      ...rows,
      '',
      skipReason
        ? `- Result: skipped. ${skipReason}`
        : '- Install mode: `yarn install --pure-lockfile --non-interactive`',
      skipReason ? '' : '- `package.json` was restored after install.',
      '- `git diff -- yarn.lock` remained clean after matrix prep.',
      '',
    ].join('\n')
  );
}
