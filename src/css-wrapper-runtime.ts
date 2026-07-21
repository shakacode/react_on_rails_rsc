/*
 * Runtime for the RSC CSS wrapper (issue #4598).
 *
 * The webpack/rspack plugin redirects each `'use client'` module's client-reference
 * resolution (in the SSR-server and browser-client bundles only) to a generated
 * wrapper module. That wrapper wraps each export with `withRscCss`, which renders a
 * render-blocking `<link rel="stylesheet" precedence="rsc-css">` for the component's
 * CSS before the component itself. React's native stylesheet handling then gates
 * commit/reveal on the stylesheet load — preventing FOUC in every rendering mode
 * (SSR streaming, hydration, client navigation, non-SSR fetch) without any of the
 * former stream-injection / waitForStylesheet machinery.
 *
 * The CSS hrefs are only known after chunking, so they are not baked into the wrapper
 * source. Instead the plugin emits a webpack RuntimeModule that populates a global map
 * keyed by the client module's stable key; `withRscCss` looks the hrefs up at render
 * time. `preinit` is intentionally NOT used — it downloads/applies CSS but does not
 * block rendering, so it does not prevent FOUC (verified experimentally).
 */
import * as React from 'react';

export const RSC_CSS_PRECEDENCE = 'rsc-css';

/** Global (per JS runtime) map: client-module key -> array of CSS hrefs. */
export const RSC_CSS_HREFS_GLOBAL = '__RSC_CSS_HREFS__';

type HrefMap = Record<string, string[] | undefined>;

function hrefsForKey(key: string): string[] {
  const map = (globalThis as unknown as Record<string, HrefMap | undefined>)[RSC_CSS_HREFS_GLOBAL];
  const hrefs = map && map[key];
  return Array.isArray(hrefs) ? hrefs : [];
}

/** Render the render-blocking stylesheet links for a client module's CSS. */
function cssLinks(key: string): React.ReactElement[] {
  return hrefsForKey(key).map((href) =>
    React.createElement('link', {
      key: href,
      rel: 'stylesheet',
      href,
      precedence: RSC_CSS_PRECEDENCE,
    }),
  );
}

/**
 * Wrap a single client-module export so that, when React renders it, the module's
 * CSS `<link precedence>` renders alongside it. Non-function exports (constants,
 * objects) are returned unchanged so ordinary consumers are unaffected. Refs are
 * forwarded; useful statics are copied.
 */
const FORWARD_REF = Symbol.for('react.forward_ref');
const MEMO = Symbol.for('react.memo');

function isComponentLike(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (value != null && typeof value === 'object') {
    const t = (value as { $$typeof?: symbol }).$$typeof;
    return t === FORWARD_REF || t === MEMO;
  }
  return false;
}

export function withRscCss<T>(value: T, key: string): T {
  // Only component-like exports are wrapped. `forwardRef`/`memo` components are
  // objects (not functions), so a plain typeof check would miss them (FOUC).
  if (!isComponentLike(value)) {
    return value;
  }
  const Component = value as unknown as React.ComponentType<Record<string, unknown>>;

  const Wrapped = React.forwardRef<unknown, Record<string, unknown>>((props, ref) =>
    React.createElement(
      React.Fragment,
      null,
      ...cssLinks(key),
      React.createElement(Component, ref == null ? props : { ...props, ref }),
    ),
  );

  // Preserve identity/debugging affordances.
  const name =
    (Component as { displayName?: string; name?: string }).displayName ||
    (Component as { name?: string }).name ||
    'Component';
  Wrapped.displayName = `withRscCss(${name})`;
  return Wrapped as unknown as T;
}
