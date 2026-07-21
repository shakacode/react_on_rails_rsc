'use client';

import * as React from 'react';
import './Styled.css';

// Models the OUTPUT of the CSS wrapper: a client component that renders its own
// <link rel="stylesheet" precedence> alongside its content. In the RSC build this
// body is replaced by registerClientReference; in the client/SSR build it renders.
export default function Styled(props) {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('link', {
      rel: 'stylesheet',
      precedence: 'rsc-css',
      href: props.cssHref,
    }),
    React.createElement('div', { id: 'box', className: 'exp-box' }, props.title),
  );
}

// A non-component named export must survive normal imports unaffected.
export const HELPER_CONSTANT = 'helper-value-42';
