// Client-bundle entry. Pulls the Flight browser runtime into the bundle
// (the plugin keys client-reference injection on that runtime module) and
// exposes a hydrate function the jsdom harness calls with the captured
// Flight payload.
import * as React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { createFromReadableStream } from 'react-on-rails-rsc/client';
import './index';

const recoverableErrors = [];

window.__E2E__ = {
  recoverableErrors,
  async hydrate(payloadText, container) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payloadText));
        controller.close();
      },
    });
    const tree = await createFromReadableStream(stream);
    return new Promise((resolve) => {
      const Root = () => {
        React.useEffect(() => resolve(root), []);
        return tree;
      };
      const root = hydrateRoot(container, React.createElement(Root), {
        onRecoverableError: (error) => {
          recoverableErrors.push(String((error && error.stack) || error));
        },
      });
    });
  },
};
