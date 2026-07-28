import type { AllureApiClient } from "../client.js";
import * as api from "../api/environments.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, coerceInt, idSchema, projectIdSchema, projectNameSchema, paginationSchema } from "./schema.js";
import { resolveProjectId } from "./utils.js";

const suggestEnvVars = zodTool("suggest_env_vars",
  "Search environment variable definitions by name. Returns matching env var keys with their IDs. Use this to find the exact name of an env var key before querying values.",
  z.object({ query: z.string().optional().describe("Partial env var name to search for."), ...paginationSchema }),
);

const suggestEnvVarValues = zodTool("suggest_env_var_values",
  "Search for recorded environment variable values by partial text. Optionally scope by envVarId, projectId, or launchId. Use this to autocomplete valid values for AQL ev[] filters before running a search.",
  z.object({
    query: z.string().optional().describe("Partial value text to search for."),
    envVarId: coerceInt().optional().describe("Filter by specific env var key ID. Must be a number (integer), not a string."),
    projectId: projectIdSchema.optional(),
    projectName: projectNameSchema.optional(),
    launchId: coerceInt().optional().describe("Scope to a specific launch. Must be a number (integer), not a string."),
    ...paginationSchema,
  }),
);

const listEnvVarSchemas = zodTool("list_env_var_schemas",
  "List environment variable schema definitions for a project. Schemas define which env var keys are tracked and displayed for launches in this project. Use this to understand what configuration context is captured per launch in a given project.",
  z.object({ projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(), ...paginationSchema }),
);

const listEnvVarValues = zodTool("list_env_var_values",
  "List all recorded values for a specific environment variable key. Returns the distinct values that have been used across test runs (e.g. all browser versions recorded). Use envVarId from list_env_vars. Useful for building precise AQL filters: know that ev[\"browser\"] has values [\"Chrome 123\", \"Firefox 115\"].",
  z.object({ envVarId: coerceInt().describe("Environment variable ID from list_env_vars. Must be a number (integer), not a string.") }),
);

const getTestResultEnvVars = zodTool("get_test_result_env_vars",
  "Get the environment variable values recorded for a specific test result. Shows what configuration context (browser, OS, env name, build) this result ran against. Use this when investigating a failure to understand if the environment is a factor: e.g. 'does this only fail on Chrome 124 but not on Firefox?'",
  z.object({ id: idSchema("Test result") }),
);

export function createEnvironmentTools(client: AllureApiClient): ToolBundle {
  return {
    tools: [
      suggestEnvVars.definition,
      suggestEnvVarValues.definition,
      listEnvVarSchemas.definition,
      listEnvVarValues.definition,
      getTestResultEnvVars.definition,
    ],
    handlers: {
      suggest_env_vars: async (rawArgs: unknown) => {
        const args = suggestEnvVars.parse(rawArgs);
        return api.suggestEnvVars(client, { query: args.query, page: args.page, size: args.size });
      },
      suggest_env_var_values: async (rawArgs: unknown) => {
        const args = suggestEnvVarValues.parse(rawArgs);
        return api.suggestEnvVarValues(client, {
          query: args.query, envVarId: args.envVarId,
          projectId: args.projectId, launchId: args.launchId,
          page: args.page, size: args.size,
        });
      },
      list_env_var_schemas: async (rawArgs: unknown) => {
        const args = listEnvVarSchemas.parse(rawArgs);
        const projectId = await resolveProjectId(args, client);
        return api.listEnvVarSchemas(client, projectId, { page: args.page, size: args.size });
      },
      list_env_var_values: async (rawArgs: unknown) => {
        const { envVarId } = listEnvVarValues.parse(rawArgs);
        return api.listEnvVarValues(client, envVarId);
      },
      get_test_result_env_vars: async (rawArgs: unknown) => {
        const { id } = getTestResultEnvVars.parse(rawArgs);
        return api.getTestResultEnvVars(client, id);
      },
    },
  };
}
