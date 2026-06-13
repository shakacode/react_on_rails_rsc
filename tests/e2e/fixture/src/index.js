// The entry app module intentionally imports no client component: client
// references reach the bundle only through the plugin's injected async
// blocks on the Flight client runtime (mirrors the split-shared fixture).
export const app = 'rsc-e2e-fixture';
