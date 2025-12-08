// Tests for version-utils.js
// Run with: node --test lib/version-utils.test.js

import { test } from 'node:test';
import assert from 'node:assert';
import { parseVersion, compareVersions, formatVersion, isPrerelease } from './version-utils.js';

test('parseVersion', async (t) => {
  await t.test('parses standard version', () => {
    const v = parseVersion('19.2.1');
    assert.strictEqual(v.major, 19);
    assert.strictEqual(v.minor, 2);
    assert.strictEqual(v.patch, 1);
    assert.deepStrictEqual(v.prerelease, []);
  });

  await t.test('strips v prefix', () => {
    const v = parseVersion('v19.2.1');
    assert.strictEqual(v.major, 19);
    assert.strictEqual(v.version, '19.2.1');
  });

  await t.test('parses rc prerelease', () => {
    const v = parseVersion('19.0.0-rc.1');
    assert.strictEqual(v.major, 19);
    assert.strictEqual(v.minor, 0);
    assert.strictEqual(v.patch, 0);
    assert.deepStrictEqual(v.prerelease, ['rc', 1]);
  });

  await t.test('parses alpha prerelease', () => {
    const v = parseVersion('v19.1.0-alpha.0');
    assert.deepStrictEqual(v.prerelease, ['alpha', 0]);
  });

  await t.test('parses beta prerelease', () => {
    const v = parseVersion('19.0.0-beta.2');
    assert.deepStrictEqual(v.prerelease, ['beta', 2]);
  });

  await t.test('parses canary prerelease', () => {
    const v = parseVersion('19.0.0-canary-abc123');
    assert.strictEqual(v.prerelease[0], 'canary-abc123');
  });

  await t.test('returns null for invalid input', () => {
    assert.strictEqual(parseVersion(null), null);
    assert.strictEqual(parseVersion(''), null);
    assert.strictEqual(parseVersion('invalid'), null);
  });
});

test('compareVersions', async (t) => {
  await t.test('compares major versions', () => {
    const v1 = parseVersion('20.0.0');
    const v2 = parseVersion('19.0.0');
    assert.strictEqual(compareVersions(v1, v2), 1);
    assert.strictEqual(compareVersions(v2, v1), -1);
  });

  await t.test('compares minor versions', () => {
    const v1 = parseVersion('19.2.0');
    const v2 = parseVersion('19.1.0');
    assert.strictEqual(compareVersions(v1, v2), 1);
  });

  await t.test('compares patch versions', () => {
    const v1 = parseVersion('19.0.2');
    const v2 = parseVersion('19.0.1');
    assert.strictEqual(compareVersions(v1, v2), 1);
  });

  await t.test('equal versions return 0', () => {
    const v1 = parseVersion('19.2.1');
    const v2 = parseVersion('19.2.1');
    assert.strictEqual(compareVersions(v1, v2), 0);
  });

  await t.test('stable > prerelease for same version', () => {
    const stable = parseVersion('19.0.0');
    const rc = parseVersion('19.0.0-rc.1');
    assert.strictEqual(compareVersions(stable, rc), 1);
    assert.strictEqual(compareVersions(rc, stable), -1);
  });

  await t.test('rc > beta > alpha', () => {
    const alpha = parseVersion('19.0.0-alpha.0');
    const beta = parseVersion('19.0.0-beta.0');
    const rc = parseVersion('19.0.0-rc.0');

    assert.strictEqual(compareVersions(beta, alpha), 1);
    assert.strictEqual(compareVersions(rc, beta), 1);
    assert.strictEqual(compareVersions(rc, alpha), 1);
  });

  await t.test('compares prerelease numbers', () => {
    const rc1 = parseVersion('19.0.0-rc.1');
    const rc2 = parseVersion('19.0.0-rc.2');
    assert.strictEqual(compareVersions(rc2, rc1), 1);
  });
});

test('formatVersion', async (t) => {
  await t.test('formats standard version', () => {
    const v = parseVersion('v19.2.1');
    assert.strictEqual(formatVersion(v), '19.2.1');
  });

  await t.test('formats prerelease version', () => {
    const v = parseVersion('19.0.0-rc.1');
    assert.strictEqual(formatVersion(v), '19.0.0-rc.1');
  });

  await t.test('returns null for null input', () => {
    assert.strictEqual(formatVersion(null), null);
  });
});

test('isPrerelease', async (t) => {
  await t.test('returns false for stable version', () => {
    const v = parseVersion('19.2.1');
    assert.strictEqual(isPrerelease(v), false);
  });

  await t.test('returns true for rc version', () => {
    const v = parseVersion('19.0.0-rc.1');
    assert.strictEqual(isPrerelease(v), true);
  });

  await t.test('returns true for alpha version', () => {
    const v = parseVersion('19.0.0-alpha.0');
    assert.strictEqual(isPrerelease(v), true);
  });

  await t.test('returns false for null input', () => {
    assert.strictEqual(isPrerelease(null), false);
  });
});
