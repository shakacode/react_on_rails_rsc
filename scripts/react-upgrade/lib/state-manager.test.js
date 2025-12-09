// Tests for state-manager.js
// Run with: node --test lib/state-manager.test.js

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasState, loadState, saveState, clearState } from './state-manager.js';
import { config } from './config.js';

async function createTempDir() {
  return mkdtemp(join(tmpdir(), 'state-manager-test-'));
}

test('hasState', async (t) => {
  await t.test('returns false when state file does not exist', async () => {
    const destRoot = await createTempDir();

    try {
      const result = await hasState(destRoot);
      assert.strictEqual(result, false);
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('returns true when state file exists', async () => {
    const destRoot = await createTempDir();

    try {
      await writeFile(join(destRoot, config.stateFile), '{}', 'utf-8');

      const result = await hasState(destRoot);
      assert.strictEqual(result, true);
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });
});

test('loadState', async (t) => {
  await t.test('returns null when state file does not exist', async () => {
    const destRoot = await createTempDir();

    try {
      const state = await loadState(destRoot);
      assert.strictEqual(state, null);
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('loads and parses existing state file', async () => {
    const destRoot = await createTempDir();

    try {
      const expectedState = {
        targetVersion: '19.1.0',
        sourceBranch: 'rsc-patches/v19.0.0',
        phase: 'build',
      };
      await writeFile(
        join(destRoot, config.stateFile),
        JSON.stringify(expectedState),
        'utf-8'
      );

      const state = await loadState(destRoot);
      assert.deepStrictEqual(state, expectedState);
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('throws on invalid JSON', async () => {
    const destRoot = await createTempDir();

    try {
      await writeFile(join(destRoot, config.stateFile), 'invalid json', 'utf-8');

      await assert.rejects(async () => {
        await loadState(destRoot);
      }, SyntaxError);
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });
});

test('saveState', async (t) => {
  await t.test('creates state file with correct content', async () => {
    const destRoot = await createTempDir();

    try {
      const state = {
        targetVersion: '19.1.0',
        sourceBranch: 'rsc-patches/v19.0.0',
        phase: 'cherry-pick',
        cherryPickedCommits: ['abc123'],
      };

      await saveState(destRoot, state);

      const content = await readFile(join(destRoot, config.stateFile), 'utf-8');
      const savedState = JSON.parse(content);

      assert.strictEqual(savedState.targetVersion, '19.1.0');
      assert.strictEqual(savedState.sourceBranch, 'rsc-patches/v19.0.0');
      assert.strictEqual(savedState.phase, 'cherry-pick');
      assert.deepStrictEqual(savedState.cherryPickedCommits, ['abc123']);
      assert.ok(savedState.updatedAt); // Should have timestamp
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('overwrites existing state file', async () => {
    const destRoot = await createTempDir();

    try {
      await saveState(destRoot, { phase: 'first' });
      await saveState(destRoot, { phase: 'second' });

      const content = await readFile(join(destRoot, config.stateFile), 'utf-8');
      const savedState = JSON.parse(content);

      assert.strictEqual(savedState.phase, 'second');
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });
});

test('clearState', async (t) => {
  await t.test('removes existing state file', async () => {
    const destRoot = await createTempDir();

    try {
      await writeFile(join(destRoot, config.stateFile), '{}', 'utf-8');

      await clearState(destRoot);

      await assert.rejects(async () => {
        await access(join(destRoot, config.stateFile));
      });
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('does not throw when state file does not exist', async () => {
    const destRoot = await createTempDir();

    try {
      // Should not throw
      await clearState(destRoot);
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });
});
