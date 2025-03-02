const { pathToFileURL } = require('url');

const RSCWebpackLoader = async function RSCWebpackLoader(source) {
  // Convert file path to URL format
  const fileUrl = pathToFileURL(this.resourcePath).href;

  const { load } = await import('./esm/react-server-dom-webpack-node-loader.production.js');
  const result = await load(fileUrl, null, async () => ({
    format: 'module',
    source,
  }));
  return result.source;
};

module.exports = {
  __esModule: true,
  default: RSCWebpackLoader,
};
