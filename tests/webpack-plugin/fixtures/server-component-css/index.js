// Simulates the CLIENT webpack build of a Server-Component page.
//
// In production, the generated client pack for a Server Component is
// `registerServerComponent("BlockServer")` with NO import of the component
// itself. So Block (a pure Server Component) and its CSS never enter the
// client graph from here. To model that faithfully, the client entry does
// NOT import Block.
//
// The 'use client' leaf, by contrast, IS reachable from the client graph in
// a real app (Flight's client manifest references it, and the SSR/client
// bundles import it). We reference it here so the plugin's normal client-
// reference discovery + CSS-sibling collection runs for it.
export const app = 'server-component-css client build';
