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

interface PostedCapturedEvent {
  source: typeof SOURCE;
  messageId?: string | undefined;
  event: CapturedEvent;
}

interface RuntimeEventMessage {
  kind: typeof RUNTIME_EVENT_KIND;
  event: CapturedEvent;
}

declare global {
  interface Window {
    __MCP_BROWSER_CONSOLE_BRIDGE_INSTALLED__?: boolean;
  }
}

const SOURCE = "mcp-browser-console";
const RUNTIME_EVENT_KIND = "mcp-browser-console-event";
const CAPTURED_EVENT_DOM_EVENT = "mcp-browser-console-event";
const BRIDGE_MARKER_ATTRIBUTE =
  "data-mcp-browser-console-bridge-installed";
const MAX_FORWARDED_MESSAGE_IDS = 1_000;
const CONSOLE_LEVELS = [
  "log",
  "warn",
  "error",
  "info",
  "debug",
  "trace",
] as const;

const forwardedMessageIds = new Set<string>();

installBridge();

function installBridge(): void {
  if (window.__MCP_BROWSER_CONSOLE_BRIDGE_INSTALLED__) {
    return;
  }

  window.__MCP_BROWSER_CONSOLE_BRIDGE_INSTALLED__ = true;
  setDocumentMarker(BRIDGE_MARKER_ATTRIBUTE);

  window.addEventListener(
    "message",
    (messageEvent: MessageEvent<unknown>) => {
      forwardPostedEvent(messageEvent.data);
    },
    false,
  );

  window.addEventListener(
    CAPTURED_EVENT_DOM_EVENT,
    (event: Event) => {
      forwardPostedEvent(getCustomEventDetail(event));
    },
    false,
  );
}

function forwardPostedEvent(value: unknown): void {
  if (!isPostedCapturedEvent(value) || !rememberMessageId(value.messageId)) {
    return;
  }

  const runtimeMessage: RuntimeEventMessage = {
    kind: RUNTIME_EVENT_KIND,
    event: value.event,
  };

  chrome.runtime.sendMessage(runtimeMessage, () => {
    void chrome.runtime.lastError;
  });
}

function rememberMessageId(messageId: string | undefined): boolean {
  if (!messageId) {
    return true;
  }

  if (forwardedMessageIds.has(messageId)) {
    return false;
  }

  forwardedMessageIds.add(messageId);

  if (forwardedMessageIds.size > MAX_FORWARDED_MESSAGE_IDS) {
    const oldestMessageId = forwardedMessageIds.values().next().value;

    if (typeof oldestMessageId === "string") {
      forwardedMessageIds.delete(oldestMessageId);
    }
  }

  return true;
}

function getCustomEventDetail(event: Event): unknown {
  return "detail" in event ? event.detail : undefined;
}

function setDocumentMarker(attribute: string): void {
  const setMarker = (): void => {
    document.documentElement?.setAttribute(attribute, "true");
  };

  setMarker();

  if (!document.documentElement) {
    document.addEventListener("DOMContentLoaded", setMarker, { once: true });
  }
}

function isPostedCapturedEvent(value: unknown): value is PostedCapturedEvent {
  if (!isRecord(value) || value.source !== SOURCE || !isRecord(value.event)) {
    return false;
  }

  if (
    value.messageId !== undefined &&
    (typeof value.messageId !== "string" || value.messageId.length === 0)
  ) {
    return false;
  }

  const event = value.event;
  return (
    (event.type === "log" ||
      event.type === "network" ||
      event.type === "error") &&
    CONSOLE_LEVELS.includes(event.level as ConsoleLevel) &&
    Array.isArray(event.args) &&
    typeof event.url === "string" &&
    typeof event.timestamp === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
