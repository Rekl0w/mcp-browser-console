# @rekl0w/mcp-browser-console

MCP Browser Console is a local-first debugging bridge between Chrome and MCP-compatible clients.

This npm package contains the **MCP server**. It receives browser console, error, fetch, and XMLHttpRequest events from the companion Chrome Extension over `ws://localhost:3712`, keeps the latest 500 events in memory, and exposes them as MCP tools over stdio.

> Full monorepo, Chrome Extension source, screenshots, privacy policy, and development docs are available at [github.com/Rekl0w/mcp-browser-console](https://github.com/Rekl0w/mcp-browser-console).

## What this package provides

- MCP stdio server powered by `@modelcontextprotocol/sdk`
- Local WebSocket listener on `ws://localhost:3712`
- In-memory circular buffer for the latest 500 browser events
- MCP tools for querying logs, network requests, errors, and runtime status
- No remote telemetry and no disk persistence for captured browser events

## Companion Chrome Extension

This server is designed to be used with the MCP Browser Console Chrome Extension from the same repository:

- Chrome Web Store: [https://chromewebstore.google.com/detail/mcp-browser-console/gggjhfijcebjbfpmjemnjohnoglmhoke](https://chromewebstore.google.com/detail/mcp-browser-console/gggjhfijcebjbfpmjemnjohnoglmhoke)
- Repository: [https://github.com/Rekl0w/mcp-browser-console](https://github.com/Rekl0w/mcp-browser-console)

The extension captures browser events and forwards them to this local MCP server. The server then makes those events available to MCP clients.

## MCP client configuration

Use the package directly with `npx`:

```json
{
  "mcpServers": {
    "browser-console": {
      "command": "npx",
      "args": ["@rekl0w/mcp-browser-console"]
    }
  }
}
```

The server writes MCP protocol messages to stdio and opens a local WebSocket listener on port `3712`.

## Available MCP tools

### `get_logs`

Returns buffered console and runtime error events.

Parameters:

- `level?: string[]` — filter by `log`, `warn`, `error`, `info`, `debug`, or `trace`
- `url?: string` — case-insensitive substring matched against `url` and `pageUrl`
- `since?: number | string` — timestamp in milliseconds or ISO date string
- `limit?: number` — maximum result count, clamped to `1..500`

### `get_network_requests`

Returns buffered fetch and XMLHttpRequest events.

Parameters:

- `url?: string` — case-insensitive substring matched against request URL and `pageUrl`
- `status?: number | number[]` — HTTP status code filter; failed requests use status `0`
- `since?: number | string` — timestamp in milliseconds or ISO date string
- `limit?: number` — maximum result count, clamped to `1..500`

### `clear_buffer`

Clears all buffered browser events.

### `get_status`

Returns WebSocket listener status, buffer size, connected WebSocket client count, connected tab count, connected tab IDs, and uptime.

## Local-first privacy model

Captured browser events are sent only to the local WebSocket endpoint used by this package. The server keeps data in memory and does not write captured events to disk by default.

Because browser logs and network responses can contain sensitive information, treat captured data as local development/debugging data.

## Links

- Repository: [github.com/Rekl0w/mcp-browser-console](https://github.com/Rekl0w/mcp-browser-console)
- Chrome Web Store: [chromewebstore.google.com/detail/mcp-browser-console/gggjhfijcebjbfpmjemnjohnoglmhoke](https://chromewebstore.google.com/detail/mcp-browser-console/gggjhfijcebjbfpmjemnjohnoglmhoke)
- Issues: [github.com/Rekl0w/mcp-browser-console/issues](https://github.com/Rekl0w/mcp-browser-console/issues)
- Privacy policy: [github.com/Rekl0w/mcp-browser-console/blob/main/PRIVACY.md](https://github.com/Rekl0w/mcp-browser-console/blob/main/PRIVACY.md)
