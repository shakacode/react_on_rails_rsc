import { createFromNodeStream as originalCreateFromNodeStream } from 'react-server-dom-webpack/client.node';
import { BundleManifest } from './types';

export interface NodeReadableStream {
  on(event: string | symbol, listener: (...args: any[]) => unknown): unknown;
}

type NodeReadableWithDestroy = NodeReadableStream & {
  destroy?: (error?: unknown) => void;
};

const withStreamDataErrorForwarding = (stream: NodeReadableStream): NodeReadableStream => {
  const readable = stream as NodeReadableWithDestroy;
  const originalOn = readable.on.bind(readable);

  return new Proxy(readable, {
    get(target, property, receiver) {
      if (property !== 'on') {
        return Reflect.get(target, property, receiver);
      }

      return (event: string | symbol, listener: (...args: any[]) => unknown) => {
        if (event !== 'data' || typeof listener !== 'function') {
          originalOn(event, listener);
          // Keep chained .on() calls on the proxy so data listeners remain wrapped.
          return receiver;
        }

        originalOn(event, function forwardDataErrors(this: unknown, ...args: unknown[]) {
          try {
            return listener.apply(this, args);
          } catch (error) {
            if (typeof target.destroy === 'function') {
              target.destroy(error);
              return undefined;
            }
            throw error;
          }
        });
        return receiver;
      };
    },
  }) as NodeReadableStream;
};

const createFromNodeStream = <T>(
  stream: NodeReadableStream,
  ssrManifest: unknown,
) =>
  originalCreateFromNodeStream<T>(
    withStreamDataErrorForwarding(stream) as NodeJS.ReadableStream,
    ssrManifest,
  );

const createSSRManifest = (clientManifest: BundleManifest, serverManifest: BundleManifest) => {
  const { filePathToModuleMetadata: clientFilePathToModuleMetadata, moduleLoading: clientModuleLoading } = clientManifest;

  const { filePathToModuleMetadata: serverFilePathToModuleMetadata } = serverManifest;

  const moduleMap: Record<string, unknown> = {};
  Object.entries(clientFilePathToModuleMetadata).forEach(([aboluteFileUrl, clientFileBundlingInfo]) => {
    const serverModuleMetadata = serverFilePathToModuleMetadata[aboluteFileUrl];
    if (!serverModuleMetadata) {
      throw new Error(`Server module metadata not found for ${aboluteFileUrl}`);
    }

    const { id, chunks } = serverModuleMetadata;
    moduleMap[clientFileBundlingInfo.id] = {
      '*': {
        id,
        chunks,
        name: '*',
      },
    };
  });

  return {
    // The `moduleLoading` property is utilized by the React runtime to load JavaScript modules on the browser.
    // It can accept options such as `prefix` and `crossOrigin` to specify the path and crossorigin attribute for the modules.
    // In our case, we set it to the client module loading options as it contains the prefix and crossOrigin of the client bundle.
    moduleLoading: clientModuleLoading,
    moduleMap,
  };
}

export const buildClientRenderer = (clientManifest: BundleManifest, serverManifest: BundleManifest) => {
  const ssrManifest = createSSRManifest(clientManifest, serverManifest);
  return {
    createFromNodeStream: <T>(
      stream: NodeReadableStream,
    ) => createFromNodeStream(stream, ssrManifest) as Promise<T>,
    ssrManifest,
  }
};
