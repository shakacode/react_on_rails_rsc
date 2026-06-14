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
