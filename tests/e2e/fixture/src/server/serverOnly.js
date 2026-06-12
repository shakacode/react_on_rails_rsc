// Server-only module: its output must appear in the Flight payload and the
// SSR HTML, but the module itself must never be referenced by the client
// manifest or client chunks.
'use strict';

exports.serverMessage = () => 'rendered-on-server-only';
