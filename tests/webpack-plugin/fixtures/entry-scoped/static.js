// Pure server entry: imports no client reference anywhere in its tree, so
// the entry-scoped asset must list an empty set for `static`.
import { serverLabel } from './server-util';

export const staticPage = `static page:${serverLabel}`;
