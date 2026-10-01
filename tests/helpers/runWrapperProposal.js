const fs = require('fs');
const path = require('path');
const [bundler, context, configured] = process.argv.slice(2);
const root = path.resolve(__dirname, '../..');
const pluginRoot = process.env.RSC_TEST_PLUGIN_ROOT || root;
const webpack = bundler === 'webpack' ? require('webpack') : require('@rspack/core').rspack;
const Plugin = bundler === 'webpack'
  ? require(path.join(pluginRoot, 'dist/WebpackPlugin')).RSCWebpackPlugin
  : require(path.join(pluginRoot, 'dist/react-server-dom-rspack/plugin')).RSCRspackPlugin;
const options = {
  isServer: true,
  cssWrapper: true,
  clientReferences: [path.join(context, 'Client.js')],
};
const runtime = require.resolve('react-server-dom-webpack/client.node');
fs.writeFileSync(path.join(context, 'entry.js'),
  `require(${JSON.stringify(runtime)}); exports.load = __webpack_require__;\n`);
if (configured === 'true') {
  options.parserPlugins = [['pipelineOperator', { proposal: 'hack', topicToken: '#' }]];
}
const compiler = webpack({
  mode: 'development',
  target: 'node',
  context,
  entry: './entry.js',
  output: { path: path.join(context, 'output'), filename: 'main.js', publicPath: '/assets/', library: { type: 'commonjs2' } },
  resolve: { modules: [path.join(root, 'node_modules'), 'node_modules'] },
  module: { rules: [{ test: /(?:Client|Target)\.js$/, use: path.join(__dirname, 'proposalSyntaxLoader.js') }] },
  optimization: { minimize: false, concatenateModules: false },
  plugins: [new Plugin(options)],
});
compiler.run(async (err, stats) => {
  const result = { errors: err ? [err.message] : stats.toJson({ all: false, errors: true }).errors };
  if (!err && !stats.hasErrors()) {
    const wrappers = [...stats.compilation.modules].filter(m => m.identifier().includes('rscCssWrapperLoader'));
    result.wrappers = wrappers.map(m => ({ request: m.identifier(), source: String(m.originalSource().source()) }));
    result.manifest = JSON.parse(fs.readFileSync(path.join(context, 'output/react-server-client-manifest.json'), 'utf8'));
    try {
      const load = require(path.join(context, 'output/main.js')).load;
      const metadata = Object.values(result.manifest.filePathToModuleMetadata)[0];
      for (let i = 0; i < metadata.chunks.length; i += 2) await load.e(metadata.chunks[i]);
      const exports = load(metadata.id);
      result.exports = Object.keys(exports).sort();
      result.values = Object.fromEntries(Object.entries(exports).map(([name, component]) => {
        const fragment = component.render({}, null);
        return [name, fragment.props.children[1].type()];
      }));
    } catch (error) { result.errors.push(error.message); }
  }
  compiler.close(() => process.stdout.write(JSON.stringify(result)));
});
