# Privacy Policy

Effective date: April 30, 2026

MCP Browser Console is a developer tool that streams browser console, error, fetch, and XMLHttpRequest events to a local MCP server for debugging workflows.

## Data processed by the extension

When the extension runs on a page, it may process the following browser data:

- Console messages, including `log`, `warn`, `error`, `info`, `debug`, and `trace` output
- Runtime errors and unhandled promise rejections
- Fetch and XMLHttpRequest metadata, including URL, method, status, duration, and response body
- The page URL and browser tab identifier associated with captured events
- Timestamps for captured events

This data may include website content or debugging information produced by the pages you visit.

## How data is used

Captured events are used only to support local development and debugging through MCP-compatible clients.

The extension sends captured events to a local WebSocket endpoint:

```text
ws://localhost:3712
```

The companion MCP server keeps the most recent events in an in-memory buffer so MCP clients can query logs, network requests, errors, and connection status.

## Data sharing

MCP Browser Console does not sell user data.

MCP Browser Console does not send captured browser data to any remote server operated by the extension publisher.

MCP Browser Console does not share captured browser data with third parties.

## Data storage

The Chrome Extension does not use persistent extension storage for captured events.

The companion MCP server stores captured events only in memory. Events are not written to disk by default.

## Remote code

MCP Browser Console does not load or execute remote JavaScript code. Extension scripts are bundled with the extension package.

## Contact

For questions or issues, use the GitHub repository:

[https://github.com/Rekl0w/mcp-browser-console](https://github.com/Rekl0w/mcp-browser-console)
