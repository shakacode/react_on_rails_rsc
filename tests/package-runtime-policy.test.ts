import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..');

const readJson = <T>(relativePath: string): T =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;

type PackageJson = {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
};

const collectExportTargets = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [value];
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectExportTargets);
  }

  return Object.values(value).flatMap(collectExportTargets);
};

describe('19.2 runtime release policy', () => {
  it('stamps the package and changelog for the 19.2.0 rc line', () => {
    const pkg = readJson<PackageJson>('package.json');
    const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');

    expect(pkg.version).toBe('19.2.0-rc.2');
    expect(changelog).toMatch(/^## \[19\.2\.0-rc\.2\] - \d{4}-\d{2}-\d{2}$/m);
  });

  it('depends on the stock React 19.2 Flight runtime and raises React peers to the runtime floor', () => {
    const pkg = readJson<PackageJson>('package.json');

    expect(pkg.dependencies?.['react-server-dom-webpack']).toBe('~19.2.7');
    expect(pkg.peerDependencies?.react).toBe('^19.2.7');
    expect(pkg.peerDependencies?.['react-dom']).toBe('^19.2.7');
  });

  it('does not publish export targets from the legacy vendored runtime tree', () => {
    const pkg = readJson<PackageJson>('package.json');
    const exportTargets = Object.values(pkg.exports ?? {}).flatMap(collectExportTargets);

    expect(exportTargets.filter((target) => target.includes('dist/react-server-dom-webpack/'))).toEqual(
      []
    );
  });

  it('publishes self-contained raw Flight server types instead of re-exporting untyped stock modules', () => {
    const pkg = readJson<PackageJson>('package.json');
    const serverExport = pkg.exports?.['./server'] as {
      default?: { types?: string };
      'react-server'?: Record<string, unknown>;
    };

    expect(serverExport.default).toEqual(
      expect.objectContaining({ types: './dist/flight-server.d.ts' })
    );
    expect(serverExport['react-server']).toEqual(
      expect.objectContaining({
        browser: expect.objectContaining({ types: './dist/flight-server.browser.d.ts' }),
        'edge-light': expect.objectContaining({ types: './dist/flight-server.edge.d.ts' }),
        node: expect.objectContaining({
          default: './dist/flight-server.node.unbundled.js',
          types: './dist/flight-server.node.unbundled.d.ts',
          webpack: expect.objectContaining({
            default: './dist/flight-server.node.js',
            types: './dist/flight-server.node.d.ts',
          }),
        }),
        workerd: expect.objectContaining({ types: './dist/flight-server.edge.d.ts' }),
      })
    );

    for (const fileName of [
      'src/flight-server.ts',
      'src/flight-server.browser.ts',
      'src/flight-server.edge.ts',
      'src/flight-server.node.ts',
      'src/flight-server.node.unbundled.ts',
    ]) {
      const source = fs.readFileSync(path.join(repoRoot, fileName), 'utf8');

      expect(source).toContain('registerClientReference');
      expect(source).not.toMatch(/export\s+\*\s+from\s+['"]react-server-dom-webpack\/server/);
    }

    const plainNodeServerSource = fs.readFileSync(
      path.join(repoRoot, 'src/flight-server.node.unbundled.ts'),
      'utf8'
    );
    expect(plainNodeServerSource).toContain('React 19.2 removed the public unbundled');
    expect(plainNodeServerSource).toContain('unsupportedPlainNodeDecode');

    const runtimeTypes = fs.readFileSync(
      path.join(repoRoot, 'types/react-server-dom-webpack/index.d.ts'),
      'utf8'
    );
    expect(runtimeTypes).not.toMatch(
      /declare module 'react-server-dom-webpack\/server\.(browser|edge)' \{\s*export \* from 'react-server-dom-webpack\/server\.node';\s*\}/
    );
  });
});
