/**
 * "use client" detector loader.
 *
 * Attached by RSCRspackPlugin to every JS/TS module during compilation.
 * Reads the source, checks if the file starts with a `"use client"`
 * directive (accounting for BOM, shebangs, and leading comments), and if
 * so adds the module's resourcePath to a per-compilation Set keyed by the
 * `CLIENT_MODULES_KEY` Symbol. The plugin consumes that Set at
 * `processAssets` time to emit the manifest.
 *
 * The loader passes the source through unchanged — it is purely a reporter.
 *
 * IMPORTANT: communication with the plugin goes via a Symbol-keyed
 * property on the compilation object (`compilation[CLIENT_MODULES_KEY]`).
 * The plugin eagerly creates the Set in `thisCompilation` so the loader
 * never races on initialization.
 */

import type { LoaderDefinition } from 'webpack';
import { CLIENT_MODULES_KEY, hasUseClientDirective } from './shared';

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
