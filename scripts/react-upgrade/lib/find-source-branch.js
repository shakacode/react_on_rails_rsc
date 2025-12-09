// Find the closest existing patch branch for a target React version

import { getBranches } from './git-utils.js';
import { parseVersion, compareVersions } from './version-utils.js';
import { config } from './config.js';

export async function getPatchBranches(reactForkPath) {
  const branches = await getBranches(reactForkPath);

  return branches
    .filter((branch) => branch.startsWith(config.branchPrefix))
    .map((branch) => {
      const versionStr = branch.slice(config.branchPrefix.length);
      const version = parseVersion(versionStr);
      return version ? { branch, version } : null;
    })
    .filter(Boolean);
}

export async function findSourceBranch(targetVersion, reactForkPath) {
  const patchBranches = await getPatchBranches(reactForkPath);

  // Filter to versions less than target
  const candidates = patchBranches.filter(
    ({ version }) => compareVersions(version, targetVersion) < 0
  );

  if (candidates.length === 0) {
    return null;
  }

  // Sort descending (newest first)
  candidates.sort((a, b) => compareVersions(b.version, a.version));

  // Return the closest (newest version less than target)
  return candidates[0];
}

export const findSourceBranchUtils = {
  findSourceBranch,
  getPatchBranches,
};
