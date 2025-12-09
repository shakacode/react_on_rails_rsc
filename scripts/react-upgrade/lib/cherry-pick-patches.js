// Cherry-pick patch commits with prompting for non-prefixed commits

import * as readline from 'node:readline';
import { cherryPick, getCommitsBetween, amendCommitMessage } from './git-utils.js';
import { formatVersion } from './version-utils.js';
import { config } from './config.js';
import { logger } from './logger.js';

export function isPatchCommit(subject) {
  return config.patchPrefixRegex.test(subject);
}

export function addPatchPrefix(originalSubject) {
  return `[RSC-PATCH] ${originalSubject}`;
}

export async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

export async function cherryPickPatches(sourceBranchInfo, reactForkPath, options = {}) {
  const { dryRun = false, force = false, resumeFromCommit = null } = options;

  // sourceBranchInfo is { branch, version } from findSourceBranch
  const versionStr = formatVersion(sourceBranchInfo.version);
  const tagRef = `v${versionStr}`;
  const branchRef = sourceBranchInfo.branch;

  logger.debug(`Getting commits between ${tagRef} and ${branchRef}`);

  let commits = await getCommitsBetween(tagRef, branchRef, reactForkPath);

  if (commits.length === 0) {
    logger.info('No commits to cherry-pick');
    return { cherryPicked: [], skipped: [], conflicted: null };
  }

  // If resuming, skip commits up to and including the resume commit
  if (resumeFromCommit) {
    const resumeIndex = commits.findIndex((c) => c.hash === resumeFromCommit);
    if (resumeIndex !== -1) {
      commits = commits.slice(resumeIndex + 1);
      logger.info(`Resuming after commit ${resumeFromCommit.slice(0, 7)}`);
    }
  }

  if (commits.length === 0) {
    logger.info('No remaining commits to cherry-pick');
    return { cherryPicked: [], skipped: [], conflicted: null };
  }

  logger.info(`Found ${commits.length} commit(s) to process`);

  const result = { cherryPicked: [], skipped: [], conflicted: null };

  for (const commit of commits) {
    const { hash, subject } = commit;
    const shortHash = hash.slice(0, 7);
    const hasPatchPrefix = isPatchCommit(subject);

    logger.debug(`Processing ${shortHash}: ${subject}`);

    if (!hasPatchPrefix && !force) {
      logger.warn(`Commit ${shortHash} does not have [RSC-PATCH] prefix`);
      logger.step(`  ${subject}`);

      const shouldPick = await promptUser('  Cherry-pick this commit? (y/n): ');

      if (!shouldPick) {
        logger.info(`Skipped ${shortHash}`);
        result.skipped.push(commit);
        continue;
      }
    }

    if (dryRun) {
      logger.info(`[DRY-RUN] Would cherry-pick ${shortHash}: ${subject}`);
      result.cherryPicked.push(commit);
      continue;
    }

    const pickResult = await cherryPick(hash, reactForkPath);

    if (!pickResult.success) {
      if (pickResult.conflicted) {
        logger.error(`Conflict while cherry-picking ${shortHash}`);
        logger.step('Resolve conflicts and run with --continue');
        result.conflicted = commit;
        return result;
      }
      logger.error(`Failed to cherry-pick ${shortHash}`);
      result.skipped.push(commit);
      continue;
    }

    // If commit didn't have prefix, amend to add it
    if (!hasPatchPrefix) {
      const newMessage = addPatchPrefix(subject);
      await amendCommitMessage(newMessage, reactForkPath);
      logger.info(`Cherry-picked and prefixed ${shortHash}: ${newMessage}`);
    } else {
      logger.info(`Cherry-picked ${shortHash}: ${subject}`);
    }

    result.cherryPicked.push(commit);
  }

  return result;
}

export const cherryPickUtils = {
  cherryPickPatches,
  isPatchCommit,
  addPatchPrefix,
  promptUser,
};
