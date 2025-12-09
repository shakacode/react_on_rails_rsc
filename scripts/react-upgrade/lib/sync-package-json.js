// Sync dependencies from React's package.json to root package.json

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';

const FIELDS_TO_SYNC = ['dependencies', 'peerDependencies', 'peerDependenciesMeta'];

async function readPackageJson(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function writePackageJson(filePath, data) {
  const content = JSON.stringify(data, null, 2) + '\n';
  await writeFile(filePath, content, 'utf-8');
}

export async function syncPackageJson(srcRoot, destRoot, options = {}) {
  const { dryRun = false } = options;

  const srcPath = join(srcRoot, config.buildOutputPath, 'package.json');
  const destPath = join(destRoot, 'package.json');

  logger.step('Syncing package.json dependencies...');
  logger.debug(`Source: ${srcPath}`);
  logger.debug(`Destination: ${destPath}`);

  try {
    const srcPkg = await readPackageJson(srcPath);
    const destPkg = await readPackageJson(destPath);

    const changes = [];

    for (const field of FIELDS_TO_SYNC) {
      if (srcPkg[field]) {
        const oldValue = JSON.stringify(destPkg[field]);
        const newValue = JSON.stringify(srcPkg[field]);

        if (oldValue !== newValue) {
          changes.push(field);
          destPkg[field] = srcPkg[field];
          logger.info(`Updated ${field}`);
        } else {
          logger.debug(`${field} unchanged`);
        }
      } else if (destPkg[field]) {
        // Source doesn't have this field but dest does - remove it
        changes.push(field);
        delete destPkg[field];
        logger.info(`Removed ${field} (not in source)`);
      }
    }

    if (changes.length === 0) {
      logger.info('No changes needed');
      return { success: true, changes: [] };
    }

    if (dryRun) {
      logger.info(`[DRY-RUN] Would update: ${changes.join(', ')}`);
    } else {
      await writePackageJson(destPath, destPkg);
      logger.info(`Updated package.json: ${changes.join(', ')}`);
    }

    return { success: true, changes };
  } catch (error) {
    logger.error(`Failed to sync package.json: ${error.message}`);
    return { success: false, error: error.message };
  }
}

export const syncPackageJsonUtils = {
  syncPackageJson,
};
