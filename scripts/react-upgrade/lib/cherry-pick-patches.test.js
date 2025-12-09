// Tests for cherry-pick-patches.js
// Run with: node --test lib/cherry-pick-patches.test.js

import { test } from 'node:test';
import assert from 'node:assert';
import { isPatchCommit, addPatchPrefix } from './cherry-pick-patches.js';

test('isPatchCommit', async (t) => {
  await t.test('returns true for [RSC-PATCH] prefix', () => {
    assert.strictEqual(isPatchCommit('[RSC-PATCH] Add server support'), true);
  });

  await t.test('returns true for [RSC-PATCH:scope] prefix', () => {
    assert.strictEqual(isPatchCommit('[RSC-PATCH:webpack] Fix manifest'), true);
  });

  await t.test('returns false for no prefix', () => {
    assert.strictEqual(isPatchCommit('Add server support'), false);
  });

  await t.test('returns false for different prefix', () => {
    assert.strictEqual(isPatchCommit('[FIX] Add server support'), false);
  });

  await t.test('returns false for prefix not at start', () => {
    assert.strictEqual(isPatchCommit('Fix: [RSC-PATCH] something'), false);
  });
});

test('addPatchPrefix', async (t) => {
  await t.test('adds [RSC-PATCH] prefix', () => {
    assert.strictEqual(
      addPatchPrefix('Add server support'),
      '[RSC-PATCH] Add server support'
    );
  });

  await t.test('works with empty string', () => {
    assert.strictEqual(addPatchPrefix(''), '[RSC-PATCH] ');
  });
});

// Note: cherryPickPatches and promptUser are integration-level functions
// that require a real git repo and stdin interaction, so we test them
// at a higher level or manually. The core logic (isPatchCommit, addPatchPrefix)
// is covered by unit tests above.
