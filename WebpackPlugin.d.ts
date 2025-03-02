import { Compiler } from "webpack";

type ClientReferenceSearchPath = {
  directory: string,
  recursive?: boolean,
  include: RegExp,
  exclude?: RegExp,
};

type ClientReferencePath = string | ClientReferenceSearchPath;

export type Options = {
  isServer: boolean,
  clientReferences?: ClientReferencePath | ReadonlyArray<ClientReferencePath>,
  chunkName?: string,
  clientManifestFilename?: string,
  serverConsumerManifestFilename?: string,
};

export declare class RSCWebpackPlugin {
  constructor(options: Options);
  apply(compiler: Compiler): void;
}
