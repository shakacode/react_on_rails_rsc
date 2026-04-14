# Rspack Compatibility Tests

These tests verify that the runtime/build-time components of `react-on-rails-rsc`
are compatible with [Rspack](https://rspack.dev/) as a bundler — not just Webpack.

## Scope

The package contains six primary source files:

| File | Tested here? | Why |
|---|---|---|
| `src/WebpackLoader.ts` | ✅ | Verified via rspack loader run |
| `src/server.node.ts` | ✅ | Bundled with rspack, runtime-verified |
| `src/client.node.ts` | ✅ | Bundled with rspack, end-to-end decode verified |
| `src/client.browser.ts` | ✅ | Bundled with rspack for web target, runtime globals verified |
| `src/types.ts` | — | Pure types; no runtime code |
| `src/WebpackPlugin.ts` | ❌ (known incompatible) | Uses `webpack/lib/*` deep imports |

`WebpackPlugin` is intentionally **excluded** — it is the one known
rspack-incompatible component in the package. See
`docs/rsc-rspack-implementation-plan.md` in `shakacode/react_on_rails` for the
replacement strategy.

## Test files

| File | What it verifies |
|---|---|
| `static-analysis.test.ts` | None of the 4 target source files import `webpack`, `webpack/lib/*`, or reach into webpack internals at runtime |
| `rspack-runtime-abi.test.ts` | When rspack bundles code, the output defines `__webpack_require__`, `__webpack_chunk_load__`, and a mutable `__webpack_require__.u` — the three globals React's Flight runtime relies on |
| `webpack-loader.rspack.test.ts` | The `RSCWebpackLoader` runs successfully under rspack, transforming `"use client"` files into client-reference stubs |
| `server-node.rspack.test.ts` | `server.node.ts` bundles successfully with rspack and `renderToPipeableStream` works in the rspack-bundled output |
| `client-browser.rspack.test.ts` | `client.browser.ts` bundles successfully with rspack (web target) — `createFromFetch` and `createFromReadableStream` remain callable, `__webpack_require__.u` remains mutable in the emitted runtime |
| `end-to-end.rspack.test.ts` | Full encode → decode round-trip using rspack-bundled server and client code: verifies the runtime ABI contract end-to-end |

## Running

```bash
yarn jest tests/rspack-compat
```

All tests are synchronous or run with short timeouts; no network calls.

## Why these tests exist

[GitHub issue `shakacode/react_on_rails#3141`](https://github.com/shakacode/react_on_rails/issues/3141)
is investigating revising rspack support and planning RSC+rspack compatibility.
A prerequisite for that work is **proving** that everything in this package
except `WebpackPlugin` is already rspack-compatible, so the rspack work can
focus narrowly on the one incompatible component.

These tests are the proof. If they pass, the conclusion holds. If they fail,
an assumption in the plan document needs revisiting before implementation
starts.
