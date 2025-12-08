// State management for upgrade process continuity

import { readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { logger } from './logger.js';

function getStatePath(destRoot) {
  return join(destRoot, config.stateFile);
}

export async function hasState(destRoot) {
  try {
    await access(getStatePath(destRoot));
    return true;
  } catch {
    return false;
  }
}

export async function loadState(destRoot) {
  const statePath = getStatePath(destRoot);

  try {
    const content = await readFile(statePath, 'utf-8');
    const state = JSON.parse(content);
    logger.debug(`Loaded state from ${statePath}`);
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    logger.error(`Failed to load state: ${error.message}`);
    throw error;
  }
}

export async function saveState(destRoot, state) {
  const statePath = getStatePath(destRoot);
  const stateWithTimestamp = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeFile(statePath, JSON.stringify(stateWithTimestamp, null, 2), 'utf-8');
    logger.debug(`Saved state to ${statePath}`);
  } catch (error) {
    logger.error(`Failed to save state: ${error.message}`);
    throw error;
  }
}

export async function clearState(destRoot) {
  const statePath = getStatePath(destRoot);

  try {
    await rm(statePath, { force: true });
    logger.debug(`Cleared state at ${statePath}`);
  } catch (error) {
    logger.error(`Failed to clear state: ${error.message}`);
    throw error;
  }
}

export const stateManagerUtils = {
  hasState,
  loadState,
  saveState,
  clearState,
};
