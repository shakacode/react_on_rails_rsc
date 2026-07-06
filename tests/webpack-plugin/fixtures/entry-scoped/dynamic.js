// Entry reaching a client reference only through a dynamic import — the
// traversal must treat async edges as reachable.
export const loadIsland = () => import('./LazyIsland');
