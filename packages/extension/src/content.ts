export {};

type CapturedEventType = "log" | "network" | "error";
type ConsoleLevel = "log" | "warn" | "error" | "info" | "debug" | "trace";

type JsonPrimitive = string | number | boolean | null;
type SerializedValue =
  | JsonPrimitive
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
  event: CapturedEvent;
}

interface RuntimeEventMessage {
  kind: typeof RUNTIME_EVENT_KIND;
  event: CapturedEvent;
}

declare global {
  interface Window {
    __MCP_BROWSER_CONSOLE_PAGE_HOOK_INSTALLED__?: boolean;
    __MCP_BROWSER_CONSOLE_BRIDGE_INSTALLED__?: boolean;
  }
}

const SOURCE = "mcp-browser-console";
const RUNTIME_EVENT_KIND = "mcp-browser-console-event";
const CONSOLE_LEVELS = [
  "log",
  "warn",
  "error",
  "info",
  "debug",
  "trace",
] as const;
const MAX_SERIALIZATION_DEPTH = 5;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_COLLECTION_ITEMS = 100;
const MAX_STRING_LENGTH = 50_000;
const MAX_RESPONSE_BODY_LENGTH = 100_000;

if (hasExtensionRuntime()) {
  installBridge();
} else {
  installPageHooks();
}

function hasExtensionRuntime(): boolean {
  try {
    return (
      typeof chrome !== "undefined" &&
      Boolean(chrome.runtime?.id) &&
      typeof chrome.runtime.sendMessage === "function"
    );
  } catch {
    return false;
  }
}

function installBridge(): void {
  if (window.__MCP_BROWSER_CONSOLE_BRIDGE_INSTALLED__) {
    return;
  }

  window.__MCP_BROWSER_CONSOLE_BRIDGE_INSTALLED__ = true;

  window.addEventListener(
    "message",
    (messageEvent: MessageEvent<unknown>) => {
      // MAIN and ISOLATED worlds can expose different WindowProxy wrappers.
      if (!isPostedCapturedEvent(messageEvent.data)) {
        return;
      }

      const runtimeMessage: RuntimeEventMessage = {
        kind: RUNTIME_EVENT_KIND,
        event: messageEvent.data.event,
      };

      chrome.runtime.sendMessage(runtimeMessage, () => {
        void chrome.runtime.lastError;
      });
    },
    false,
  );
}

function installPageHooks(): void {
  if (window.__MCP_BROWSER_CONSOLE_PAGE_HOOK_INSTALLED__) {
    return;
  }

  window.__MCP_BROWSER_CONSOLE_PAGE_HOOK_INSTALLED__ = true;

  patchConsole();
  patchGlobalErrors();
  patchFetch();
  patchXmlHttpRequest();
}

function patchConsole(): void {
  for (const level of CONSOLE_LEVELS) {
    const original = console[level];

    if (typeof original !== "function") {
      continue;
    }

    Object.defineProperty(console, level, {
      configurable: true,
      writable: true,
      value: function patchedConsoleMethod(
        this: Console,
        ...args: unknown[]
      ): void {
        try {
          emitEvent({
            type: "log",
            level,
            args: args.map((arg) => serializeValue(arg)),
            url: window.location.href,
            stack: getConsoleStack(level, args),
          });
        } catch {
          // Capturing must never interfere with page logging.
        }

        Reflect.apply(original, this, args);
      },
    });
  }
}

function patchGlobalErrors(): void {
  const previousOnError = window.onerror;
  let lastErrorKey = "";
  let lastErrorAt = 0;

  const emitGlobalError = (
    message: unknown,
    source: unknown,
    lineNumber: unknown,
    columnNumber: unknown,
    error: unknown,
  ): void => {
    const now = Date.now();
    const key = `${String(message)}|${String(source)}|${String(lineNumber)}|${String(columnNumber)}`;

    if (key === lastErrorKey && now - lastErrorAt < 100) {
      return;
    }

    lastErrorKey = key;
    lastErrorAt = now;

    const sourceUrl =
      typeof source === "string" && source.length > 0
        ? source
        : window.location.href;
    const serializedError = serializeValue(error);
    const args: SerializedValue[] = [serializeValue(message)];

    if (serializedError !== null) {
      args.push(serializedError);
    }

    emitEvent({
      type: "error",
      level: "error",
      args,
      url: sourceUrl,
      stack: getErrorStack(error),
      responseBody: serializeErrorLocation(lineNumber, columnNumber),
    });
  };

  window.onerror = function mcpBrowserConsoleOnError(
    message,
    source,
    lineNumber,
    columnNumber,
    error,
  ): boolean | void {
    try {
      emitGlobalError(message, source, lineNumber, columnNumber, error);
    } catch {
      // Error capture must be side-effect free.
    }

    if (typeof previousOnError === "function") {
      return previousOnError.apply(this, [
        message,
        source,
        lineNumber,
        columnNumber,
        error,
      ]);
    }

    return false;
  };

  window.addEventListener(
    "error",
    (event) => {
      try {
        emitGlobalError(
          event.message,
          event.filename,
          event.lineno,
          event.colno,
          event.error,
        );
      } catch {
        // Error capture must be side-effect free.
      }
    },
    true,
  );

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      try {
        const reason = event.reason;
        emitEvent({
          type: "error",
          level: "error",
          args: [
            serializeValue("Unhandled promise rejection"),
            serializeValue(reason),
          ],
          url: window.location.href,
          stack: getErrorStack(reason),
        });
      } catch {
        // Error capture must be side-effect free.
      }
    },
    true,
  );
}

