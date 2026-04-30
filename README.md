# mcp-browser-console

`mcp-browser-console` is a production-ready monorepo containing:

- a Chrome Extension that captures browser console, runtime error, fetch, and XHR activity from pages;
- an MCP server that receives those events over a local WebSocket and exposes them to MCP clients over stdio.

The extension streams to `ws://localhost:3712`. The server buffers the latest 500 events in memory and provides MCP tools for querying and clearing that buffer.

## Architecture

```text
mcp-browser-console/
├── packages/
│   ├── extension/       # Manifest V3 Chrome Extension, TypeScript, Vite
│   └── server/          # TypeScript MCP server, Node.js, stdio transport
├── scripts/             # package-manager-neutral build/test helpers
├── package.json         # npm workspaces root; Bun can run the same scripts
└── README.md
```

### Event flow

1. `packages/extension/src/content.ts` runs in both Chrome extension worlds.
2. In the page `MAIN` world, it patches `console`, `fetch`, `XMLHttpRequest`, `window.onerror`, and `unhandledrejection`.
3. In the extension `ISOLATED` world, it bridges captured events to the background service worker.
4. `packages/extension/src/background.ts` maintains a WebSocket connection to `ws://localhost:3712`.
5. `packages/server/src/websocket.ts` receives events, tracks connected tabs, and keeps a circular buffer of the latest 500 events.
6. `packages/server/src/index.ts` exposes the buffer through MCP stdio tools.

## Requirements

- Node.js `>=20.19.0`
- npm `>=10.0.0`
- Bun `>=1.0.0` if you prefer Bun commands
- Google Chrome or Chromium with Manifest V3 support

## Install

Choose one package manager and keep its lockfile committed.

### Install with npm

```bash
npm install
```

### Install with Bun

```bash
bun install
```

## Build

### Build with npm

```bash
npm run build
```

### Build with Bun

```bash
bun run build
```

The extension build is emitted to `packages/extension/dist`.
The MCP server build is emitted to `packages/server/dist`.

## Test and verify

The root `test` script builds both packages and runs a smoke test against the compiled server modules. The smoke test starts a temporary WebSocket server, sends log/network events, calls the MCP tool handlers, verifies filtering/status/clear behavior, and shuts the server down.

### Test with npm

```bash
npm run typecheck
npm run build
npm test
```

### Test with Bun

```bash
bun run typecheck
bun run build
bun run test
```

## Run the MCP server locally

### Run with npm

```bash
npm run dev:server
```

### Run with Bun

```bash
bun run dev:server
```

The server uses stdio for MCP protocol messages and opens a local WebSocket server on port `3712`.

## Load the Chrome Extension

1. Build the workspace with `npm run build` or `bun run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select `packages/extension/dist`.

The popup shows whether the background service worker is connected to the local MCP server.

## MCP client configuration

After publishing the server package to npm, MCP clients can launch it with:

```json
{
  "mcpServers": {
    "browser-console": {
      "command": "npx",
      "args": ["mcp-browser-console"]
    }
  }
}
```

For local development, point the command at the built package entry:

```json
{
  "mcpServers": {
    "browser-console": {
      "command": "node",
      "args": ["packages/server/dist/index.js"]
    }
  }
}
```

## MCP tools

### `get_logs`

Returns buffered console and runtime error events.

Parameters:

- `level?: string[]` — one or more of `log`, `warn`, `error`, `info`, `debug`, `trace`;
- `url?: string` — case-insensitive substring matched against `url` and `pageUrl`;
- `since?: number | string` — milliseconds since epoch or an ISO date string;
- `limit?: number` — maximum result count, clamped to `1..500`.

### `get_network_requests`

Returns buffered fetch and XHR events.

Parameters:

- `url?: string` — case-insensitive substring matched against request URL and `pageUrl`;
- `status?: number | number[]` — HTTP status code, with failed requests represented as `0`;
- `since?: number | string` — milliseconds since epoch or an ISO date string;
- `limit?: number` — maximum result count, clamped to `1..500`.

### `clear_buffer`

Clears all buffered events.

### `get_status`

Returns WebSocket listener status, buffer size, connected WebSocket client count, connected tab count, and uptime.

## Event payload

Captured events follow this shape:

```ts
type BrowserEvent = {
  type: "log" | "network" | "error";
  level: "log" | "warn" | "error" | "info" | "debug" | "trace" | string;
  args: unknown[];
  stack?: string;
  url: string;
  pageUrl?: string;
  tabId?: number;
  timestamp: number;
  method?: string;
  status?: number;
  responseBody?: unknown;
  duration?: number;
};
```

Console arguments are serialized defensively. Circular references, DOM nodes, functions, symbols, `bigint`, `Map`, `Set`, `Date`, `RegExp`, and `Error` objects are handled without breaking original page behavior.

## Security and privacy notes

- The extension reads console and network response bodies from pages where it is enabled.
- Events are sent only to `ws://localhost:3712`.
- The server keeps events in memory only; it does not write captured browser data to disk.
- Treat captured logs and response bodies as sensitive during development.

## Development commands

```bash
npm install
npm run typecheck
npm run build
npm test
npm run clean
npm run dev:extension
npm run dev:server
```

Bun equivalents:

```bash
bun install
bun run typecheck
bun run build
bun run test
bun run clean
bun run dev:extension
bun run dev:server
```
