declare module 'react-server-dom-webpack/node-loader' {
  interface LoadOptions {
    format: 'module';
    source: string;
  }

  interface LoadResult {
    source: string;
  }

  export function load(
    url: string,
    context: null | object,
    defaultLoad: () => Promise<LoadOptions>
  ): Promise<LoadResult>;
}

declare module 'react-server-dom-webpack/plugin' {
  import { Compiler } from "webpack";

  class ReactFlightWebpackPlugin {
    constructor(options: unknown);
    apply(compiler: Compiler): void;
  }

  export = ReactFlightWebpackPlugin;
}
