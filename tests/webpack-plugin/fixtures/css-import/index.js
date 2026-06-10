// The entry intentionally imports no client component: Button (and its
// CSS) reaches the bundle only through the plugin's injected async block,
// so its chunk group carries a CSS chunk file.
export const app = 'css-import';
