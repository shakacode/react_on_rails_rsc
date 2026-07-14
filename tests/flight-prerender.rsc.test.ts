import * as React from 'react';
import { text } from 'node:stream/consumers';
import {
  prerenderToNodeStream,
  buildServerPrerenderer,
} from '../src/static.node';

const CLIENT_MODULE_URL = 'file:///app/Widget.client.js';

const clientManifest = {
  filePathToModuleMetadata: {
    [CLIENT_MODULE_URL]: {
      id: './Widget.client.js',
      chunks: ['widget', 'widget.js'],
      css: ['/assets/widget.css'],
      name: '*',
    },
  },
  moduleLoading: { prefix: '', crossOrigin: null },
};

const emptyManifest = {
  filePathToModuleMetadata: {},
  moduleLoading: { prefix: '', crossOrigin: null },
};

describe('Flight prerenderToNodeStream', () => {
  it('prerenders a simple RSC model to a Node.js Readable stream', async () => {
    const element = React.createElement('h1', null, 'Prerendered PPR content');

    const { prelude } = await prerenderToNodeStream(element, emptyManifest);

    const payload = await text(prelude);
    expect(payload).toContain('Prerendered PPR content');
  });

  it('prerenders with the buildServerPrerenderer factory', async () => {
    const { prerenderToNodeStream: factoryPrerender, reactClientManifest } =
      buildServerPrerenderer(emptyManifest);

    expect(reactClientManifest).toBeDefined();

    const element = React.createElement('p', null, 'Factory prerender');
    const { prelude } = await factoryPrerender(element);

    const payload = await text(prelude);
    expect(payload).toContain('Factory prerender');
  });

  it('applies withStylesheetHints so CSS entries trigger preinit hints', async () => {
    const { registerClientReference } = require('react-server-dom-webpack/server.node') as {
      registerClientReference: (
        proxyImplementation: () => never,
        id: string,
        exportName: string,
      ) => unknown;
    };

    const Widget = registerClientReference(
      function Widget() {
        throw new Error('client reference should not execute on the server');
      },
      CLIENT_MODULE_URL,
      'Widget',
    ) as React.ComponentType;

    const element = React.createElement(Widget);
    const { prelude } = await prerenderToNodeStream(element, clientManifest);

    const payload = await text(prelude);
    // withStylesheetHints injects preinit calls that produce :HS (preinitStyle) hints
    // in the Flight payload for CSS entries in the manifest
    expect(payload).toContain('/assets/widget.css');
    expect(payload).toContain('rsc-css');
  });

  it('accepts onError callback in options', async () => {
    const errors: unknown[] = [];

    const RejectedComponent = async () => {
      throw new Error('prerender test error');
    };

    const element = React.createElement(RejectedComponent);
    const { prelude } = await prerenderToNodeStream(element, emptyManifest, {
      onError: (err) => {
        errors.push(err);
      },
    });

    // Consume the stream to trigger rendering
    await text(prelude);

    expect(errors.length).toBeGreaterThan(0);
    expect((errors[0] as Error).message).toBe('prerender test error');
  });
});
