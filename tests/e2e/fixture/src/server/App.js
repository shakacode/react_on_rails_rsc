// Server-component tree for the fixture app, used by the Flight render
// script under --conditions=react-server. The client components are
// injected as registered client references — requiring them directly here
// would execute client code on the server.
'use strict';

const React = require('react');
const {
  preconnect,
  prefetchDNS,
  preloadFont,
  preloadImage,
  preloadScript,
  preloadStyle,
} = require('react-on-rails-rsc/server');
const { serverMessage } = require('./serverOnly');

module.exports = function createApp({ Counter, ThemeSection }) {
  function AppRoot() {
    prefetchDNS('https://rsc-assets.example.test');
    preconnect('https://cdn.example.test', { crossOrigin: 'anonymous' });
    preloadStyle('/assets/e2e-critical.css', { fetchPriority: 'high' });
    preloadScript('/assets/e2e-critical.js');
    preloadFont('/assets/e2e-font.woff2', { type: 'font/woff2' });
    preloadImage('/assets/e2e-hero.webp', {
      fetchPriority: 'high',
      imageSizes: '100vw',
    });

    return React.createElement(
      'div',
      { id: 'app' },
      React.createElement('h1', null, 'RSC E2E Fixture'),
      React.createElement('p', { 'data-testid': 'server-message' }, serverMessage()),
      React.createElement(Counter, { label: 'clicks', initial: 3 }),
      React.createElement(ThemeSection, { theme: 'dark' }),
    );
  }

  return React.createElement(AppRoot);
};
