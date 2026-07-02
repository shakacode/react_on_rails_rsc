import * as path from 'path';
import { RSCWebpackPlugin } from '../src/webpack/RSCWebpackPlugin';

type WatchDependencies = {
  files: Set<string>;
  contexts: Set<string>;
  missing: Set<string>;
};

type ClientReferenceSearchPath = {
  directory: string;
  recursive?: boolean;
  include: RegExp;
  exclude?: RegExp;
};

type CollectCapable = {
  collectClientReferenceContextDependencies(
    fs: unknown,
    rootDirectory: string,
    clientReferencePath: ClientReferenceSearchPath,
    watchDependencies: WatchDependencies,
    callback: (err: Error | null) => void
  ): void;
};

const createWatchDependencies = (): WatchDependencies => ({
  files: new Set<string>(),
  contexts: new Set<string>(),
  missing: new Set<string>(),
});

const collectContextDependencies = async (
  fs: unknown,
  rootDirectory: string,
  clientReferencePath: ClientReferenceSearchPath
): Promise<WatchDependencies> => {
  const plugin = new RSCWebpackPlugin({ isServer: false }) as unknown as CollectCapable;
  const watchDependencies = createWatchDependencies();
  await new Promise<void>((resolve, reject) => {
    plugin.collectClientReferenceContextDependencies(
      fs,
      rootDirectory,
      clientReferencePath,
      watchDependencies,
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
  return watchDependencies;
};

const fsError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(code), { code });

describe('RSCWebpackPlugin context watch dependency collection', () => {
  it('tests excluded directories against relative client-reference paths', async () => {
    const root = path.resolve('/project');
    const appDir = path.join(root, 'app');
    const vendorDir = path.join(root, 'vendor');
    const visitedDirectories: string[] = [];

    const inputFs = {
      readdir: (directory: string, callback: (err: Error | null, files?: string[]) => void) => {
        visitedDirectories.push(directory);
        callback(null, directory === root ? ['app', 'vendor'] : []);
      },
      stat: (
        _filePath: string,
        callback: (err: Error | null, stats?: { isDirectory(): boolean }) => void
      ) => callback(null, { isDirectory: () => true }),
    };

    const watchDependencies = await collectContextDependencies(inputFs, root, {
      directory: '.',
      recursive: true,
      include: /\.js$/,
      exclude: /^\.\/vendor(?:\/|$)/,
    });

    expect(watchDependencies.contexts.has(root)).toBe(true);
    expect(watchDependencies.contexts.has(appDir)).toBe(true);
    expect(visitedDirectories).not.toContain(vendorDir);
  });

  it('records missing dependencies instead of failing on filesystem traversal errors', async () => {
    const root = path.resolve('/project');
    const blockedDir = path.join(root, 'blocked-dir');
    const brokenFile = path.join(root, 'broken-file.js');

    const inputFs = {
      readdir: (
        directory: string,
        callback: (err: NodeJS.ErrnoException | null, files?: string[]) => void
      ) => {
        if (directory === blockedDir) {
          callback(fsError('EACCES'));
          return;
        }
        callback(null, ['blocked-dir', 'broken-file.js']);
      },
      stat: (
        filePath: string,
        callback: (err: NodeJS.ErrnoException | null, stats?: { isDirectory(): boolean }) => void
      ) => {
        if (filePath === blockedDir) {
          callback(null, { isDirectory: () => true });
          return;
        }
        callback(fsError('ELOOP'));
      },
    };

    const watchDependencies = await collectContextDependencies(inputFs, root, {
      directory: '.',
      recursive: true,
      include: /\.js$/,
    });

    expect(watchDependencies.missing.has(blockedDir)).toBe(true);
    expect(watchDependencies.missing.has(brokenFile)).toBe(true);
  });

  it('records a missing dependency instead of failing on realpath errors', async () => {
    const root = path.resolve('/project');
    const inputFs = {
      readdir: jest.fn(),
      realpath: (_directory: string, callback: (err: NodeJS.ErrnoException | null) => void) => {
        callback(fsError('ELOOP'));
      },
      stat: jest.fn(),
    };

    const watchDependencies = await collectContextDependencies(inputFs, root, {
      directory: '.',
      recursive: true,
      include: /\.js$/,
    });

    expect(watchDependencies.missing.has(root)).toBe(true);
    expect(inputFs.readdir).not.toHaveBeenCalled();
  });
});
