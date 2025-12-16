import * as fs from 'fs';
import * as path from 'path';
import generateRSCPayloadChunks from './generateRSCPayloadChunks';

test('file exists', async () => {
  await generateRSCPayloadChunks();
  const chunksTmpFile = path.resolve(__dirname, '../tmp/AsyncQueueContainerRSCChunks.json');
  expect(fs.existsSync(chunksTmpFile)).toBeTruthy();
});
