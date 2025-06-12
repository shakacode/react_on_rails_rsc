type ImportManifestEntry = {
  id: string,
  // chunks is a double indexed array of chunkId / chunkFilename pairs
  chunks: Array<string>,
  name: string,
  async?: boolean,
};

type FilePathToModuleMetadata = Record<string, ImportManifestEntry>;

export type BundleManifest = {
  moduleLoading: {
    prefix: string,
    crossOrigin: string | null,
  },
  filePathToModuleMetadata: FilePathToModuleMetadata,
};
