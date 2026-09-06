#!/usr/bin/env node
/**
 * Client hydration in jsdom.
 *
 * Usage: node scripts/hydrate.js <webpack|rspack> [boundary-first|shared-first|omit-shared-from-flight]
 *
 * Serves the client build over a local HTTP server (publicPath /assets/),
 * loads a page whose body contains the SSR HTML, executes the real client
 * bundle (webpack/rspack runtime + async chunk loading via script tags),
 * hydrates with the captured Flight payload, and clicks the counter.
 *
 * Reports JSON with console errors/warnings, recoverable hydration errors,
 * stylesheet <link>s the Flight runtime preinits into <head>, the devtools
 * renderer registrations (embedded runtime version check), and the counter
 * text before/after the click.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { MessageChannel, MessagePort } = require('worker_threads');

const bundlerName = process.argv[2];
const scenario = process.argv[3] || 'boundary-first';
if (!['boundary-first', 'shared-first', 'omit-shared-from-flight'].includes(scenario)) {
  process.stderr.write(`Unknown hydration scenario: ${scenario}\n`);
  process.exit(2);
}
const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.join(projectRoot, 'build', bundlerName);
const clientDir = path.join(buildDir, 'client');

const ssrHtml = fs.readFileSync(path.join(buildDir, 'ssr.html'), 'utf8');
const originalPayload = fs.readFileSync(path.join(buildDir, 'flight-payload.rsc'), 'utf8');
const flightChunkFiles = [
  ...new Set(
    [...originalPayload.matchAll(/^[0-9a-f]+:I(\[.*\])$/gm)].flatMap((match) => {
      const chunks = JSON.parse(match[1])[1];
      return chunks.filter((_, index) => index % 2 === 1);
    }),
  ),
];
const sharedChunkFile = flightChunkFiles.find((file) => file === 'shared-format.chunk.js');
const firstBoundaryChunkFile = flightChunkFiles.find(
  (file) => file.startsWith('client-') && file.endsWith('.chunk.js'),
);

let omittedSharedChunkPairs = 0;
const payload =
  scenario === 'omit-shared-from-flight'
    ? originalPayload.replace(/^([0-9a-f]+:I)(\[.*\])$/gm, (_match, prefix, json) => {
        const row = JSON.parse(json);
        const chunks = row[1];
        const filtered = [];
        for (let index = 0; index < chunks.length; index += 2) {
          if (chunks[index + 1] === 'shared-format.chunk.js') {
            omittedSharedChunkPairs += 1;
          } else {
            filtered.push(chunks[index], chunks[index + 1]);
          }
        }
        row[1] = filtered;
        return `${prefix}${JSON.stringify(row)}`;
      })
    : originalPayload;

const CONTENT_TYPES = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

const pageHtml = [
  '<!doctype html><html><head><meta charset="utf-8"></head><body>',
  `<div id="root">${ssrHtml}</div>`,
  '<script src="/assets/runtime.js"></script>',
  '<script src="/assets/main.js"></script>',
  '</body></html>',
].join('');

const fail = (message) => {
  process.stdout.write(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
};

const consoleMessages = [];
const devtoolsRenderers = [];
const assetRequests = [];
const assetEvents = [];

const run = async (origin) => {
  const virtualConsole = new VirtualConsole();
  for (const level of ['error', 'warn']) {
    virtualConsole.on(level, (...args) => {
      consoleMessages.push({ level, message: args.map(String).join(' ') });
    });
  }
  virtualConsole.on('jsdomError', (error) => {
    consoleMessages.push({ level: 'jsdomError', message: String(error) });
  });

  const dom = await JSDOM.fromURL(`${origin}/`, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // The development Flight/browser runtimes register themselves with
      // the devtools hook — capture the embedded version strings.
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        isDisabled: false,
        supportsFlight: true,
        supportsFiber: true,
        renderers: new Map(),
        inject(internals) {
          devtoolsRenderers.push({
            version: internals.version,
            rendererPackageName: internals.rendererPackageName,
          });
          return devtoolsRenderers.length;
        },
        checkDCE() {},
        onCommitFiberRoot() {},
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        onScheduleFiberRoot() {},
        setStrictMode() {},
      };
      // Node globals jsdom does not implement but React/Flight need.
      window.MessageChannel = MessageChannel;
      window.MessagePort = MessagePort;
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.ReadableStream = ReadableStream;
      if (!window.queueMicrotask) window.queueMicrotask = queueMicrotask;
    },
  });

  const { window } = dom;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('page load timed out')), 30_000);
    window.addEventListener('load', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  if (!window.__E2E__) {
    throw new Error('client bundle did not expose window.__E2E__ — entry not executed');
  }

  const { document } = window;
  const container = document.getElementById('root');
  const loadChunk = (file) =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `/assets/${file}`;
      script.addEventListener('load', () => {
        assetEvents.push(`load:${file}`);
        resolve();
      });
      script.addEventListener('error', () => reject(new Error(`failed to preload ${file}`)));
      document.head.appendChild(script);
    });

  const firstChunk = scenario === 'boundary-first' ? firstBoundaryChunkFile : sharedChunkFile;
  if (scenario !== 'omit-shared-from-flight') {
    if (!firstChunk) throw new Error(`missing preload chunk for ${scenario}`);
    await loadChunk(firstChunk);
  }

  try {
    await Promise.race([
      window.__E2E__.hydrate(payload, container),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('hydration timed out')),
          scenario === 'omit-shared-from-flight' ? 2_000 : 10_000,
        ),
      ),
    ]);
  } catch (error) {
    const result = {
      ok: false,
      error: String((error && error.stack) || error),
      valueBeforeClick: null,
      valueAfterClick: null,
      nestedLabelText: null,
      nestedLabelColor: null,
      serverMessageText: null,
      stylesheetLinks: [],
      devtoolsRenderers,
      recoverableErrors: window.__E2E__ ? window.__E2E__.recoverableErrors : [],
      consoleMessages,
      assetRequests,
      assetEvents,
      omittedSharedChunkPairs,
    };
    window.close();
    return result;
  }

  const counterValue = () => {
    const el = document.querySelector('[data-testid="counter-value"]');
    return el ? el.textContent : null;
  };
  const valueBeforeClick = counterValue();

  const button = document.querySelector('[data-testid="counter-button"]');
  if (!button) throw new Error('counter button not found after hydration');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  // Allow React to flush the update.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const valueAfterClick = counterValue();

  const stylesheetLinks = [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) =>
    link.getAttribute('href'),
  );
  const nestedLabel = document.querySelector('[data-testid="nested-label"]');
  // Flight inserts stylesheet links asynchronously during hydration.
  const expectedNestedLabelColor = 'rgb(120, 30, 90)';
  const cssDeadline = Date.now() + 2000;
  let nestedLabelColor = nestedLabel ? window.getComputedStyle(nestedLabel).color : null;
  while (nestedLabel && nestedLabelColor !== expectedNestedLabelColor && Date.now() < cssDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    nestedLabelColor = nestedLabel ? window.getComputedStyle(nestedLabel).color : null;
  }
  const serverMessage = document.querySelector('[data-testid="server-message"]');

  window.close();

  return {
    ok: true,
    valueBeforeClick,
    valueAfterClick,
    nestedLabelText: nestedLabel ? nestedLabel.textContent : null,
    nestedLabelColor,
    serverMessageText: serverMessage ? serverMessage.textContent : null,
    stylesheetLinks,
    devtoolsRenderers,
    recoverableErrors: window.__E2E__ ? window.__E2E__.recoverableErrors : null,
    consoleMessages,
    assetRequests,
    assetEvents,
    omittedSharedChunkPairs,
  };
};

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(pageHtml);
    return;
  }
  if (urlPath.startsWith('/assets/')) {
    const rel = urlPath.slice('/assets/'.length);
    const file = path.join(clientDir, rel);
    assetRequests.push(rel);
    assetEvents.push(`request:${rel}`);
    // Keep file access inside the client build dir.
    if (file.startsWith(clientDir + path.sep) && fs.existsSync(file)) {
      assetEvents.push(`response:${rel}`);
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
      });
      res.end(fs.readFileSync(file));
      return;
    }
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  run(`http://127.0.0.1:${port}`)
    .then((result) => {
      process.stdout.write(JSON.stringify(result));
      server.close();
      // jsdom timers/resources can keep the loop alive; the result is out.
      process.exit(0);
    })
    .catch((error) => {
      server.close();
      fail(String((error && error.stack) || error));
    });
});
