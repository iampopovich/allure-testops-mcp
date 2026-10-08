import { z } from "zod";
import type { McpToolAnnotations, McpToolDefinition } from "./types.js";

const READ_ONLY_PREFIXES = ["get_", "list_", "search_", "find_", "suggest_"];
const DESTRUCTIVE_PREFIXES = ["delete_", "remove_", "unlink_"];
const ADDITIVE_PREFIXES = ["create_", "add_", "link_", "copy_", "upload_", "restore_"];

/**
 * Behaviour hints derived from the tool-name verb. Tools whose verb is not listed
 * (update_, set_, close_, run_, ...) get only readOnlyHint=false, so clients fall
 * back to the spec default of treating them as potentially destructive.
 */
export function inferToolAnnotations(name: string): McpToolAnnotations {
  const has = (prefixes: string[]) => prefixes.some((prefix) => name.startsWith(prefix));
  if (has(READ_ONLY_PREFIXES)) return { readOnlyHint: true, openWorldHint: true };
  if (has(DESTRUCTIVE_PREFIXES)) return { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
  if (has(ADDITIVE_PREFIXES)) return { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
  return { readOnlyHint: false, openWorldHint: true };
}

/**
 * Creates a Zod-backed tool definition: a JSON Schema for the MCP
 * inputSchema, and a typed `parse()` function for use in handlers.
 *
 * Usage:
 *   const getDefect = zodTool("get_defect", "Get a defect by ID.", z.object({
 *     id: z.number().int().describe("Defect ID."),
 *   }));
 *
 *   // In the bundle:
 *   tools: [getDefect.definition],
 *   handlers: {
 *     get_defect: async (rawArgs) => {
 *       const { id } = getDefect.parse(rawArgs);
 *       return api.getDefect(client, id);
 *     },
 *   }
 */
export function zodTool<S extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: S,
): {
  definition: McpToolDefinition;
  parse: (rawArgs: unknown) => z.infer<S>;
} {
  // Zod v4 ships its own JSON Schema converter. "io: input" is required so that
  // coerced/transformed fields (coerceInt, coerceArray, coerceObject) are described
  // by what a client may SEND, not by the parsed output type.
  const jsonSchema = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;

  // MCP inputSchema carries no $schema dialect marker.
  delete jsonSchema.$schema;

  // Ensure the top-level "type" is present (the converter may omit it in edge cases)
  if (!jsonSchema.type) {
    jsonSchema.type = "object";
  }

  return {
    definition: {
      name,
      description,
      inputSchema: jsonSchema as McpToolDefinition["inputSchema"],
      annotations: inferToolAnnotations(name),
    },
    parse: (rawArgs: unknown) => schema.parse(rawArgs) as z.infer<S>,
  };
}

// ─── Reusable schema fragments ───────────────────────────────────────────────

/** Coerces string numbers to actual numbers (MCP clients often pass numbers as strings). */
export function coerceInt() {
  return z.coerce.number().int();
}

/** Numeric project ID. */
export const projectIdSchema = coerceInt().describe(
  "Project ID. Must be a number (integer), not a string.",
);

/** Project name (alternative to projectId). */
export const projectNameSchema = z.string().describe(
  "Project name (alternative to projectId).",
);

/** Numeric ID field. */
export const idSchema = (label: string) =>
  coerceInt().describe(label + " ID. Must be a number (integer), not a string.");

/** Pagination fields. */
export const paginationSchema = {
  page: coerceInt().min(0).optional().describe("Page number, 0-based."),
  size: coerceInt().optional().describe("Page size."),
};

/** Sort array. */
export const sortSchema = coerceArray(z.string()).optional();

/** Accepts both objects and JSON-stringified objects (MCP clients may serialize nested params as JSON strings). */
export function coerceObject() {
  return z.union([
    z.object({}).passthrough(),
    z.string().transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        // Silently falling back to {} would turn a malformed payload into an empty write that "succeeds".
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected an object or a JSON-encoded object string." });
        return z.NEVER;
      }
    }).pipe(z.object({}).passthrough()),
  ]);
}

/** Generic object payload (legacy — prefer coerceObject() for new code). */
export const payloadSchema = coerceObject();

/** Accepts both arrays and JSON-stringified arrays (MCP clients often serialize array params as JSON strings). */
export function coerceArray<T extends z.ZodTypeAny>(elementSchema: T) {
  return z.union([
    z.array(elementSchema),
    z.string().transform((s, ctx) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(s);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected an array or a JSON-encoded array string." });
        return z.NEVER;
      }
      if (!Array.isArray(parsed)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected an array or a JSON-encoded array string." });
        return z.NEVER;
      }
      return parsed;
    }).pipe(z.array(elementSchema)),
  ]);
}
