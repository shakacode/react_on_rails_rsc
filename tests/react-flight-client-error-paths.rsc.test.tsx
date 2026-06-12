import * as React from 'react';
import { PassThrough, Readable } from 'node:stream';
import { createFromNodeStream } from '../src/react-server-dom-webpack/client.node';
import { renderToPipeableStream } from '../src/server.node';
import type { BundleManifest } from '../src/types';

const { registerClientReference } = require('../src/react-server-dom-webpack/server.node') as {
  registerClientReference: (
    proxyImplementation: () => never,
    id: string,
    exportName: string,
  ) => unknown;
};

const CLIENT_MODULE_URL = 'file:///app/ErrorPath.client.js';
const CLIENT_MODULE_ID = './ErrorPath.client.js';

const clientManifest: BundleManifest = {
  filePathToModuleMetadata: {
    [CLIENT_MODULE_URL]: {
      id: CLIENT_MODULE_ID,
      chunks: ['client-error-path', 'client-error-path.js'],
      name: '*',
    },
  },
  moduleLoading: { prefix: '', crossOrigin: null },
};

const emptyClientManifest: BundleManifest = {
  filePathToModuleMetadata: {},
  moduleLoading: { prefix: '', crossOrigin: null },
};

const emptySSRManifest = {
  moduleLoading: { prefix: '', crossOrigin: null },
  moduleMap: {},
};

const webpackGlobal = globalThis as unknown as {
  __webpack_chunk_load__?: (id: string) => Promise<void>;
  __webpack_require__?: (id: string) => unknown;
};

let originalWebpackChunkLoad: typeof webpackGlobal.__webpack_chunk_load__;
let originalWebpackRequire: typeof webpackGlobal.__webpack_require__;

const ClientWidget = registerClientReference(
  function ClientWidget() {
    throw new Error('client reference should not execute on the server');
  },
  CLIENT_MODULE_URL,
  'Widget',
) as React.ComponentType<{ label: string }>;

const renderFlightPayload = async (model: unknown): Promise<Buffer> => {
  const flightStream = renderToPipeableStream(model, clientManifest);
  const readable = new PassThrough();
  const chunks: Buffer[] = [];

  readable.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  const done = new Promise<void>((resolve, reject) => {
    readable.on('end', resolve);
    readable.on('error', reject);
  });

  flightStream.pipe(readable);
  await done;

  return Buffer.concat(chunks);
};

const decodeElementType = async (
  payload: Buffer,
  ssrManifest: unknown,
): Promise<unknown> => {
  const decoded = (await createFromNodeStream(
    Readable.from([payload]),
    ssrManifest,
  )) as React.ReactElement;

  expect(React.isValidElement(decoded)).toBe(true);
  // This intentionally probes the React 19.x lazy payload shape so the missing
  // client-reference error is asserted before React attempts to resolve it.
  const type = decoded.type as { $$typeof?: symbol; _payload?: Promise<unknown> };
  expect(type.$$typeof).toBe(Symbol.for('react.lazy'));
  if (!('_payload' in type)) {
    throw new Error('React lazy shape changed; update decodeElementType to match the new internals.');
  }
  // Awaiting the private lazy payload triggers the chunk-load rejection path.
  expect(type._payload).toBeDefined();
  if (!(type._payload instanceof Promise)) {
    throw new Error('React lazy _payload is no longer a Promise; update decodeElementType.');
  }

  return type._payload;
};

describe('React Flight client error paths', () => {
  beforeEach(() => {
    originalWebpackChunkLoad = webpackGlobal.__webpack_chunk_load__;
    originalWebpackRequire = webpackGlobal.__webpack_require__;
    webpackGlobal.__webpack_chunk_load__ = () => Promise.resolve();
    webpackGlobal.__webpack_require__ = (id: string) => {
      if (id === CLIENT_MODULE_ID) {
        return { Widget: () => React.createElement('span', null, 'loaded') };
      }
      throw new Error(`Unexpected module id: ${id}`);
    };
  });

  afterEach(() => {
    if (originalWebpackChunkLoad !== undefined) {
      webpackGlobal.__webpack_chunk_load__ = originalWebpackChunkLoad;
    } else {
      Reflect.deleteProperty(webpackGlobal, '__webpack_chunk_load__');
    }

    if (originalWebpackRequire !== undefined) {
      webpackGlobal.__webpack_require__ = originalWebpackRequire;
    } else {
      Reflect.deleteProperty(webpackGlobal, '__webpack_require__');
    }
  });

  it('rejects a missing client reference with the missing module id', async () => {
    const payload = await renderFlightPayload(
      React.createElement(ClientWidget, { label: 'missing manifest entry' }),
    );

    await expect(decodeElementType(payload, emptySSRManifest)).rejects.toThrow(
      `Could not find the module "${CLIENT_MODULE_ID}" in the React Server Consumer Manifest.`,
    );
  });

  it('propagates chunk load failures through the lazy client reference', async () => {
    const failingChunkId = 'chunk-load-failure-64';
    const chunkError = new Error(`Chunk load failed for ${failingChunkId}`);
    const chunkLoader = jest.fn(() => Promise.reject(chunkError));
    webpackGlobal.__webpack_chunk_load__ = chunkLoader;

    const payload = await renderFlightPayload(
      React.createElement(ClientWidget, { label: 'chunk failure' }),
    );
    const ssrManifest = {
      moduleLoading: { prefix: '', crossOrigin: null },
      moduleMap: {
        [CLIENT_MODULE_ID]: {
          Widget: {
            id: CLIENT_MODULE_ID,
            chunks: [failingChunkId, `${failingChunkId}.js`],
            name: 'Widget',
          },
        },
      },
    };

    await expect(decodeElementType(payload, ssrManifest)).rejects.toThrow(chunkError.message);
    expect(chunkLoader).toHaveBeenCalledWith(failingChunkId);
  });

  it('surfaces the server abort reason to the node Flight client', async () => {
    const cleanup = new AbortController();
    const NeverResolves = async () => {
      await new Promise<void>((resolve) => {
        cleanup.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return React.createElement('span', null, 'unreachable');
    };
    const serverErrors: unknown[] = [];
    const flightStream = renderToPipeableStream(
      React.createElement(NeverResolves),
      emptyClientManifest,
      {
        onError: (error) => {
          serverErrors.push(error);
        },
      },
    );
    const readable = new PassThrough();
    const decoded = createFromNodeStream(readable, emptySSRManifest);

    try {
      flightStream.pipe(readable);
      flightStream.abort(new Error('server render aborted for issue 64'));
      cleanup.abort();

      await expect(decoded).rejects.toThrow('server render aborted for issue 64');
      expect(serverErrors).toHaveLength(1);
      expect(serverErrors[0]).toEqual(
        expect.objectContaining({
          message: 'server render aborted for issue 64',
        }),
      );
    } finally {
      cleanup.abort();
    }
  });
});
