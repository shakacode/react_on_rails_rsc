import * as server from 'react-server-dom-webpack/server.edge';
import { withStylesheetHints } from './flight-stylesheet-hints';
export {
  preconnect,
  prefetchDNS,
  preinitScript,
  preinitStyle,
  preloadAsset,
  preloadFont,
  preloadImage,
  preloadScript,
  preloadStyle,
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

const renderToReadableStreamReact = server.renderToReadableStream as ServerFunction;

export const renderToReadableStream: ServerFunction = (model, webpackMap, options) =>
  renderToReadableStreamReact(model, withStylesheetHints(webpackMap), options);
export const decodeReply: ServerFunction = server.decodeReply as ServerFunction;
export const decodeReplyFromAsyncIterable: ServerFunction =
  server.decodeReplyFromAsyncIterable as ServerFunction;
export const decodeAction: ServerFunction = server.decodeAction as ServerFunction;
export const decodeFormState: ServerFunction = server.decodeFormState as ServerFunction;
export const registerServerReference: RegisterServerReference =
  server.registerServerReference as RegisterServerReference;
export const registerClientReference: RegisterClientReference =
  server.registerClientReference as RegisterClientReference;
export const createClientModuleProxy: (moduleId: string) => unknown =
  server.createClientModuleProxy as (moduleId: string) => unknown;
export const createTemporaryReferenceSet: () => unknown =
  server.createTemporaryReferenceSet as () => unknown;
