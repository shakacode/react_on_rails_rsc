import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_CLIENT_REFERENCES_EXCLUDE,
  DEFAULT_CLIENT_REFERENCES_INCLUDE,
} from '../../src/clientReferences';
import {
  RSCRspackPlugin,
  type ClientReferenceSearchPath,
} from '../../src/react-server-dom-rspack/plugin';

type WalkDirCapable = {
  walkDir(
    dir: string,
    walkRoot: string,
    ref: ClientReferenceSearchPath,
    out: Set<string>,
  ): void;
};

describe('RSCRspackPlugin filesystem discovery', () => {
  it('prunes excluded directories instead of only filtering files after traversal', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ror-rspack-walk-'));
    const appDir = path.join(root, 'app/javascript');
    const ignoredDir = path.join(root, 'node_modules/ignored-package');
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(ignoredDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'AppClient.js'), "'use client';\n");
    fs.writeFileSync(path.join(ignoredDir, 'PackageClient.js'), "'use client';\n");

    const readdirSpy = jest.spyOn(fs, 'readdirSync');

    try {
      const plugin = new RSCRspackPlugin({ isServer: false }) as unknown as WalkDirCapable;
      const out = new Set<string>();
      plugin.walkDir(
        root,
        root,
        {
          directory: '.',
          recursive: true,
          include: DEFAULT_CLIENT_REFERENCES_INCLUDE,
          exclude: DEFAULT_CLIENT_REFERENCES_EXCLUDE,
        },
        out,
      );

      const discoveredPaths = [...out];
      expect(discoveredPaths.some((p) => p.endsWith('/app/javascript/AppClient.js'))).toBe(true);
      expect(discoveredPaths.some((p) => p.includes('/node_modules/'))).toBe(false);

      const visitedDirectories = readdirSpy.mock.calls.map(([visited]) =>
        path.normalize(String(visited)),
      );
      expect(visitedDirectories).not.toContain(path.join(root, 'node_modules'));
      expect(visitedDirectories).not.toContain(ignoredDir);
    } finally {
      readdirSpy.mockRestore();
      fs.rmSync(root, { force: true, recursive: true });
    }
  });
});
