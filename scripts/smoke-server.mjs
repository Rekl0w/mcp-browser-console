import assert from "node:assert/strict";
import { BrowserEventHub } from "../packages/server/dist/websocket.js";
import { handleBrowserConsoleTool } from "../packages/server/dist/tools.js";
import WebSocket from "ws";

const TEST_PORT = 3713;
const hub = new BrowserEventHub({
  port: TEST_PORT,
  maxBufferSize: 5,
  heartbeatIntervalMs: 1_000,
  clientTimeoutMs: 5_000,
});
let client;

try {
  await hub.start();

  client = new WebSocket(`ws://localhost:${TEST_PORT}`);
  await new Promise((resolve, reject) => {
    client.once("open", resolve);
    client.once("error", reject);
  });

  const now = Date.now();

  client.send(
    JSON.stringify({
      kind: "client_status",
      tabIds: [42],
      connected: true,
      queuedEvents: 0,
      timestamp: now,
      extensionVersion: "test",
    }),
  );

  client.send(
    JSON.stringify({
      type: "log",
      level: "warn",
      args: ["hello from smoke test"],
      url: "https://example.test/app",
      pageUrl: "https://example.test/app",
      timestamp: now + 1,
      tabId: 42,
    }),
  );

  client.send(
    JSON.stringify({
      type: "network",
      level: "info",
      args: [],
      url: "https://example.test/api",
      pageUrl: "https://example.test/app",
      method: "GET",
      status: 201,
      responseBody: "ok",
      duration: 12.5,
      timestamp: now + 2,
      tabId: 42,
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 150));

  const logs = await handleBrowserConsoleTool(
    "get_logs",
    { level: ["warn"], url: "example.test", since: now, limit: 10 },
    hub,
  );
  assert.equal(logs.count, 1, "expected one warn log event");
  assert.equal(logs.events[0].args[0], "hello from smoke test");

  const network = await handleBrowserConsoleTool(
    "get_network_requests",
    { status: 201, url: "/api", since: now, limit: 10 },
    hub,
  );
  assert.equal(network.count, 1, "expected one network event");
  assert.equal(network.events[0].method, "GET");
  assert.equal(network.events[0].responseBody, "ok");

  const status = await handleBrowserConsoleTool("get_status", {}, hub);
  assert.equal(status.listening, true, "hub should be listening");
  assert.equal(
    status.bufferSize,
    2,
    "buffer should contain the two captured events",
  );
  assert.equal(status.connectedTabCount, 1, "one tab should be tracked");
  assert.deepEqual(status.connectedTabs, [42]);

  const clearResult = await handleBrowserConsoleTool("clear_buffer", {}, hub);
  assert.equal(clearResult.cleared, true, "clear_buffer should report success");
  assert.equal(
    hub.getStatus().bufferSize,
    0,
    "buffer should be empty after clear_buffer",
  );

  console.log("Server smoke test passed.");
} finally {
  if (client && client.readyState === WebSocket.OPEN) {
    client.close();
  }

  await hub.stop();
}
