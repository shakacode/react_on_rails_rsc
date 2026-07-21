/*
 * Webpack/rspack loader that generates the RSC CSS wrapper module for a
 * `'use client'` file (issue #4598). Applied ONLY to the client-reference async
 * block in the SSR-server and browser-client builds (never the RSC bundle), so
 * client references keep their metadata. The generated module imports the ORIGINAL
 * client module and re-exports each export wrapped so that rendering it also renders
 * a render-blocking `<link rel="stylesheet" precedence="rsc-css">` for the module's
 * CSS (hrefs looked up at render time from a plugin-populated global map).
 *
 * The wrapper is self-contained (no runtime-package import) so it resolves in any
 * host build; it depends only on `react`, which is always present in these bundles.
 */
import type { LoaderContext } from 'webpack';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface Options {
  /** Stable key for this client module (matches the manifest key). Defaults to the file URL. */
  key?: string;
}

// Bare `export * from 'x'` (NOT `export * as N from 'x'`, which lexes as a named export).
const STAR_REEXPORT_RE = /export\s*\*\s*from\s*(['"])([^'"]+)\1/g;

export default function rscCssWrapperLoader(this: LoaderContext<Options>, source: string): void {
  const callback = this.async();
  const loaderContext = this;
  const resourcePath = this.resourcePath;
  const options = (typeof this.getOptions === 'function' ? this.getOptions() : {}) as Options;
  const key = options.key || pathToFileURL(resourcePath).href;

  const resolve = (request: string): Promise<string> =>
    new Promise((res, rej) =>
      loaderContext.resolve(dirname(resourcePath), request, (err, result) =>
        err || !result ? rej(err || new Error(`cannot resolve ${request}`)) : res(result),
      ),
    );

  // es-module-lexer is ESM-only; load it dynamically from this CommonJS loader.
  import('es-module-lexer')
    .then(async ({ init, parse }) => {
      await init;
      const exportNames: string[] = [];
      try {
        const [, exports] = parse(source, resourcePath);
        for (const e of exports) {
          if (e.n) exportNames.push(e.n);
        }
        // Resolve bare `export * from` sources one level and collect their named
        // exports (all available on this module's namespace via the re-export), so
        // re-exported components are wrapped too rather than leaking unwrapped (FOUC).
        const starSources = [...source.matchAll(STAR_REEXPORT_RE)].map((m) => m[2]!);
        for (const starSource of starSources) {
          try {
            const resolved = await resolve(starSource);
            loaderContext.addDependency(resolved);
            const [, starExports] = parse(readFileSync(resolved, 'utf8'), resolved);
            for (const e of starExports) {
              // `export *` does not re-export the default.
              if (e.n && e.n !== 'default' && !exportNames.includes(e.n)) {
                exportNames.push(e.n);
              }
            }
          } catch {
            // If a star source can't be resolved/parsed, skip it (best effort).
          }
        }
      } catch {
        // If parsing fails, fall back to wrapping default only.
        exportNames.length = 0;
        exportNames.push('default');
      }

      // Import the original with a distinct query so it is a different webpack
      // resource than the wrapper (whose resource is the bare client file). This
      // keeps the manifest entry pointing at the wrapper module id, while the
      // wrapper still renders the real component.
      const origRequest = JSON.stringify(`${resourcePath}?__rsc_orig`);
      const keyLit = JSON.stringify(key);
      const named = exportNames.filter((n) => n !== 'default');
      const hasDefault = exportNames.includes('default');

      const lines: string[] = [
        `import * as React from 'react';`,
        `import * as __orig from ${origRequest};`,
        `var __k = ${keyLit};`,
        `function __rscHrefs(){ var m = globalThis['__RSC_CSS_HREFS__']; var h = m && m[__k]; return Array.isArray(h) ? h : []; }`,
        `var __FR = Symbol.for('react.forward_ref'), __MEMO = Symbol.for('react.memo');`,
        `function __rscIsComponent(v){ return typeof v === 'function' || (v != null && typeof v === 'object' && (v.$$typeof === __FR || v.$$typeof === __MEMO)); }`,
        `function __rscWrap(v){`,
        `  if (!__rscIsComponent(v)) return v;`,
        `  var W = React.forwardRef(function(props, ref){`,
        `    var links = __rscHrefs().map(function(href){ return React.createElement('link', { key: href, rel: 'stylesheet', href: href, precedence: 'rsc-css' }); });`,
        `    var el = React.createElement(v, ref == null ? props : Object.assign({}, props, { ref: ref }));`,
        `    return React.createElement(React.Fragment, null, links, el);`,
        `  });`,
        `  W.displayName = 'withRscCss(' + ((v.displayName || v.name) || 'Component') + ')';`,
        `  return W;`,
        `}`,
      ];

      for (const n of named) {
        lines.push(`export var ${n} = __rscWrap(__orig[${JSON.stringify(n)}]);`);
      }
      if (hasDefault) {
        lines.push(`export default __rscWrap(__orig['default']);`);
      }

      callback(null, lines.join('\n'));
    })
    .catch((err: unknown) => callback(err as Error));
}
