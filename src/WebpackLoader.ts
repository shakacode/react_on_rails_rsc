import { pathToFileURL } from 'url';
import { LoaderDefinition } from 'webpack';

const RSCWebpackLoader: LoaderDefinition = async function RSCWebpackLoader(source) {
  // Convert file path to URL format
  const fileUrl = pathToFileURL(this.resourcePath).href;

  const { load } = await import('react-server-dom-webpack/node-loader');
  const result = await load(fileUrl, null, async () => ({
    format: 'module',
    source,
  }));
  return result.source;
};

export default RSCWebpackLoader;
