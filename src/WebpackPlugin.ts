import { Compiler } from "webpack";
import {
  DEFAULT_CLIENT_REFERENCES_EXCLUDE,
  DEFAULT_CLIENT_REFERENCES_INCLUDE,
} from "./clientReferences";
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
  private plugin: ReactFlightWebpackPlugin;

  constructor(options: Options) {
    const normalizedOptions =
      options.clientReferences === undefined
        ? {
            ...options,
            clientReferences: [
              {
                directory: '.',
                recursive: true,
                include: DEFAULT_CLIENT_REFERENCES_INCLUDE,
                exclude: DEFAULT_CLIENT_REFERENCES_EXCLUDE,
              },
            ],
          }
        : options;
    this.plugin = new (RSCWebpackPluginLib as ReactFlightWebpackPluginConstructor)(normalizedOptions);
  }

  apply(compiler: Compiler) {
    this.plugin.apply(compiler);
  }
}
