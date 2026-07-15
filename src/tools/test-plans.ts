import type { AllureApiClient } from "../client.js";
import * as api from "../api/test-plans.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, idSchema, paginationSchema, projectIdSchema, projectNameSchema , coerceObject} from "./schema.js"
import { resolveProjectId } from "./utils.js";

const getTestPlan = zodTool("get_test_plan",
  "Get a test plan by ID.",
  z.object({ id: idSchema("Test plan") }),
);

const createTestPlan = zodTool("create_test_plan",
  "Create a new test plan. payload.projectId defaults to ALLURE_PROJECT_ID env when omitted.",
  z.object({ payload: coerceObject() }),
);

const updateTestPlan = zodTool("update_test_plan",
  "Update an existing test plan.",
  z.object({ id: idSchema("Test plan"), payload: coerceObject() }),
);

const deleteTestPlan = zodTool("delete_test_plan",
  "Delete a test plan by ID.",
  z.object({ id: idSchema("Test plan") }),
);

const runTestPlan = zodTool("run_test_plan",
  "Run a test plan by ID.",
  z.object({ id: idSchema("Test plan"), payload: coerceObject().optional() }),
);

export function createTestPlanTools(client: AllureApiClient): ToolBundle {
  return {
    tools: [
      getTestPlan.definition,
      createTestPlan.definition,
      updateTestPlan.definition,
      deleteTestPlan.definition,
      runTestPlan.definition,
    ],
    handlers: {
      get_test_plan: async (rawArgs) => api.getTestPlan(client, getTestPlan.parse(rawArgs).id),
      create_test_plan: async (rawArgs) => {
        const { payload } = createTestPlan.parse(rawArgs);
        return api.createTestPlan(client, payload);
      },
      update_test_plan: async (rawArgs) => {
        const { id, payload } = updateTestPlan.parse(rawArgs);
        return api.updateTestPlan(client, id, payload);
      },
      delete_test_plan: async (rawArgs) => api.deleteTestPlan(client, deleteTestPlan.parse(rawArgs).id),
      run_test_plan: async (rawArgs) => {
        const { id, payload } = runTestPlan.parse(rawArgs);
        return api.runTestPlan(client, id, payload);
      },
    },
  };
}
