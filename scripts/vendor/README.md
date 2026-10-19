# Acorn

`acorn.cjs` vendors Acorn 8.17.0 from the Node.js 24.19.0 bundled parser. It is used only during local builds and tests to identify JavaScript expressions safely. The delivered browser application does not load this parser, and rebuilding does not need npm or network access.

Upstream: https://github.com/acornjs/acorn

The MIT license is included in `ACORN-LICENSE`.
