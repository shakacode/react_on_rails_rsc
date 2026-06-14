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
  export * from 'react-server-dom-webpack/server.node';
}

declare module 'react-server-dom-webpack/server.edge' {
  export * from 'react-server-dom-webpack/server.node';
}

declare module 'react-server-dom-webpack/server.node' {
  export const createClientModuleProxy: (moduleId: string) => unknown;
  export const createTemporaryReferenceSet: () => unknown;
  export const decodeAction: (...args: unknown[]) => unknown;
  export const decodeFormState: (...args: unknown[]) => unknown;
  export const decodeReply: (...args: unknown[]) => unknown;
  export const decodeReplyFromAsyncIterable: (...args: unknown[]) => unknown;
  export const decodeReplyFromBusboy: (...args: unknown[]) => unknown;
  export const registerClientReference: (
    proxyImplementation: unknown,
    id: string,
    exportName: string
  ) => unknown;
  export const registerServerReference: (
    reference: unknown,
    id: string,
    exportName: string
  ) => unknown;
  export const renderToPipeableStream: (
    model: unknown,
    webpackMap: unknown,
    options?: unknown
  ) => unknown;
  export const renderToReadableStream: (...args: unknown[]) => unknown;
}
