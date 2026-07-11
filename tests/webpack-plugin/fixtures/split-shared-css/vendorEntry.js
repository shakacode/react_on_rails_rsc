// Extra entrypoint that also imports the shared CSS-bearing module. With a
// splitChunks cacheGroup matching `shared`, the shared chunk becomes initial
// (loaded by this entry's stylesheet links) while still appearing in both
// client-reference chunk groups — the #108 vendor/common shape the plugin
// must keep excluding from client-reference CSS.
import { shared } from './shared';

export const vendorEntry = 'vendor-entry:' + shared;
