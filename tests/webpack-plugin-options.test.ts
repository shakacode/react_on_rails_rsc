import {
  DEFAULT_CLIENT_REFERENCES_EXCLUDE,
  DEFAULT_CLIENT_REFERENCES_INCLUDE,
} from '../src/clientReferences';
import { RSCWebpackPlugin } from '../src/WebpackPlugin';

describe('RSCWebpackPlugin clientReferences defaults', () => {
  it('uses the shared dependency and generated directory exclusions by default', () => {
    const wrapper = new RSCWebpackPlugin({ isServer: false });
    // RSCWebpackPlugin delegates to the upstream webpack plugin, so this keeps
    // the option normalization check focused without running a full compilation.
    const plugin = (wrapper as unknown as { plugin: { clientReferences: unknown[] } }).plugin;

    expect(plugin).toBeDefined();
    expect(plugin.clientReferences).toEqual([
      {
        directory: '.',
        recursive: true,
        include: DEFAULT_CLIENT_REFERENCES_INCLUDE,
        exclude: DEFAULT_CLIENT_REFERENCES_EXCLUDE,
      },
    ]);
  });
});
