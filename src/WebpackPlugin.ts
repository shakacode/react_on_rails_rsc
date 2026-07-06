import { Compiler } from "webpack";
import {
  DEFAULT_CLIENT_REFERENCES_EXCLUDE,
  DEFAULT_CLIENT_REFERENCES_INCLUDE,
} from "./clientReferences";
import { RSCWebpackPlugin as RSCFlightWebpackPlugin } from "./webpack/RSCWebpackPlugin";

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
  chunkGroupWarningThreshold?: number | false,
  clientManifestFilename?: string,
  serverConsumerManifestFilename?: string,
  clientReferenceDiagnosticsFilename?: string | false,
  entryClientReferencesFilename?: string | false,
};

export class RSCWebpackPlugin {
  private plugin: RSCFlightWebpackPlugin;

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
    this.plugin = new RSCFlightWebpackPlugin(normalizedOptions);
  }

  apply(compiler: Compiler) {
    this.plugin.apply(compiler);
  }
}
