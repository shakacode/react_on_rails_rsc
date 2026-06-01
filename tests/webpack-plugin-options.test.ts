import { DEFAULT_CLIENT_REFERENCES_EXCLUDE } from '../src/clientReferences';
import { RSCWebpackPlugin } from '../src/WebpackPlugin';

describe('RSCWebpackPlugin clientReferences defaults', () => {
  it('uses the shared dependency and generated directory exclusions by default', () => {
    const wrapper = new RSCWebpackPlugin({ isServer: false });
    const plugin = (wrapper as unknown as { plugin: { clientReferences: unknown[] } }).plugin;

    expect(plugin.clientReferences).toEqual([
      {
        directory: '.',
        recursive: true,
        include: /\.[cm]?[jt]sx?$/,
        exclude: DEFAULT_CLIENT_REFERENCES_EXCLUDE,
      },
    ]);
  });
});
