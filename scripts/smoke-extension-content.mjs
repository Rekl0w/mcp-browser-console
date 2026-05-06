import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentPath = resolve(
  rootDir,
  "packages/extension/dist/assets/content-bridge.js",
);
const runtimeMessages = [];
const messageListeners = [];
const customEventListeners = [];
const documentAttributes = new Map();

globalThis.document = {
  documentElement: {
    setAttribute(name, value) {
      documentAttributes.set(name, value);
    },
  },
  addEventListener() {},
};

const fakeWindow = {
  __MCP_BROWSER_CONSOLE_BRIDGE_INSTALLED__: false,
  location: {
    href: "https://example.test/app",
  },
  addEventListener(type, listener) {
    if (type === "message") {
      messageListeners.push(listener);
    }

    if (type === "mcp-browser-console-event") {
      customEventListeners.push(listener);
    }
  },
  dispatchMessage(messageEvent) {
    for (const listener of messageListeners) {
      listener(messageEvent);
    }
  },
  dispatchCustomEvent(detail) {
    for (const listener of customEventListeners) {
      listener({ detail });
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
  "content bridge script should install the isolated-world bridge",
);
assert.equal(
  documentAttributes.get("data-mcp-browser-console-bridge-installed"),
  "true",
  "content bridge should expose a DOM marker visible from the page world",
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
    messageId: "message-smoke",
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

const duplicatePayload = {
  source: "mcp-browser-console",
  messageId: "duplicate-smoke",
  event: capturedEvent,
};

fakeWindow.dispatchCustomEvent(duplicatePayload);
fakeWindow.dispatchMessage({
  source: { proxy: "main-world-window" },
  data: duplicatePayload,
});

assert.equal(
  runtimeMessages.length,
  2,
  "bridge should dedupe events delivered by both DOM and postMessage channels",
);

fakeWindow.dispatchMessage({
  source: { proxy: "main-world-window" },
  data: {
    source: "not-mcp-browser-console",
    event: capturedEvent,
  },
});

assert.equal(
  runtimeMessages.length,
  2,
  "bridge should ignore messages without the extension payload marker",
);

console.log("Extension content bridge smoke test passed.");
