const RSCWebpackPluginLib = require("./plugin.js");

class RSCWebpackPlugin {
  constructor(options) {
    if (!options.isServer) {
      this.plugin = new RSCWebpackPluginLib(options);
    }
  }

  apply(compiler) {
    this.plugin?.apply(compiler);
  }
}

module.exports = { RSCWebpackPlugin };
