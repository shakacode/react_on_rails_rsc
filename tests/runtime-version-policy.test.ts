import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

// Exercise the verifier that the artifact workflow actually runs, without network access.
const releaseScript = fs.readFileSync(path.join(__dirname, '../scripts/verify-release.sh'), 'utf8');
const verifierSource = releaseScript.split('cat > "$TMP_DIR/verify-runtime-version.cjs" <<\'NODE\'\n')[1]
  ?.split('\nNODE\n')[0];
if (!verifierSource) throw new Error('Cannot find the artifact runtime verifier');
const verifier = verifierSource;

function verifyRuntime(range: string, version = '19.3.1', peerVersion = version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsc-runtime-policy-'));
  const runtime = path.join(root, 'node_modules/react-server-dom-webpack');
  try {
    fs.mkdirSync(path.join(runtime, 'cjs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'verify.cjs'), verifier);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      dependencies: { 'react-server-dom-webpack': range },
      peerDependencies: { react: '^19.3.0', 'react-dom': '^19.3.0' },
    }));
    fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({
      version,
      peerDependencies: { react: `^${peerVersion}`, 'react-dom': `^${peerVersion}` },
    }));
    fs.writeFileSync(path.join(runtime, 'cjs/react-server-dom-webpack-client.browser.development.js'),
      `version: "${version}", reconcilerVersion: "${version}"`);
    return spawnSync(process.execPath, [path.join(root, 'verify.cjs'), root], { encoding: 'utf8' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

it('accepts a packed consumer resolving a newer Flight patch within the declared tilde range', () => {
  const result = verifyRuntime('~19.3.0');
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

it('accepts the declared minimum patch', () => {
  expect(verifyRuntime('~19.3.1').status).toBe(0);
});

it.each([
  ['~19.3.0', '19.4.0'],
  ['~19.3.0', '20.3.0'],
  ['~19.3.0', '19.2.1'],
  ['~19.3.2', '19.3.1'],
  ['^19.3.0', '19.3.1'],
  ['19.3.1', '19.3.1'],
  ['~19.3.0', '19.3.1-rc.1'],
])('rejects runtime %s resolving to %s outside the supported tilde policy', (range, version) => {
  const result = verifyRuntime(range, version);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/root dependencies.react-server-dom-webpack|runtime version/);
});

it('still rejects root peers that exclude the resolved runtime', () => {
  const result = verifyRuntime('~19.2.0', '19.2.1');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('root peerDependencies.react ^19.3.0 does not include');
});

it('still requires runtime peers to match the resolved runtime patch', () => {
  const result = verifyRuntime('~19.3.0', '19.3.1', '19.3.0');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('runtime peerDependencies.react expected ^19.3.1, got ^19.3.0');
});
