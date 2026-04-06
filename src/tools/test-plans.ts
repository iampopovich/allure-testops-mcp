import type { AllureApiClient } from "../client.js";
import * as api from "../api/test-plans.js";
import type { ToolBundle } from "./types.js";
import {
  asObject,
  ensureProjectIdInPayload,
  getObjectPayload,
  getOptionalString,
  getRequiredId,
  pickPagination,
  resolveProjectId,
} from "./utils.js";

export function createTestPlanTools(
  client: AllureApiClient,
): ToolBundle {
  const tools = [
    {
      name: "list_test_plans",
      description: "List test plans for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          search: { type: "string" },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "get_test_plan",
      description: "Get a test plan by ID.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number", description: "Test plan ID. Must be a number (integer), not a string." } },
        required: ["id"],
      },
    },
    {
      name: "create_test_plan",
      description:
        "Create a new test plan. payload.projectId defaults to ALLURE_PROJECT_ID env when omitted.",
      inputSchema: {
        type: "object" as const,
        properties: { payload: { type: "object", additionalProperties: true } },
        required: ["payload"],
      },
    },
    {
      name: "update_test_plan",
      description: "Update an existing test plan.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Test plan ID. Must be a number (integer), not a string." },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "delete_test_plan",
      description: "Delete a test plan by ID.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number", description: "Test plan ID. Must be a number (integer), not a string." } },
        required: ["id"],
      },
    },
    {
      name: "run_test_plan",
      description: "Run a test plan by ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Test plan ID. Must be a number (integer), not a string." },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id"],
      },
    },
  ];

  const handlers = {
    list_test_plans: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.listTestPlans(client, projectId, {
        search: getOptionalString(args, "search"),
        ...pickPagination(args),
      });
    },
    get_test_plan: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestPlan(client, getRequiredId(args));
    },
    create_test_plan: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const payload = ensureProjectIdInPayload(getObjectPayload(args), client);
      return api.createTestPlan(client, payload);
    },
    update_test_plan: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.updateTestPlan(client, getRequiredId(args), getObjectPayload(args));
    },
    delete_test_plan: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.deleteTestPlan(client, getRequiredId(args));
    },
    run_test_plan: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const payload = args.payload;
      if (
        payload !== undefined &&
        (typeof payload !== "object" || payload === null || Array.isArray(payload))
      ) {
        throw new Error("\"payload\" must be an object when provided.");
      }
      return api.runTestPlan(
        client,
        getRequiredId(args),
        payload as Record<string, unknown> | undefined,
      );
    },
  };

  return { tools, handlers };
}
