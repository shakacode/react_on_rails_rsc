// Build React and copy artifacts to destination

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export async function buildReact(reactForkPath, options = {}) {
  const { dryRun = false } = options;

  logger.step('Building react-server-dom-webpack...');

  if (dryRun) {
    logger.info(`[DRY-RUN] Would run: ${config.buildCommand}`);
    return { success: true, output: '' };
  }

  try {
    const [cmd, ...args] = config.buildCommand.split(' ');
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: reactForkPath,
      shell: true,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for build output
    });

    logger.info('Build completed successfully');
    logger.debug(stdout);
    if (stderr) logger.debug(stderr);

    return { success: true, output: stdout };
  } catch (error) {
    logger.error(`Build failed: ${error.message}`);
    if (error.stdout) logger.debug(error.stdout);
    if (error.stderr) logger.error(error.stderr);
    return { success: false, output: error.message };
  }
}

export async function copyBuildArtifacts(reactForkPath, destRoot, options = {}) {
  const { dryRun = false } = options;

  const srcPath = join(reactForkPath, config.buildOutputPath);
  const destPath = join(destRoot, config.destPath);

  logger.step('Copying build artifacts...');
  logger.debug(`From: ${srcPath}`);
  logger.debug(`To: ${destPath}`);

  if (dryRun) {
    logger.info(`[DRY-RUN] Would copy ${srcPath} to ${destPath}`);
    return { success: true };
  }

  try {
    // Remove existing destination directory
    await rm(destPath, { recursive: true, force: true });

    // Copy new build artifacts
    await cp(srcPath, destPath, { recursive: true });

    logger.info('Build artifacts copied successfully');
    return { success: true };
  } catch (error) {
    logger.error(`Copy failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

export async function buildAndCopy(reactForkPath, destRoot, options = {}) {
  const buildResult = await buildReact(reactForkPath, options);

  if (!buildResult.success) {
    return { buildSuccess: false, copySuccess: false };
  }

  const copyResult = await copyBuildArtifacts(reactForkPath, destRoot, options);

  return {
    buildSuccess: buildResult.success,
    copySuccess: copyResult.success,
  };
}

export const buildAndCopyUtils = {
  buildReact,
  copyBuildArtifacts,
  buildAndCopy,
};
