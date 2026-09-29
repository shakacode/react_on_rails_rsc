/**
 * Regression coverage for react_on_rails#5079.
 *
 * `RSCWebpackLoader` hands the stock `react-server-dom-webpack/node-loader`'s
 * `load(url, context, defaultLoad)` a callback that React calls back for
 * everything it needs — not just the module being transformed. The old stub
 * took no parameters and answered every request with the current module's
 * JavaScript source. When a directive-carrying file ended with a
 * `//# sourceMappingURL=` comment (the shape npm packages publish — e.g.
 * react-on-rails-pro's lib/RSCRoute.js), React asked the callback for that
 * sourcemap as JSON and `JSON.parse`d the JavaScript it got back, failing the
 * build with `SyntaxError: Unexpected token '/' ... is not valid JSON`.
 *
 * These tests drive `createLoadRequestHandler` directly through the three
 * request shapes (own module, sourcemap-as-json, other module) so they run
 * in-process. The full stock `load()` path needs a dynamic ESM `import()`,
 * which Jest's VM sandbox does not support, so the end-to-end "use server"
 * builds live out-of-process in tests/rspack-compat/webpack-loader.rspack.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { LoaderContext } from 'webpack';
import RSCWebpackLoader, { createLoadRequestHandler } from '../src/WebpackLoader';

const FIXTURES = path.join(__dirname, 'fixtures', 'load-requests');

const fixturePath = (name: string): string => path.join(FIXTURES, name);
const readFixture = (name: string): string => fs.readFileSync(fixturePath(name), 'utf8');

const EMPTY_SOURCE_MAP = { version: 3, sources: [], names: [], mappings: '' };

interface FakeInputFs {
  readFile: jest.Mock;
}

interface FakeLoaderContext {
  resourcePath: string;
  addDependency: jest.Mock;
  fs?: FakeInputFs;
}

const createLoaderContext = (
  resourcePath: string,
  overrides: Partial<FakeLoaderContext> = {}
): FakeLoaderContext => ({
  resourcePath,
  addDependency: jest.fn(),
  ...overrides,
});

/** A bundler-style callback input filesystem serving virtual file contents. */
const createInputFs = (files: Record<string, string>): FakeInputFs => ({
  readFile: jest.fn((file: string, callback: (error: unknown, data?: unknown) => void) => {
    const content = files[file];
    if (content !== undefined) {
      callback(null, Buffer.from(content, 'utf8'));
    } else {
      callback(new Error(`virtual fs: no such file ${file}`));
    }
  }),
});

/** Build a handler for `resourcePath` the way the loader does. */
const handlerFor = (
  resourcePath: string,
  source: string,
  overrides: Partial<FakeLoaderContext> = {}
) => {
  const context = createLoaderContext(resourcePath, overrides);
  const fileUrl = pathToFileURL(resourcePath).href;
  return {
    context,
    fileUrl,
    handler: createLoadRequestHandler(context, fileUrl, source),
  };
};

const JSON_REQUEST = { format: 'json' };
const MODULE_REQUEST = { format: 'module' };

describe('createLoadRequestHandler: the module’s own URL', () => {
  it('serves the source webpack provided, unchanged', async () => {
    const source = readFixture('server-actions-with-map.js');
    const { handler, fileUrl } = handlerFor(fixturePath('server-actions-with-map.js'), source);

    await expect(handler(fileUrl, null)).resolves.toEqual({ format: 'module', source });
  });

  it('treats a call without arguments as the module’s own request', async () => {
    // The stock loader's published type declares a parameterless nextLoad; a
    // bare call must keep returning the module source, like the old stub did.
    const source = readFixture('server-actions-with-map.js');
    const { handler } = handlerFor(fixturePath('server-actions-with-map.js'), source);

    await expect(handler()).resolves.toEqual({ format: 'module', source });
  });
});

