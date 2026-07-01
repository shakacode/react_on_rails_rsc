import * as React from 'react';
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import {
  preconnect,
  prefetchDNS,
  preinitScript,
  preinitStyle,
  preloadAsset,
  preloadFont,
  preloadImage,
  preloadScript,
  preloadStyle,
  renderToPipeableStream,
} from '../src/flight-server.node';

const emptyWebpackMap = {};

type PipeableStreamLike = {
  pipe(destination: PassThrough): unknown;
};

const renderToText = async (model: unknown): Promise<string> => {
  const stream = renderToPipeableStream(model, emptyWebpackMap) as PipeableStreamLike;
  const readable = new PassThrough();
  stream.pipe(readable);
  return text(readable);
};

describe('React Flight resource hint helpers', () => {
  it('serializes critical RSC resource hints during server rendering', async () => {
    const HintedPage = () => {
      prefetchDNS('https://cdn.example.com');
      preconnect('https://assets.example.com', { crossOrigin: 'anonymous' });
      preloadStyle('/packs/generated/WelcomePage.css', { fetchPriority: 'high' });
      preinitStyle('/packs/generated/critical.css');
      preinitStyle('/packs/generated/default-precedence.css', { precedence: undefined });
      preloadScript('/packs/generated/WelcomePage.js');
      preinitScript('/packs/generated/bootstrap.js', { fetchPriority: 'high' });
      preloadFont('/fonts/poppins-600.woff2', { type: 'font/woff2' });
      preloadImage('/images/listing-price-comparison.webp', {
        fetchPriority: 'high',
        imageSrcSet:
          '/images/listing-price-comparison.webp 1x, /images/listing-price-comparison@2x.webp 2x',
        imageSizes: '100vw',
      });
      preloadAsset('/packs/generated/manifest.json', {
        as: 'fetch',
        crossOrigin: 'anonymous',
      });

      return React.createElement('h1', null, 'Critical resource hints');
    };

    const payload = await renderToText(React.createElement(HintedPage));

    expect(payload).toContain(':HD"https://cdn.example.com"');
    expect(payload).toContain(':HC["https://assets.example.com",""]');
    expect(payload).toContain(':HL["/packs/generated/WelcomePage.css","style"');
    expect(payload).toContain(':HS["/packs/generated/critical.css","rsc-css"]');
    expect(payload).toContain(':HS["/packs/generated/default-precedence.css","rsc-css"]');
    expect(payload).toContain(':HL["/packs/generated/WelcomePage.js","script"');
    expect(payload).toContain(':HX["/packs/generated/bootstrap.js"');
    expect(payload).toContain(
      ':HL["/fonts/poppins-600.woff2","font",{"crossOrigin":"","type":"font/woff2"}]'
    );
    expect(payload).toContain('/images/listing-price-comparison.webp');
    expect(payload).toContain('"fetchPriority":"high"');
    expect(payload).toContain('"imageSizes":"100vw"');
    expect(payload).toContain(':HL["/packs/generated/manifest.json","fetch"');
    expect(payload).toContain('Critical resource hints');
  });
});
