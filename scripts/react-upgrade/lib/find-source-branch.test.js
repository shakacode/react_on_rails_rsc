// Tests for find-source-branch.js
// Run with: node --test lib/find-source-branch.test.js

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './git-utils.js';
import { parseVersion } from './version-utils.js';
import { findSourceBranch, getPatchBranches } from './find-source-branch.js';

async function createTempGitRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'find-source-test-'));
  await git(['init'], dir);
  await git(['config', 'user.email', 'test@test.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
  await git(['commit', '--allow-empty', '-m', 'initial'], dir);
  return dir;
}

test('getPatchBranches', async (t) => {
  await t.test('returns patch branches with parsed versions', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['branch', 'rsc-patches/v19.0.0'], dir);
      await git(['branch', 'rsc-patches/v19.1.0'], dir);
      await git(['branch', 'other-branch'], dir);

      const branches = await getPatchBranches(dir);

      assert.strictEqual(branches.length, 2);
      assert.ok(branches.some((b) => b.branch === 'rsc-patches/v19.0.0'));
      assert.ok(branches.some((b) => b.branch === 'rsc-patches/v19.1.0'));
      assert.ok(branches.every((b) => b.version !== null));
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('handles prerelease versions', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['branch', 'rsc-patches/v19.0.0-rc.1'], dir);

      const branches = await getPatchBranches(dir);

      assert.strictEqual(branches.length, 1);
      assert.strictEqual(branches[0].branch, 'rsc-patches/v19.0.0-rc.1');
      assert.deepStrictEqual(branches[0].version.prerelease, ['rc', 1]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('returns empty array when no patch branches', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['branch', 'feature-branch'], dir);

      const branches = await getPatchBranches(dir);

      assert.deepStrictEqual(branches, []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

test('findSourceBranch', async (t) => {
  await t.test('finds closest branch less than target', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['branch', 'rsc-patches/v19.0.0'], dir);
      await git(['branch', 'rsc-patches/v19.1.0'], dir);
      await git(['branch', 'rsc-patches/v19.2.0'], dir);

      const target = parseVersion('19.2.1');
      const result = await findSourceBranch(target, dir);

      assert.strictEqual(result.branch, 'rsc-patches/v19.2.0');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('skips branches equal to or greater than target', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['branch', 'rsc-patches/v19.0.0'], dir);
      await git(['branch', 'rsc-patches/v19.2.0'], dir);
      await git(['branch', 'rsc-patches/v19.3.0'], dir);

      const target = parseVersion('19.2.0');
      const result = await findSourceBranch(target, dir);

      assert.strictEqual(result.branch, 'rsc-patches/v19.0.0');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('returns null when no suitable branch found', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['branch', 'rsc-patches/v19.2.0'], dir);
      await git(['branch', 'rsc-patches/v19.3.0'], dir);

      const target = parseVersion('19.0.0');
      const result = await findSourceBranch(target, dir);

      assert.strictEqual(result, null);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('handles prerelease versions correctly', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['branch', 'rsc-patches/v19.0.0-rc.0'], dir);
      await git(['branch', 'rsc-patches/v19.0.0-rc.1'], dir);

      // Stable 19.0.0 should find rc.1 (closest prerelease)
      const target = parseVersion('19.0.0');
      const result = await findSourceBranch(target, dir);

      assert.strictEqual(result.branch, 'rsc-patches/v19.0.0-rc.1');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('prefers newer minor over older patch', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['branch', 'rsc-patches/v19.0.5'], dir);
      await git(['branch', 'rsc-patches/v19.1.0'], dir);

      const target = parseVersion('19.2.0');
      const result = await findSourceBranch(target, dir);

      assert.strictEqual(result.branch, 'rsc-patches/v19.1.0');
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
