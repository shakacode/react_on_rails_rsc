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
// We accept both quote styles and trim leading whitespace / BOM / shebang.
const USE_CLIENT_REGEX = /^\s*['"]use client['"];?\s*\n/;

// Strip leading shebangs (#!) and UTF-8 BOM so the regex above can match even
// when those precede the directive.
const stripProlog = (source: string): string => {
  let s = source;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // BOM
  if (s.startsWith('#!')) {
    const nl = s.indexOf('\n');
    s = nl === -1 ? '' : s.slice(nl + 1);
  }
  return s;
};

const hasUseClientDirective = (source: string): boolean =>
  USE_CLIENT_REGEX.test(stripProlog(source));

const RSCRspackLoader: LoaderDefinition = function RSCRspackLoader(source) {
  // Report the module if it has "use client" at the top.
  if (hasUseClientDirective(source)) {
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
      const set = compilation[CLIENT_MODULES_KEY] as Set<string> | undefined;
      if (set) set.add(this.resourcePath);
    }
  }

  return source;
};

export default RSCRspackLoader;
