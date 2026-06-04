import * as React from 'react';
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
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

const renderToText = async (model: unknown): Promise<string> => {
  const stream = renderToPipeableStream(model, {
    filePathToModuleMetadata: {
      [CLIENT_MODULE_URL]: {
        id: './Header.client.js',
        chunks: ['client', 'client.js'],
        css: ['/assets/header.css'],
        name: '*',
      },
    },
    moduleLoading: { prefix: '', crossOrigin: null },
  });

  const readable = new PassThrough();
  stream.pipe(readable);
  return text(readable);
};

describe('React Flight client-reference CSS metadata', () => {
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
});
