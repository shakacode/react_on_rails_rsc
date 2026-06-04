import * as React from 'react';
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import { createFromNodeStream } from '../src/react-server-dom-webpack/client.node';
import { renderToPipeableStream } from '../src/server.node';

const { registerClientReference } = require('../src/react-server-dom-webpack/server.node') as {
  registerClientReference: (
    proxyImplementation: () => never,
    id: string,
    exportName: string,
  ) => unknown;
};

const CLIENT_REFERENCE_TAG = Symbol.for('react.client.reference');
const CLIENT_MODULE_URL = 'file:///app/Header.client.js';
const WRAPPER_MODULE_URL = 'file:///app/Wrapper.client.js';

const HeaderImplementation = () => null;
const WrapperImplementation = ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children);

const clientManifest = {
  filePathToModuleMetadata: {
    [CLIENT_MODULE_URL]: {
      id: './Header.client.js',
      chunks: ['client', 'client.js'],
      css: ['/assets/header.css'],
      name: '*',
    },
    [WRAPPER_MODULE_URL]: {
      id: './Wrapper.client.js',
      chunks: ['client', 'client.js'],
      css: [],
      name: '*',
    },
  },
  moduleLoading: { prefix: '', crossOrigin: null },
};

const ssrManifest = {
  moduleLoading: { prefix: '', crossOrigin: null },
  moduleMap: {
    './Header.client.js': {
      Header: {
        id: './Header.client.js',
        chunks: [],
        name: 'Header',
      },
    },
    './Wrapper.client.js': {
      Wrapper: {
        id: './Wrapper.client.js',
        chunks: [],
        name: 'Wrapper',
      },
    },
  },
};
const webpackGlobal = globalThis as unknown as {
  __webpack_chunk_load__?: (id: string) => Promise<void>;
  __webpack_require__?: (id: string) => unknown;
};
let originalWebpackChunkLoad: typeof webpackGlobal.__webpack_chunk_load__;
let originalWebpackRequire: typeof webpackGlobal.__webpack_require__;

const renderToText = async (model: unknown): Promise<string> => {
  const stream = renderToPipeableStream(model, clientManifest);

  const readable = new PassThrough();
  stream.pipe(readable);
  return text(readable);
};

describe('React Flight client-reference CSS metadata', () => {
  beforeEach(() => {
    originalWebpackChunkLoad = webpackGlobal.__webpack_chunk_load__;
    originalWebpackRequire = webpackGlobal.__webpack_require__;
    webpackGlobal.__webpack_require__ = (id: string) => {
      if (id === './Header.client.js') {
        return { Header: HeaderImplementation };
      }
      if (id === './Wrapper.client.js') {
        return { Wrapper: WrapperImplementation };
      }
      throw new Error(`Unexpected module id: ${id}`);
    };
    webpackGlobal.__webpack_chunk_load__ = () => Promise.resolve();
  });

  afterEach(() => {
    webpackGlobal.__webpack_require__ = originalWebpackRequire;
    webpackGlobal.__webpack_chunk_load__ = originalWebpackChunkLoad;
  });

  it('keeps rendered client references tagged and serializes their manifest CSS', async () => {
    const Header = registerClientReference(
      function Header() {
        throw new Error('client reference should not execute on the server');
      },
      CLIENT_MODULE_URL,
      'Header',
    ) as React.ComponentType<{ title: string }> & { $$typeof?: symbol };

    expect(Header.$$typeof).toBe(CLIENT_REFERENCE_TAG);

    const payload = await renderToText(React.createElement(Header, { title: 'Hello' }));

    expect(payload).toContain('/assets/header.css');
    expect(payload).toContain('rsc-css');
    expect(payload).toContain('Header');
  });

  it('keeps client elements nested in props as the same React value shape', async () => {
    const Header = registerClientReference(
      function Header() {
        throw new Error('client reference should not execute on the server');
      },
      CLIENT_MODULE_URL,
      'Header',
    ) as React.ComponentType<{ title: string }> & { $$typeof?: symbol };
    const Wrapper = registerClientReference(
      function Wrapper() {
        throw new Error('client reference should not execute on the server');
      },
      WRAPPER_MODULE_URL,
      'Wrapper',
    ) as React.ComponentType<React.PropsWithChildren>;

    const flightStream = renderToPipeableStream(
      React.createElement(Wrapper, null, React.createElement(Header, { title: 'Hello' })),
      clientManifest,
    );
    const readable = new PassThrough();
    flightStream.pipe(readable);

    const decoded = (await createFromNodeStream(readable, ssrManifest)) as React.ReactElement<{
      children: React.ReactElement<{ title: string }>;
    }>;

    expect(React.isValidElement(decoded)).toBe(true);
    expect(Array.isArray(decoded.props.children)).toBe(false);
    expect(React.isValidElement(decoded.props.children)).toBe(true);
    expect(decoded.props.children.props.title).toBe('Hello');
  });
});
