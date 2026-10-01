import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { ParserPlugin } from '@babel/parser';
import { pathToFileURL } from 'url';
import { RSCWebpackPlugin } from '../src/WebpackPlugin';
import { RSCRspackPlugin } from '../src/react-server-dom-rspack/plugin';
import { cssWrapperRequest } from '../src/webpack/cssWrapperRequest';
import {
  getInjectionStateForCompiler,
  setInjectionStateForCompiler,
  setGeneratedChunkNamesForCompiler,
} from '../src/react-server-dom-rspack/injection-loader';

jest.setTimeout(120_000);

it('round-trips request delimiters and preserves default requests and escaped resources', () => {
  const parserPlugins = [['pipelineOperator', {
    proposal: 'hack', topicToken: '#', note: '!?#\0\u200b',
  }]] as unknown as ParserPlugin[];
  for (const resource of ['client.js', 'client\0?.js', 'client\u200b#.js']) {
    expect(cssWrapperRequest('loader', resource, [])).toBe(`!!loader!${resource}`);
    const request = cssWrapperRequest('loader', resource, parserPlugins);
    const query = request.slice('!!loader?'.length, request.indexOf('!', 2));
    expect(query).not.toMatch(/[!?#\0\u200b]/);
    expect(JSON.parse(query)).toEqual({ parserPlugins });
    expect(request.endsWith(`!${resource}`)).toBe(true);
  }
});

it('keeps parser configuration isolated between rspack compilers', () => {
  const first = {};
  const second = {};
  setInjectionStateForCompiler(first, ['a.js'], 'a', true, ['decorators']);
  setInjectionStateForCompiler(second, ['b.js'], 'b', true, []);
  setGeneratedChunkNamesForCompiler(first, ['a0']);
  expect(getInjectionStateForCompiler(first).parserPlugins).toEqual(['decorators']);
  expect(getInjectionStateForCompiler(second).parserPlugins).toEqual([]);
  expect(getInjectionStateForCompiler({}).parserPlugins).toEqual([]);
});

describe.each(['webpack', 'rspack'])('%s wrapper proposal syntax', (bundler) => {
  it.each([false, true])('preserves exports with named=%s', (named) => {
    const context = fs.mkdtempSync(path.join(os.tmpdir(), 'rsc-wrapper-proposal-'));
    try {
      fs.writeFileSync(path.join(context, 'Client.js'),
        '"use client";\nconst value = 1 |> # + 1;\nexport default function Default() { return value; }\n' +
        (named ? 'export * from "./Target.js";\n' : ''));
      if (named) fs.writeFileSync(path.join(context, 'Target.js'),
        'const value = 1 |> # + 1;\nexport function Named() { return value; }\n');
      const run = (configured: boolean) => JSON.parse(execFileSync(process.execPath, [
        path.join(__dirname, 'helpers/runWrapperProposal.js'), bundler, context, String(configured),
      ], { encoding: 'utf8' }));
      // The application's transform accepts the proposal, but the raw wrapper scan does not.
      expect(JSON.stringify(run(false).errors)).toMatch(/pipelineOperator|pipeline operator/);
      const result = run(true);
      expect(result.errors).toEqual([]);
      expect(result.wrappers).toHaveLength(1);
      expect(result.wrappers[0].source).toContain('export default');
      expect(result.wrappers[0].source.includes('export var Named')).toBe(named);
      expect(result.exports).toEqual(named ? ['Named', 'default'] : ['default']);
      expect(result.values).toEqual(named ? { Named: 2, default: 2 } : { default: 2 });
      expect(Object.keys(result.manifest.filePathToModuleMetadata)).toEqual([
        pathToFileURL(fs.realpathSync(path.join(context, 'Client.js'))).href,
      ]);
      // Reserved request delimiters must survive as JSON values, never become loader separators.
      expect(result.wrappers[0].request).toContain('pipelineOperator');
    } finally {
      fs.rmSync(context, { recursive: true, force: true });
    }
  });
});

describe.each([RSCWebpackPlugin, RSCRspackPlugin])('%p parserPlugins validation', (Plugin) => {
  it.each([null, {}, 'pipelineOperator', [42], [['pipelineOperator']], [['x', {}, 'extra']]])(
    'rejects malformed options %p even without cssWrapper', (parserPlugins) => {
      expect(() => new Plugin({ isServer: false, parserPlugins } as never)).toThrow(/parserPlugins/);
    }
  );
  it('accepts omitted, empty, string and tuple plugins', () => {
    for (const parserPlugins of [undefined, [], ['decorators'], [['pipelineOperator', { proposal: 'hack', topicToken: '#' }]]]) {
      expect(() => new Plugin({ isServer: false, parserPlugins } as never)).not.toThrow();
    }
  });
});
