import * as React from 'react';
import { Suspense, PropsWithChildren } from 'react';

import AsyncQueue from './AsyncQueue';

const AsyncQueueItem = async ({ asyncQueue, children  }: PropsWithChildren<{asyncQueue: AsyncQueue}>) => {
  const value = await asyncQueue.dequeue();

  return (
    <>
      <p>Data: {value}</p>
      {children}
    </>
  )
}

const AsyncQueueContainer = ({ asyncQueue }: { asyncQueue: AsyncQueue }) => {
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

export default AsyncQueueContainer;
