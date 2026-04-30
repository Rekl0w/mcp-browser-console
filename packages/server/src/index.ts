#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { browserConsoleTools, handleBrowserConsoleTool } from "./tools.js";
import { BrowserEventHub } from "./websocket.js";

const SERVER_NAME = "mcp-browser-console";
const SERVER_VERSION = "0.1.0";
const WEBSOCKET_PORT = 3712;
const BUFFER_SIZE = 500;

async function main(): Promise<void> {
  const eventHub = new BrowserEventHub({
    port: WEBSOCKET_PORT,
    maxBufferSize: BUFFER_SIZE,
  });

  await eventHub.start();

  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: browserConsoleTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await handleBrowserConsoleTool(
        request.params.name,
        request.params.arguments,
        eventHub,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(ErrorCode.MethodNotFound, getErrorMessage(error));
    }
  });

  const shutdown = async (): Promise<void> => {
    await eventHub.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });

  process.once("SIGTERM", () => {
    void shutdown();
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] ${getErrorMessage(error)}`);
  process.exit(1);
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
