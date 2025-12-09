// Tests for check-replacements.js
// Run with: node --test lib/check-replacements.test.js

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMatches } from './check-replacements.js';
import { config } from './config.js';

async function createTempDir() {
  return mkdtemp(join(tmpdir(), 'check-replacements-test-'));
}

test('findMatches', async (t) => {
  await t.test('finds matches in files', async () => {
    const destRoot = await createTempDir();

    try {
      const destPath = join(destRoot, config.destPath);
      await mkdir(destPath, { recursive: true });

      await writeFile(
        join(destPath, 'index.js'),
        `import something from 'react-server-dom-webpack/server';
const x = require('react-server-dom-webpack');`
      );

      const matches = await findMatches(destRoot);

      assert.strictEqual(matches.length, 2);
      assert.strictEqual(matches[0].lineNumber, 1);
      assert.strictEqual(matches[1].lineNumber, 2);
      assert.ok(matches[0].line.includes('react-server-dom-webpack'));
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('searches nested directories', async () => {
    const destRoot = await createTempDir();

    try {
      const destPath = join(destRoot, config.destPath);
      const nestedDir = join(destPath, 'esm', 'nested');
      await mkdir(nestedDir, { recursive: true });

      await writeFile(
        join(nestedDir, 'deep.js'),
        "const pkg = 'react-server-dom-webpack';"
      );

      const matches = await findMatches(destRoot);

      assert.strictEqual(matches.length, 1);
      assert.ok(matches[0].file.includes('deep.js'));
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('returns empty array when no matches', async () => {
    const destRoot = await createTempDir();

    try {
      const destPath = join(destRoot, config.destPath);
      await mkdir(destPath, { recursive: true });

      await writeFile(join(destPath, 'index.js'), 'const x = 1;');

      const matches = await findMatches(destRoot);

      assert.deepStrictEqual(matches, []);
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('handles multiple matches on same line', async () => {
    const destRoot = await createTempDir();

    try {
      const destPath = join(destRoot, config.destPath);
      await mkdir(destPath, { recursive: true });

      await writeFile(
        join(destPath, 'index.js'),
        "import 'react-server-dom-webpack' from 'react-server-dom-webpack';"
      );

      const matches = await findMatches(destRoot);

      // Should find one match (per line, not per occurrence)
      assert.strictEqual(matches.length, 1);
    } finally {
      await rm(destRoot, { recursive: true });
    }
  });
});

// Note: checkReplacements requires stdin interaction, tested manually
