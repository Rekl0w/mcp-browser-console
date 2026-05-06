import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentPath = resolve(rootDir, "packages/extension/dist/assets/content.js");
const runtimeMessages = [];
const messageListeners = [];

const fakeWindow = {
  __MCP_BROWSER_CONSOLE_BRIDGE_INSTALLED__: false,
  location: {
    href: "https://example.test/app",
  },
  addEventListener(type, listener) {
    if (type === "message") {
      messageListeners.push(listener);
    }
  },
  dispatchMessage(messageEvent) {
    for (const listener of messageListeners) {
      listener(messageEvent);
    }
  },
};

globalThis.window = fakeWindow;
globalThis.chrome = {
  runtime: {
    id: "extension-content-smoke-test",
    lastError: undefined,
    sendMessage(message, callback) {
      runtimeMessages.push(message);
      callback?.();
    },
  },
};

await import(`${pathToFileURL(contentPath).href}?t=${Date.now()}`);

assert.equal(
  fakeWindow.__MCP_BROWSER_CONSOLE_BRIDGE_INSTALLED__,
  true,
  "content script should install the isolated-world bridge",
);

const capturedEvent = {
  type: "log",
  level: "warn",
  args: ["bridge smoke test"],
  url: "https://example.test/app",
  pageUrl: "https://example.test/app",
  timestamp: Date.now(),
};

fakeWindow.dispatchMessage({
  source: { proxy: "main-world-window" },
  data: {
    source: "mcp-browser-console",
    event: capturedEvent,
  },
});

assert.equal(
  runtimeMessages.length,
  1,
  "bridge should forward valid page events even when WindowProxy identity differs",
);
assert.equal(runtimeMessages[0].kind, "mcp-browser-console-event");
assert.deepEqual(runtimeMessages[0].event, capturedEvent);

fakeWindow.dispatchMessage({
  source: { proxy: "main-world-window" },
  data: {
    source: "not-mcp-browser-console",
    event: capturedEvent,
  },
});

assert.equal(
  runtimeMessages.length,
  1,
  "bridge should ignore messages without the extension payload marker",
);

console.log("Extension content bridge smoke test passed.");
