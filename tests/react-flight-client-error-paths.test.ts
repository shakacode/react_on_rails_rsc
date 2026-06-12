import { PassThrough, Readable } from 'node:stream';
import { createFromNodeStream } from '../src/react-server-dom-webpack/client.node';

const { createFromNodeStream: createFromUnbundledNodeStream } = require('../src/react-server-dom-webpack/client.node.unbundled') as {
  createFromNodeStream: typeof createFromNodeStream;
};

const emptySSRManifest = {
  moduleLoading: { prefix: '', crossOrigin: null },
  moduleMap: {},
};

type BrowserClient = {
  createFromReadableStream: <T>(stream: ReadableStream<Uint8Array>) => Promise<T>;
};

const encoder = new TextEncoder();

const nodeFlight = (payload: string) =>
  createFromNodeStream(Readable.from([Buffer.from(payload)]), emptySSRManifest);

const unbundledNodeFlight = (payload: string) =>
  createFromUnbundledNodeStream(Readable.from([Buffer.from(payload)]), emptySSRManifest);

const readableFlight = (payload: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });

const loadBrowserClient = (): { client: BrowserClient; restore: () => void } => {
  const webpackGlobal = globalThis as typeof globalThis & {
    __webpack_require__?: ((id: string) => never) & { u?: (chunkId: string) => string };
  };
  const originalWebpackRequire = webpackGlobal.__webpack_require__;
  const fakeWebpackRequire = Object.assign(
    (id: string) => {
      throw new Error(`Unexpected browser module require: ${id}`);
    },
    { u: (chunkId: string) => `${chunkId}.js` },
  );

  webpackGlobal.__webpack_require__ = fakeWebpackRequire;

  let client: BrowserClient | undefined;
  jest.isolateModules(() => {
    client = require('../src/react-server-dom-webpack/client.browser') as BrowserClient;
  });
  // jest.isolateModules is synchronous; keep an explicit failure if that contract changes.
  if (!client) {
    throw new Error('jest.isolateModules did not populate client synchronously');
  }

  return {
    client,
    restore: () => {
      if (originalWebpackRequire) {
        webpackGlobal.__webpack_require__ = originalWebpackRequire;
      } else {
        Reflect.deleteProperty(webpackGlobal, '__webpack_require__');
      }
    },
  };
};

describe('React Flight client stream error paths', () => {
  it('rejects malformed node Flight payloads with the parse reason', async () => {
    await expect(nodeFlight('0:{not-json}\n')).rejects.toThrow(
      /JSON|property name|Unexpected token/,
    );
  });

  it('keeps the parse reason when a node stream errors after malformed data', async () => {
    const stream = new PassThrough();
    const decoded = createFromNodeStream(stream, emptySSRManifest);

    stream.write(Buffer.from('0:{not-json}\n'));
    stream.destroy(new Error('should not replace the parse reason'));

    await expect(decoded).rejects.toThrow(/JSON|property name|Unexpected token/);
  });

  it('keeps the parse reason when an unbundled node stream errors after malformed data', async () => {
    const stream = new PassThrough();
    const decoded = createFromUnbundledNodeStream(stream, emptySSRManifest);

    stream.write(Buffer.from('0:{not-json}\n'));
    stream.destroy(new Error('should not replace the parse reason'));

    await expect(decoded).rejects.toThrow(/JSON|property name|Unexpected token/);
  });

  it('rejects malformed unbundled node Flight payloads with the parse reason', async () => {
    await expect(unbundledNodeFlight('0:{not-json}\n')).rejects.toThrow(
      /JSON|property name|Unexpected token/,
    );
  });

  it('rejects malformed readable-stream Flight payloads with the parse reason', async () => {
    const { client, restore } = loadBrowserClient();
    try {
      await expect(
        client.createFromReadableStream(readableFlight('0:{not-json}\n')),
      ).rejects.toThrow(/JSON|property name|Unexpected token/);
    } finally {
      restore();
    }
  });

  it('rejects truncated node Flight payloads with the connection-close reason', async () => {
    await expect(nodeFlight('0:"unterminated')).rejects.toThrow('Connection closed.');
  });

  it('rejects truncated unbundled node Flight payloads with the connection-close reason', async () => {
    await expect(unbundledNodeFlight('0:"unterminated')).rejects.toThrow('Connection closed.');
  });

  it('rejects truncated readable-stream Flight payloads with the connection-close reason', async () => {
    const { client, restore } = loadBrowserClient();
    try {
      await expect(client.createFromReadableStream(readableFlight('0:"unterminated'))).rejects.toThrow(
        'Connection closed.',
      );
    } finally {
      restore();
    }
  });

  it('propagates node stream abort reasons instead of hanging', async () => {
    const stream = new PassThrough();
    const decoded = createFromNodeStream(stream, emptySSRManifest);

    stream.destroy(new Error('upstream Flight stream aborted for issue 64'));

    await expect(decoded).rejects.toThrow('upstream Flight stream aborted for issue 64');
  });

  it('propagates unbundled node stream abort reasons instead of hanging', async () => {
    const stream = new PassThrough();
    const decoded = createFromUnbundledNodeStream(stream, emptySSRManifest);

    stream.destroy(new Error('unbundled Flight stream aborted for issue 64'));

    await expect(decoded).rejects.toThrow('unbundled Flight stream aborted for issue 64');
  });

  it('propagates readable-stream abort reasons instead of hanging', async () => {
    const { client, restore } = loadBrowserClient();
    try {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error('browser Flight stream aborted for issue 64'));
        },
      });

      await expect(client.createFromReadableStream(stream)).rejects.toThrow(
        'browser Flight stream aborted for issue 64',
      );
    } finally {
      restore();
    }
  });
});
