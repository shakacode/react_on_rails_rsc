/**
 * SPIKE (#4049) render-side proof: a Server Component's CSS gets a stylesheet
 * hint emitted into the Flight stream via preinitServerComponentStylesheets.
 *
 * Run with the react-server condition (it is an *.rsc.test.* file):
 *   NODE_CONDITIONS=react-server npx jest tests/server-component-css-hint.rsc.test.tsx
 */

import * as React from 'react';
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import { renderToPipeableStream } from '../src/server.node';
import { preinitServerComponentStylesheets } from '../src/flight-stylesheet-hints';

const SENTINEL_HREF = '/assets/rsc-sc-css-0.chunk.css';
const BLOCK_URL = 'file:///app/Block.js';

const serverComponentCss = {
  [BLOCK_URL]: [SENTINEL_HREF],
};

const emptyManifest = {
  filePathToModuleMetadata: {},
  moduleLoading: { prefix: '', crossOrigin: null },
};

const renderToText = async (model: unknown): Promise<string> => {
  const stream = renderToPipeableStream(model, emptyManifest);
  const readable = new PassThrough();
  stream.pipe(readable);
  return text(readable);
};

describe('Server-Component CSS stylesheet hint (#4049)', () => {
  it('emits the sentinel stylesheet href into the Flight stream when the SC is rendered', async () => {
    // A pure Server Component. During render it fires the hint for itself,
    // scoped to the components actually on this page — exactly what the
    // framework orchestration would do from the rendered set.
    function BlockServer() {
      preinitServerComponentStylesheets(serverComponentCss, [BLOCK_URL]);
      return React.createElement('div', { className: 'block_marker' }, 'styled block');
    }

    const payload = await renderToText(React.createElement(BlockServer));

    // The stylesheet href reaches the wire payload (React emits a hint row),
    // and carries the rsc-css precedence used by the client-reference path.
    expect(payload).toContain(SENTINEL_HREF);
    expect(payload).toContain('rsc-css');
  });

  it('does NOT emit hints for server components not on this page (scoping)', async () => {
    const OTHER_HREF = '/assets/other-page.chunk.css';
    const cssMap = {
      [BLOCK_URL]: [SENTINEL_HREF],
      'file:///app/OtherPageBlock.js': [OTHER_HREF],
    };

    function BlockServer() {
      // Only BLOCK_URL is on this page.
      preinitServerComponentStylesheets(cssMap, [BLOCK_URL]);
      return React.createElement('div', { className: 'block_marker' }, 'styled block');
    }

    const payload = await renderToText(React.createElement(BlockServer));

    expect(payload).toContain(SENTINEL_HREF);
    expect(payload).not.toContain(OTHER_HREF);
  });
});
