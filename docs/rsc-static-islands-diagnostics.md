# RSC Static Island Diagnostics

Use this guide when a public or mostly static RSC page should prove which client
reference chunks it can load before introducing route-scoped manifest behavior.
The current plugin model still emits one client manifest per build. It does not
automatically infer per-page or per-route manifests.

## Emit Diagnostics

Enable the optional diagnostics asset on the client build:

```js
new RSCWebpackPlugin({
  isServer: false,
  clientReferenceDiagnosticsFilename: 'rsc-client-reference-diagnostics.json',
});
```

Rspack uses the same option:

```js
new RSCRspackPlugin({
  isServer: false,
  clientReferenceDiagnosticsFilename: 'rsc-client-reference-diagnostics.json',
});
```

The emitted JSON reports the client references recorded in the manifest, the JS
chunk files attached to each reference, and byte sizes for emitted assets when
the bundler exposes them:

```json
{
  "version": 1,
  "manifestFilename": "react-client-manifest.json",
  "isServer": false,
  "clientReferenceCount": 1,
  "totalChunkBytes": 1234,
  "clientReferences": [
    {
      "file": "file:///absolute/path/to/TinyIsland.js",
      "id": "./TinyIsland.js",
      "name": "*",
      "chunks": [
        {
          "id": "client-TinyIsland-js",
          "file": "client-TinyIsland-js.chunk.js",
          "bytes": 1234
        }
      ],
      "totalBytes": 1234
    }
  ]
}
```

`bytes` is `null` only when the bundler does not expose the asset source during
manifest emission. `totalChunkBytes` counts each emitted JS or CSS asset file
once even when multiple client references share that asset.

## Static Page Patterns

For a server-only static RSC entry, use an explicit empty client reference list
for that build:

```js
new RSCWebpackPlugin({
  isServer: false,
  clientReferences: [],
  clientReferenceDiagnosticsFilename: 'rsc-client-reference-diagnostics.json',
});
```

This produces an empty client manifest and an empty diagnostics file. Use it only
for a build target that cannot render client components. Do not apply
`clientReferences: []` to a mixed RSC app; any page that renders a client
component will miss the client reference metadata it needs at runtime.

For a static page with one or two small islands, isolate the static build and
declare only the island files that the public page may render:

```js
new RSCWebpackPlugin({
  isServer: false,
  clientReferences: [
    {
      directory: './app/public-rsc',
      recursive: false,
      include: /TinyIsland\.(js|jsx|ts|tsx)$/,
    },
  ],
  clientReferenceDiagnosticsFilename: 'rsc-client-reference-diagnostics.json',
});
```

The same descriptor shape is supported by `RSCRspackPlugin`. Keep the static page
entry separate from the normal authenticated app entry when the app entry imports
large global vendors, analytics, or dashboard-only clients. The diagnostics file
then gives a direct audit trail for whether the tiny island pulls only its own
chunk or also pulls an unexpected vendor chunk through an import.

If an island imports a heavy dependency, the diagnostics file will show that
dependency through the emitted chunk files and byte totals. Remove or defer the
import in the island itself; the diagnostics option only reports what the build
emitted and does not rewrite the module graph.

## Tiny Browser Sidecars

Use a tiny browser sidecar when a page should ship static RSC HTML and CSS on the
initial path but still needs browser-only effects, such as auth checks,
query-param handling, analytics beacons, or intent-driven modals. The sidecar is
a normal browser entry. It is not a Flight client reference unless the RSC page
actually renders it as a `"use client"` component.

Recommended shape:

1. Render the mostly static page from an isolated RSC build target.
2. Keep `clientReferences: []` for pages that cannot render Flight client
   components, or declare only the tiny islands that the page may render.
3. Add a dedicated browser entry, for example `public-page-client-effects`, for
   page effects that do not need to be in the Flight manifest.
4. Hand server data to the sidecar with inert JSON, such as an
   `application/json` script tag, instead of auto-mounting a React component on
   page load.
5. Lazy-import React, React DOM, dashboard clients, and other heavy modules only
   after user intent or after the browser condition that needs them.

The browser entry should avoid importing the normal application pack. If the
normal pack includes global dashboard code, analytics setup, or authenticated
app vendors, importing it from the sidecar puts that cost back on the static
page even when the RSC manifest is empty.

For webpack or rspack split-chunk configuration, keep the sidecar separate from
the app-wide vendor cache group when the vendor group would pull in the main app
shell. A sidecar can still share small, intentional dependencies, but the static
page budget should be verified from emitted assets rather than inferred from the
entry name. Use the diagnostics JSON to confirm the Flight client-reference
chunks stay empty or tiny, and inspect the bundler stats or emitted asset list to
confirm the sidecar did not inherit the monolithic app vendor chunk.

Avoid using the sidecar as a substitute for missing route-scoped manifests. It is
a supported integration pattern for static pages whose browser effects can live
outside Flight. If a route renders real Flight client components, keep those
components in `clientReferences` and use the diagnostics output to prove the
declared island set is still narrow.

## Boundaries

This diagnostics slice is intentionally narrow:

- It does not create route-scoped or page-scoped manifests.
- It does not discover the exact client references rendered by a specific RSC
  page.
- It does not eliminate vendor chunks automatically.
- It does not solve the broader dependency and manifest scoping work tracked
  outside this page.

Use the diagnostics output to decide whether an explicit static-page build is
acceptable today, or whether the app needs the broader manifest-scoping product
decision before treating static RSC pages as performance-isolated.
