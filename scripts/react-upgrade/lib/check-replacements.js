// Search for remaining mentions and prompt for replacements

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as readline from 'node:readline';
import fg from 'fast-glob';
import { config } from './config.js';
import { logger } from './logger.js';

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
      if (line.includes(config.searchPattern)) {
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

async function replaceInFile(filePath, lineNumber, oldText, newText) {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  lines[lineNumber - 1] = lines[lineNumber - 1].replace(oldText, newText);
  await writeFile(filePath, lines.join('\n'), 'utf-8');
}

export async function checkReplacements(destRoot, options = {}) {
  const { dryRun = false } = options;

  logger.step('Checking for remaining mentions to replace...');

  const matches = await findMatches(destRoot);

  if (matches.length === 0) {
    logger.info('No mentions of react-server-dom-webpack found');
    return { replaced: 0, skipped: 0 };
  }

  logger.info(`Found ${matches.length} mention(s) of '${config.searchPattern}'`);

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
      if (dryRun) {
        logger.info(`[DRY-RUN] Would replace in ${relativePath}:${match.lineNumber}`);
      } else {
        await replaceInFile(
          match.file,
          match.lineNumber,
          config.searchPattern,
          'react-on-rails-rsc'
        );
        logger.info(`Replaced in ${relativePath}:${match.lineNumber}`);
      }
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
