// Search for remaining mentions and prompt for replacements

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as readline from 'node:readline';
import fg from 'fast-glob';
import { config } from './config.js';
import { logger } from './logger.js';

// Match react-server-dom-webpack as a standalone word (not part of filename like react-server-dom-webpack-client.node.js)
const STANDALONE_PATTERN = /react-server-dom-webpack(?!-)/g;

export async function findMatches(destRoot) {
  const searchDir = join(destRoot, config.destPath);
  const matches = [];

  const files = await fg('**/*', {
    cwd: searchDir,
    absolute: true,
    onlyFiles: true,
  });

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      if (STANDALONE_PATTERN.test(line)) {
        // Reset regex lastIndex for next test
        STANDALONE_PATTERN.lastIndex = 0;
        matches.push({
          file,
          lineNumber: index + 1,
          line: line.trim(),
        });
      }
    });
  }

  return matches;
}

async function promptChoice(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function replaceInFile(filePath, lineNumber) {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  lines[lineNumber - 1] = lines[lineNumber - 1].replace(STANDALONE_PATTERN, 'react-on-rails-rsc');
  await writeFile(filePath, lines.join('\n'), 'utf-8');
}

export async function checkReplacements(destRoot, options = {}) {
  const { dryRun = false, force = false } = options;

  logger.step('Checking for remaining mentions to replace...');

  const matches = await findMatches(destRoot);

  if (matches.length === 0) {
    logger.info('No mentions of react-server-dom-webpack found');
    return { replaced: 0, skipped: 0 };
  }

  logger.info(`Found ${matches.length} mention(s) of '${config.searchPattern}'`);

  // In dry-run mode, just list the files without prompting
  if (dryRun) {
    logger.info('[DRY-RUN] Would prompt for replacements in:');
    const uniqueFiles = [...new Set(matches.map((m) => m.file.replace(destRoot + '/', '')))];
    uniqueFiles.forEach((file) => logger.info(`  - ${file}`));
    logger.step(`[DRY-RUN] ${matches.length} potential replacement(s) found`);
    return { replaced: 0, skipped: 0 };
  }

  // In force mode, replace all without prompting
  if (force) {
    logger.info('[FORCE] Replacing all mentions without prompting');
    for (const match of matches) {
      const relativePath = match.file.replace(destRoot + '/', '');
      await replaceInFile(match.file, match.lineNumber);
      logger.info(`Replaced in ${relativePath}:${match.lineNumber}`);
    }
    logger.step(`Replacement complete: ${matches.length} replaced, 0 skipped`);
    return { replaced: matches.length, skipped: 0 };
  }

  let replaced = 0;
  let skipped = 0;
  let replaceAll = false;

  for (const match of matches) {
    const relativePath = match.file.replace(destRoot + '/', '');

    console.log(`\n${relativePath}:${match.lineNumber}`);
    console.log(`  ${match.line}`);

    let choice;
    if (replaceAll) {
      choice = 'y';
    } else {
      choice = await promptChoice(
        "  Replace with 'react-on-rails-rsc'? (y/n/a=all/q=quit): "
      );
    }

    if (choice === 'q') {
      logger.info('Quitting replacement process');
      break;
    }

    if (choice === 'a') {
      replaceAll = true;
      choice = 'y';
    }

    if (choice === 'y') {
      await replaceInFile(match.file, match.lineNumber);
      logger.info(`Replaced in ${relativePath}:${match.lineNumber}`);
      replaced++;
    } else {
      skipped++;
    }
  }

  logger.step(`Replacement complete: ${replaced} replaced, ${skipped} skipped`);
  return { replaced, skipped };
}

export const checkReplacementsUtils = {
  checkReplacements,
  findMatches,
};
