#!/usr/bin/env node
/**
 * Client hydration in jsdom.
 *
 * Usage: node scripts/hydrate.js <webpack|rspack>
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
const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.join(projectRoot, 'build', bundlerName);
const clientDir = path.join(buildDir, 'client');

const ssrHtml = fs.readFileSync(path.join(buildDir, 'ssr.html'), 'utf8');
const payload = fs.readFileSync(path.join(buildDir, 'flight-payload.rsc'), 'utf8');

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
  await window.__E2E__.hydrate(payload, container);

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
  const serverMessage = document.querySelector('[data-testid="server-message"]');

  window.close();

  return {
    ok: true,
    valueBeforeClick,
    valueAfterClick,
    nestedLabelText: nestedLabel ? nestedLabel.textContent : null,
    serverMessageText: serverMessage ? serverMessage.textContent : null,
    stylesheetLinks,
    devtoolsRenderers,
    recoverableErrors: window.__E2E__ ? window.__E2E__.recoverableErrors : null,
    consoleMessages,
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
    // Keep file access inside the client build dir.
    if (file.startsWith(clientDir + path.sep) && fs.existsSync(file)) {
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
