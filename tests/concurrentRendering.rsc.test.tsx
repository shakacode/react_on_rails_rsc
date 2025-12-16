import * as React from 'react';
import { PassThrough, Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { text } from 'node:stream/consumers';
import { Suspense, PropsWithChildren } from 'react';
import { buildServerRenderer } from '../src/server.node';

import AsyncQueue from './AsyncQueue';
import StreamReader from './StreamReader';
import AsyncQueueContainer from './AsyncQueueContainer';

const { renderToPipeableStream } = buildServerRenderer({
  filePathToModuleMetadata: {},
  moduleLoading: { prefix: '', crossOrigin: null },
});

const removeComponentJsonData = (chunk: string) => {
  return chunk.split('\n').map(chunkLine => {
    if (/^[0-9a-fA-F]+\:D/.exec(chunkLine) || chunkLine.startsWith(':N')) {
      return '';
    }
    if (!(chunkLine.includes('"stack":') || chunkLine.includes('"start":') || chunkLine.includes('"end":'))) {
      return chunkLine;
    }

    const regexMatch = /([^\{]+)\{/.exec(chunkLine)
    if (!regexMatch) {
      return chunkLine;
    }

    const chunkJsonString = chunkLine.slice(chunkLine.indexOf('{'));
    try {
      const chunkJson = JSON.parse(chunkJsonString);
      delete chunkJson.stack;
      delete chunkJson.start;
      delete chunkJson.end;
      return `${regexMatch[1]}${JSON.stringify(chunkJson)}`
    } catch {
      return chunkLine
    }
  })
}

const createParallelRenders = (size: number) => {
  const asyncQueues = new Array(size).fill(null).map(() => new AsyncQueue());
  const streams = asyncQueues.map((asyncQueue) => {
    return renderToPipeableStream(<AsyncQueueContainer asyncQueue={asyncQueue} />);
  });
  const readers = streams.map(stream => new StreamReader(stream));

  const enqueue = (value: string) => asyncQueues.forEach(asyncQueue => asyncQueue.enqueue(value));

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
  // expect.assertions(258);
  const asyncQueue = new AsyncQueue();
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
}, 1000000);

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

  expect(removeComponentJsonData(
    content1.replace(new RegExp("First Unique Name", 'g'), "Second Unique Name"),
  )).toEqual(removeComponentJsonData(content2));
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

// That's a bug at React and will be reported to React
test("[bug] catches logs outside the component during reading the stream", async() => {
  const element1 = <PromiseContainerWithLogs name="First Unique Name" />;
  const stream1 = renderToPipeableStream(element1);
  const readable1 = new PassThrough();
  stream1.pipe(readable1);

  let content1 = "";
  let i = 0;
  readable1.on('data', (chunk) => {
    i += 1;
    // To avoid infinite loop
    if (i < 5) {
      console.log("Outside The Component");
    }
    content1 += chunk.toString();
  });
  await finished(readable1);

  expect(content1).toContain("First Unique Name");
  expect(content1.match(/First Unique Name/g)).toHaveLength(57)
  // Here's the bug
  expect(content1).toContain("Outside The Component");
});

const ContainerWithError = () => {
  const rejectedPromise = new Promise<string>((_, reject) => {
    setTimeout(() => reject("Fake Error"), 10);
  });
  const resolvedPromise = new Promise<string>(resolve => {
    setTimeout(() => resolve(""), 100);
  });
  return (
    <div>
      <h1>Header</h1>
      <Suspense fallback={<p>Loading Promise</p>}>
        <PromiseWrapperWithLogs name='' promise={rejectedPromise} />
      </Suspense>
      <Suspense fallback={<p>Loading Promise2</p>}>
        <PromiseWrapperWithLogs name='' promise={resolvedPromise} />
      </Suspense>
    </div>
  )
}

test("onError callback doesn't have the logs leakage bug", async () => {
  const element1 = <ContainerWithError />;
  let receivedError = '';
  const stream1 = renderToPipeableStream(element1, {
    onError: (err) => {
      console.error("Inside onError callback", err);
      receivedError = err as string;
    }
  });
  const readable1 = new PassThrough();
  stream1.pipe(readable1);

  let content = "";
  readable1.on('data', (chunk: Buffer) => {
    content += chunk.toString();
  });
  await finished(readable1);
  expect(content).not.toContain("Inside onError callback");
  expect(receivedError).toBe('Fake Error');
})
