# react-on-rails-rsc

[![npm version](https://img.shields.io/npm/v/react-on-rails-rsc.svg)](https://www.npmjs.com/package/react-on-rails-rsc)
[![npm next](https://img.shields.io/npm/v/react-on-rails-rsc/next.svg?label=next)](https://www.npmjs.com/package/react-on-rails-rsc?activeTab=versions)
[![license](https://img.shields.io/npm/l/react-on-rails-rsc.svg)](https://www.npmjs.com/package/react-on-rails-rsc)

[**npm: react-on-rails-rsc**](https://www.npmjs.com/package/react-on-rails-rsc)

This package provides React Server Components (RSC) support for the [`react-on-rails-pro`](https://github.com/shakacode/react_on_rails_pro) Ruby gem.

⚠️ **IMPORTANT: This package is for internal use only** ⚠️

This package is not intended to be used directly by end users. It is designed to be used internally by [`react-on-rails-pro`](https://github.com/shakacode/react_on_rails_pro) npm package and ruby gem.

## Usage

Do not use this package's APIs directly in your application code. Instead use [`react_on_rails`](https://github.com/shakacode/react_on_rails) and [`react-on-rails-pro`](https://github.com/shakacode/react_on_rails_pro) gems and npm packages APIs to render or stream React Server Components.

## Documentation

This repository's checked-in docs are internal maintainer notes. Public React
Server Components guidance for application developers belongs in the downstream
[`react_on_rails`](https://github.com/shakacode/react_on_rails) documentation.

Maintainers can start from [`docs/README.md`](docs/README.md) for the internal
documentation boundary and links to package-maintainer runbooks.

## Package Contents

This package provides internal tooling for React Server Components integration:
- Webpack plugin for manifesting client components
- Webpack loader for bundling server components
- Client/server utilities for RSC rendering

## Versioning

The package `major.minor` tracks the React runtime line it ships or requires.
Maintainer policy lives in [`internal/docs/versioning.md`](internal/docs/versioning.md).

## License

Starting with version `19.2.1`, this package is offered as a related software
component of React on Rails Pro under commercial terms for ShakaCode-owned or
authorized portions. Production Use requires an appropriate paid subscription
or Complimentary OSS License; the license also permits the free non-commercial,
educational, and demo uses it defines. Prior MIT grants, contributor copyrights,
and Meta's MIT terms for the Webpack plugin port remain preserved. See
[LICENSE.md](LICENSE.md) for the exact scope and terms.

## Releasing

Release this package from `main` using the changelog-driven workflow in
[`internal/docs/releasing.md`](internal/docs/releasing.md). Run
`yarn release:dry-run` before `yarn release`.

## Compatibility Policy

The package peer dependencies are the current source of truth for supported
React, webpack, and rspack ranges. CI also runs a focused compatibility matrix
covering React 19.0.4 and 19.2.x, Node.js 20 and 22, webpack 5.59.0 and latest
5.x, and rspack latest 1.x plus latest 2.x. The `@rspack/core` peer is optional
so webpack-only consumers do not need to install rspack. A weekly React canary
job is signal-only and is allowed to fail while upstream canary APIs move;
review its GitHub Actions summary for early warnings.

A formal versioning policy is tracked in
[#70](https://github.com/shakacode/react_on_rails_rsc/issues/70).

## Support

For questions about React Server Components:
- Visit [React on Rails Pro documentation](https://www.shakacode.com/react-on-rails-pro/docs/)
- Visit [React on Rails documentation](https://www.shakacode.com/react-on-rails/docs/)
- Open issues in the [`react-on-rails-pro`](https://github.com/shakacode/react_on_rails_pro/issues) repository
