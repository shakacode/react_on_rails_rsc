import { createFromNodeStream as originalCreateFromNodeStream } from './react-server-dom-webpack/client.node';

export const createFromNodeStream: <T>(
  stream: NodeJS.ReadableStream,
  manifest: Record<string, unknown>,
) => Promise<T> = originalCreateFromNodeStream;
