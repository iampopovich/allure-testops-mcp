import type { AllureApiClient } from "../client.js";
import * as api from "../api/launches.js";
import type { ToolBundle } from "./types.js";
import {
  asObject,
  ensureProjectIdInPayload,
  getObjectPayload,
  getOptionalNumber,
  getOptionalString,
  getRequiredId,
  getRequiredString,
  pickPagination,
  resolveProjectId,
} from "./utils.js";

export function createLaunchTools(
  client: AllureApiClient,
): ToolBundle {
  const tools = [
    {
      name: "list_launches",
      description: "List launches for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          search: { type: "string" },
          filterId: { type: "number", description: "Saved filter ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "search_launches",
      description: "Search launches by AQL query.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          rql: {
            type: "string",
            description:
              "AQL (Allure Query Language) filter expression. " +
              "Operators: = != ~= (contains) > < >= <= in [...] and or not. " +
              "IMPORTANT: 'not in' is written as 'not field in [...]', NOT 'field not in [...]'. " +
              "Launch fields: id, name, tag, issue, job, ev[\"VAR\"], evv, closed (boolean), " +
              "createdDate, createdBy, lastModifiedDate, lastModifiedBy. " +
              "Dates use 13-digit Unix ms timestamps. " +
              'Examples: name ~= "nightly" | closed = false | closed = true | ' +
              'tag in ["release", "pre-release"] | job = "jenkins_master" | ' +
              'ev["OS"] = "Linux" | not tag in ["devbuild"] | ' +
              'name ~= "regression" and closed = true',
          },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["rql"],
      },
    },
    {
      name: "get_launch",
      description: "Get a launch by ID.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "create_launch",
      description:
        "Create a new launch. payload.projectId defaults to ALLURE_PROJECT_ID env when omitted.",
      inputSchema: {
        type: "object" as const,
        properties: { payload: { type: "object", additionalProperties: true } },
        required: ["payload"],
      },
    },
    {
      name: "update_launch",
      description: "Update an existing launch.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Launch ID. Must be a number (integer), not a string." },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "delete_launch",
      description: "Delete a launch by ID.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "close_launch",
      description: "Close an open launch.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "reopen_launch",
      description: "Reopen a closed launch.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "get_launch_statistic",
      description: "Get launch statistics.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "get_launch_progress",
      description: "Get launch progress widget data.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "add_test_cases_to_launch",
      description: "Add test cases to a launch.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Launch ID. Must be a number (integer), not a string." },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "add_test_plan_to_launch",
      description: "Add a test plan to a launch.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Launch ID. Must be a number (integer), not a string." },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id", "payload"],
      },
    },
  ];

  const handlers = {
    list_launches: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.listLaunches(client, projectId, {
        search: getOptionalString(args, "search"),
        filterId: getOptionalNumber(args, "filterId"),
        ...pickPagination(args),
      });
    },
    search_launches: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.searchLaunches(client, projectId, getRequiredString(args, "rql"), {
        ...pickPagination(args),
      });
    },
    get_launch: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getLaunch(client, getRequiredId(args));
    },
    create_launch: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const payload = ensureProjectIdInPayload(getObjectPayload(args), client);
      return api.createLaunch(client, payload);
    },
    update_launch: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.updateLaunch(client, getRequiredId(args), getObjectPayload(args));
    },
    delete_launch: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.deleteLaunch(client, getRequiredId(args));
    },
    close_launch: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.closeLaunch(client, getRequiredId(args));
    },
    reopen_launch: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.reopenLaunch(client, getRequiredId(args));
    },
    get_launch_statistic: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getLaunchStatistic(client, getRequiredId(args));
    },
    get_launch_progress: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getLaunchProgress(client, getRequiredId(args));
    },
    add_test_cases_to_launch: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.addTestCasesToLaunch(client, getRequiredId(args), getObjectPayload(args));
    },
    add_test_plan_to_launch: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.addTestPlanToLaunch(client, getRequiredId(args), getObjectPayload(args));
    },
  };

  return { tools, handlers };
}
