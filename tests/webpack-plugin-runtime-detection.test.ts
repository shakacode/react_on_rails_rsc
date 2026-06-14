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
  packageName = 'react-server-dom-webpack',
  runtimeFile = 'client.browser.js',
}: {
  packageName?: string;
  runtimeFile?: string;
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ror-rsc-doppelganger-'));
  tempRoots.push(root);

  const packageRoot = path.join(
    root,
    'node_modules/.pnpm/react-server-dom-webpack@19.2.7_webpack@5.103.0/node_modules/react-server-dom-webpack',
  );
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: packageName }));

  const runtimePath = path.join(packageRoot, runtimeFile);
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
    const runtimePath = require.resolve('react-server-dom-webpack/client.browser');

    expect(
      ReactFlightWebpackPlugin.__internal_isReactOnRailsRSCRuntimeResource(runtimePath, false),
    ).toBe(true);
  });

  it('recognizes a client runtime from a separate react-server-dom-webpack package instance', () => {
    const runtimePath = createDoppelgangerRuntime({});

    expect(
      ReactFlightWebpackPlugin.__internal_isReactOnRailsRSCRuntimeResource(runtimePath, false),
    ).toBe(true);
  });

  it('recognizes a server runtime from a separate react-server-dom-webpack package instance', () => {
    const runtimePath = createDoppelgangerRuntime({ runtimeFile: 'client.node.js' });

    expect(
      ReactFlightWebpackPlugin.__internal_isReactOnRailsRSCRuntimeResource(runtimePath, true),
    ).toBe(true);
  });

  it('rejects runtime-shaped paths from other packages', () => {
    const runtimePath = createDoppelgangerRuntime({ packageName: 'not-react-server-dom-webpack' });

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

  it('rejects malformed stock runtime package metadata', () => {
    const runtimePath = createDoppelgangerRuntime({});
    fs.writeFileSync(path.join(path.dirname(runtimePath), 'package.json'), '{');

    expect(
      ReactFlightWebpackPlugin.__internal_isReactOnRailsRSCRuntimeResource(runtimePath, false),
    ).toBe(false);
  });
});