function patchFetch(): void {
  if (typeof window.fetch !== "function") {
    return;
  }

  const originalFetch = window.fetch;

  Object.defineProperty(window, "fetch", {
    configurable: true,
    writable: true,
    value: async function patchedFetch(
      this: WindowOrWorkerGlobalScope,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const startedAt = performance.now();
      const request = getFetchRequestDetails(input, init);

      try {
        const response = (await Reflect.apply(originalFetch, this, [
          input,
          init,
        ])) as Response;
        const duration = performance.now() - startedAt;

        void readResponseBody(response).then((responseBody) => {
          emitEvent({
            type: "network",
            level: response.ok ? "info" : "error",
            args: [],
            url: request.url,
            method: request.method,
            status: response.status,
            responseBody,
            duration,
          });
        });

        return response;
      } catch (error) {
        const duration = performance.now() - startedAt;
        emitEvent({
          type: "network",
          level: "error",
          args: [serializeValue(error)],
          url: request.url,
          method: request.method,
          status: 0,
          responseBody: serializeValue(error),
          duration,
          stack: getErrorStack(error),
        });
        throw error;
      }
    },
  });
}

function patchXmlHttpRequest(): void {
  if (typeof window.XMLHttpRequest !== "function") {
    return;
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const requestMetadata = new WeakMap<
    XMLHttpRequest,
    { method: string; url: string; startedAt: number }
  >();

  Object.defineProperty(XMLHttpRequest.prototype, "open", {
    configurable: true,
    writable: true,
    value: function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
    ): void {
      requestMetadata.set(this, {
        method: normalizeMethod(method),
        url: normalizeUrl(url),
        startedAt: 0,
      });

      return Reflect.apply(originalOpen, this, arguments) as void;
    },
  });

  Object.defineProperty(XMLHttpRequest.prototype, "send", {
    configurable: true,
    writable: true,
    value: function patchedSend(this: XMLHttpRequest): void {
      const metadata = requestMetadata.get(this) ?? {
        method: "GET",
        url: "unknown",
        startedAt: 0,
      };

      metadata.startedAt = performance.now();
      requestMetadata.set(this, metadata);

      this.addEventListener(
        "loadend",
        () => {
          const duration =
            metadata.startedAt > 0 ? performance.now() - metadata.startedAt : 0;
          const status = safeNumber(this.status, 0);

          emitEvent({
            type: "network",
            level: status >= 400 || status === 0 ? "error" : "info",
            args: [],
            url: metadata.url,
            method: metadata.method,
            status,
            responseBody: readXhrResponseBody(this),
            duration,
          });
        },
        { once: true },
      );

      return Reflect.apply(originalSend, this, arguments) as void;
    },
  });
}

function emitEvent(
  event: Omit<CapturedEvent, "timestamp" | "pageUrl"> &
    Partial<Pick<CapturedEvent, "timestamp" | "pageUrl">>,
): void {
  const payload: PostedCapturedEvent = {
    source: SOURCE,
    event: {
      ...event,
      pageUrl: event.pageUrl ?? window.location.href,
      timestamp: event.timestamp ?? Date.now(),
    },
  };

  window.postMessage(payload, "*");
}

function getFetchRequestDetails(
  input: RequestInfo | URL,
  init?: RequestInit,
): { method: string; url: string } {
  if (typeof Request !== "undefined" && input instanceof Request) {
    return {
      method: normalizeMethod(init?.method ?? input.method),
      url: normalizeUrl(input.url),
    };
  }

  return {
    method: normalizeMethod(init?.method ?? "GET"),
    url: normalizeUrl(input),
  };
}

async function readResponseBody(response: Response): Promise<SerializedValue> {
  try {
    const text = await response.clone().text();
    return truncateString(text, MAX_RESPONSE_BODY_LENGTH);
  } catch (error) {
    return `[unavailable response body: ${getErrorMessage(error)}]`;
  }
}

function readXhrResponseBody(xhr: XMLHttpRequest): SerializedValue {
  try {
    if (xhr.responseType === "" || xhr.responseType === "text") {
      return truncateString(xhr.responseText, MAX_RESPONSE_BODY_LENGTH);
    }

    if (xhr.responseType === "json") {
      return serializeValue(xhr.response);
    }

    if (xhr.responseType === "document") {
      return "[document response]";
    }

    if (xhr.responseType === "arraybuffer") {
      return `[arraybuffer response: ${xhr.response instanceof ArrayBuffer ? xhr.response.byteLength : 0} bytes]`;
    }

    if (xhr.responseType === "blob") {
      const blob = xhr.response instanceof Blob ? xhr.response : undefined;
      return `[blob response${blob ? `: ${blob.size} bytes, ${blob.type || "unknown type"}` : ""}]`;
    }

    return `[${xhr.responseType} response]`;
  } catch (error) {
    return `[unavailable response body: ${getErrorMessage(error)}]`;
  }
}

function serializeValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): SerializedValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value === "string"
      ? truncateString(value, MAX_STRING_LENGTH)
      : value;
  }

  if (typeof value === "undefined") {
    return "[undefined]";
  }

  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }

  if (typeof value === "symbol") {
    return value.toString();
  }

  if (typeof value === "function") {
    return `[Function${value.name ? `: ${value.name}` : ""}]`;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  if (depth >= MAX_SERIALIZATION_DEPTH) {
    return "[MaxDepth]";
  }

  if (isDomNode(value)) {
    return serializeDomNode(value);
  }

  seen.add(value);

  if (value instanceof Error) {
    const serialized: Record<string, SerializedValue> = {
      name: value.name,
      message: value.message,
    };

    if (typeof value.stack === "string") {
      serialized.stack = truncateString(value.stack, MAX_STRING_LENGTH);
    }

    if ("cause" in value) {
      serialized.cause = serializeValue(value.cause, seen, depth + 1);
    }

    return serialized;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? "[Invalid Date]"
      : value.toISOString();
  }

  if (value instanceof RegExp) {
    return value.toString();
  }

  if (value instanceof Map) {
    const entries = Array.from(value.entries())
      .slice(0, MAX_COLLECTION_ITEMS)
      .map(([key, entryValue]) => [
        serializeValue(key, seen, depth + 1),
        serializeValue(entryValue, seen, depth + 1),
      ]);

    return {
      type: "Map",
      size: value.size,
      entries,
    };
  }

  if (value instanceof Set) {
    return {
      type: "Set",
      size: value.size,
      values: Array.from(value.values())
        .slice(0, MAX_COLLECTION_ITEMS)
        .map((entryValue) => serializeValue(entryValue, seen, depth + 1)),
    };
  }

  if (Array.isArray(value)) {
    const serializedArray = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => serializeValue(item, seen, depth + 1));

    if (value.length > MAX_ARRAY_ITEMS) {
      serializedArray.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
    }

    return serializedArray;
  }

  const serializedObject: Record<string, SerializedValue> = {};
  const keys = Object.keys(value).slice(0, MAX_OBJECT_KEYS);

  for (const key of keys) {
    try {
      serializedObject[key] = serializeValue(
        (value as Record<string, unknown>)[key],
        seen,
        depth + 1,
      );
    } catch (error) {
      serializedObject[key] =
        `[unavailable property: ${getErrorMessage(error)}]`;
    }
  }

  const totalKeys = Object.keys(value).length;
  if (totalKeys > MAX_OBJECT_KEYS) {
    serializedObject.__truncatedKeys = totalKeys - MAX_OBJECT_KEYS;
  }

  return serializedObject;
}

function isDomNode(value: object): value is Node {
  return typeof Node !== "undefined" && value instanceof Node;
}

function serializeDomNode(node: Node): SerializedValue {
  const base: Record<string, SerializedValue> = {
    nodeType: node.nodeType,
    nodeName: node.nodeName,
  };

  if (node instanceof Element) {
    base.tagName = node.tagName.toLowerCase();

    if (node.id) {
      base.id = node.id;
    }

    if (typeof node.className === "string" && node.className.length > 0) {
      base.className = node.className;
    }

    const text = node.textContent?.trim();
    if (text) {
      base.text = truncateString(text, 500);
    }

    return base;
  }

  if (node instanceof Text) {
    base.text = truncateString(node.textContent ?? "", 500);
  }

  return base;
}

function getConsoleStack(
  level: ConsoleLevel,
  args: unknown[],
): string | undefined {
  for (const arg of args) {
    const stack = getErrorStack(arg);
    if (stack) {
      return stack;
    }
  }

  if (level === "error" || level === "trace") {
    return new Error(`console.${level}`).stack;
  }

  return undefined;
}

function getErrorStack(value: unknown): string | undefined {
  return value instanceof Error && typeof value.stack === "string"
    ? truncateString(value.stack, MAX_STRING_LENGTH)
    : undefined;
}

function serializeErrorLocation(
  lineNumber: unknown,
  columnNumber: unknown,
): SerializedValue {
  return {
    lineNumber: typeof lineNumber === "number" ? lineNumber : null,
    columnNumber: typeof columnNumber === "number" ? columnNumber : null,
  };
}

function normalizeMethod(method: unknown): string {
  return typeof method === "string" && method.trim().length > 0
    ? method.toUpperCase()
    : "GET";
}

function normalizeUrl(url: unknown): string {
  try {
    return new URL(String(url), window.location.href).href;
  } catch {
    return String(url);
  }
}

function truncateString(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength)}…[truncated ${value.length - maxLength} chars]`
    : value;
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPostedCapturedEvent(value: unknown): value is PostedCapturedEvent {
  if (!isRecord(value) || value.source !== SOURCE || !isRecord(value.event)) {
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
