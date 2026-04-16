/**
 * "use client" detector loader.
 *
 * Attached by RSCRspackPlugin to every JS/TS module during compilation. Reads
 * the source, checks if the file starts with a `"use client"` directive, and
 * if so records the module's resource path on the current compilation.
 *
 * The plugin picks up this set of paths in `compilation.hooks.finishModules`
 * and emits the manifest.
 *
 * The loader passes the source through unchanged — it is purely a reporter.
 *
 * IMPORTANT: communication with the plugin goes via a property attached to
 * the compilation object (`compilation[CLIENT_MODULES_KEY]`). This avoids a
 * module-level singleton that would clash in parallel test runs.
 */

import type { LoaderDefinition } from 'webpack';
import { CLIENT_MODULES_KEY } from './shared';

// We use the same directive-detection logic as react-server-dom-webpack/node-loader:
// the directive must be the first statement of the module, before any imports.
// We accept both quote styles, trim leading whitespace / BOM / shebang, and
// terminate on either a newline OR end-of-input so one-line modules without
// a trailing newline are still tagged. Whitespace between the closing quote
// and the optional `;` is allowed per ES spec.
const USE_CLIENT_REGEX = /^\s*['"]use client['"]\s*;?\s*(?:\n|$)/;

// Strip leading shebangs (#!), UTF-8 BOM, AND any number of leading line
// (`// ...`) or block (`/* ... */`) comments so the regex above can match
// even when those precede the directive. The ECMAScript directive prologue
// rules (and React's RSC spec) allow comments before directives — a copyright
// header before `"use client"` is a common real-world case.
const LEADING_COMMENTS = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))+/;

const stripProlog = (source: string): string => {
  let s = source;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // BOM
  if (s.startsWith('#!')) {
    const nl = s.indexOf('\n');
    s = nl === -1 ? '' : s.slice(nl + 1);
  }
  // Strip any sequence of leading line or block comments, separated by
  // whitespace. Repeated so that `/* a */ // b\n /* c */` all vanishes.
  const stripped = s.replace(LEADING_COMMENTS, '');
  if (stripped !== s) s = stripped;
  return s;
};

const hasUseClientDirective = (source: string): boolean =>
  USE_CLIENT_REGEX.test(stripProlog(source));

const RSCRspackLoader: LoaderDefinition = function RSCRspackLoader(source) {
  // Our loader has a side effect: it mutates the compilation via
  // `compilation[CLIENT_MODULES_KEY]`. That side effect must happen on
  // EVERY build, including incremental rebuilds — but rspack's default
  // loader caching would skip re-executing on cache hits, leaving the
  // tag-set stale or empty across watch-mode rebuilds. Declaring the
  // loader non-cacheable forces re-execution every time, which restores
  // a correct manifest on incremental builds.
  //
  // The loader is effectively free (one regex test on source text), so
  // the caching cost is negligible compared to the correctness win.
  this.cacheable(false);

  // Defensive: if another `pre` loader runs before ours and returns a
  // Buffer (e.g., a binary loader or an ill-behaved plugin), `source`
  // could arrive as Buffer instead of string. `charCodeAt` + `startsWith`
  // would throw. Coerce to string so the detector is always safe.
  const text = typeof source === 'string' ? source : String(source);

  // Report the module if it has "use client" at the top.
  if (hasUseClientDirective(text)) {
    // `this._compilation` is the rspack/webpack Compilation object. It is a
    // loader-context private but both rspack and webpack expose it reliably.
    // We guard with optional chaining in case the loader gets called outside
    // a regular compilation (e.g., loader tests).
    const compilation = (this as unknown as { _compilation?: unknown })._compilation as
      | Record<string | symbol, unknown>
      | undefined;
    if (compilation) {
      // Plugin eagerly initializes the Set in its `thisCompilation` hook,
      // which always runs before any loader. If the Set is missing here,
      // the plugin wasn't applied to this compiler — skip silently (the
      // loader is harmless on its own).
      //
      // Guard an empty / missing resourcePath (virtual modules synthesized
      // by other plugins have no physical file and may report `undefined`
      // or `""`). Tagging an empty string would pollute the manifest.
      const set = compilation[CLIENT_MODULES_KEY] as Set<string> | undefined;
      if (set && typeof this.resourcePath === 'string' && this.resourcePath.length > 0) {
        set.add(this.resourcePath);
      }
    }
  }

  return source;
};

export default RSCRspackLoader;
