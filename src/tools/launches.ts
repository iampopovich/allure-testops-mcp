import type { AllureApiClient } from "../client.js";
import * as api from "../api/launches.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, idSchema, paginationSchema, projectIdSchema, projectNameSchema, sortSchema, coerceArray, coerceInt, coerceObject } from "./schema.js";
import { AQL_SYNTAX, ensureProjectIdInPayload, resolveProjectId } from "./utils.js";

const searchLaunches = zodTool("search_launches",
  "Search launches by AQL query.",
  z.object({
    projectId: projectIdSchema.optional(),
    projectName: projectNameSchema.optional(),
    rql: z.string().describe(
      AQL_SYNTAX + " " +
      "Launch fields: id, name, tag, issue, job, ev[\"VAR\"], evv, closed (boolean), " +
      "createdDate, createdBy, lastModifiedDate, lastModifiedBy. " +
      "Examples: name ~= \"nightly\" | closed = false | closed = true | " +
      "tag in [\"release\", \"pre-release\"] | job = \"jenkins_master\" | " +
      "ev[\"OS\"] = \"Linux\" | not tag in [\"devbuild\"] | " +
      "name ~= \"regression\" and closed = true",
    ),
    ...paginationSchema,
    sort: sortSchema,
  }),
);

const getLaunch = zodTool("get_launch", "Get a launch by ID.",
  z.object({ id: idSchema("Launch") }),
);

const createLaunch = zodTool("create_launch",
  "Create a new launch. payload.projectId defaults to ALLURE_PROJECT_ID env when omitted.",
  z.object({ payload: coerceObject() }),
);

const updateLaunch = zodTool("update_launch", "Update an existing launch.",
  z.object({ id: idSchema("Launch"), payload: coerceObject() }),
);

const deleteLaunch = zodTool("delete_launch", "Delete a launch by ID.",
  z.object({ id: idSchema("Launch") }),
);

const closeLaunch = zodTool("close_launch", "Close an open launch.",
  z.object({ id: idSchema("Launch") }),
);

const reopenLaunch = zodTool("reopen_launch", "Reopen a closed launch.",
  z.object({ id: idSchema("Launch") }),
);

const getLaunchStatistic = zodTool("get_launch_statistic", "Get launch statistics.",
  z.object({ id: idSchema("Launch") }),
);

const getLaunchProgress = zodTool("get_launch_progress", "Get launch progress widget data.",
  z.object({ id: idSchema("Launch") }),
);

const addTestCasesToLaunch = zodTool("add_test_cases_to_launch",
  "Add test cases to a launch. payload.selection.leafsInclude must be an array of test case IDs, e.g. { selection: { projectId, leafsInclude: [123, 456], inverted: false } }.",
  z.object({
    id: idSchema("Launch"),
    payload: z.object({
      selection: z.object({
        projectId: projectIdSchema.optional(),
        leafsInclude: coerceArray(coerceInt()).optional(),
        leafsExclude: coerceArray(coerceInt()).optional(),
        inverted: z.boolean().optional(),
      }).passthrough().optional(),
    }).passthrough(),
  }),
);

const addTestPlanToLaunch = zodTool("add_test_plan_to_launch", "Add a test plan to a launch.",
  z.object({ id: idSchema("Launch"), payload: coerceObject() }),
);

export function createLaunchTools(client: AllureApiClient): ToolBundle {
  return {
    tools: [
      searchLaunches.definition,
      getLaunch.definition,
      createLaunch.definition,
      updateLaunch.definition,
      deleteLaunch.definition,
      closeLaunch.definition,
      reopenLaunch.definition,
      getLaunchStatistic.definition,
      getLaunchProgress.definition,
      addTestCasesToLaunch.definition,
      addTestPlanToLaunch.definition,
    ],
    handlers: {
      search_launches: async (rawArgs: unknown) => {
        const args = searchLaunches.parse(rawArgs);
        const projectId = await resolveProjectId(args, client);
        return api.searchLaunches(client, projectId, args.rql, { page: args.page, size: args.size, sort: args.sort });
      },
      get_launch: async (rawArgs) => api.getLaunch(client, getLaunch.parse(rawArgs).id),
      create_launch: async (rawArgs) => {
        const { payload } = createLaunch.parse(rawArgs);
        return api.createLaunch(client, ensureProjectIdInPayload(payload, client));
      },
      update_launch: async (rawArgs) => {
        const { id, payload } = updateLaunch.parse(rawArgs);
        return api.updateLaunch(client, id, payload);
      },
      delete_launch: async (rawArgs) => api.deleteLaunch(client, deleteLaunch.parse(rawArgs).id),
      close_launch: async (rawArgs) => api.closeLaunch(client, closeLaunch.parse(rawArgs).id),
      reopen_launch: async (rawArgs) => api.reopenLaunch(client, reopenLaunch.parse(rawArgs).id),
      get_launch_statistic: async (rawArgs) => api.getLaunchStatistic(client, getLaunchStatistic.parse(rawArgs).id),
      get_launch_progress: async (rawArgs) => api.getLaunchProgress(client, getLaunchProgress.parse(rawArgs).id),
      add_test_cases_to_launch: async (rawArgs) => {
        const { id, payload } = addTestCasesToLaunch.parse(rawArgs);
        return api.addTestCasesToLaunch(client, id, payload);
      },
      add_test_plan_to_launch: async (rawArgs) => {
        const { id, payload } = addTestPlanToLaunch.parse(rawArgs);
        return api.addTestPlanToLaunch(client, id, payload);
      },
    },
  };
}
