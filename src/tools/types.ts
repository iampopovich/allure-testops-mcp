export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  annotations?: McpToolAnnotations;
}

/** MCP tool behaviour hints (spec 2025-03-26+). Clients use them for confirmation prompts and auto-approval. */
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export type ToolHandler = (args: unknown) => Promise<unknown>;

export interface ToolBundle {
  tools: McpToolDefinition[];
  handlers: Record<string, ToolHandler>;
}
