import { PassThrough, Readable } from 'node:stream';
import AsyncQueue from './AsyncQueue';

class StreamReader {
  private asyncQueue: AsyncQueue;

  constructor(pipeableStream: Pick<Readable, 'pipe'>) {
    this.asyncQueue = new AsyncQueue();
    const decoder = new TextDecoder();

    const readableStream = new PassThrough();
    pipeableStream.pipe(readableStream);

    readableStream.on('data', (chunk) => {
      const decodedChunk = decoder.decode(chunk, { stream: true });
      this.asyncQueue.enqueue(decodedChunk);
    });

    readableStream.on('end', () => {
      // Flush any remaining bytes in the decoder
      const remaining = decoder.decode();
      if (remaining) {
        this.asyncQueue.enqueue(remaining);
      }
      this.asyncQueue.end();
    });
  }

  nextChunk() {
    return this.asyncQueue.dequeue();
  }
}

export default StreamReader;
