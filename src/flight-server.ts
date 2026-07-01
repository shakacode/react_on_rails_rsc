import type {
  PreconnectResourceOptions,
  PreinitScriptOptions,
  PreinitStyleOptions,
  PreloadAssetOptions,
  PreloadFontOptions,
  PreloadImageOptions,
  PreloadScriptOptions,
  PreloadStyleOptions,
} from './resource-hints';
export type {
  PreconnectResourceOptions,
  PreinitScriptOptions,
  PreinitStyleOptions,
  PreloadAssetOptions,
  PreloadFontOptions,
  PreloadImageOptions,
  PreloadScriptOptions,
  PreloadStyleOptions,
  ResourceHintAs,
  ResourceHintCrossOrigin,
  ResourceHintFetchPriority,
} from './resource-hints';

type ServerFunction = (...args: unknown[]) => unknown;
type RegisterClientReference = (
  proxyImplementation: unknown,
  id: string,
  exportName: string
) => unknown;
type RegisterServerReference = (reference: unknown, id: string, exportName: string) => unknown;

const defaultServerFallbackError = (apiName: string): Error =>
  new Error(
    `react-on-rails-rsc/server ${apiName}() cannot be used outside a react-server environment. ` +
      'Configure Node.js using the `--conditions react-server` flag so the server entrypoint ' +
      'resolves to the Flight runtime before calling server helpers.'
  );

const unsupportedDefaultServerFunction = <TFunction>(apiName: string): TFunction =>
  (() => {
    throw defaultServerFallbackError(apiName);
  }) as unknown as TFunction;

const throwUnsupportedDefaultServerResourceHint = (apiName: string): never => {
  throw defaultServerFallbackError(apiName);
};

// Default fallback is importable for type/runtime introspection, but every API
// fails explicitly until the react-server export condition selects a Flight runtime.
export const renderToReadableStream: ServerFunction =
  unsupportedDefaultServerFunction<ServerFunction>('renderToReadableStream');
export const renderToPipeableStream: ServerFunction =
  unsupportedDefaultServerFunction<ServerFunction>('renderToPipeableStream');
export const decodeReply: ServerFunction =
  unsupportedDefaultServerFunction<ServerFunction>('decodeReply');
export const decodeReplyFromBusboy: ServerFunction =
  unsupportedDefaultServerFunction<ServerFunction>('decodeReplyFromBusboy');
export const decodeReplyFromAsyncIterable: ServerFunction =
  unsupportedDefaultServerFunction<ServerFunction>('decodeReplyFromAsyncIterable');
export const decodeAction: ServerFunction =
  unsupportedDefaultServerFunction<ServerFunction>('decodeAction');
export const decodeFormState: ServerFunction =
  unsupportedDefaultServerFunction<ServerFunction>('decodeFormState');
export const registerServerReference: RegisterServerReference =
  unsupportedDefaultServerFunction<RegisterServerReference>('registerServerReference');
export const registerClientReference: RegisterClientReference =
  unsupportedDefaultServerFunction<RegisterClientReference>('registerClientReference');
export const createClientModuleProxy: (moduleId: string) => unknown =
  unsupportedDefaultServerFunction<(moduleId: string) => unknown>('createClientModuleProxy');
export const createTemporaryReferenceSet: () => unknown =
  unsupportedDefaultServerFunction<() => unknown>('createTemporaryReferenceSet');
export const prefetchDNS: (href: string) => void = () => {
  throwUnsupportedDefaultServerResourceHint('prefetchDNS');
};
export const preconnect: (href: string, options?: PreconnectResourceOptions) => void = () => {
  throwUnsupportedDefaultServerResourceHint('preconnect');
};
export const preloadAsset: (href: string, options: PreloadAssetOptions) => void = () => {
  throwUnsupportedDefaultServerResourceHint('preloadAsset');
};
export const preloadStyle: (href: string, options?: PreloadStyleOptions) => void = () => {
  throwUnsupportedDefaultServerResourceHint('preloadStyle');
};
export const preinitStyle: (href: string, options?: PreinitStyleOptions) => void = () => {
  throwUnsupportedDefaultServerResourceHint('preinitStyle');
};
export const preloadScript: (href: string, options?: PreloadScriptOptions) => void = () => {
  throwUnsupportedDefaultServerResourceHint('preloadScript');
};
export const preinitScript: (href: string, options?: PreinitScriptOptions) => void = () => {
  throwUnsupportedDefaultServerResourceHint('preinitScript');
};
export const preloadFont: (href: string, options?: PreloadFontOptions) => void = () => {
  throwUnsupportedDefaultServerResourceHint('preloadFont');
};
export const preloadImage: (href: string, options?: PreloadImageOptions) => void = () => {
  throwUnsupportedDefaultServerResourceHint('preloadImage');
};
