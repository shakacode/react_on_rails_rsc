import * as server from 'react-server-dom-webpack/server.browser';

type ServerFunction = (...args: unknown[]) => unknown;
type RegisterClientReference = (
  proxyImplementation: unknown,
  id: string,
  exportName: string
) => unknown;
type RegisterServerReference = (reference: unknown, id: string, exportName: string) => unknown;

export const renderToReadableStream: ServerFunction =
  server.renderToReadableStream as ServerFunction;
export const decodeReply: ServerFunction = server.decodeReply as ServerFunction;
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
