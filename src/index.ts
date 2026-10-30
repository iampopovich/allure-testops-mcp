#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { version: string };
const version = pkg.version;
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { buildToolRegistry, createClientFromEnv } from "./server-bootstrap.js";
import { RESOURCES, RESOURCE_TEMPLATES, readResourceContent } from "./resources/index.js";
import { logger } from "./logger.js";

function formatToolResult(result: unknown): string {
  if (result === undefined) {
    return "OK";
  }
  if (typeof result === "string") {
    return result;
  }
  // Compact JSON: indentation adds ~20-30% tokens to every response with no value for the model.
  return JSON.stringify(result);
}

async function main(): Promise<void> {
  const client = createClientFromEnv();
  const { tools, handlers } = buildToolRegistry(client);

  const server = new Server(
    { name: "allure-testops-mcp", version: version },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: RESOURCE_TEMPLATES }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    try {
      const { mimeType, text } = await readResourceContent(client, uri);
      return { contents: [{ uri, mimeType, text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read resource ${uri}: ${message}`);
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const start = Date.now();
    try {
      const handler = handlers.get(toolName);
      if (!handler) {
        logger.warn({ tool: toolName }, "unknown tool requested");
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error: Unknown tool: ${toolName}`,
            },
          ],
        };
      }

      logger.debug({ tool: toolName }, "tool call started");
      const result = await handler(request.params.arguments);
      logger.debug({ tool: toolName, durationMs: Date.now() - start }, "tool call completed");
      return {
        content: [
          {
            type: "text",
            text: formatToolResult(result),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ tool: toolName, err: message, durationMs: Date.now() - start }, "tool call failed");
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error: ${message}`,
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("server started");

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down gracefully");
    try {
      await server.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, "error during server close");
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.fatal({ err: message }, "fatal startup error");
  process.exit(1);
});
