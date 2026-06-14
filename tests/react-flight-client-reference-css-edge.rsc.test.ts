import * as React from 'react';
import {
  registerClientReference,
  renderToReadableStream,
} from '../src/flight-server.edge';

const CLIENT_REFERENCE_TAG = Symbol.for('react.client.reference');
const CLIENT_MODULE_URL = 'file:///app/Header.client.js';

const clientReferenceMetadata = {
  [CLIENT_MODULE_URL]: {
    id: './Header.client.js',
    chunks: ['client', 'client.js'],
    css: ['/assets/header.css'],
    name: '*',
  },
};

const readWebStream = async (stream: ReadableStream<Uint8Array | string>): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    output += typeof value === 'string' ? value : decoder.decode(value, { stream: true });
  }

  return output + decoder.decode();
};

describe('React Flight edge client-reference CSS metadata', () => {
  it('serializes manifest CSS when rendering through the edge server export', async () => {
    const Header = registerClientReference(
      function Header() {
        throw new Error('client reference should not execute on the server');
      },
      CLIENT_MODULE_URL,
      'Header'
    ) as React.ComponentType<{ title: string }> & { $$typeof?: symbol };

    expect(Header.$$typeof).toBe(CLIENT_REFERENCE_TAG);

    const stream = renderToReadableStream(
      React.createElement(Header, { title: 'Hello' }),
      clientReferenceMetadata
    ) as ReadableStream<Uint8Array>;
    const payload = await readWebStream(stream);

    expect(payload).toContain('/assets/header.css');
    expect(payload).toContain('rsc-css');
    expect(payload).toContain('Header');
  });
});
