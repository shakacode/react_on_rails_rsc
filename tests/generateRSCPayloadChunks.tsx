import * as React from 'react';
import { PassThrough, Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { text } from 'node:stream/consumers';
import { Suspense, PropsWithChildren } from 'react';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { buildServerRenderer } from '../src/server.node';

import AsyncQueue from './AsyncQueue';
import StreamReader from './StreamReader';
import AsyncQueueContainer from './AsyncQueueContainer';

const { renderToPipeableStream } = buildServerRenderer({
  filePathToModuleMetadata: {},
  moduleLoading: { prefix: '', crossOrigin: null },
});

async function generateRSCPayloadChunks() {
  const asyncQueue = new AsyncQueue();
  const stream = renderToPipeableStream(<AsyncQueueContainer asyncQueue={asyncQueue} />);
  const reader = new StreamReader(stream);

  const chunks: string[] = [];
  let chunk = await reader.nextChunk()
  chunks.push(chunk);

  asyncQueue.enqueue("Random Value1");
  chunk = await reader.nextChunk();
  chunks.push(chunk);

  asyncQueue.enqueue("Random Value2");
  chunk = await reader.nextChunk();
  chunks.push(chunk);

  asyncQueue.enqueue("Random Value3");
  chunk = await reader.nextChunk();
  chunks.push(chunk);

  await expect(reader.nextChunk()).rejects.toThrow(/Queue Ended/);
  try {
    await reader.nextChunk();
    throw new Error("Unexpected to have more chunks");
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes("Queue Ended")) {
      throw err;
    }
  }

  const chunksTmpFile = path.resolve(__dirname, '../tmp/AsyncQueueContainerRSCChunks.json');
  const tmpDirectory = path.dirname(chunksTmpFile);

  await fs.mkdir(tmpDirectory, { recursive: true });
  await fs.writeFile(chunksTmpFile, JSON.stringify(chunks, null, 2));
  console.log(`Written to: ${chunksTmpFile}`);
}

export default generateRSCPayloadChunks;
