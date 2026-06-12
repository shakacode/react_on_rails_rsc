#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');

const originalPackageJson = fs.readFileSync(packageJsonPath, 'utf8');
const packageJson = JSON.parse(originalPackageJson);

const env = process.env;
const label = env.COMPAT_LABEL || 'compatibility matrix leg';
const skipInstall = env.COMPAT_SKIP_INSTALL === '1';

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

    run('yarn', ['install', '--pure-lockfile', '--non-interactive', '--ignore-scripts'], {
      ...env,
      YARN_CACHE_FOLDER:
        env.YARN_CACHE_FOLDER ||
        path.join(env.RUNNER_TEMP || os.tmpdir(), 'react-on-rails-rsc-yarn-compat-cache'),
    });
  }
} finally {
  fs.writeFileSync(packageJsonPath, originalPackageJson);
}

const installed = Object.fromEntries(
  Object.entries(packageSpecs).map(([packageName, spec]) => [
    packageName,
    readInstalledVersion(packageName, spec),
  ])
);

for (const [packageName, spec] of Object.entries(packageSpecs)) {
  const actualVersion = installed[packageName];
  if (!matchesSpec(actualVersion, spec)) {
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

function run(command, args, childEnv) {
  console.log(`[compat] Running ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: childEnv,
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
    if (packageName === 'react' || packageName === 'react-dom') {
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

function assertReactSpec(packageName, spec) {
  if (isCanarySpec(spec) || spec === '~19.2.0') return;

  const version = parseVersion(spec);
  if (version.major !== 19 || (version.minor === 0 && version.patch < 4)) {
    throw new Error(`${packageName}@${spec} is outside the supported React compatibility matrix`);
  }
}

function assertWebpackSpec(spec) {
  if (spec === '^5.0.0') return;

  const version = parseVersion(spec);
  if (version.major !== 5 || compareVersions(version, { major: 5, minor: 59, patch: 0 }) < 0) {
    throw new Error(`webpack@${spec} is below the supported peer minimum 5.59.0`);
  }
}

function assertRspackSpec(spec) {
  if (spec === '^1.0.0' || spec === '^1' || spec === '1.x') return;

  const version = parseVersion(spec);
  if (version.major !== 1) {
    throw new Error(`@rspack/core@${spec} is outside the supported rspack 1.x compatibility matrix`);
  }
}

function matchesSpec(actualVersion, spec) {
  if (isCanarySpec(spec)) return actualVersion.includes('canary');
  if (spec === '^5.0.0') return parseVersion(actualVersion).major === 5;
  if (spec === '^1.0.0' || spec === '^1' || spec === '1.x') {
    return parseVersion(actualVersion).major === 1;
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

function assertGitPathClean(relativePath) {
  const targetPath = path.join(rootDir, relativePath);
  if (!fs.existsSync(targetPath)) {
    return;
  }

  const result = spawnSync('git', ['diff', '--quiet', '--', relativePath], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${relativePath} changed during compatibility install`);
  }
}

function writeSummary(runLabel, requestedSpecs, installedVersions) {
  if (!env.GITHUB_STEP_SUMMARY) return;

  const rows = Object.keys(requestedSpecs)
    .sort()
    .map(
      (packageName) =>
        `| \`${packageName}\` | \`${requestedSpecs[packageName]}\` | \`${installedVersions[packageName]}\` |`
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
      '- Install mode: `yarn install --pure-lockfile --non-interactive --ignore-scripts`',
      '- `package.json` was restored after install.',
      '- `git diff -- yarn.lock` remained clean after matrix prep.',
      '',
    ].join('\n')
  );
}