describe('createLoadRequestHandler: sourcemap (json) requests', () => {
  // Every sourcemap request is answered with the valid empty map: the loader
  // deliberately does not read real .map files, inline data: maps, or file:
  // map URLs (passthrough is tracked in issue #239). What matters for
  // react_on_rails#5079 is that a json request is NEVER answered with
  // JavaScript, so the stock loader's JSON.parse always succeeds.
  it('serves the valid empty map for a dangling sourceMappingURL', async () => {
    const resourcePath = fixturePath('server-actions-dangling-map.js');
    const { handler, context } = handlerFor(
      resourcePath,
      readFixture('server-actions-dangling-map.js')
    );

    const result = await handler('server-actions-dangling-map.js.map', JSON_REQUEST);

    expect(result.format).toBe('json');
    expect(JSON.parse(result.source as string)).toEqual(EMPTY_SOURCE_MAP);
    expect(context.addDependency).not.toHaveBeenCalled();
  });

  it('serves the empty map even when the pointed-at sibling .map exists on disk', async () => {
    const resourcePath = fixturePath('server-actions-with-map.js');
    const { handler } = handlerFor(resourcePath, readFixture('server-actions-with-map.js'));

    const result = await handler('server-actions-with-map.js.map', JSON_REQUEST);

    expect(JSON.parse(result.source as string)).toEqual(EMPTY_SOURCE_MAP);
    expect(result.source).not.toBe(readFixture('server-actions-with-map.js.map'));
  });

  it('answers a json request for the module\u2019s own URL with a map, never module source', async () => {
    // The json check runs before the own-module check: a sourceMappingURL that
    // resolves to the module's own URL must not be served as JavaScript.
    const resourcePath = fixturePath('server-actions-with-map.js');
    const source = readFixture('server-actions-with-map.js');
    const { handler, fileUrl } = handlerFor(resourcePath, source);

    const result = await handler(fileUrl, JSON_REQUEST);

    expect(result.format).toBe('json');
    expect(result.source).not.toBe(source);
    expect(JSON.parse(result.source as string)).toEqual(EMPTY_SOURCE_MAP);
  });

  it('never answers a sourcemap request with the module\u2019s JavaScript source (the #5079 bug)', async () => {
    const source = readFixture('server-actions-dangling-map.js');
    const { handler } = handlerFor(fixturePath('server-actions-dangling-map.js'), source);

    const result = await handler('server-actions-dangling-map.js.map', JSON_REQUEST);

    expect(result.source).not.toBe(source);
    // The stock loader JSON.parses whatever comes back; this must not throw.
    expect(() => JSON.parse(result.source as string)).not.toThrow();
  });
});

describe('createLoadRequestHandler: bundler input filesystem', () => {
  it('reads other module URLs through loaderContext.fs when provided', async () => {
    const resourcePath = fixturePath('server-actions-with-map.js');
    const virtualModulePath = fixturePath('virtual-only-module.js');
    const virtualModule = 'export const virtualOnly = true;\n';
    const inputFs = createInputFs({ [virtualModulePath]: virtualModule });
    const { handler, context } = handlerFor(
      resourcePath,
      readFixture('server-actions-with-map.js'),
      { fs: inputFs }
    );

    const result = await handler(pathToFileURL(virtualModulePath).href, MODULE_REQUEST);

    expect(result).toEqual({ format: 'module', source: virtualModule });
    expect(inputFs.readFile).toHaveBeenCalledWith(virtualModulePath, expect.any(Function));
    expect(context.addDependency).toHaveBeenCalledWith(virtualModulePath);
  });
});

describe('createLoadRequestHandler: other module URLs', () => {
  it('reads the requested module from disk (export * resolution)', async () => {
    const resourcePath = fixturePath('server-actions-with-map.js');
    const { handler, context } = handlerFor(resourcePath, readFixture('server-actions-with-map.js'));
    const targetPath = fixturePath('reexport-target.js');

    const result = await handler(pathToFileURL(targetPath).href, MODULE_REQUEST);

    expect(result.format).toBe('module');
    expect(result.source).toBe(readFixture('reexport-target.js'));
    expect(context.addDependency).toHaveBeenCalledWith(targetPath);
  });
});

describe('RSCWebpackLoader on the published npm file shape (react_on_rails#5079)', () => {
  it('transforms a published "use client" file with a dangling sourceMappingURL into client-reference stubs', async () => {
    // license header + "use client" + trailing sourceMappingURL pointer with
    // no .map on disk — the exact shape of react-on-rails-pro/lib/RSCRoute.js.
    const name = 'published-client-component.js';
    const resourcePath = fixturePath(name);
    const context = createLoaderContext(resourcePath);

    const output = await (
      RSCWebpackLoader as unknown as (this: unknown, content: string) => Promise<string>
    ).call(context as unknown as LoaderContext<unknown>, readFixture(name));

    expect(output).toContain('registerClientReference');
    expect(output).toContain(JSON.stringify(pathToFileURL(resourcePath).href));
    expect(output).toContain('"useCurrentRSCRoute"');
    expect(output).toContain('"default"');
    // The component body must not survive into the server bundle.
    expect(output).not.toContain('jsx-runtime');
  });
});
