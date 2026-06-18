import { preinit } from 'react-dom';

const RSC_CSS_PRECEDENCE = 'rsc-css';

const preinitStylesheetsForClientReference = (metadata: unknown) => {
  if (!metadata || typeof metadata !== 'object') return;

  const css = (metadata as { css?: unknown }).css;
  if (!Array.isArray(css)) return;

  for (const href of css) {
    if (typeof href === 'string') {
      preinit(href, { as: 'style', precedence: RSC_CSS_PRECEDENCE });
    }
  }
};

export const withStylesheetHints = <Manifest>(filePathToModuleMetadata: Manifest): Manifest => {
  if (!filePathToModuleMetadata || typeof filePathToModuleMetadata !== 'object') {
    return filePathToModuleMetadata;
  }

  return new Proxy(filePathToModuleMetadata as object, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      preinitStylesheetsForClientReference(value);
      return value;
    },
  }) as Manifest;
};

/**
 * SPIKE (#4049): emit stylesheet hints for Server-Component CSS.
 *
 * Unlike client references, Server Components never trigger a manifest lookup
 * during Flight serialization (they execute on the server and emit plain
 * markup), so the `withStylesheetHints` proxy never fires for them. Instead,
 * the render orchestration calls this with the `serverComponentCss` map (from
 * the client manifest) and the set of server-component module URLs ACTUALLY
 * rendered on this page. Scoping to rendered components avoids over-linking
 * other pages' CSS (the #3211 pitfall). `preinit` dedupes by href+precedence,
 * so CSS shared across components links once.
 */
export const preinitServerComponentStylesheets = (
  serverComponentCss: Record<string, string[]> | undefined,
  renderedServerComponentUrls: Iterable<string>
): void => {
  if (!serverComponentCss || typeof serverComponentCss !== 'object') return;

  for (const moduleUrl of renderedServerComponentUrls) {
    const hrefs = serverComponentCss[moduleUrl];
    if (!Array.isArray(hrefs)) continue;
    for (const href of hrefs) {
      if (typeof href === 'string') {
        preinit(href, { as: 'style', precedence: RSC_CSS_PRECEDENCE });
      }
    }
  }
};
