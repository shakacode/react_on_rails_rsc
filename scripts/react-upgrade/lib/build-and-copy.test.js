// Tests for build-and-copy.js
// Run with: node --test lib/build-and-copy.test.js

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyBuildArtifacts } from './build-and-copy.js';
import { config } from './config.js';

async function createTempDir() {
  return mkdtemp(join(tmpdir(), 'build-copy-test-'));
}

test('copyBuildArtifacts', async (t) => {
  await t.test('copies files from build output to destination', async () => {
    const srcRoot = await createTempDir();
    const destRoot = await createTempDir();

    try {
      // Create mock build output structure
      const buildOutputDir = join(srcRoot, config.buildOutputPath);
      await mkdir(buildOutputDir, { recursive: true });
      await writeFile(join(buildOutputDir, 'index.js'), 'export default {}');
      await mkdir(join(buildOutputDir, 'cjs'), { recursive: true });
      await writeFile(join(buildOutputDir, 'cjs', 'react-server-dom-webpack.js'), 'module.exports = {}');

      const result = await copyBuildArtifacts(srcRoot, destRoot);

      assert.strictEqual(result.success, true);

      // Verify files were copied
      const destPath = join(destRoot, config.destPath);
      const indexContent = await readFile(join(destPath, 'index.js'), 'utf-8');
      assert.strictEqual(indexContent, 'export default {}');

      const cjsContent = await readFile(join(destPath, 'cjs', 'react-server-dom-webpack.js'), 'utf-8');
      assert.strictEqual(cjsContent, 'module.exports = {}');
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('removes existing destination before copying', async () => {
    const srcRoot = await createTempDir();
    const destRoot = await createTempDir();

    try {
      // Create existing destination with old file
      const destPath = join(destRoot, config.destPath);
      await mkdir(destPath, { recursive: true });
      await writeFile(join(destPath, 'old-file.js'), 'old content');

      // Create mock build output
      const buildOutputDir = join(srcRoot, config.buildOutputPath);
      await mkdir(buildOutputDir, { recursive: true });
      await writeFile(join(buildOutputDir, 'new-file.js'), 'new content');

      const result = await copyBuildArtifacts(srcRoot, destRoot);

      assert.strictEqual(result.success, true);

      // Old file should be gone
      await assert.rejects(async () => {
        await access(join(destPath, 'old-file.js'));
      });

      // New file should exist
      const newContent = await readFile(join(destPath, 'new-file.js'), 'utf-8');
      assert.strictEqual(newContent, 'new content');
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('returns failure when source does not exist', async () => {
    const srcRoot = await createTempDir();
    const destRoot = await createTempDir();

    try {
      // Don't create build output - should fail
      const result = await copyBuildArtifacts(srcRoot, destRoot);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('dry run does not copy files', async () => {
    const srcRoot = await createTempDir();
    const destRoot = await createTempDir();

    try {
      // Create mock build output
      const buildOutputDir = join(srcRoot, config.buildOutputPath);
      await mkdir(buildOutputDir, { recursive: true });
      await writeFile(join(buildOutputDir, 'index.js'), 'content');

      const result = await copyBuildArtifacts(srcRoot, destRoot, { dryRun: true });

      assert.strictEqual(result.success, true);

      // Destination should not exist
      const destPath = join(destRoot, config.destPath);
      await assert.rejects(async () => {
        await access(destPath);
      });
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });
});

// Note: buildReact is an integration test that requires a real React repo
// with yarn and build scripts. It's tested manually or in E2E tests.
