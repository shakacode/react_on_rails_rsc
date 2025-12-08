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
import { loadState, saveState, clearState, hasState } from './lib/state-manager.js';
import { logger } from './lib/logger.js';

function printUsage() {
  console.log(`
Usage: node upgrade.js <targetVersion> <reactForkPath> [options]

Arguments:
  targetVersion   The React version to upgrade to (e.g., 19.1.0)
  reactForkPath   Path to the React fork repository

Options:
  --dry-run       Show what would be done without making changes
  --force         Skip confirmations and force operations
  --continue      Resume from a previous interrupted upgrade
  --rebuild-only  Skip cherry-picking, only rebuild and copy
  --verbose, -v   Enable verbose output
  --help, -h      Show this help message

Examples:
  node upgrade.js 19.1.0 ../react
  node upgrade.js 19.1.0 ../react --dry-run
  node upgrade.js --continue
  node upgrade.js 19.1.0 ../react --rebuild-only
`);
}

function parseArgs() {
  const argv = minimist(process.argv.slice(2), {
    string: ['_'],
    boolean: ['help', 'verbose', 'dry-run', 'force', 'continue', 'rebuild-only'],
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

  return {
    targetVersion,
    reactForkPath,
    dryRun: argv['dry-run'],
    force: argv.force,
    continue: argv.continue,
    rebuildOnly: argv['rebuild-only'],
  };
}

async function validateInputs(targetVersion, reactForkPath, options = {}) {
  const errors = [];

  // If continuing, we don't need version/path from args
  if (options.continue) {
    return errors;
  }

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

  const args = parseArgs();
  const destRoot = process.cwd();
  const options = {
    dryRun: args.dryRun,
    force: args.force,
  };

  // Handle --continue flag
  if (args.continue) {
    const stateExists = await hasState(destRoot);
    if (!stateExists) {
      logger.error('No saved state found. Cannot continue.');
      logger.info('Start a new upgrade with: node upgrade.js <version> <reactForkPath>');
      process.exit(1);
    }

    const state = await loadState(destRoot);
    logger.info(`Resuming upgrade to React ${state.targetVersion}`);
    logger.info(`Phase: ${state.phase}`);

    args.targetVersion = state.targetVersion;
    args.reactForkPath = state.reactForkPath;

    // Resume from saved phase
    await runFromPhase(state.phase, args, destRoot, options);
    return;
  }

  // Validate inputs
  const errors = await validateInputs(args.targetVersion, args.reactForkPath, args);
  if (errors.length > 0) {
    errors.forEach((err) => logger.error(err));
    printUsage();
    process.exit(1);
  }

  // Check for existing state
  if (await hasState(destRoot)) {
    if (!args.force) {
      logger.warn('Found existing upgrade state. Use --continue to resume or --force to start fresh.');
      process.exit(1);
    }
    await clearState(destRoot);
  }

  // Run full upgrade
  await runFromPhase('start', args, destRoot, options);
}

async function runFromPhase(startPhase, args, destRoot, options) {
  const resolvedReactPath = resolve(args.reactForkPath);
  const parsedVersion = parseVersion(args.targetVersion);
  const phases = ['start', 'cherry-pick', 'build', 'sync', 'replacements', 'check'];

  const startIndex = phases.indexOf(startPhase);
  if (startIndex === -1) {
    logger.error(`Unknown phase: ${startPhase}`);
    process.exit(1);
  }

  logger.info(`Target version: ${args.targetVersion}`);
  logger.info(`React fork path: ${resolvedReactPath}`);
  logger.info(`Destination: ${destRoot}`);
  if (options.dryRun) {
    logger.info('[DRY-RUN MODE]');
  }

  // Save initial state
  if (startPhase === 'start' && !options.dryRun) {
    await saveState(destRoot, {
      targetVersion: args.targetVersion,
      reactForkPath: args.reactForkPath,
      phase: 'start',
      startedAt: new Date().toISOString(),
    });
  }

  // Phase: cherry-pick (skip if --rebuild-only)
  if (startIndex <= phases.indexOf('cherry-pick') && !args.rebuildOnly) {
    if (!options.dryRun) {
      await saveState(destRoot, {
        targetVersion: args.targetVersion,
        reactForkPath: args.reactForkPath,
        phase: 'cherry-pick',
      });
    }

    const sourceBranch = await findSourceBranch(parsedVersion, resolvedReactPath);
    if (!sourceBranch) {
      logger.warn('No previous patch branch found. Starting fresh.');
    } else {
      logger.info(`Found source branch: ${sourceBranch.branch}`);
      await cherryPickPatches(sourceBranch.branch, resolvedReactPath, options);
    }
  }

  // Phase: build
  if (startIndex <= phases.indexOf('build')) {
    if (!options.dryRun) {
      await saveState(destRoot, {
        targetVersion: args.targetVersion,
        reactForkPath: args.reactForkPath,
        phase: 'build',
      });
    }

    const { buildSuccess, copySuccess } = await buildAndCopy(resolvedReactPath, destRoot, options);

    if (!buildSuccess) {
      logger.error('Build failed. Use --continue to retry after fixing issues.');
      process.exit(1);
    }

    if (!copySuccess) {
      logger.error('Copy failed. Use --continue to retry after fixing issues.');
      process.exit(1);
    }
  }

  // Phase: sync package.json
  if (startIndex <= phases.indexOf('sync')) {
    if (!options.dryRun) {
      await saveState(destRoot, {
        targetVersion: args.targetVersion,
        reactForkPath: args.reactForkPath,
        phase: 'sync',
      });
    }

    const syncResult = await syncPackageJson(resolvedReactPath, destRoot, options);
    if (!syncResult.success) {
      logger.error('Failed to sync package.json. Use --continue to retry.');
      process.exit(1);
    }
  }

  // Phase: cherry-pick replacements
  if (startIndex <= phases.indexOf('replacements')) {
    if (!options.dryRun) {
      await saveState(destRoot, {
        targetVersion: args.targetVersion,
        reactForkPath: args.reactForkPath,
        phase: 'replacements',
      });
    }

    await cherryPickReplacements(destRoot, options);
  }

  // Phase: check remaining replacements
  if (startIndex <= phases.indexOf('check')) {
    if (!options.dryRun) {
      await saveState(destRoot, {
        targetVersion: args.targetVersion,
        reactForkPath: args.reactForkPath,
        phase: 'check',
      });
    }

    await checkReplacements(destRoot, options);
  }

  // Clear state on successful completion
  if (!options.dryRun) {
    await clearState(destRoot);
  }

  // Summary
  logger.step('Upgrade complete!');
  logger.info(`Successfully upgraded to React ${args.targetVersion}`);
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
