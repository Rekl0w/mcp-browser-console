export {};

interface PopupStatus {
  connected: boolean;
  socketState: string;
  queuedEvents: number;
  trackedTabs: number;
  reconnectAttempts: number;
  lastConnectedAt?: number | undefined;
  lastError?: string | undefined;
}

interface StatusRequestMessage {
  kind: typeof STATUS_REQUEST_KIND;
}

const STATUS_REQUEST_KIND = "mcp-browser-console-get-status";
const REFRESH_INTERVAL_MS = 1_000;

const statusDot = getElement("statusDot");
const statusText = getElement("statusText");
const socketState = getElement("socketState");
const queuedEvents = getElement("queuedEvents");
const trackedTabs = getElement("trackedTabs");
const lastConnectedAt = getElement("lastConnectedAt");
const lastError = getElement("lastError");

void refreshStatus();
window.setInterval(() => {
  void refreshStatus();
}, REFRESH_INTERVAL_MS);

async function refreshStatus(): Promise<void> {
  const status = await requestStatus();

  if (!status) {
    renderDisconnected("Extension background is not responding.");
    return;
  }

  statusDot.classList.toggle("connected", status.connected);
  statusText.textContent = status.connected ? "Connected" : "Disconnected";
  socketState.textContent = status.socketState;
  queuedEvents.textContent = String(status.queuedEvents);
  trackedTabs.textContent = String(status.trackedTabs);
  lastConnectedAt.textContent = status.lastConnectedAt
    ? new Date(status.lastConnectedAt).toLocaleTimeString()
    : "never";
  lastError.textContent =
    status.lastError ??
    (status.connected
      ? "Events are streaming to the local MCP server."
      : "Waiting for ws://localhost:3712.");
}

function requestStatus(): Promise<PopupStatus | undefined> {
  const message: StatusRequestMessage = { kind: STATUS_REQUEST_KIND };

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError || !isPopupStatus(response)) {
        resolve(undefined);
        return;
      }

      resolve(response);
    });
  });
}

function renderDisconnected(reason: string): void {
  statusDot.classList.remove("connected");
  statusText.textContent = "Disconnected";
  socketState.textContent = "unknown";
  queuedEvents.textContent = "0";
  trackedTabs.textContent = "0";
  lastConnectedAt.textContent = "never";
  lastError.textContent = reason;
}

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing popup element: ${id}`);
  }

  return element;
}

function isPopupStatus(value: unknown): value is PopupStatus {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.connected === "boolean" &&
    typeof value.socketState === "string" &&
    typeof value.queuedEvents === "number" &&
    typeof value.trackedTabs === "number" &&
    typeof value.reconnectAttempts === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
