// Cherry-pick previous replacement commits from react-on-rails-rsc history

import * as readline from 'node:readline';
import { git, cherryPick } from './git-utils.js';
import { config } from './config.js';
import { logger } from './logger.js';

async function findLastNonReplacementCommit(destRoot) {
  // Find the most recent commit that touched destPath but is NOT a replacement commit
  // This would typically be the build copy commit from the previous upgrade
  const { stdout } = await git(
    [
      'log',
      '--oneline',
      '--invert-grep',
      '--fixed-strings',
      `--grep=${config.replacementCommitPrefix}`,
      '-1',
      '--',
      config.destPath,
    ],
    destRoot
  );

  if (!stdout.trim()) {
    return null;
  }

  const [hash] = stdout.trim().split(' ');
  return hash;
}

export async function getReplacementCommits(destRoot) {
  try {
    // Find the last non-replacement commit that touched destPath
    const baseCommit = await findLastNonReplacementCommit(destRoot);

    if (!baseCommit) {
      logger.debug('No base commit found for destPath');
      return [];
    }

    // Find replacement commits after the base commit
    const { stdout } = await git(
      [
        'log',
        '--oneline',
        '--reverse',
        '--fixed-strings',
        `--grep=${config.replacementCommitPrefix}`,
        `${baseCommit}..HEAD`,
        '--',
        config.destPath,
      ],
      destRoot
    );

    if (!stdout.trim()) {
      return [];
    }

    return stdout
      .trim()
      .split('\n')
      .map((line) => {
        const [hash, ...subjectParts] = line.split(' ');
        return {
          hash,
          subject: subjectParts.join(' '),
        };
      });
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
