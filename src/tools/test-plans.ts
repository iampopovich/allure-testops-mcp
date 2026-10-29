import type { AllureApiClient } from "../client.js";
import * as api from "../api/test-plans.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, idSchema, coerceObject } from "./schema.js";
import { ensureProjectIdInPayload } from "./utils.js";

const getTestPlan = zodTool("get_test_plan",
  "Get a test plan by ID.",
  z.object({ id: idSchema("Test plan") }),
);

const createTestPlan = zodTool("create_test_plan",
  "Create a test plan (a saved set of test cases to run together). payload: name (required), projectId (defaults to ALLURE_PROJECT_ID), " +
  "baseRql (AQL filter over test cases, e.g. 'tag = \"smoke\"'), treeSelection { inverted, leafsInclude, leafsExclude, groupsInclude, groupsExclude, path }, treeId.\n" +
  "Selection semantics: baseRql + treeSelection {inverted:true} with empty lists = every test case matching baseRql (what the UI sends); " +
  "treeSelection {inverted:false, leafsInclude:[ids]} = exactly those test cases; with inverted:true, leafsInclude lists EXCLUDED test cases.\n" +
  "WARNING: { name } alone (no baseRql, no treeSelection) puts EVERY test case of the project into the plan.\n" +
  "The plan is a snapshot: test cases created later that match baseRql are added only after a sync (UI: Sync test cases). Run it with run_test_plan. See MCP resource allure://guides/user-flows.",
  z.object({ payload: coerceObject() }),
);

const updateTestPlan = zodTool("update_test_plan",
  "Partially update a test plan: name, baseRql, treeSelection, treeId (same semantics as create_test_plan; with inverted:true, leafsInclude lists EXCLUDED test cases). The test case count is recalculated after the update.",
  z.object({ id: idSchema("Test plan"), payload: coerceObject() }),
);

const deleteTestPlan = zodTool("delete_test_plan",
  "Delete a test plan by ID.",
  z.object({ id: idSchema("Test plan") }),
);

const runTestPlan = zodTool("run_test_plan",
  "Run a test plan by ID. payload fields: launchName (required by the API), tags, issues, links, " +
  "envVarValueSets, releaseId to bind the produced launch to a release.",
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
        return api.createTestPlan(client, ensureProjectIdInPayload(payload, client));
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
