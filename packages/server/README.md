# mcp-browser-console

`@rekl0w/mcp-browser-console` is the npm-publishable MCP server for the MCP Browser Console Chrome Extension. It listens for browser events on `ws://localhost:3712`, buffers the latest 500 events in memory, and exposes MCP tools over stdio.

## MCP tools

- `get_logs` — filters buffered console and global error events by `level`, `url`, `since`, and `limit`.
- `get_network_requests` — filters buffered fetch and XHR events by `url`, `status`, `since`, and `limit`.
- `clear_buffer` — clears the in-memory event buffer.
- `get_status` — returns WebSocket listener status, buffer size, and connected tab count.

## Usage after publishing

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

The server writes MCP protocol messages to stdio and opens only one local WebSocket listener on port `3712`.
