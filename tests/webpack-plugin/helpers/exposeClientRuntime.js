/**
 * Appended as the last `main` entry module when the `exposeClientRuntime`
 * compile option is set. With `output.library` configured, webpack exposes
 * the last entry module's exports, so requiring the built bundle yields the
 * bundled Flight node client (`createFromNodeStream`) running inside the
 * bundle's own webpack runtime — its `__webpack_require__` and
 * `__webpack_chunk_load__` resolve against the bundle's real chunk graph.
 *
 * Must resolve to the same resource as the runner's server-build
 * `runtimeEntry` so the plugin's block injection still keys on a single
 * runtime module.
 */

'use strict';

module.exports = require('react-server-dom-webpack/client.node');
