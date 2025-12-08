// Tests for sync-package-json.js
// Run with: node --test lib/sync-package-json.test.js

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncPackageJson } from './sync-package-json.js';
import { config } from './config.js';

async function createTempDir() {
  return mkdtemp(join(tmpdir(), 'sync-pkg-test-'));
}

async function setupTestDirs() {
  const srcRoot = await createTempDir();
  const destRoot = await createTempDir();

  // Create source build output directory
  const srcPkgDir = join(srcRoot, config.buildOutputPath);
  await mkdir(srcPkgDir, { recursive: true });

  return { srcRoot, destRoot, srcPkgDir };
}

async function writeJson(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function readJson(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

test('syncPackageJson', async (t) => {
  await t.test('syncs dependencies from source to destination', async () => {
    const { srcRoot, destRoot, srcPkgDir } = await setupTestDirs();

    try {
      await writeJson(join(srcPkgDir, 'package.json'), {
        name: 'react-server-dom-webpack',
        dependencies: {
          'neo-async': '^2.6.0',
          'loose-envify': '^1.1.0',
        },
      });

      await writeJson(join(destRoot, 'package.json'), {
        name: 'react-on-rails-rsc',
        version: '1.0.0',
        dependencies: {
          'old-dep': '^1.0.0',
        },
      });

      const result = await syncPackageJson(srcRoot, destRoot);

      assert.strictEqual(result.success, true);
      assert.ok(result.changes.includes('dependencies'));

      const destPkg = await readJson(join(destRoot, 'package.json'));
      assert.deepStrictEqual(destPkg.dependencies, {
        'neo-async': '^2.6.0',
        'loose-envify': '^1.1.0',
      });
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('syncs peerDependencies from source to destination', async () => {
    const { srcRoot, destRoot, srcPkgDir } = await setupTestDirs();

    try {
      await writeJson(join(srcPkgDir, 'package.json'), {
        name: 'react-server-dom-webpack',
        peerDependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
        },
      });

      await writeJson(join(destRoot, 'package.json'), {
        name: 'react-on-rails-rsc',
        version: '1.0.0',
      });

      const result = await syncPackageJson(srcRoot, destRoot);

      assert.strictEqual(result.success, true);
      assert.ok(result.changes.includes('peerDependencies'));

      const destPkg = await readJson(join(destRoot, 'package.json'));
      assert.deepStrictEqual(destPkg.peerDependencies, {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      });
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('syncs peerDependenciesMeta from source to destination', async () => {
    const { srcRoot, destRoot, srcPkgDir } = await setupTestDirs();

    try {
      await writeJson(join(srcPkgDir, 'package.json'), {
        name: 'react-server-dom-webpack',
        peerDependenciesMeta: {
          webpack: { optional: true },
        },
      });

      await writeJson(join(destRoot, 'package.json'), {
        name: 'react-on-rails-rsc',
        version: '1.0.0',
      });

      const result = await syncPackageJson(srcRoot, destRoot);

      assert.strictEqual(result.success, true);
      assert.ok(result.changes.includes('peerDependenciesMeta'));

      const destPkg = await readJson(join(destRoot, 'package.json'));
      assert.deepStrictEqual(destPkg.peerDependenciesMeta, {
        webpack: { optional: true },
      });
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('preserves other fields in destination package.json', async () => {
    const { srcRoot, destRoot, srcPkgDir } = await setupTestDirs();

    try {
      await writeJson(join(srcPkgDir, 'package.json'), {
        name: 'react-server-dom-webpack',
        dependencies: { 'new-dep': '^1.0.0' },
      });

      await writeJson(join(destRoot, 'package.json'), {
        name: 'react-on-rails-rsc',
        version: '2.0.0',
        description: 'My package',
        main: 'index.js',
        license: 'MIT',
      });

      await syncPackageJson(srcRoot, destRoot);

      const destPkg = await readJson(join(destRoot, 'package.json'));
      assert.strictEqual(destPkg.name, 'react-on-rails-rsc');
      assert.strictEqual(destPkg.version, '2.0.0');
      assert.strictEqual(destPkg.description, 'My package');
      assert.strictEqual(destPkg.main, 'index.js');
      assert.strictEqual(destPkg.license, 'MIT');
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('handles missing fields gracefully', async () => {
    const { srcRoot, destRoot, srcPkgDir } = await setupTestDirs();

    try {
      // Source has no dependencies, peerDependencies, or peerDependenciesMeta
      await writeJson(join(srcPkgDir, 'package.json'), {
        name: 'react-server-dom-webpack',
        version: '19.0.0',
      });

      await writeJson(join(destRoot, 'package.json'), {
        name: 'react-on-rails-rsc',
        version: '1.0.0',
      });

      const result = await syncPackageJson(srcRoot, destRoot);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.changes, []);
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('removes field from dest if not in source', async () => {
    const { srcRoot, destRoot, srcPkgDir } = await setupTestDirs();

    try {
      // Source has no peerDependenciesMeta
      await writeJson(join(srcPkgDir, 'package.json'), {
        name: 'react-server-dom-webpack',
        dependencies: { 'some-dep': '^1.0.0' },
      });

      // Dest has peerDependenciesMeta that should be removed
      await writeJson(join(destRoot, 'package.json'), {
        name: 'react-on-rails-rsc',
        version: '1.0.0',
        peerDependenciesMeta: { 'old-meta': { optional: true } },
      });

      const result = await syncPackageJson(srcRoot, destRoot);

      assert.strictEqual(result.success, true);
      assert.ok(result.changes.includes('peerDependenciesMeta'));

      const destPkg = await readJson(join(destRoot, 'package.json'));
      assert.strictEqual(destPkg.peerDependenciesMeta, undefined);
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('dry run does not modify destination', async () => {
    const { srcRoot, destRoot, srcPkgDir } = await setupTestDirs();

    try {
      await writeJson(join(srcPkgDir, 'package.json'), {
        name: 'react-server-dom-webpack',
        dependencies: { 'new-dep': '^2.0.0' },
      });

      const originalDest = {
        name: 'react-on-rails-rsc',
        version: '1.0.0',
        dependencies: { 'old-dep': '^1.0.0' },
      };
      await writeJson(join(destRoot, 'package.json'), originalDest);

      const result = await syncPackageJson(srcRoot, destRoot, { dryRun: true });

      assert.strictEqual(result.success, true);
      assert.ok(result.changes.includes('dependencies'));

      // Verify file was not modified
      const destPkg = await readJson(join(destRoot, 'package.json'));
      assert.deepStrictEqual(destPkg.dependencies, { 'old-dep': '^1.0.0' });
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });

  await t.test('reports no changes when values are identical', async () => {
    const { srcRoot, destRoot, srcPkgDir } = await setupTestDirs();

    try {
      const deps = { 'some-dep': '^1.0.0' };

      await writeJson(join(srcPkgDir, 'package.json'), {
        name: 'react-server-dom-webpack',
        dependencies: deps,
      });

      await writeJson(join(destRoot, 'package.json'), {
        name: 'react-on-rails-rsc',
        dependencies: deps,
      });

      const result = await syncPackageJson(srcRoot, destRoot);

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.changes, []);
    } finally {
      await rm(srcRoot, { recursive: true });
      await rm(destRoot, { recursive: true });
    }
  });
});
