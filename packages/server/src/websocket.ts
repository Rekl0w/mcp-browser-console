import { WebSocketServer, type RawData, type WebSocket } from "ws";

export type BrowserEventType = "log" | "network" | "error";
export type BrowserEventLevel =
  | "log"
  | "warn"
  | "error"
  | "info"
  | "debug"
  | "trace"
  | string;

export interface BrowserConsoleEvent {
  type: BrowserEventType;
  level: BrowserEventLevel;
  args: unknown[];
  url: string;
  timestamp: number;
  stack?: string | undefined;
  pageUrl?: string | undefined;
  tabId?: number | undefined;
  method?: string | undefined;
  status?: number | undefined;
  responseBody?: unknown;
  duration?: number | undefined;
}

export interface BrowserEventHubOptions {
  port?: number;
  maxBufferSize?: number;
  heartbeatIntervalMs?: number;
  clientTimeoutMs?: number;
}

export interface BrowserEventHubStatus {
  listening: boolean;
  port: number;
  bufferSize: number;
  maxBufferSize: number;
  websocketClientCount: number;
  connectedTabCount: number;
  connectedTabs: number[];
  lastEventAt?: number | undefined;
  uptimeSeconds: number;
}

interface ClientState {
  tabIds: Set<number>;
  connectedAt: number;
  lastSeenAt: number;
  queuedEvents?: number | undefined;
  extensionVersion?: string | undefined;
}

interface ClientStatusMessage {
  kind: "client_status";
  tabIds?: unknown;
  connected?: unknown;
  queuedEvents?: unknown;
  timestamp?: unknown;
  extensionVersion?: unknown;
}

const DEFAULT_PORT = 3712;
const DEFAULT_MAX_BUFFER_SIZE = 500;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_CLIENT_TIMEOUT_MS = 45_000;

export class BrowserEventHub {
  readonly port: number;
  readonly maxBufferSize: number;

  private readonly heartbeatIntervalMs: number;
  private readonly clientTimeoutMs: number;
  private readonly startedAt = Date.now();
  private readonly buffer: BrowserConsoleEvent[] = [];
  private readonly clients = new Map<WebSocket, ClientState>();

  private nextBufferIndex = 0;
  private server: WebSocketServer | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private lastEventAt: number | undefined;

