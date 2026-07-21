// The generated wrapper: imports the ORIGINAL client module and renders its
// CSS <link precedence> + the original component, forwarding props.
import * as React from 'react';
import Foo from './Foo.js';
export default function FooWithCss(props) {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('link', { rel: 'stylesheet', precedence: 'rsc-css', href: props.__cssHref }),
    React.createElement(Foo, props),
  );
}
