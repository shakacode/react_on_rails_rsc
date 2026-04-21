#!/usr/bin/env node
/**
 * Runs an rspack build in a dedicated Node process.
 *
 * Jest's VM sandbox does not support dynamic ESM `import()` inside loaders
 * (it throws "You need to run with a version of node that supports ES
 * Modules in the VM API"). Running rspack out-of-process avoids that
 * limitation — and is also how rspack is actually invoked in production.
 *
 * Usage:
 *   node runRspack.js <path-to-config-json>
 *
 * The config JSON is a serialized rspack config. Loader paths are NOT
 * serializable across processes, so we use a "directives" side-channel:
 * the JSON may contain "__loader__" or "__plugin__" placeholders.
 *
 * Stdout: JSON-encoded build result { ok: true } or { ok: false, errors, warnings }
 * Stderr: human-readable progress (for debugging)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { rspack } = require('@rspack/core');

const configPath = process.argv[2];
if (!configPath) {
  process.stderr.write('Usage: node runRspack.js <config.json>\n');
  process.exit(2);
}

const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// The config JSON cannot carry plugin instances, so we allow the caller to
// pass a separate "plugins" command: an array of [name, optionsJson] pairs.
// Currently unused because we only need loaders for our tests.

rspack(rawConfig, (err, stats) => {
  if (err) {
    process.stdout.write(JSON.stringify({ ok: false, errors: [String(err)] }));
    process.exit(1);
  }
  if (!stats) {
    process.stdout.write(JSON.stringify({ ok: false, errors: ['rspack returned no stats'] }));
    process.exit(1);
  }
  const info = stats.toJson({ errors: true, warnings: true });
  if (stats.hasErrors()) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        errors: (info.errors || []).map((e) => e.message),
        warnings: (info.warnings || []).map((w) => w.message),
      }),
    );
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({
      ok: true,
      warnings: (info.warnings || []).map((w) => w.message),
      outputPath: rawConfig.output && rawConfig.output.path,
    }),
  );
});
