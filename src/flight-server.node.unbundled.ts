import * as server from 'react-server-dom-webpack/server.node';

// Plain Node can reuse stock render/registration helpers; decode APIs below
// still fail explicitly because they need the removed unbundled loader runtime.
type ServerFunction = (...args: unknown[]) => unknown;
type RegisterClientReference = (
  proxyImplementation: unknown,
  id: string,
  exportName: string
) => unknown;
type RegisterServerReference = (reference: unknown, id: string, exportName: string) => unknown;

const plainNodeDecodeError = (apiName: string): Error =>
  new Error(
    `${apiName} is not available from react-on-rails-rsc/server in a plain Node ` +
      'react-server process. React 19.2 removed the public unbundled Flight server ' +
      'runtime, so server action/reference decoding now requires a bundler runtime ' +
      'that sets the webpack export condition. Use the webpack-conditioned ' +
      'react-on-rails-rsc/server export, or stay on the 19.0.x package line if you ' +
      'need unbundled server-reference decoding.'
  );

const unsupportedPlainNodeDecode = (apiName: string): ServerFunction => {
  return () => {
    throw plainNodeDecodeError(apiName);
  };
};

export const renderToReadableStream: ServerFunction =
  server.renderToReadableStream as ServerFunction;
export const renderToPipeableStream: ServerFunction =
  server.renderToPipeableStream as ServerFunction;
export const decodeReply: ServerFunction = unsupportedPlainNodeDecode('decodeReply');
export const decodeReplyFromBusboy: ServerFunction =
  unsupportedPlainNodeDecode('decodeReplyFromBusboy');
export const decodeReplyFromAsyncIterable: ServerFunction = unsupportedPlainNodeDecode(
  'decodeReplyFromAsyncIterable'
);
export const decodeAction: ServerFunction = unsupportedPlainNodeDecode('decodeAction');
export const decodeFormState: ServerFunction = unsupportedPlainNodeDecode('decodeFormState');
export const registerServerReference: RegisterServerReference =
  server.registerServerReference as RegisterServerReference;
export const registerClientReference: RegisterClientReference =
  server.registerClientReference as RegisterClientReference;
export const createClientModuleProxy: (moduleId: string) => unknown =
  server.createClientModuleProxy as (moduleId: string) => unknown;
export const createTemporaryReferenceSet: () => unknown =
  server.createTemporaryReferenceSet as () => unknown;
