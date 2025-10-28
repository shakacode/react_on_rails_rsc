import * as React from 'react';
import { PassThrough, Readable } from 'node:stream';
import { Suspense, PropsWithChildren } from 'react';
import { buildServerRenderer } from '../src/server.node';

import AsyncQueue from './AsyncQueue';
import StreamReader from './StreamReader';

const AsyncQueueItem = async ({ asyncQueue, children  }: PropsWithChildren<{asyncQueue: AsyncQueue<string>}>) => {
  const value = await asyncQueue.dequeue();

  return (
    <>
      <p>Data: {value}</p>
      {children}
    </>
  )
}

const AsyncQueueContainer = ({ asyncQueue }: { asyncQueue: AsyncQueue<string> }) => {
  return (
    <div>
      <h1>Async Queue</h1>
      <Suspense fallback={<p>Loading Item1</p>}>
        <AsyncQueueItem asyncQueue={asyncQueue}>
          <Suspense fallback={<p>Loading Item2</p>}>
            <AsyncQueueItem asyncQueue={asyncQueue}>
              <Suspense fallback={<p>Loading Item3</p>}>
                <AsyncQueueItem asyncQueue={asyncQueue} />
              </Suspense>
            </AsyncQueueItem>
          </Suspense>
        </AsyncQueueItem>
      </Suspense>
    </div>
  )
}

const { renderToPipeableStream } = buildServerRenderer({
  filePathToModuleMetadata: {},
  moduleLoading: { prefix: '', crossOrigin: null },
});

const createParallelRenders = (size: number) => {
  const asyncQueues = new Array(size).fill(null).map(() => new AsyncQueue<string>());
  const streams = asyncQueues.map((asyncQueue) => {
    return renderToPipeableStream(<AsyncQueueContainer asyncQueue={asyncQueue} />);
  });
  const readers = streams.map(stream => new StreamReader(stream));

  const enqueue = (value: string) => asyncQueues.forEach(asyncQueues => asyncQueues.enqueue(value));

  const removeComponentJsonData = (chunk: string) => {
    return chunk.split('\n').map(chunkLine => {
      if (!chunkLine.includes('"stack":')) {
        return chunkLine;
      }

      const regexMatch = /(^\d+):\{/.exec(chunkLine)
      if (!regexMatch) {
        return;
      }

      const chunkJsonString = chunkLine.slice(chunkLine.indexOf('{'));
      const chunkJson = JSON.parse(chunkJsonString);
      delete chunkJson.stack;
      return `${regexMatch[1]}:${JSON.stringify(chunkJson)}`
    })
  }

  const expectNextChunk = (nextChunk: string) => Promise.all(
    readers.map(async (reader) => {
      const chunk = await reader.nextChunk();
      expect(removeComponentJsonData(chunk)).toEqual(removeComponentJsonData(nextChunk));
    })
  );
  
  const expectEndOfStream = () => Promise.all(
    readers.map(reader => expect(reader.nextChunk()).rejects.toThrow(/Queue Ended/))
  );

  return { enqueue, expectNextChunk, expectEndOfStream };
}

test('Renders concurrent rsc streams as single rsc stream', async () => {
  expect.assertions(258);
  const asyncQueue = new AsyncQueue<string>();
  const stream = renderToPipeableStream(<AsyncQueueContainer asyncQueue={asyncQueue} />);
  const reader = new StreamReader(stream);

  const chunks: string[] = [];
  let chunk = await reader.nextChunk()
  chunks.push(chunk);
  expect(chunk).toContain("Async Queue");
  expect(chunk).toContain("Loading Item2");
  expect(chunk).not.toContain("Random Value");

  asyncQueue.enqueue("Random Value1");
  chunk = await reader.nextChunk();
  chunks.push(chunk);
  expect(chunk).toContain("Random Value1");

  asyncQueue.enqueue("Random Value2");
  chunk = await reader.nextChunk();
  chunks.push(chunk);
  expect(chunk).toContain("Random Value2");

  asyncQueue.enqueue("Random Value3");
  chunk = await reader.nextChunk();
  chunks.push(chunk);
  expect(chunk).toContain("Random Value3");

  await expect(reader.nextChunk()).rejects.toThrow(/Queue Ended/);

  const { enqueue, expectNextChunk, expectEndOfStream } = createParallelRenders(50);

  expect(chunks).toHaveLength(4);
  await expectNextChunk(chunks[0]!);
  enqueue("Random Value1");
  await expectNextChunk(chunks[1]!);
  enqueue("Random Value2");
  await expectNextChunk(chunks[2]!);
  enqueue("Random Value3");
  await expectNextChunk(chunks[3]!);
  await expectEndOfStream();
});