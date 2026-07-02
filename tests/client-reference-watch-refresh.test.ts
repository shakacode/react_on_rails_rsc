import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const RUNNER = path.resolve(__dirname, 'helpers/runClientReferenceWatchRefresh.js');
const DIST_RSPACK_PLUGIN = path.resolve(
  __dirname,
  '../dist/react-server-dom-rspack/plugin.js'
);
const DIST_WEBPACK_PLUGIN = path.resolve(__dirname, '../dist/webpack/RSCWebpackPlugin.js');

type Bundler = 'rspack' | 'webpack';
type Scenario = 'add' | 'remove';

type WatchRefreshResult = {
  ok: boolean;
  bundler: Bundler;
  scenario: Scenario;
  errors?: string[];
  snapshots: Array<{
    errors: string[];
    warnings: string[];
    assets: string[];
    manifestKeys: string[];
  }>;
};

const runWatchRefresh = (bundler: Bundler, scenario: Scenario): WatchRefreshResult => {
  const argsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ror-rsc-watch-refresh-args-'));
  const argsFile = path.join(argsDir, 'args.json');
  fs.writeFileSync(argsFile, JSON.stringify({ bundler, scenario }));
  try {
    const out = execFileSync('node', [RUNNER, argsFile], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 90_000,
    });
    return JSON.parse(out) as WatchRefreshResult;
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const details = err.stdout || err.stderr || err.message;
    throw new Error(`Watch refresh runner failed for ${bundler} ${scenario}:\n${details}`);
  } finally {
    fs.rmSync(argsDir, { recursive: true, force: true });
  }
};

const expectSuccessfulWatch = (result: WatchRefreshResult): void => {
  if (!result.ok) {
    throw new Error(
      `${result.bundler} ${result.scenario} watch refresh failed:\n` +
        `Errors:\n${(result.errors ?? []).join('\n')}\n` +
        `Snapshots:\n${JSON.stringify(result.snapshots, null, 2)}`
    );
  }
  expect(result.snapshots).toHaveLength(2);
};

const expectManifestEntry = (
  result: WatchRefreshResult,
  snapshotIndex: number,
  filename: string
): void => {
  const keys = result.snapshots[snapshotIndex]!.manifestKeys;
  expect(keys).toEqual(expect.arrayContaining([expect.stringMatching(`/${filename}$`)]));
};

const expectNoManifestEntry = (
  result: WatchRefreshResult,
  snapshotIndex: number,
  filename: string
): void => {
  const keys = result.snapshots[snapshotIndex]!.manifestKeys;
  expect(keys).not.toEqual(expect.arrayContaining([expect.stringMatching(`/${filename}$`)]));
};

describe.each(['rspack', 'webpack'] as const)('%s client-reference watch refresh', (bundler) => {
  beforeAll(() => {
    const distPlugin = bundler === 'rspack' ? DIST_RSPACK_PLUGIN : DIST_WEBPACK_PLUGIN;
    if (!fs.existsSync(distPlugin)) {
      throw new Error(`Precondition: ${distPlugin} does not exist. Run \`yarn build\` first.`);
    }
  });

  it('adds newly discovered client references on the next rebuild', () => {
    const result = runWatchRefresh(bundler, 'add');

    expectSuccessfulWatch(result);
    expectManifestEntry(result, 0, 'InitialClient.js');
    expectNoManifestEntry(result, 0, 'AddedClient.js');
    expectManifestEntry(result, 1, 'InitialClient.js');
    expectManifestEntry(result, 1, 'AddedClient.js');
  });

  it('drops removed client references on the next rebuild', () => {
    const result = runWatchRefresh(bundler, 'remove');

    expectSuccessfulWatch(result);
    expectManifestEntry(result, 0, 'InitialClient.js');
    expectManifestEntry(result, 0, 'RemovedClient.js');
    expectManifestEntry(result, 1, 'InitialClient.js');
    expectNoManifestEntry(result, 1, 'RemovedClient.js');
  });
});
