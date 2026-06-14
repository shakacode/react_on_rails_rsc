import { pathToFileURL } from 'url';
import { LoaderDefinition } from 'webpack';
import { recordDiscoveredClientReferenceIfNeeded } from './RSCReferenceDiscoveryPlugin';

const STOCK_SERVER_IMPORT = 'react-server-dom-webpack/server';
const PUBLIC_SERVER_IMPORT = 'react-on-rails-rsc/server';

const rewriteStockServerImport = (source: string | Buffer) => {
  const text = typeof source === 'string' ? source : source.toString('utf8');
  return text
    .split(`"${STOCK_SERVER_IMPORT}"`)
    .join(`"${PUBLIC_SERVER_IMPORT}"`)
    .split(`'${STOCK_SERVER_IMPORT}'`)
    .join(`'${PUBLIC_SERVER_IMPORT}'`);
};

const RSCWebpackLoader: LoaderDefinition = async function RSCWebpackLoader(source) {
  recordDiscoveredClientReferenceIfNeeded(this, source);

  // Convert file path to URL format
  const fileUrl = pathToFileURL(this.resourcePath).href;

  const { load } = await import('react-server-dom-webpack/node-loader');
  const result = await load(fileUrl, null, async () => ({
    format: 'module',
    source,
  }));
  return rewriteStockServerImport(result.source);
};

export default RSCWebpackLoader;
