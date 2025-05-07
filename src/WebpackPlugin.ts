import { Compiler } from "webpack";
import RSCWebpackPluginLib = require("./react-server-dom-webpack/plugin");

type ReactFlightWebpackPlugin = {
  apply(compiler: Compiler): void;
};

type ReactFlightWebpackPluginConstructor = {
  new (options: unknown): ReactFlightWebpackPlugin;
};

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

export class RSCWebpackPlugin {
  private plugin?: ReactFlightWebpackPlugin;

  constructor(options: Options) {
    if (!options.isServer) {
      this.plugin = new (RSCWebpackPluginLib as ReactFlightWebpackPluginConstructor)(options);
    }
  }

  apply(compiler: Compiler) {
    this.plugin?.apply(compiler);
  }
}
