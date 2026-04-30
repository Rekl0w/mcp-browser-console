# Contributing

Thanks for your interest in contributing to `mcp-browser-console`.

## Setup

```bash
npm install
```

Bun is also supported:

```bash
bun install
```

## Development

Run the MCP server during local development:

```bash
npm run dev:server
```

Build the Chrome Extension in watch mode:

```bash
npm run dev:extension
```

Load `packages/extension/dist` from `chrome://extensions` with Developer mode enabled.

## Before opening a pull request

Run the checks from the repository root:

```bash
npm run typecheck
npm test
npm run build
```

Bun equivalents:

```bash
bun run typecheck
bun run test
bun run build
```

## Notes

- Keep the Chrome Extension Manifest V3 compatible.
- Do not break original page behavior when intercepting console or network APIs.
- Keep captured browser data local to `ws://localhost:3712` unless a change explicitly documents otherwise.
- Avoid committing build outputs, package tarballs, or local environment files.
