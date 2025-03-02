import { Compiler } from "webpack";

declare class ReactFlightWebpackPlugin {
  constructor(options: unknown);
  apply(compiler: Compiler): void;
}

export = ReactFlightWebpackPlugin;
