#!/usr/bin/env node

// Main upgrade orchestrator for react-server-dom-webpack

import minimist from 'minimist';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseVersion } from './lib/version-utils.js';
import { findSourceBranch } from './lib/find-source-branch.js';
import { cherryPickPatches } from './lib/cherry-pick-patches.js';
import { buildAndCopy } from './lib/build-and-copy.js';
import { syncPackageJson } from './lib/sync-package-json.js';
import { cherryPickReplacements } from './lib/cherry-pick-replacements.js';
import { checkReplacements } from './lib/check-replacements.js';
import { logger } from './lib/logger.js';

function printUsage() {
  console.log(`
Usage: node upgrade.js <targetVersion> <reactForkPath>

Arguments:
  targetVersion   The React version to upgrade to (e.g., 19.1.0)
  reactForkPath   Path to the React fork repository

Example:
  node upgrade.js 19.1.0 ../react
`);
}

function parseArgs() {
  const argv = minimist(process.argv.slice(2), {
    string: ['_'],
    boolean: ['help', 'verbose'],
    alias: { h: 'help', v: 'verbose' },
  });

  if (argv.help) {
    printUsage();
    process.exit(0);
  }

  if (argv.verbose) {
    logger.setVerbose(true);
  }

  const [targetVersion, reactForkPath] = argv._;

  return { targetVersion, reactForkPath };
}

async function validateInputs(targetVersion, reactForkPath) {
  const errors = [];

  if (!targetVersion) {
    errors.push('Target version is required');
  } else {
    const parsed = parseVersion(targetVersion);
    if (!parsed) {
      errors.push(`Invalid version format: ${targetVersion}`);
    }
  }

  if (!reactForkPath) {
    errors.push('React fork path is required');
  } else {
    try {
      await access(resolve(reactForkPath));
    } catch {
      errors.push(`React fork path does not exist: ${reactForkPath}`);
    }
  }

  return errors;
}

async function run() {
  logger.step('React Server DOM Webpack Upgrade Tool');

  const { targetVersion, reactForkPath } = parseArgs();
  const destRoot = process.cwd();

  // Validate inputs
  const errors = await validateInputs(targetVersion, reactForkPath);
  if (errors.length > 0) {
    errors.forEach((err) => logger.error(err));
    printUsage();
    process.exit(1);
  }

  const resolvedReactPath = resolve(reactForkPath);
  const parsedVersion = parseVersion(targetVersion);

  logger.info(`Target version: ${targetVersion}`);
  logger.info(`React fork path: ${resolvedReactPath}`);
  logger.info(`Destination: ${destRoot}`);

  // Step 1: Find source branch
  const sourceBranch = await findSourceBranch(parsedVersion, resolvedReactPath);
  if (!sourceBranch) {
    logger.warn('No previous patch branch found. Starting fresh.');
  } else {
    logger.info(`Found source branch: ${sourceBranch.branch}`);

    // Step 2: Cherry-pick patches from source branch
    await cherryPickPatches(sourceBranch.branch, resolvedReactPath);
  }

  // Step 3: Build React and copy artifacts
  const { buildSuccess, copySuccess } = await buildAndCopy(resolvedReactPath, destRoot);

  if (!buildSuccess) {
    logger.error('Build failed. Aborting upgrade.');
    process.exit(1);
  }

  if (!copySuccess) {
    logger.error('Copy failed. Aborting upgrade.');
    process.exit(1);
  }

  // Step 4: Sync package.json dependencies
  const syncResult = await syncPackageJson(resolvedReactPath, destRoot);
  if (!syncResult.success) {
    logger.error('Failed to sync package.json. Aborting upgrade.');
    process.exit(1);
  }

  // Step 5: Cherry-pick previous replacement commits
  await cherryPickReplacements(destRoot);

  // Step 6: Check for remaining replacements
  await checkReplacements(destRoot);

  // Summary
  logger.step('Upgrade complete!');
  logger.info(`Successfully upgraded to React ${targetVersion}`);
  logger.info('Next steps:');
  logger.info('  1. Review the changes');
  logger.info('  2. Run tests to verify the upgrade');
  logger.info('  3. Commit the changes');
}

run().catch((error) => {
  logger.error(`Upgrade failed: ${error.message}`);
  logger.debug(error.stack);
  process.exit(1);
});
