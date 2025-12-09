#!/usr/bin/env node

// Main upgrade orchestrator for react-server-dom-webpack

import minimist from 'minimist';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVersion } from './lib/version-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { findSourceBranch } from './lib/find-source-branch.js';
import { cherryPickPatches } from './lib/cherry-pick-patches.js';
import { buildAndCopy } from './lib/build-and-copy.js';
import { syncPackageJson } from './lib/sync-package-json.js';
import { cherryPickReplacements } from './lib/cherry-pick-replacements.js';
import { checkReplacements } from './lib/check-replacements.js';
import { loadState, saveState, clearState, hasState } from './lib/state-manager.js';
import { getCurrentBranch, getCommitHash, branchExists, checkoutBranch, deleteBranch, stageFiles, commit } from './lib/git-utils.js';
import { config } from './lib/config.js';
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
  --continue      Resume from a previous interrupted upgrade (uses state file or target branch)
  --reset-branch  Delete existing target branch and start fresh
  --rebuild-only  Skip cherry-picking, only rebuild and copy
  --verbose, -v   Enable verbose output
  --help, -h      Show this help message

Examples:
  node upgrade.js 19.1.0 ../react
  node upgrade.js 19.1.0 ../react --dry-run
  node upgrade.js --continue                         # Resume from state file
  node upgrade.js 19.1.0 ../react --continue         # Resume from target branch
  node upgrade.js 19.1.0 ../react --reset-branch
  node upgrade.js 19.1.0 ../react --rebuild-only
