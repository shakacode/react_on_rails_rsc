// Server-component tree for the fixture app, used by the Flight render
// script under --conditions=react-server. The client components are
// injected as registered client references — requiring them directly here
// would execute client code on the server.
'use strict';

const React = require('react');
const { serverMessage } = require('./serverOnly');

module.exports = function createApp({ Counter, ThemeSection }) {
  return React.createElement(
    'div',
    { id: 'app' },
    React.createElement('h1', null, 'RSC E2E Fixture'),
    React.createElement('p', { 'data-testid': 'server-message' }, serverMessage()),
    React.createElement(Counter, { label: 'clicks', initial: 3 }),
    React.createElement(ThemeSection, { theme: 'dark' }),
  );
};