  constructor(options: BrowserEventHubOptions = {}) {
    this.port = options.port ?? DEFAULT_PORT;
    this.maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.clientTimeoutMs = options.clientTimeoutMs ?? DEFAULT_CLIENT_TIMEOUT_MS;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = new WebSocketServer({ port: this.port });
    this.server = server;

    server.on("connection", (socket) => {
      this.registerClient(socket);
    });

    await new Promise<void>((resolve, reject) => {
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };

      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };

      server.once("listening", onListening);
      server.once("error", onError);
    });

    this.startHeartbeat();
  }

  async stop(): Promise<void> {
    this.stopHeartbeat();

    const server = this.server;
    this.server = undefined;

    for (const socket of this.clients.keys()) {
      socket.close(1001, "MCP server shutting down");
    }

    this.clients.clear();

    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  getEvents(): BrowserConsoleEvent[] {
    if (this.buffer.length < this.maxBufferSize) {
      return [...this.buffer];
    }

    return [
      ...this.buffer.slice(this.nextBufferIndex),
      ...this.buffer.slice(0, this.nextBufferIndex),
    ];
  }

  clear(): void {
    this.buffer.length = 0;
    this.nextBufferIndex = 0;
    this.lastEventAt = undefined;
  }

  getStatus(): BrowserEventHubStatus {
    const connectedTabs = this.getConnectedTabs();
    const status: BrowserEventHubStatus = {
      listening: Boolean(this.server),
      port: this.port,
      bufferSize: this.buffer.length,
      maxBufferSize: this.maxBufferSize,
      websocketClientCount: this.clients.size,
      connectedTabCount: connectedTabs.length,
      connectedTabs,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };

    if (this.lastEventAt !== undefined) {
      status.lastEventAt = this.lastEventAt;
    }

    return status;
  }

  private registerClient(socket: WebSocket): void {
    const state: ClientState = {
      tabIds: new Set<number>(),
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
    };

    this.clients.set(socket, state);

    socket.on("message", (data) => {
      state.lastSeenAt = Date.now();
      this.handleMessage(socket, data);
    });

    socket.on("pong", () => {
      state.lastSeenAt = Date.now();
    });

    socket.on("close", () => {
      this.clients.delete(socket);
    });

    socket.on("error", () => {
      this.clients.delete(socket);
    });
  }

  private handleMessage(socket: WebSocket, data: RawData): void {
    const parsed = parseJson(data);

    if (!isRecord(parsed)) {
      return;
    }

    if (isClientStatusMessage(parsed)) {
      this.updateClientStatus(socket, parsed);
      return;
    }

    const event = normalizeBrowserEvent(parsed);

    if (!event) {
      return;
    }

    this.addEvent(event);

    const state = this.clients.get(socket);
    if (state && typeof event.tabId === "number") {
      state.tabIds.add(event.tabId);
    }
  }

  private updateClientStatus(
    socket: WebSocket,
    message: ClientStatusMessage,
  ): void {
    const state = this.clients.get(socket);

    if (!state) {
      return;
    }

    state.lastSeenAt =
      typeof message.timestamp === "number" &&
      Number.isFinite(message.timestamp)
        ? message.timestamp
        : Date.now();
    state.tabIds = new Set(parseTabIds(message.tabIds));

    if (
      typeof message.queuedEvents === "number" &&
      Number.isFinite(message.queuedEvents)
    ) {
      state.queuedEvents = message.queuedEvents;
    }

    if (typeof message.extensionVersion === "string") {
      state.extensionVersion = message.extensionVersion;
    }
  }

  private addEvent(event: BrowserConsoleEvent): void {
    if (this.buffer.length < this.maxBufferSize) {
      this.buffer.push(event);
    } else {
      this.buffer[this.nextBufferIndex] = event;
      this.nextBufferIndex = (this.nextBufferIndex + 1) % this.maxBufferSize;
    }

    this.lastEventAt = event.timestamp;
  }

  private getConnectedTabs(): number[] {
    const tabIds = new Set<number>();

    for (const state of this.clients.values()) {
      for (const tabId of state.tabIds) {
        tabIds.add(tabId);
      }
    }

    return [...tabIds].sort((left, right) => left - right);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();

      for (const [socket, state] of this.clients) {
        if (now - state.lastSeenAt > this.clientTimeoutMs) {
          socket.terminate();
          this.clients.delete(socket);
          continue;
        }

        if (socket.readyState === socket.OPEN) {
          socket.ping();
        }
      }
    }, this.heartbeatIntervalMs);

    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }
}

function parseJson(data: RawData): unknown {
  try {
    if (Array.isArray(data)) {
      return JSON.parse(Buffer.concat(data).toString("utf8"));
    }

    if (data instanceof ArrayBuffer) {
      return JSON.parse(Buffer.from(data).toString("utf8"));
    }

    return JSON.parse(Buffer.from(data).toString("utf8"));
  } catch {
    return undefined;
  }
}

function normalizeBrowserEvent(
  value: Record<string, unknown>,
): BrowserConsoleEvent | undefined {
  const type = value.type;

  if (type !== "log" && type !== "network" && type !== "error") {
    return undefined;
  }

  const level =
    typeof value.level === "string"
      ? value.level
      : type === "error"
        ? "error"
        : "log";
  const url = typeof value.url === "string" ? value.url : "unknown";
  const timestamp =
    typeof value.timestamp === "number" && Number.isFinite(value.timestamp)
      ? value.timestamp
      : Date.now();
  const args = Array.isArray(value.args) ? value.args : [];

  const event: BrowserConsoleEvent = {
    type,
    level,
    args,
    url,
    timestamp,
  };

  assignString(event, "stack", value.stack);
  assignString(event, "pageUrl", value.pageUrl);
  assignNumber(event, "tabId", value.tabId);
  assignString(event, "method", value.method);
  assignNumber(event, "status", value.status);
  assignNumber(event, "duration", value.duration);

  if ("responseBody" in value) {
    event.responseBody = value.responseBody;
  }

  return event;
}

function parseTabIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is number =>
      typeof entry === "number" && Number.isInteger(entry) && entry >= 0,
  );
}

function assignString(
  target: BrowserConsoleEvent,
  key: "stack" | "pageUrl" | "method",
  value: unknown,
): void {
  if (typeof value === "string") {
    target[key] = value;
  }
}

function assignNumber(
  target: BrowserConsoleEvent,
  key: "tabId" | "status" | "duration",
  value: unknown,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value;
  }
}

function isClientStatusMessage(value: unknown): value is ClientStatusMessage {
  return isRecord(value) && value.kind === "client_status";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
