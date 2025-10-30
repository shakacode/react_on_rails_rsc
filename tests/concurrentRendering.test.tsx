import * as React from 'react';
import { PassThrough, Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
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

const PromiseWrapperWithLogs = async ({ promise, name }: { promise: Promise<string>, name: string }) => {
  console.log(`[${name}] Before Awaiting`)
  const value = await promise;
  console.log(`[${name}] After Awaiting`)

  return <p>Component [{name}] Resolved with value: [{value}]</p>;
};

const PromiseContainerWithLogs = ({ name }: { name: string }) => {
  const promise = new Promise<string>((resolve) => {
    let i = 0;
    const intervalId = setInterval(() => {
      console.log(`Interval ${i} at [${name}]`);
      i += 1;
      if (i === 50) {
        clearInterval(intervalId);
        resolve(`Value of name ${name}`);
      }
    }, 1);
  });

  return (
    <div>
      <h1>Initial Header</h1>
      <Suspense fallback={<p>Loading [{name}]</p>}>
        <PromiseWrapperWithLogs promise={promise} name={name} />
      </Suspense>
    </div>
  );
};

test('no console leakage between components', async() => {
  const element1 = <PromiseContainerWithLogs name="First Unique Name" />;
  const element2 = <PromiseContainerWithLogs name="Second Unique Name" />;

  const stream1 = renderToPipeableStream(element1);
  const stream2 = renderToPipeableStream(element2);

  const readable1 = new PassThrough();
  stream1.pipe(readable1);
  const readable2 = new PassThrough();
  stream2.pipe(readable2);

  const [content1, content2] = await Promise.all([text(readable1), text(readable2)]);

  expect(content1).toContain("First Unique Name");
  expect(content2).toContain("Second Unique Name");
  expect(content1.match(/First Unique Name/g)).toHaveLength(57)
  expect(content2.match(/Second Unique Name/g)).toHaveLength(57)
  expect(content1).not.toContain("Second Unique Name");
  expect(content2).not.toContain("First Unique Name");

  expect(content1.replace(new RegExp("First Unique Name", 'g'), "Second Unique Name")).toEqual(content2);
});

test("doesn't catch logs from outside the component", async() => {
  const element1 = <PromiseContainerWithLogs name="First Unique Name" />;
  const stream1 = renderToPipeableStream(element1);
  const readable1 = new PassThrough();
  stream1.pipe(readable1);

  const outsideComponentPromise = new Promise<void>((resolve) => {
    let i = 0;
    const intervalId = setInterval(() => {
      console.log(`Interval ${i} at [Outside The Component]`);
      i += 1;
      if (i === 50) {
        clearInterval(intervalId);
        resolve();
      }
    }, 1);
  });

  const [content1] = await Promise.all([text(readable1), outsideComponentPromise]);

  expect(content1).toContain("First Unique Name");
  expect(content1.match(/First Unique Name/g)).toHaveLength(57)
  expect(content1).not.toContain("Outside The Component");
});
