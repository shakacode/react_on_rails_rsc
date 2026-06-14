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
