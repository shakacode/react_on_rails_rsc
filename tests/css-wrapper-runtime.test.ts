/**
 * Issue #4598 — `withRscCss` must wrap every component-export shape so each emits
 * its render-blocking `<link precedence>`, and must pass non-component exports
 * through unchanged. forwardRef/memo components are OBJECTS, not functions, so a
 * naive typeof check would miss them (a real FOUC path).
 */
import * as React from 'react';
import { withRscCss, RSC_CSS_PRECEDENCE } from '../src/css-wrapper-runtime';

const KEY = 'file:///app/Shapes.js';
const FORWARD_REF = Symbol.for('react.forward_ref');

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).__RSC_CSS_HREFS__ = { [KEY]: ['/a.css', '/b.css'] };
});
afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__RSC_CSS_HREFS__;
});

/** Render a wrapped component (always a forwardRef) and collect its <link> children. */
function linksOf(Wrapped: unknown): Array<{ rel?: string; precedence?: string; href?: string }> {
  const w = Wrapped as { $$typeof?: symbol; render?: (p: unknown, r: unknown) => React.ReactElement };
  expect(w.$$typeof).toBe(FORWARD_REF);
  const tree = w.render!({ title: 'x' }, null);
  const children = React.Children.toArray((tree as React.ReactElement<{ children: React.ReactNode }>).props.children);
  return children
    .filter((c): c is React.ReactElement => React.isValidElement(c) && c.type === 'link')
    .map((c) => {
      const p = c.props as { rel?: string; precedence?: string; href?: string };
      return { rel: p.rel, precedence: p.precedence, href: p.href };
    });
}

describe('withRscCss export-shape coverage', () => {
  const expectedLinks = [
    { rel: 'stylesheet', precedence: RSC_CSS_PRECEDENCE, href: '/a.css' },
    { rel: 'stylesheet', precedence: RSC_CSS_PRECEDENCE, href: '/b.css' },
  ];

  it('wraps a plain function component', () => {
    const Fn = (props: { title: string }) => React.createElement('div', null, props.title);
    expect(linksOf(withRscCss(Fn, KEY))).toEqual(expectedLinks);
  });

  it('wraps a forwardRef component (object, not function)', () => {
    const Ref = React.forwardRef<HTMLDivElement, { title: string }>((props, ref) =>
      React.createElement('div', { ref }, props.title),
    );
    expect(linksOf(withRscCss(Ref, KEY))).toEqual(expectedLinks);
  });

  it('wraps a memo component (object)', () => {
    const Memo = React.memo((props: { title: string }) => React.createElement('div', null, props.title));
    expect(linksOf(withRscCss(Memo, KEY))).toEqual(expectedLinks);
  });

  it('wraps a memo(forwardRef) component', () => {
    const MemoRef = React.memo(
      React.forwardRef<HTMLDivElement, { title: string }>((props, ref) =>
        React.createElement('div', { ref }, props.title),
      ),
    );
    expect(linksOf(withRscCss(MemoRef, KEY))).toEqual(expectedLinks);
  });

  it('passes non-component exports through unchanged', () => {
    const constant = { some: 'value' };
    expect(withRscCss(constant, KEY)).toBe(constant);
    expect(withRscCss(42, KEY)).toBe(42);
    expect(withRscCss('hello', KEY)).toBe('hello');
    expect(withRscCss(null, KEY)).toBe(null);
  });

  it('forwards props and ref through the wrapper', () => {
    const seen: { props?: unknown; ref?: unknown } = {};
    const Ref = React.forwardRef<unknown, { title: string }>((props, ref) => {
      seen.props = props;
      seen.ref = ref;
      return React.createElement('div', null, props.title);
    });
    const Wrapped = withRscCss(Ref, KEY) as unknown as {
      render: (p: unknown, r: unknown) => React.ReactElement;
    };
    const ref = React.createRef();
    const tree = Wrapped.render({ title: 'Hi' }, ref);
    // The last child is the original component element with props + ref forwarded.
    const children = React.Children.toArray(
      (tree as React.ReactElement<{ children: React.ReactNode }>).props.children,
    );
    const compEl = children[children.length - 1] as React.ReactElement<{ title: string }> & { ref?: unknown };
    expect(compEl.props.title).toBe('Hi');
    expect(compEl.ref).toBe(ref);
  });

  it('renders no links when the href map has no entry for the key', () => {
    const Fn = (props: { title: string }) => React.createElement('div', null, props.title);
    expect(linksOf(withRscCss(Fn, 'file:///app/Unknown.js'))).toEqual([]);
  });
});
