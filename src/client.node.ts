import { createFromNodeStream } from './react-server-dom-webpack/client.node';
import { BundleManifest } from './types';

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
      stream: NodeJS.ReadableStream,
    ) => createFromNodeStream(stream, ssrManifest) as Promise<T>,
    ssrManifest,
  }
};
