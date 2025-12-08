// Tests for cherry-pick-replacements.js
// Run with: node --test lib/cherry-pick-replacements.test.js

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getReplacementCommits } from './cherry-pick-replacements.js';
import { config } from './config.js';

async function createTempGitRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'cherry-pick-replace-test-'));

  // Initialize git repo
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });

  return { dir, execFileAsync };
}

test('getReplacementCommits', async (t) => {
  await t.test('returns empty array when no commits exist', async () => {
    const { dir, execFileAsync } = await createTempGitRepo();

    try {
      // Create dest directory and initial commit (non-replacement)
      const destPath = join(dir, config.destPath);
      await mkdir(destPath, { recursive: true });
      await writeFile(join(destPath, 'index.js'), 'export default {}');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: dir });

      const commits = await getReplacementCommits(dir);
      assert.deepStrictEqual(commits, []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('finds replacement commits after last non-replacement commit', async () => {
    const { dir, execFileAsync } = await createTempGitRepo();

    try {
      // Create dest directory and initial commit (simulates build copy)
      const destPath = join(dir, config.destPath);
      await mkdir(destPath, { recursive: true });
      await writeFile(join(destPath, 'index.js'), 'export default {}');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync('git', ['commit', '-m', 'Copy build artifacts'], { cwd: dir });

      // Add replacement commit
      await writeFile(join(destPath, 'index.js'), 'export default { replaced: true }');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync(
        'git',
        ['commit', '-m', '[RSC-REPLACE] Replace package name'],
        { cwd: dir }
      );

      const commits = await getReplacementCommits(dir);

      assert.strictEqual(commits.length, 1);
      assert.ok(commits[0].hash);
      assert.ok(commits[0].subject.includes('[RSC-REPLACE]'));
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('ignores replacement commits from previous upgrades', async () => {
    const { dir, execFileAsync } = await createTempGitRepo();

    try {
      const destPath = join(dir, config.destPath);
      await mkdir(destPath, { recursive: true });

      // First upgrade cycle: build copy + replacement
      await writeFile(join(destPath, 'index.js'), 'v1');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync('git', ['commit', '-m', 'Copy build v1'], { cwd: dir });

      await writeFile(join(destPath, 'index.js'), 'v1-replaced');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync(
        'git',
        ['commit', '-m', '[RSC-REPLACE] Old replacement'],
        { cwd: dir }
      );

      // Second upgrade cycle: new build copy + new replacement
      await writeFile(join(destPath, 'index.js'), 'v2');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync('git', ['commit', '-m', 'Copy build v2'], { cwd: dir });

      await writeFile(join(destPath, 'index.js'), 'v2-replaced');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync(
        'git',
        ['commit', '-m', '[RSC-REPLACE] New replacement'],
        { cwd: dir }
      );

      const commits = await getReplacementCommits(dir);

      // Should only find the new replacement, not the old one
      assert.strictEqual(commits.length, 1);
      assert.ok(commits[0].subject.includes('New replacement'));
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('finds multiple replacement commits from current upgrade', async () => {
    const { dir, execFileAsync } = await createTempGitRepo();

    try {
      const destPath = join(dir, config.destPath);
      await mkdir(destPath, { recursive: true });

      // Build copy
      await writeFile(join(destPath, 'index.js'), 'v1');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync('git', ['commit', '-m', 'Copy build'], { cwd: dir });

      // First replacement
      await writeFile(join(destPath, 'index.js'), 'v2');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync(
        'git',
        ['commit', '-m', '[RSC-REPLACE] First replacement'],
        { cwd: dir }
      );

      // Second replacement
      await writeFile(join(destPath, 'index.js'), 'v3');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync(
        'git',
        ['commit', '-m', '[RSC-REPLACE] Second replacement'],
        { cwd: dir }
      );

      const commits = await getReplacementCommits(dir);

      assert.strictEqual(commits.length, 2);
      assert.ok(commits[0].subject.includes('First'));
      assert.ok(commits[1].subject.includes('Second'));
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('only finds commits that touch destPath', async () => {
    const { dir, execFileAsync } = await createTempGitRepo();

    try {
      const destPath = join(dir, config.destPath);
      await mkdir(destPath, { recursive: true });

      // Build copy
      await writeFile(join(destPath, 'index.js'), 'v1');
      await writeFile(join(dir, 'other.js'), 'v1');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync('git', ['commit', '-m', 'Copy build'], { cwd: dir });

      // Replacement commit that doesn't touch destPath
      await writeFile(join(dir, 'other.js'), 'v2');
      await execFileAsync('git', ['add', '.'], { cwd: dir });
      await execFileAsync(
        'git',
        ['commit', '-m', '[RSC-REPLACE] Change outside destPath'],
        { cwd: dir }
      );

      const commits = await getReplacementCommits(dir);
      assert.deepStrictEqual(commits, []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  await t.test('returns empty when destPath has no commits', async () => {
    const { dir } = await createTempGitRepo();

    try {
      // No commits touching destPath at all
      const commits = await getReplacementCommits(dir);
      assert.deepStrictEqual(commits, []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
