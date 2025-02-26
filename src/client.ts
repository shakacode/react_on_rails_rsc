import {
  createFromFetch as originalCreateFromFetch,
  createFromReadableStream as originalCreateFromReadableStream,
} from 'react-server-dom-webpack/client';

export function createFromFetch<T>(res: Promise<Response>): Promise<T> {
  return originalCreateFromFetch(res);
}

export function createFromReadableStream<T>(stream: ReadableStream): Promise<T> {
  return originalCreateFromReadableStream(stream);
}
