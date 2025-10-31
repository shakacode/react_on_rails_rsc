import * as React from 'react';
import { Suspense, use } from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import { renderToPipeableStream } from 'react-dom/server';
import { buildClientRenderer } from '../src/client.node';
import { PassThrough, Readable } from 'stream';
import { text } from 'stream/consumers';
import StreamReader from './StreamReader';

const { createFromNodeStream } = buildClientRenderer({
  filePathToModuleMetadata: {},
  moduleLoading: { prefix: '', crossOrigin: null },
}, {
  filePathToModuleMetadata: {},
  moduleLoading: { prefix: '', crossOrigin: null },
})

beforeAll(() => {
  execSync('NODE_CONDITIONS=react-server ENABLE_JEST_CONSOLE=y yarn jest tests/generateRSCPayloadChunks.rsc.test.tsx');
})

const chunksTmpFile = path.resolve(__dirname, '../tmp/AsyncQueueContainerRSCChunks.json');

test('file exists', async () => {
  expect(fs.existsSync(chunksTmpFile)).toBeTruthy();
});

const PromiseWrapper = ({ promise }: { promise: Promise<unknown> }) => {
  const element = use(promise) as React.ReactNode;
  return element;
}

const RSCRendererComponent = ({ stream }: { stream: Readable }) => {
  const renderPromise = createFromNodeStream(stream);

  return (
    <div>
      <h1>Parent Header</h1>
      <Suspense fallback={<p>Loading RSC Component</p>}>
        <PromiseWrapper promise={renderPromise} />
      </Suspense>
    </div>
  )
};

const createParallelRenders = (size: number) => {
  const chunksArray = JSON.parse(fs.readFileSync(chunksTmpFile).toString()) as string[];
  const chunkStreams = new Array(size).fill(null).map(() => new PassThrough());
  const renderStreams = chunkStreams.map(chunksStream => renderToPipeableStream(<RSCRendererComponent stream={chunksStream} />));

  const readers = renderStreams.map(renderStream => new StreamReader(renderStream));

  const enqueueNextChunk = () => {
    const nextChunk = chunksArray.shift();
    chunkStreams.forEach(chunkStream => chunkStream.push(nextChunk));
  }

  const expectNextChunk = async (expectedNextChunk: string) => {
    const allComponentChunks = await Promise.all(readers.map(reader => reader.nextChunk()));
    allComponentChunks.forEach((chunk) => expect(chunk).toEqual(expectedNextChunk));
  }
  
  const expectEndOfStream = () => Promise.all(
    readers.map(reader => expect(reader.nextChunk()).rejects.toThrow(/Queue Ended/))
  );

  return { enqueueNextChunk, expectNextChunk, expectEndOfStream };
}

test('renders HTML', async () => {
  const chunksArray = JSON.parse(fs.readFileSync(chunksTmpFile).toString());
  const chunksStream = new PassThrough();
  const stream = renderToPipeableStream(<RSCRendererComponent stream={chunksStream} />);
  
  const reader = new StreamReader(stream);
  const chunks = [];
  let chunk = await reader.nextChunk()
  chunks.push(chunk);
  expect(chunk).toContain("<h1>Parent Header</h1>");
  expect(chunk).toContain("<p>Loading RSC Component</p>");
  expect(chunk).not.toContain("Random Value");
  expect(chunk).not.toContain("Async Queue");

  chunksStream.push(chunksArray.shift());
  chunk = await reader.nextChunk()
  chunks.push(chunk);
  expect(chunk).toContain("<h1>Async Queue</h1>");
  expect(chunk).toContain("<p>Loading Item1</p>");
  expect(chunk).not.toContain("Loading Item2");
  expect(chunk).not.toContain("Random Value");

  chunksStream.push(chunksArray.shift());
  chunk = await reader.nextChunk();
  chunks.push(chunk);
  expect(chunk).toContain("Random Value1");
  expect(chunk).not.toContain("Loading Item1");
  expect(chunk).toContain("<p>Loading Item2</p>");

  chunksStream.push(chunksArray.shift());
  chunk = await reader.nextChunk();
  chunks.push(chunk);
  expect(chunk).toContain("Random Value2");

  chunksStream.push(chunksArray.shift());
  chunk = await reader.nextChunk();
  chunks.push(chunk);
  expect(chunk).toContain("Random Value3");

  await expect(reader.nextChunk()).rejects.toThrow(/Queue Ended/);
  expect(chunks).toHaveLength(5);

  const { enqueueNextChunk, expectNextChunk, expectEndOfStream } = createParallelRenders(10);
  
  await expectNextChunk(chunks[0]!);
  enqueueNextChunk();
  await expectNextChunk(chunks[1]!);
  enqueueNextChunk();
  await expectNextChunk(chunks[2]!);
  enqueueNextChunk();
  await expectNextChunk(chunks[3]!);
  enqueueNextChunk();
  await expectNextChunk(chunks[4]!);
  await expectEndOfStream();
});
