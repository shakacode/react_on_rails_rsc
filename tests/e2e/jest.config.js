// Dedicated jest config for the packed-tarball E2E suite.
//
// E2E files are named *.e2e.ts so the main jest config's testMatch
// (`tests/**/*.test.*`) never picks them up — they only run through
// `yarn test:e2e` (scripts/e2e/run.sh), which prepares the consumer
// project and exports RSC_E2E_PROJECT_DIR.
const { createDefaultPreset } = require('ts-jest');

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  transform: {
    ...tsJestTransformCfg,
  },
  testMatch: ['<rootDir>/tests/e2e/**/*.e2e.[jt]s'],
  testTimeout: 300_000,
};
