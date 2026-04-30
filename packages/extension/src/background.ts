export {};

type CapturedEventType = "log" | "network" | "error";
type ConsoleLevel = "log" | "warn" | "error" | "info" | "debug" | "trace";

type SerializedValue =
  | string
  | number
  | boolean
  | null
  | SerializedValue[]
  | { [key: string]: SerializedValue };

interface CapturedEvent {
  type: CapturedEventType;
  level: ConsoleLevel;
  args: SerializedValue[];
  url: string;
  timestamp: number;
  stack?: string | undefined;
  pageUrl?: string | undefined;
  tabId?: number | undefined;
  method?: string | undefined;
  status?: number | undefined;
  responseBody?: SerializedValue | undefined;
  duration?: number | undefined;
}

interface RuntimeEventMessage {
  kind: typeof EVENT_MESSAGE_KIND;
  event: CapturedEvent;
}

interface StatusRequestMessage {
  kind: typeof STATUS_REQUEST_KIND;
}

interface ClientStatusMessage {
  kind: typeof CLIENT_STATUS_KIND;
  tabIds: number[];
  connected: boolean;
  queuedEvents: number;
  timestamp: number;
  extensionVersion: string;
}

interface PopupStatus {
  connected: boolean;
  socketState: string;
  queuedEvents: number;
  trackedTabs: number;
  reconnectAttempts: number;
  lastConnectedAt?: number | undefined;
  lastError?: string | undefined;
}

const WS_URL = "ws://localhost:3712";
const EVENT_MESSAGE_KIND = "mcp-browser-console-event";
const STATUS_REQUEST_KIND = "mcp-browser-console-get-status";
const CLIENT_STATUS_KIND = "client_status";
const MAX_PENDING_EVENTS = 1_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const STATUS_FLUSH_INTERVAL_MS = 10_000;

let socket: WebSocket | null = null;
let reconnectTimer: number | undefined;
let statusTimer: number | undefined;
let reconnectAttempts = 0;
let connected = false;
let lastConnectedAt: number | undefined;
let lastError: string | undefined;

const pendingEvents: CapturedEvent[] = [];
const activeTabIds = new Set<number>();

connectWebSocket();

chrome.runtime.onInstalled.addListener(() => {
  connectWebSocket();
});

chrome.runtime.onStartup.addListener(() => {
  connectWebSocket();
});

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse): boolean => {
    if (isRuntimeEventMessage(message)) {
      const tabId = sender.tab?.id;
      const event = addTabId(message.event, tabId);

      if (typeof event.tabId === "number") {
        activeTabIds.add(event.tabId);
      }

      sendEvent(event);
      sendResponse({ ok: true, connected });
      return false;
    }

    if (isStatusRequestMessage(message)) {
      sendResponse(getPopupStatus());
      return false;
    }

    return false;
  },
);

chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabIds.delete(tabId);
  sendClientStatus();
});

function connectWebSocket(): void {
  if (
    socket?.readyState === WebSocket.OPEN ||
    socket?.readyState === WebSocket.CONNECTING
  ) {
    return;
  }

  clearReconnectTimer();

  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    connected = true;
    reconnectAttempts = 0;
    lastConnectedAt = Date.now();
    lastError = undefined;
    flushPendingEvents();
    sendClientStatus();
    startStatusTimer();
  });

  socket.addEventListener("message", () => {
    // The local MCP server currently does not send commands to the extension.
  });

  socket.addEventListener("close", () => {
    connected = false;
    stopStatusTimer();
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    connected = false;
    lastError = `Unable to connect to ${WS_URL}`;
  });
}

function sendEvent(event: CapturedEvent): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
    return;
  }

  pendingEvents.push(event);

  if (pendingEvents.length > MAX_PENDING_EVENTS) {
    pendingEvents.shift();
  }

  scheduleReconnect();
}

function flushPendingEvents(): void {
  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  while (pendingEvents.length > 0) {
    const event = pendingEvents.shift();

    if (event) {
      socket.send(JSON.stringify(event));
    }
  }
}

function sendClientStatus(): void {
  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  const statusMessage: ClientStatusMessage = {
    kind: CLIENT_STATUS_KIND,
    tabIds: [...activeTabIds],
    connected,
    queuedEvents: pendingEvents.length,
    timestamp: Date.now(),
    extensionVersion: chrome.runtime.getManifest().version,
  };

  socket.send(JSON.stringify(statusMessage));
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) {
    return;
  }

  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** Math.min(reconnectAttempts, 5),
    RECONNECT_MAX_DELAY_MS,
  );
  reconnectAttempts += 1;

  reconnectTimer = self.setTimeout(() => {
    reconnectTimer = undefined;
    connectWebSocket();
  }, delay);
}

function clearReconnectTimer(): void {
  if (reconnectTimer === undefined) {
    return;
  }

  self.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
}

function startStatusTimer(): void {
  stopStatusTimer();
  statusTimer = self.setInterval(() => {
    sendClientStatus();
  }, STATUS_FLUSH_INTERVAL_MS);
}

function stopStatusTimer(): void {
  if (statusTimer === undefined) {
    return;
  }

  self.clearInterval(statusTimer);
  statusTimer = undefined;
}

function getPopupStatus(): PopupStatus {
  const status: PopupStatus = {
    connected,
    socketState: getSocketState(),
    queuedEvents: pendingEvents.length,
    trackedTabs: activeTabIds.size,
    reconnectAttempts,
  };

  if (lastConnectedAt !== undefined) {
    status.lastConnectedAt = lastConnectedAt;
  }

  if (lastError !== undefined) {
    status.lastError = lastError;
  }

  return status;
}

function getSocketState(): string {
  if (!socket) {
    return "not-created";
  }

  switch (socket.readyState) {
    case WebSocket.CONNECTING:
      return "connecting";
    case WebSocket.OPEN:
      return "open";
    case WebSocket.CLOSING:
      return "closing";
    case WebSocket.CLOSED:
      return "closed";
    default:
      return "unknown";
  }
}

function addTabId(
  event: CapturedEvent,
  tabId: number | undefined,
): CapturedEvent {
  if (typeof tabId !== "number") {
    return event;
  }

  return {
    ...event,
    tabId,
  };
}

function isRuntimeEventMessage(value: unknown): value is RuntimeEventMessage {
  return (
    isRecord(value) &&
    value.kind === EVENT_MESSAGE_KIND &&
    isCapturedEvent(value.event)
  );
}

function isStatusRequestMessage(value: unknown): value is StatusRequestMessage {
  return isRecord(value) && value.kind === STATUS_REQUEST_KIND;
}

function isCapturedEvent(value: unknown): value is CapturedEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.type === "log" ||
      value.type === "network" ||
      value.type === "error") &&
    (value.level === "log" ||
      value.level === "warn" ||
      value.level === "error" ||
      value.level === "info" ||
      value.level === "debug" ||
      value.level === "trace") &&
    Array.isArray(value.args) &&
    typeof value.url === "string" &&
    typeof value.timestamp === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
