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

throw new Error(
  'The React Server Writer cannot be used outside a react-server environment. ' +
    'You must configure Node.js using the `--conditions react-server` flag.'
);

// Unreachable at runtime; present so tsc emits the public default type surface.
export const renderToReadableStream: ServerFunction = undefined as never;
export const renderToPipeableStream: ServerFunction = undefined as never;
export const decodeReply: ServerFunction = undefined as never;
export const decodeReplyFromBusboy: ServerFunction = undefined as never;
export const decodeReplyFromAsyncIterable: ServerFunction = undefined as never;
export const decodeAction: ServerFunction = undefined as never;
export const decodeFormState: ServerFunction = undefined as never;
export const registerServerReference: RegisterServerReference = undefined as never;
export const registerClientReference: RegisterClientReference = undefined as never;
export const createClientModuleProxy: (moduleId: string) => unknown = undefined as never;
export const createTemporaryReferenceSet: () => unknown = undefined as never;
export const prefetchDNS: (href: string) => void = undefined as never;
export const preconnect: (href: string, options?: PreconnectResourceOptions) => void =
  undefined as never;
export const preloadAsset: (href: string, options: PreloadAssetOptions) => void =
  undefined as never;
export const preloadStyle: (href: string, options?: PreloadStyleOptions) => void =
  undefined as never;
export const preinitStyle: (href: string, options?: PreinitStyleOptions) => void =
  undefined as never;
export const preloadScript: (href: string, options?: PreloadScriptOptions) => void =
  undefined as never;
export const preinitScript: (href: string, options?: PreinitScriptOptions) => void =
  undefined as never;
export const preloadFont: (href: string, options?: PreloadFontOptions) => void =
  undefined as never;
export const preloadImage: (href: string, options?: PreloadImageOptions) => void =
  undefined as never;
