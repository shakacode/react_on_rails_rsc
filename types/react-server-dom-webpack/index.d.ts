type RSCServerFunction = (...args: unknown[]) => unknown;
type RSCRegisterClientReference = (
  proxyImplementation: unknown,
  id: string,
  exportName: string
) => unknown;
type RSCRegisterServerReference = (reference: unknown, id: string, exportName: string) => unknown;

declare module 'react-server-dom-webpack/client.browser' {
  export const createFromFetch: <T = unknown>(res: Promise<Response>, options?: {}) => Promise<T>;
  export const createFromReadableStream: <T = unknown>(
    stream: ReadableStream,
    options?: {}
  ) => Promise<T>;
}

declare module 'react-server-dom-webpack/client.node' {
  export const createFromFetch: <T = unknown>(res: Promise<Response>, options?: {}) => Promise<T>;
  export const createFromReadableStream: <T = unknown>(
    stream: ReadableStream,
    options?: {}
  ) => Promise<T>;
  export const createFromNodeStream: <T = unknown>(
    stream: NodeJS.ReadableStream,
    manifest: unknown,
    options?: {}
  ) => Promise<T>;
}

declare module 'react-server-dom-webpack/node-loader' {
  export const load: (
    url: string,
    context: unknown,
    nextLoad: () => Promise<{ format: string; source: string | Buffer }>
  ) => Promise<{ format: string; source: string | Buffer }>;
}

declare module 'react-server-dom-webpack/server' {
  export * from 'react-server-dom-webpack/server.node';
}

declare module 'react-server-dom-webpack/server.browser' {
  export const createClientModuleProxy: (moduleId: string) => unknown;
  export const createTemporaryReferenceSet: () => unknown;
  export const decodeAction: RSCServerFunction;
  export const decodeFormState: RSCServerFunction;
  export const decodeReply: RSCServerFunction;
  export const registerClientReference: RSCRegisterClientReference;
  export const registerServerReference: RSCRegisterServerReference;
  export const renderToReadableStream: RSCServerFunction;
}

declare module 'react-server-dom-webpack/server.edge' {
  export const createClientModuleProxy: (moduleId: string) => unknown;
  export const createTemporaryReferenceSet: () => unknown;
  export const decodeAction: RSCServerFunction;
  export const decodeFormState: RSCServerFunction;
  export const decodeReply: RSCServerFunction;
  export const decodeReplyFromAsyncIterable: RSCServerFunction;
  export const registerClientReference: RSCRegisterClientReference;
  export const registerServerReference: RSCRegisterServerReference;
  export const renderToReadableStream: RSCServerFunction;
}

declare module 'react-server-dom-webpack/server.node' {
  export const createClientModuleProxy: (moduleId: string) => unknown;
  export const createTemporaryReferenceSet: () => unknown;
  export const decodeAction: RSCServerFunction;
  export const decodeFormState: RSCServerFunction;
  export const decodeReply: RSCServerFunction;
  export const decodeReplyFromAsyncIterable: RSCServerFunction;
  export const decodeReplyFromBusboy: RSCServerFunction;
  export const registerClientReference: RSCRegisterClientReference;
  export const registerServerReference: RSCRegisterServerReference;
  export const renderToPipeableStream: (
    model: unknown,
    webpackMap: unknown,
    options?: unknown
  ) => unknown;
  export const renderToReadableStream: RSCServerFunction;
}

declare module 'react-server-dom-webpack/static.node' {
  export const prerenderToNodeStream: (
    model: unknown,
    webpackMap: unknown,
    options?: unknown
  ) => Promise<{ prelude: import('stream').Readable }>;
  export const prerender: (
    model: unknown,
    webpackMap: unknown,
    options?: unknown
  ) => Promise<{ prelude: ReadableStream }>;
}
