import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backgroundPath = resolve(
  rootDir,
  "packages/extension/dist/assets/background.js",
);

const runtimeOnMessage = createChromeEvent();
const tabsOnCreated = createChromeEvent();
const tabsOnUpdated = createChromeEvent();
const tabsOnRemoved = createChromeEvent();
const sentMessages = [];
const openTabs = [
  { id: 10, url: "https://example.test/" },
  { id: 11, url: "https://app.test/" },
];

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances = [];

  readyState = FakeWebSocket.CONNECTING;
  listeners = new Map();

  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.open());
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(message) {
    sentMessages.push(JSON.parse(message));
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

globalThis.self = {
  setTimeout(handler, timeout, ...args) {
    const handle = setTimeout(handler, timeout, ...args);
    handle.unref?.();
    return handle;
  },
  clearTimeout,
  setInterval(handler, timeout, ...args) {
    const handle = setInterval(handler, timeout, ...args);
    handle.unref?.();
    return handle;
  },
  clearInterval,
};

globalThis.chrome = {
  runtime: {
    id: "extension-smoke-test",
    lastError: undefined,
    getManifest: () => ({ version: "smoke-test" }),
    onInstalled: createChromeEvent(),
    onStartup: createChromeEvent(),
    onMessage: runtimeOnMessage,
  },
  tabs: {
    query(_queryInfo, callback) {
      queueMicrotask(() => callback([...openTabs]));
    },
    onCreated: tabsOnCreated,
    onUpdated: tabsOnUpdated,
    onRemoved: tabsOnRemoved,
  },
};

globalThis.WebSocket = FakeWebSocket;

await import(`${pathToFileURL(backgroundPath).href}?t=${Date.now()}`);

await waitFor(() => getLastClientStatus()?.tabIds?.length === 2);
assert.deepEqual(
  getLastClientStatus().tabIds,
  [10, 11],
  "background should read existing tabs on startup",
);

const popupStatus = await sendRuntimeMessage({
  kind: "mcp-browser-console-get-status",
});
assert.equal(
  popupStatus.trackedTabs,
  2,
  "popup status should include tabs read via chrome.tabs.query",
);

openTabs.push({ id: 12, url: "https://new-tab.test/" });
tabsOnCreated.emit({ id: 12, url: "https://new-tab.test/" });

await waitFor(() => getLastClientStatus()?.tabIds?.includes(12));
assert.deepEqual(
  getLastClientStatus().tabIds,
  [10, 11, 12],
  "tab creation should be reported in client status",
);

openTabs.splice(
  openTabs.findIndex((tab) => tab.id === 11),
  1,
);
tabsOnRemoved.emit(11);

await waitFor(() => !getLastClientStatus()?.tabIds?.includes(11));
assert.deepEqual(
  getLastClientStatus().tabIds,
  [10, 12],
  "tab removal should be reported in client status",
);

const logEvent = {
  type: "log",
  level: "warn",
  args: ["tab-specific log"],
  url: "https://new-tab.test/",
  timestamp: Date.now(),
};

const eventResponse = await sendRuntimeMessage(
  {
    kind: "mcp-browser-console-event",
    event: logEvent,
  },
  { tab: { id: 12 } },
);
assert.equal(eventResponse.ok, true, "runtime event should be accepted");

const forwardedEvent = sentMessages.find((message) => message.type === "log");
assert.equal(
  forwardedEvent.tabId,
  12,
  "forwarded browser events should keep sender tabId",
);

console.log("Extension background smoke test passed.");

function createChromeEvent() {
  const listeners = [];

  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    emit(...args) {
      for (const listener of listeners) {
        listener(...args);
      }
    },
  };
}

function sendRuntimeMessage(message, sender = {}) {
  const listener = runtimeOnMessage.listeners[0];

  assert.equal(
    typeof listener,
    "function",
    "background should register a runtime message listener",
  );

  return new Promise((resolve) => {
    let settled = false;
    const sendResponse = (response) => {
      settled = true;
      resolve(response);
    };
    const isAsync = listener(message, sender, sendResponse);

    if (!isAsync && !settled) {
      resolve(undefined);
    }
  });
}

function getLastClientStatus() {
  return sentMessages.findLast((message) => message.kind === "client_status");
}

async function waitFor(predicate) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 1_000) {
    if (predicate()) {
      return;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }

  assert.fail("Timed out waiting for extension background smoke condition");
}
