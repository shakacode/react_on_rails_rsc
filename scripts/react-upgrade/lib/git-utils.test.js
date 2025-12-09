// Tests for git-utils.js
// Run with: node --test lib/git-utils.test.js

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  git,
  getBranches,
  getTags,
  getCommitsBetween,
  getCurrentBranch,
  checkoutBranch,
} from './git-utils.js';

async function createTempGitRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'git-utils-test-'));
  await git(['init'], dir);
  await git(['config', 'user.email', 'test@test.com'], dir);
  await git(['config', 'user.name', 'Test'], dir);
  return dir;
}

test('git', async (t) => {
  await t.test('executes git command and returns output', async () => {
    const dir = await createTempGitRepo();
    try {
      const result = await git(['status'], dir);
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('On branch'));
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('throws on failure by default', async () => {
    const dir = await createTempGitRepo();
    try {
      await assert.rejects(async () => {
        await git(['checkout', 'nonexistent-branch'], dir);
      });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('returns error info when allowFailure is true', async () => {
    const dir = await createTempGitRepo();
    try {
      const result = await git(['checkout', 'nonexistent-branch'], dir, { allowFailure: true });
      assert.notStrictEqual(result.exitCode, 0);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

test('getBranches', async (t) => {
  await t.test('returns list of branches', async () => {
    const dir = await createTempGitRepo();
    try {
      // Create initial commit so we have a branch
      await git(['commit', '--allow-empty', '-m', 'initial'], dir);
      await git(['branch', 'feature-1'], dir);
      await git(['branch', 'feature-2'], dir);

      const branches = await getBranches(dir);
      assert.ok(branches.includes('master') || branches.includes('main'));
      assert.ok(branches.includes('feature-1'));
      assert.ok(branches.includes('feature-2'));
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

test('getTags', async (t) => {
  await t.test('returns list of tags', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['commit', '--allow-empty', '-m', 'initial'], dir);
      await git(['tag', 'v1.0.0'], dir);
      await git(['tag', 'v1.1.0'], dir);

      const tags = await getTags(dir);
      assert.ok(tags.includes('v1.0.0'));
      assert.ok(tags.includes('v1.1.0'));
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('returns empty array when no tags', async () => {
    const dir = await createTempGitRepo();
    try {
      const tags = await getTags(dir);
      assert.deepStrictEqual(tags, []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

test('getCommitsBetween', async (t) => {
  await t.test('returns commits between two refs', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['commit', '--allow-empty', '-m', 'commit 1'], dir);
      await git(['tag', 'v1.0.0'], dir);
      await git(['commit', '--allow-empty', '-m', 'commit 2'], dir);
      await git(['commit', '--allow-empty', '-m', 'commit 3'], dir);

      const commits = await getCommitsBetween('v1.0.0', 'HEAD', dir);
      assert.strictEqual(commits.length, 2);
      assert.strictEqual(commits[0].subject, 'commit 2');
      assert.strictEqual(commits[1].subject, 'commit 3');
      assert.ok(commits[0].hash.length === 40);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('returns empty array when no commits between refs', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['commit', '--allow-empty', '-m', 'commit 1'], dir);
      await git(['tag', 'v1.0.0'], dir);

      const commits = await getCommitsBetween('v1.0.0', 'HEAD', dir);
      assert.deepStrictEqual(commits, []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

test('getCurrentBranch', async (t) => {
  await t.test('returns current branch name', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['commit', '--allow-empty', '-m', 'initial'], dir);
      const branch = await getCurrentBranch(dir);
      assert.ok(branch === 'master' || branch === 'main');
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

test('checkoutBranch', async (t) => {
  await t.test('creates and checks out new branch', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['commit', '--allow-empty', '-m', 'initial'], dir);
      await checkoutBranch('new-branch', dir, { create: true });

      const branch = await getCurrentBranch(dir);
      assert.strictEqual(branch, 'new-branch');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('checks out existing branch', async () => {
    const dir = await createTempGitRepo();
    try {
      await git(['commit', '--allow-empty', '-m', 'initial'], dir);
      await git(['branch', 'existing-branch'], dir);
      await checkoutBranch('existing-branch', dir);

      const branch = await getCurrentBranch(dir);
      assert.strictEqual(branch, 'existing-branch');
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
