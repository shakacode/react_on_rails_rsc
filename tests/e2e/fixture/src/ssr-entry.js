// SSR-bundle entry, exposed via webpack/rspack `output.library` commonjs2.
// Everything the SSR render script needs is re-exported from INSIDE the
// bundle so the Flight node client, React, and react-dom/server share one
// module graph (CSS hint dispatch and hooks both require a single React
// and react-dom instance).
import './index';

export { buildClientRenderer } from 'react-on-rails-rsc/client';
export * as React from 'react';
export * as ReactDOMServer from 'react-dom/server';