`);
}

function parseArgs() {
  const argv = minimist(process.argv.slice(2), {
    string: ['_'],
    boolean: ['help', 'verbose', 'dry-run', 'force', 'continue', 'reset-branch', 'rebuild-only'],
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
    resetBranch: argv['reset-branch'],
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
      await access(resolve(__dirname, reactForkPath));
    } catch {
      errors.push(`React fork path does not exist: ${reactForkPath}`);
    }
  }

  return errors;
}

async function run() {
  logger.step('React Server DOM Webpack Upgrade Tool');

  const args = parseArgs();
  // destRoot is the project root (2 levels up from scripts/react-upgrade/)
  const destRoot = resolve(__dirname, '../..');
  const options = {
    dryRun: args.dryRun,
    force: args.force,
  };

  // Handle --continue flag
  if (args.continue) {
    const stateExists = await hasState(destRoot);

    if (stateExists) {
      // Resume from saved state file
      const state = await loadState(destRoot);
      logger.info(`Resuming upgrade to React ${state.targetVersion}`);
      logger.info(`Phase: ${state.phase}`);

      args.targetVersion = state.targetVersion;
      args.reactForkPath = state.reactForkPath;

      await runFromPhase(state.phase, args, destRoot, options, state);
      return;
    }

    // No state file - check if we can resume from target branch
    if (!args.targetVersion || !args.reactForkPath) {
      logger.error('No saved state found. When using --continue without state file,');
      logger.error('you must provide targetVersion and reactForkPath.');
      logger.info('Usage: node upgrade.js <version> <reactForkPath> --continue');
      process.exit(1);
    }

    const resolvedReactPath = resolve(__dirname, args.reactForkPath);
    const targetBranch = `${config.branchPrefix}${args.targetVersion}`;
    const targetExists = await branchExists(targetBranch, resolvedReactPath);

    if (!targetExists) {
      logger.error(`No saved state and target branch ${targetBranch} does not exist.`);
      logger.info('Start a new upgrade with: node upgrade.js <version> <reactForkPath>');
      process.exit(1);
    }

    logger.info(`No state file, but found target branch: ${targetBranch}`);
    logger.info('Resuming from cherry-pick phase...');

    // Resume from cherry-pick phase (assumes branch already has patches)
    await runFromPhase('cherry-pick', args, destRoot, options);
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

async function setupTargetBranch(targetVersion, reactForkPath, args, options) {
  const targetBranch = `${config.branchPrefix}${targetVersion}`;
  const tagRef = `v${targetVersion}`;
  const currentBranch = await getCurrentBranch(reactForkPath);

  // Already on target branch - check if it matches the tag
  if (currentBranch === targetBranch) {
    const branchCommit = await getCommitHash('HEAD', reactForkPath);
    const tagCommit = await getCommitHash(tagRef, reactForkPath);

    if (branchCommit === tagCommit) {
      logger.info(`Already on target branch: ${targetBranch} (at tag ${tagRef})`);
      return;
    }

    // Branch has diverged from tag
    if (args.resetBranch) {
      if (options.dryRun) {
        logger.info(`[DRY-RUN] Would reset branch ${targetBranch} to ${tagRef}`);
        return;
      }
      logger.info(`Resetting branch ${targetBranch} to ${tagRef}`);
      // Checkout tag first (detached HEAD) so we can delete the branch
      await checkoutBranch(tagRef, reactForkPath);
      await deleteBranch(targetBranch, reactForkPath, { force: true });
      await checkoutBranch(targetBranch, reactForkPath, { create: true, startPoint: tagRef });
      return;
    }

    // Branch exists with changes but no flag specified
    logger.error(`Branch ${targetBranch} exists but has diverged from tag ${tagRef}.`);
    logger.info('Use --continue to build on current branch, or --reset-branch to reset to tag.');
    process.exit(1);
  }

  const targetExists = await branchExists(targetBranch, reactForkPath);

  if (targetExists) {
    if (args.resetBranch) {
      // Delete and recreate from tag
      if (options.dryRun) {
        logger.info(`[DRY-RUN] Would delete branch ${targetBranch} and recreate from ${tagRef}`);
        return;
      }
      logger.info(`Deleting existing branch: ${targetBranch}`);
      await deleteBranch(targetBranch, reactForkPath, { force: true });
    } else {
      // Branch exists but no --reset-branch flag
      logger.error(`Branch ${targetBranch} already exists.`);
      logger.info('Use --continue to resume on existing branch, or --reset-branch to delete and start fresh.');
      process.exit(1);
    }
  }

  // Create new branch from tag
  if (options.dryRun) {
    logger.info(`[DRY-RUN] Would create branch ${targetBranch} from ${tagRef}`);
    return;
  }
  logger.info(`Creating branch ${targetBranch} from ${tagRef}`);
  await checkoutBranch(targetBranch, reactForkPath, { create: true, startPoint: tagRef });
}

async function runFromPhase(startPhase, args, destRoot, options, savedState = null) {
  const resolvedReactPath = resolve(__dirname, args.reactForkPath);
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

  // Setup target branch in React fork (only when starting fresh, not --rebuild-only)
  if (startPhase === 'start' && !args.rebuildOnly) {
    await setupTargetBranch(args.targetVersion, resolvedReactPath, args, options);
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

      // Pass resumeFromCommit if we're continuing after a conflict
      const cherryPickOptions = {
        ...options,
        resumeFromCommit: savedState?.conflictedCommit || null,
      };
      const cherryPickResult = await cherryPickPatches(sourceBranch, resolvedReactPath, cherryPickOptions);

      if (cherryPickResult.conflicted) {
        // Save the conflicted commit hash so we can resume after it
        if (!options.dryRun) {
          await saveState(destRoot, {
            targetVersion: args.targetVersion,
            reactForkPath: args.reactForkPath,
            phase: 'cherry-pick',
            conflictedCommit: cherryPickResult.conflicted.hash,
          });
        }
        logger.error('Cherry-pick stopped due to conflict.');
        logger.info('Resolve the conflict, then run with --continue to resume.');
        process.exit(1);
      }
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

    // Commit the copied artifacts and synced package.json
    if (!options.dryRun) {
      logger.step('Committing copied artifacts...');
      await stageFiles([config.destPath, 'package.json'], destRoot);
      await commit(`Update react-server-dom-webpack to React ${args.targetVersion}`, destRoot);
      logger.info('Committed build artifacts');
    } else {
      logger.info('[DRY-RUN] Would commit copied artifacts');
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

    // Commit the replacement changes
    if (!options.dryRun) {
      logger.step('Committing replacement changes...');
      await stageFiles([config.destPath], destRoot);
      await commit(`[RSC-REPLACE] Replace react-server-dom-webpack with react-on-rails-rsc`, destRoot);
      logger.info('Committed replacement changes');
    } else {
      logger.info('[DRY-RUN] Would commit replacement changes');
    }
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
}

run().catch((error) => {
  logger.error(`Upgrade failed: ${error.message}`);
  logger.debug(error.stack);
  process.exit(1);
});
