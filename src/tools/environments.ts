import type { AllureApiClient } from "../client.js";
import * as api from "../api/environments.js";
import type { ToolBundle } from "./types.js";
import {
  asObject,
  getOptionalNumber,
  getOptionalString,
  getRequiredId,
  pickPagination,
  resolveProjectId,
} from "./utils.js";

export function createEnvironmentTools(client: AllureApiClient): ToolBundle {
  const tools = [
    {
      name: "list_env_vars",
      description:
        "List all environment variable definitions (keys) available in the system. " +
        "Environment variables track test configuration context: browser, OS, environment name, build number, etc. " +
        "Use this to discover what ev[] keys are available before constructing AQL filters like " +
        'ev["browser"] = "Chrome" or ev["os"] = "Linux" in search_test_results or search_launches.',
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "suggest_env_vars",
      description:
        "Search environment variable definitions by name. " +
        "Returns matching env var keys with their IDs. " +
        "Use this to find the exact name of an env var key before querying values.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Partial env var name to search for." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
        },
      },
    },
    {
      name: "list_env_var_schemas",
      description:
        "List environment variable schema definitions for a project. " +
        "Schemas define which env var keys are tracked and displayed for launches in this project. " +
        "Use this to understand what configuration context is captured per launch in a given project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
        },
      },
    },
    {
      name: "list_env_var_values",
      description:
        "List all recorded values for a specific environment variable key. " +
        "Returns the distinct values that have been used across test runs (e.g. all browser versions recorded). " +
        "Use envVarId from list_env_vars. " +
        "Useful for building precise AQL filters: know that ev[\"browser\"] has values [\"Chrome 123\", \"Firefox 115\"].",
      inputSchema: {
        type: "object" as const,
        properties: {
          envVarId: { type: "number", description: "Environment variable ID from list_env_vars. Must be a number (integer), not a string." },
        },
        required: ["envVarId"],
      },
    },
    {
      name: "suggest_env_var_values",
      description:
        "Search for recorded environment variable values by partial text. " +
        "Optionally scope by envVarId, projectId, or launchId. " +
        "Use this to autocomplete valid values for AQL ev[] filters before running a search.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Partial value text to search for." },
          envVarId: { type: "number", description: "Filter by specific env var key ID. Must be a number (integer), not a string." },
          projectId: { type: "number", description: "Scope to a project. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          launchId: { type: "number", description: "Scope to a specific launch. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
        },
      },
    },
    {
      name: "get_test_result_env_vars",
      description:
        "Get the environment variable values recorded for a specific test result. " +
        "Shows what configuration context (browser, OS, env name, build) this result ran against. " +
        "Use this when investigating a failure to understand if the environment is a factor: " +
        "e.g. 'does this only fail on Chrome 124 but not on Firefox?'",
      inputSchema: {
        type: "object" as const,
        properties: {
          testResultId: { type: "number", description: "Test result ID. Must be a number (integer), not a string." },
        },
        required: ["testResultId"],
      },
    },
  ];

  const handlers = {
    list_env_vars: async (_rawArgs: unknown) => {
      return api.listEnvVars(client);
    },

    suggest_env_vars: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.suggestEnvVars(client, {
        query: getOptionalString(args, "query"),
        ...pickPagination(args),
      });
    },

    list_env_var_schemas: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.listEnvVarSchemas(client, projectId, pickPagination(args));
    },

    list_env_var_values: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.listEnvVarValues(client, getRequiredId(args, "envVarId"));
    },

    suggest_env_var_values: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const query: Record<string, string | number | undefined> = {
        query: getOptionalString(args, "query"),
        envVarId: getOptionalNumber(args, "envVarId"),
        launchId: getOptionalNumber(args, "launchId"),
      };
      if (args["projectId"] !== undefined || args["projectName"] !== undefined) {
        query.projectId = await resolveProjectId(args, client);
      }
      return api.suggestEnvVarValues(client, { ...query, ...pickPagination(args) });
    },

    get_test_result_env_vars: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestResultEnvVars(client, getRequiredId(args, "testResultId"));
    },
  };

  return { tools, handlers };
}
