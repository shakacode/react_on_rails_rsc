import {
  createFromFetch as originalCreateFromFetch,
  createFromReadableStream as originalCreateFromReadableStream,
// @ts-expect-error Untyped module
} from 'react-server-dom-webpack/client';

// we don't care about options, so don't specify the type here
export const createFromFetch: <T>(res: Promise<Response>, options?: {}) => Promise<T> =
  originalCreateFromFetch;

export const createFromReadableStream: <T>(stream: ReadableStream, options?: {}) => Promise<T> =
  originalCreateFromReadableStream;
