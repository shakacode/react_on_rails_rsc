// Cherry-pick previous replacement commits from react-on-rails-rsc history

import * as readline from 'node:readline';
import { git, cherryPick } from './git-utils.js';
import { config } from './config.js';
import { logger } from './logger.js';

export async function getReplacementCommits(destRoot) {
  try {
    // Get recent commits that touched destPath
    const { stdout } = await git(
      [
        'log',
        '--oneline',
        '-50', // Look at last 50 commits
        '--',
        config.destPath,
      ],
      destRoot
    );

    if (!stdout.trim()) {
      return [];
    }

    const lines = stdout.trim().split('\n');
    const commits = [];

    // Find consecutive replacement commits from the most recent one
    // Stop when we hit a non-replacement commit
    let foundFirstReplacement = false;

    for (const line of lines) {
      const [hash, ...subjectParts] = line.split(' ');
      const subject = subjectParts.join(' ');
      const isReplacement = subject.startsWith(config.replacementCommitPrefix);

      if (isReplacement) {
        foundFirstReplacement = true;
        commits.push({ hash, subject });
      } else if (foundFirstReplacement) {
        // Hit a non-replacement commit after finding replacements, stop
        break;
      }
      // Skip non-replacement commits before finding any replacement
    }

    // Reverse to get oldest first (for cherry-picking in order)
    return commits.reverse();
  } catch (error) {
    logger.error(`Failed to get replacement commits: ${error.message}`);
    return [];
  }
}

async function promptConflictResolution(commit) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(`\nConflict while cherry-picking: ${commit.hash} ${commit.subject}`);
    console.log('Please resolve the conflict manually, then:');
    console.log('  - Stage resolved files with: git add <files>');
    console.log('  - Press Enter to continue, or type "skip" to skip this commit');

    rl.question('> ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export async function cherryPickReplacements(destRoot, options = {}) {
  const { dryRun = false } = options;

  logger.step('Cherry-picking previous replacement commits...');

  const commits = await getReplacementCommits(destRoot);

  if (commits.length === 0) {
    logger.info('No previous replacement commits found');
    return { cherryPicked: 0, skipped: 0 };
  }

  logger.info(`Found ${commits.length} replacement commit(s) to cherry-pick`);

  let cherryPicked = 0;
  let skipped = 0;

  for (const commit of commits) {
    logger.info(`Cherry-picking: ${commit.hash} ${commit.subject}`);

    if (dryRun) {
      logger.info(`[DRY-RUN] Would cherry-pick ${commit.hash}`);
      cherryPicked++;
      continue;
    }

    const result = await cherryPick(commit.hash, destRoot);

    if (result.success) {
      cherryPicked++;
    } else if (result.conflict) {
      const answer = await promptConflictResolution(commit);

      if (answer === 'skip') {
        await git(['cherry-pick', '--abort'], destRoot);
        logger.warn(`Skipped commit ${commit.hash}`);
        skipped++;
      } else {
        // User resolved conflict, continue the cherry-pick
        try {
          await git(['cherry-pick', '--continue'], destRoot);
          cherryPicked++;
        } catch {
          logger.error(`Failed to continue cherry-pick for ${commit.hash}`);
          await git(['cherry-pick', '--abort'], destRoot);
          skipped++;
        }
      }
    } else {
      logger.error(`Failed to cherry-pick ${commit.hash}: ${result.error}`);
      skipped++;
    }
  }

  logger.step(`Replacement cherry-pick complete: ${cherryPicked} applied, ${skipped} skipped`);
  return { cherryPicked, skipped };
}

export const cherryPickReplacementsUtils = {
  getReplacementCommits,
  cherryPickReplacements,
};
