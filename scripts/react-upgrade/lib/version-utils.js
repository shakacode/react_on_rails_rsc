// Version parsing and comparison utilities
// Thin wrapper around semver package

import semver from 'semver';

export function parseVersion(versionString) {
  if (!versionString) return null;

  // Remove 'v' prefix if present and parse
  const cleaned = versionString.replace(/^v/, '');
  return semver.parse(cleaned);
}

export function compareVersions(v1, v2) {
  // semver.compare returns -1, 0, or 1
  return semver.compare(v1.version, v2.version);
}

export function formatVersion(parsed) {
  return parsed?.version ?? null;
}

export function isPrerelease(parsed) {
  return parsed?.prerelease?.length > 0;
}

export const versionUtils = {
  parseVersion,
  compareVersions,
  formatVersion,
  isPrerelease,
};
