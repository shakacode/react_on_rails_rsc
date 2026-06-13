import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { RSCWebpackPlugin: ReactFlightWebpackPlugin } = require('../src/webpack/RSCWebpackPlugin') as {
  RSCWebpackPlugin: {
    __internal_isReactOnRailsRSCRuntimeResource(resource: string | undefined, isServer: boolean): boolean;
  };
};

const tempRoots: string[] = [];

const createDoppelgangerRuntime = ({
  packageName = 'react-on-rails-rsc',
  runtimeFile = 'client.browser.js',
  runtimeDirectory = 'react-server-dom-webpack',
}: {
  packageName?: string;
  runtimeFile?: string;
  runtimeDirectory?: string;
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ror-rsc-doppelganger-'));
  tempRoots.push(root);

  const packageRoot = path.join(
    root,
    'node_modules/.pnpm/react-on-rails-rsc@19.0.4_webpack@5.103.0/node_modules/react-on-rails-rsc',
  );
  const runtimeDir = path.join(packageRoot, 'dist', runtimeDirectory);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: packageName }));

  const runtimePath = path.join(runtimeDir, runtimeFile);
  fs.writeFileSync(runtimePath, '');

  return runtimePath;
};

afterEach(() => {
  while (tempRoots.length > 0) {
    fs.rmSync(tempRoots.pop()!, { force: true, recursive: true });
  }
});

describe('ReactFlightWebpackPlugin runtime detection', () => {
  it('keeps recognizing the plugin package runtime by exact path', () => {
    const runtimePath = path.resolve(__dirname, '../src/react-server-dom-webpack/client.browser.js');

    expect(
      ReactFlightWebpackPlugin.__internal_isReactOnRailsRSCRuntimeResource(runtimePath, false),
    ).toBe(true);
  });

  it('recognizes a client runtime from a separate react-on-rails-rsc package instance', () => {
    const runtimePath = createDoppelgangerRuntime({});

    expect(
      ReactFlightWebpackPlugin.__internal_isReactOnRailsRSCRuntimeResource(runtimePath, false),
    ).toBe(true);
  });

  it('recognizes a server runtime from a separate react-on-rails-rsc package instance', () => {
    const runtimePath = createDoppelgangerRuntime({ runtimeFile: 'client.node.js' });

    expect(
      ReactFlightWebpackPlugin.__internal_isReactOnRailsRSCRuntimeResource(runtimePath, true),
    ).toBe(true);
  });

  it('rejects runtime-shaped paths from other packages', () => {
    const runtimePath = createDoppelgangerRuntime({ packageName: 'not-react-on-rails-rsc' });

    expect(
      ReactFlightWebpackPlugin.__internal_isReactOnRailsRSCRuntimeResource(runtimePath, false),
    ).toBe(false);
  });

  it('rejects the opposite runtime target', () => {
    const runtimePath = createDoppelgangerRuntime({ runtimeFile: 'client.node.js' });

    expect(
      ReactFlightWebpackPlugin.__internal_isReactOnRailsRSCRuntimeResource(runtimePath, false),
    ).toBe(false);
  });

  it('rejects runtime-like directory names that only end with the expected runtime directory', () => {
    const runtimePath = createDoppelgangerRuntime({
      runtimeDirectory: 'evil-react-server-dom-webpack',
    });

    expect(
      ReactFlightWebpackPlugin.__internal_isReactOnRailsRSCRuntimeResource(runtimePath, false),
    ).toBe(false);
  });

  it('continues walking when an intermediate package.json is malformed', () => {
    const runtimePath = createDoppelgangerRuntime({});
    fs.writeFileSync(path.join(path.dirname(runtimePath), 'package.json'), '{');

    expect(
      ReactFlightWebpackPlugin.__internal_isReactOnRailsRSCRuntimeResource(runtimePath, false),
    ).toBe(true);
  });
});
