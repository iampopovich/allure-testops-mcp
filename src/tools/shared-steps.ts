import type { AllureApiClient } from "../client.js";
import * as api from "../api/shared-steps.js";
import type { ToolBundle } from "./types.js";
import {
  asObject,
  getObjectPayload,
  getOptionalBoolean,
  getOptionalString,
  getRequiredId,
  getRequiredString,
  pickPagination,
  resolveProjectId,
} from "./utils.js";

export function createSharedStepTools(client: AllureApiClient): ToolBundle {
  const tools = [
    {
      name: "list_shared_steps",
      description:
        "List shared steps (reusable step library) for a project. " +
        "Shared steps are referenced from test case scenarios via sharedStepId. " +
        "Use this to discover the available shared step library before reading test case steps.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          search: { type: "string", description: "Text search filter." },
          archived: { type: "boolean", description: "Filter by archived status. Omit to return active steps only." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
        },
      },
    },
    {
      name: "get_shared_step",
      description: "Get a shared step by ID. Returns metadata: name, project, archived status.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Shared step ID. Must be a number (integer), not a string." },
        },
        required: ["id"],
      },
    },
    {
      name: "get_shared_step_steps",
      description:
        "Get the full normalized scenario (list of steps) inside a shared step. " +
        "This is the key tool for resolving sharedStepId references in test case scenarios: " +
        "when get_test_case_steps returns a step with sharedStepId, call this tool to inline " +
        "the actual step content. Returns the same NormalizedScenarioDto format as get_test_case_steps.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Shared step ID. Must be a number (integer), not a string." },
        },
        required: ["id"],
      },
    },
    {
      name: "get_shared_step_usage",
      description:
        "Get the list of test cases that use a specific shared step. " +
        "Use this for impact analysis before editing or archiving a shared step: " +
        "shows which test cases would be affected.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Shared step ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
        },
        required: ["id"],
      },
    },
    {
      name: "create_shared_step",
      description:
        "Create a new shared step in a project. " +
        "payload must include at minimum: name (string) and projectId (number). " +
        "Use this to extract repeated test steps into a reusable library.",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload: {
            type: "object",
            additionalProperties: true,
            description: "Shared step creation data. Required fields: name, projectId.",
          },
        },
        required: ["payload"],
      },
    },
    {
      name: "update_shared_step",
      description: "Update shared step metadata (name, etc.) by ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Shared step ID. Must be a number (integer), not a string." },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "archive_shared_step",
      description:
        "Archive a shared step to retire it from active use. " +
        "Archived steps remain readable but are hidden from the active library. " +
        "Run get_shared_step_usage first to check impact before archiving.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Shared step ID. Must be a number (integer), not a string." },
        },
        required: ["id"],
      },
    },
    {
      name: "unarchive_shared_step",
      description: "Restore an archived shared step back to active status.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Shared step ID. Must be a number (integer), not a string." },
        },
        required: ["id"],
      },
    },
  ];

  const handlers = {
    list_shared_steps: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.listSharedSteps(client, projectId, {
        search: getOptionalString(args, "search"),
        archived: getOptionalBoolean(args, "archived"),
        ...pickPagination(args),
      });
    },

    get_shared_step: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getSharedStep(client, getRequiredId(args));
    },

    get_shared_step_steps: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getSharedStepSteps(client, getRequiredId(args));
    },

    get_shared_step_usage: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getSharedStepUsage(client, getRequiredId(args), pickPagination(args));
    },

    create_shared_step: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.createSharedStep(client, getObjectPayload(args));
    },

    update_shared_step: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.updateSharedStep(client, getRequiredId(args), getObjectPayload(args));
    },

    archive_shared_step: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.archiveSharedStep(client, getRequiredId(args));
    },

    unarchive_shared_step: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.unarchiveSharedStep(client, getRequiredId(args));
    },
  };

  return { tools, handlers };
}
