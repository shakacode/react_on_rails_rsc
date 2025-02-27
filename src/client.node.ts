import type { ReactElement } from 'react';
// @ts-expect-error Untyped module
import { createFromNodeStream as originalCreateFromNodeStream } from 'react-server-dom-webpack/client.node';

// export const createFromNodeStream: (stream: NodeJS.ReadableStream, manifest: Record<string, unknown>) => Promise<ReactElement>;

export const createFromNodeStream: (
  stream: NodeJS.ReadableStream,
  manifest: Record<string, unknown>,
) => Promise<ReactElement> = originalCreateFromNodeStream;
