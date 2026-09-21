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

interface FakeLoaderContext {
  resourcePath: string;
  addDependency: jest.Mock;
}

const createLoaderContext = (resourcePath: string): FakeLoaderContext => ({
  resourcePath,
  addDependency: jest.fn(),
});

/** Build a handler for `resourcePath` the way the loader does. */
const handlerFor = (resourcePath: string, source: string) => {
  const context = createLoaderContext(resourcePath);
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
  it('serves the sibling .map file named by a relative sourceMappingURL', async () => {
    const resourcePath = fixturePath('server-actions-with-map.js');
    const { handler, context } = handlerFor(resourcePath, readFixture('server-actions-with-map.js'));

    const result = await handler('server-actions-with-map.js.map', JSON_REQUEST);

    expect(result.format).toBe('json');
    expect(result.source).toBe(readFixture('server-actions-with-map.js.map'));
    expect(JSON.parse(result.source as string).sources).toEqual([
      'server-actions-with-map.source.ts',
    ]);
    // The map participates in watch mode: a change must trigger a rebuild.
    expect(context.addDependency).toHaveBeenCalledWith(
      fixturePath('server-actions-with-map.js.map')
    );
  });

  it('serves the map through a file: URL sourceMappingURL', async () => {
    const resourcePath = fixturePath('server-actions-with-map.js');
    const { handler, context } = handlerFor(resourcePath, readFixture('server-actions-with-map.js'));
    const mapUrl = pathToFileURL(fixturePath('server-actions-with-map.js.map')).href;

    const result = await handler(mapUrl, JSON_REQUEST);

    expect(result.source).toBe(readFixture('server-actions-with-map.js.map'));
    expect(context.addDependency).toHaveBeenCalledWith(
      fixturePath('server-actions-with-map.js.map')
    );
  });

  it('falls back to a valid empty map when the pointed-at .map does not exist', async () => {
    // react-on-rails-pro publishes sourceMappingURL pointers but zero .map
    // files, so the missing-map case is the published norm, not an edge.
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

  it('never answers a sourcemap request with the module’s JavaScript source (the #5079 bug)', async () => {
    const source = readFixture('server-actions-dangling-map.js');
    const { handler } = handlerFor(fixturePath('server-actions-dangling-map.js'), source);

    const result = await handler('server-actions-dangling-map.js.map', JSON_REQUEST);

    expect(result.source).not.toBe(source);
    // The stock loader JSON.parses whatever comes back; this must not throw.
    expect(() => JSON.parse(result.source as string)).not.toThrow();
  });

  it('decodes a base64 data: URI inline map instead of treating it as a path', async () => {
    const resourcePath = fixturePath('server-actions-with-map.js');
    const { handler, context } = handlerFor(resourcePath, readFixture('server-actions-with-map.js'));
    const inlineMap = '{"version":3,"sources":["inline.ts"],"names":[],"mappings":"AAAA"}';
    const dataUri = `data:application/json;charset=utf-8;base64,${Buffer.from(
      inlineMap,
      'utf8'
    ).toString('base64')}`;

    const result = await handler(dataUri, JSON_REQUEST);

    expect(result.format).toBe('json');
    expect(result.source).toBe(inlineMap);
    expect(context.addDependency).not.toHaveBeenCalled();
  });

  it('decodes a URL-encoded (non-base64) data: URI inline map', async () => {
    const resourcePath = fixturePath('server-actions-with-map.js');
    const { handler } = handlerFor(resourcePath, readFixture('server-actions-with-map.js'));
    const inlineMap = '{"version":3,"sources":[],"names":[],"mappings":""}';

    const result = await handler(
      `data:application/json,${encodeURIComponent(inlineMap)}`,
      JSON_REQUEST
    );

    expect(result.source).toBe(inlineMap);
  });

  it('falls back to the empty map for a data: URI that does not decode to JSON', async () => {
    const resourcePath = fixturePath('server-actions-with-map.js');
    const { handler } = handlerFor(resourcePath, readFixture('server-actions-with-map.js'));

    const result = await handler('data:application/json;base64,%%%not-base64-json', JSON_REQUEST);

    expect(JSON.parse(result.source as string)).toEqual(EMPTY_SOURCE_MAP);
  });

  it('falls back to the empty map for a remote (http) sourceMappingURL', async () => {
    const resourcePath = fixturePath('server-actions-with-map.js');
    const { handler, context } = handlerFor(resourcePath, readFixture('server-actions-with-map.js'));

    const result = await handler('https://example.com/app.js.map', JSON_REQUEST);

    expect(JSON.parse(result.source as string)).toEqual(EMPTY_SOURCE_MAP);
    expect(context.addDependency).not.toHaveBeenCalled();
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
