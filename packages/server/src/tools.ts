import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { BrowserConsoleEvent, BrowserEventHub } from "./websocket.js";

interface LogFilters {
  levels?: string[];
  url?: string;
  since?: number;
  limit: number;
}

interface NetworkFilters {
  url?: string;
  statuses?: number[];
  since?: number;
  limit: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export const browserConsoleTools = [
  {
    name: "get_logs",
    description:
      "Return buffered console and error events. Supports filtering by log level, URL substring, timestamp, and result limit.",
    inputSchema: {
      type: "object",
      properties: {
        level: {
          type: "array",
          items: {
            type: "string",
            enum: ["log", "warn", "error", "info", "debug", "trace"],
          },
          description: "Optional list of console levels to include.",
        },
        url: {
          type: "string",
          description:
            "Optional case-insensitive substring matched against url and pageUrl.",
        },
        since: {
          oneOf: [{ type: "number" }, { type: "string" }],
          description:
            "Optional timestamp. Accepts milliseconds since epoch or an ISO date string.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          default: DEFAULT_LIMIT,
          description: "Maximum number of events to return.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_network_requests",
    description:
      "Return buffered fetch and XMLHttpRequest network events. Supports filtering by URL substring, HTTP status, timestamp, and result limit.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "Optional case-insensitive substring matched against request URL and pageUrl.",
        },
        status: {
          oneOf: [
            { type: "integer" },
            {
              type: "array",
              items: { type: "integer" },
            },
          ],
          description:
            "Optional HTTP status code or list of status codes. Failed requests use status 0.",
        },
        since: {
          oneOf: [{ type: "number" }, { type: "string" }],
          description:
            "Optional timestamp. Accepts milliseconds since epoch or an ISO date string.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          default: DEFAULT_LIMIT,
          description: "Maximum number of events to return.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "clear_buffer",
    description:
      "Clear all buffered browser console, error, and network events.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_status",
    description:
      "Return WebSocket connection status, buffer size, and connected tab count.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const satisfies Tool[];

export async function handleBrowserConsoleTool(
  name: string,
  args: unknown,
  hub: BrowserEventHub,
): Promise<unknown> {
  switch (name) {
    case "get_logs":
      return getLogs(args, hub);
    case "get_network_requests":
      return getNetworkRequests(args, hub);
    case "clear_buffer":
      hub.clear();
      return {
        cleared: true,
        bufferSize: 0,
      };
    case "get_status":
      return hub.getStatus();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function getLogs(
  args: unknown,
  hub: BrowserEventHub,
): { count: number; events: BrowserConsoleEvent[] } {
  const filters = parseLogFilters(args);
  const events = hub
    .getEvents()
    .filter((event) => event.type === "log" || event.type === "error")
    .filter((event) => matchesSince(event, filters.since))
    .filter((event) => matchesUrl(event, filters.url))
    .filter((event) => matchesLevel(event, filters.levels))
    .slice(-filters.limit);

  return {
    count: events.length,
    events,
  };
}

function getNetworkRequests(
  args: unknown,
  hub: BrowserEventHub,
): { count: number; events: BrowserConsoleEvent[] } {
  const filters = parseNetworkFilters(args);
  const events = hub
    .getEvents()
    .filter((event) => event.type === "network")
    .filter((event) => matchesSince(event, filters.since))
    .filter((event) => matchesUrl(event, filters.url))
    .filter((event) => matchesStatus(event, filters.statuses))
    .slice(-filters.limit);

  return {
    count: events.length,
    events,
  };
}

function parseLogFilters(args: unknown): LogFilters {
  const input = isRecord(args) ? args : {};
  const filters: LogFilters = {
    limit: parseLimit(input.limit),
  };

  if (Array.isArray(input.level)) {
    const levels = input.level.filter(
      (level): level is string => typeof level === "string" && level.length > 0,
    );

    if (levels.length > 0) {
      filters.levels = levels;
    }
  }

  if (typeof input.url === "string" && input.url.length > 0) {
    filters.url = input.url;
  }

  const since = parseSince(input.since);
  if (since !== undefined) {
    filters.since = since;
  }

  return filters;
}

function parseNetworkFilters(args: unknown): NetworkFilters {
  const input = isRecord(args) ? args : {};
  const filters: NetworkFilters = {
    limit: parseLimit(input.limit),
  };

  if (typeof input.url === "string" && input.url.length > 0) {
    filters.url = input.url;
  }

  const statuses = parseStatuses(input.status);
  if (statuses !== undefined) {
    filters.statuses = statuses;
  }

  const since = parseSince(input.since);
  if (since !== undefined) {
    filters.since = since;
  }

  return filters;
}

function matchesSince(
  event: BrowserConsoleEvent,
  since: number | undefined,
): boolean {
  return since === undefined || event.timestamp >= since;
}

function matchesUrl(
  event: BrowserConsoleEvent,
  url: string | undefined,
): boolean {
  if (!url) {
    return true;
  }

  const needle = url.toLowerCase();
  return (
    event.url.toLowerCase().includes(needle) ||
    (event.pageUrl?.toLowerCase().includes(needle) ?? false)
  );
}

function matchesLevel(
  event: BrowserConsoleEvent,
  levels: string[] | undefined,
): boolean {
  return !levels || levels.includes(event.level);
}

function matchesStatus(
  event: BrowserConsoleEvent,
  statuses: number[] | undefined,
): boolean {
  return (
    !statuses ||
    (typeof event.status === "number" && statuses.includes(event.status))
  );
}

function parseLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

function parseSince(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  return undefined;
}

function parseStatuses(value: unknown): number[] | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return [value];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const statuses = value.filter(
    (status): status is number =>
      typeof status === "number" && Number.isInteger(status),
  );
  return statuses.length > 0 ? statuses : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
