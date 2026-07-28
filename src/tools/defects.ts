import type { AllureApiClient } from "../client.js";
import * as api from "../api/defects.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, idSchema, paginationSchema , coerceObject} from "./schema.js";

const getDefect = zodTool("get_defect",
  "Get a defect by ID. Returns the defect name, status, description, and matcher configuration.",
  z.object({ id: idSchema("Defect") }),
);

const createDefect = zodTool("create_defect",
  "Create a new defect record to group a novel failure pattern. payload must include: name (string), projectId (number). Optional: description (string).",
  z.object({ payload: coerceObject().describe("Required: name, projectId. Optional: description.") }),
);

const updateDefect = zodTool("update_defect",
  "Update defect name, description, or status.",
  z.object({ id: idSchema("Defect"), payload: coerceObject() }),
);

const getDefectTestResults = zodTool("get_defect_test_results",
  "Get the test results grouped under a specific defect. Use this to see how many failures belong to this defect and in which launches they appeared.",
  z.object({ id: idSchema("Defect"), ...paginationSchema }),
);

const getDefectTestCases = zodTool("get_defect_test_cases",
  "Get the test cases affected by a specific defect. Use this to understand which test scenarios are impacted by the failure pattern.",
  z.object({ id: idSchema("Defect"), ...paginationSchema }),
);

const getDefectLaunches = zodTool("get_defect_launches",
  "Get launches in which a specific defect has appeared. Use this to understand the blast radius: is this defect appearing in every run or only in specific environments?",
  z.object({ id: idSchema("Defect"), ...paginationSchema }),
);

const getLaunchDefects = zodTool("get_launch_defects",
  "Get all defects present in a specific launch. This is the fastest way to get a defect summary for a launch: 'what are all the distinct failure patterns in this test run?'",
  z.object({ id: idSchema("Launch"), ...paginationSchema }),
);

const findSimilarFailures = zodTool("find_similar_failures",
  "Find test results that match a defect pattern within a launch. Use this to detect flaky tests and group failures by root cause: pass launchId to scope the search, optionally pass a defectId to check match against a specific defect. Returns test results that are candidates for linking to the defect.",
  z.object({
    launchId: idSchema("Launch").optional().describe("Launch ID to scope the search."),
    defectId: idSchema("Defect").optional().describe("Defect ID to match against."),
    ...paginationSchema,
  }),
);

const linkDefectToTestResults = zodTool("link_defect_to_test_results",
  "Link one or multiple test results to a defect record (bulk API). payload must include: defectId (number) and testResultIds (array of numbers).",
  z.object({ payload: coerceObject().describe("Required: defectId (number), testResultIds (array of numbers).") }),
);

const bulkCloseDefects = zodTool("bulk_close_defects",
  "Close multiple defects at once — mark them as resolved after a fix is confirmed. payload must include: ids (array of defect IDs).",
  z.object({ payload: coerceObject().describe("Required: ids (array of defect ID numbers).") }),
);

const bulkReopenDefects = zodTool("bulk_reopen_defects",
  "Reopen multiple closed defects — use when a regression is detected after a fix was marked complete. payload must include: ids (array of defect IDs).",
  z.object({ payload: coerceObject().describe("Required: ids (array of defect ID numbers).") }),
);

const linkIssueToDefect = zodTool("link_issue_to_defect",
  "Link an external issue (Jira, GitHub, etc.) to a defect record. payload must include: url (string) and name (string). Use this to associate a tracker ticket with a failure pattern.",
  z.object({
    id: idSchema("Defect"),
    payload: coerceObject().describe("Required: url (string), name (string). Optional: type (string)."),
  }),
);

const unlinkIssueFromDefect = zodTool("unlink_issue_from_defect",
  "Remove the external issue link from a defect record.",
  z.object({ id: idSchema("Defect") }),
);

const applyDefectMatchers = zodTool("apply_defect_matchers",
  "Apply all configured defect matcher rules to a launch. This auto-triages unresolved test results by matching them to existing defect records based on error message patterns. Run this after a launch completes to auto-group failures.",
  z.object({ id: idSchema("Launch") }),
);

export function createDefectTools(client: AllureApiClient): ToolBundle {
  return {
    tools: [
      getDefect.definition,
      createDefect.definition,
      updateDefect.definition,
      getDefectTestResults.definition,
      getDefectTestCases.definition,
      getDefectLaunches.definition,
      getLaunchDefects.definition,
      findSimilarFailures.definition,
      linkDefectToTestResults.definition,
      bulkCloseDefects.definition,
      bulkReopenDefects.definition,
      linkIssueToDefect.definition,
      unlinkIssueFromDefect.definition,
      applyDefectMatchers.definition,
    ],
    handlers: {
      get_defect: async (rawArgs) => api.getDefect(client, getDefect.parse(rawArgs).id),
      create_defect: async (rawArgs) => api.createDefect(client, createDefect.parse(rawArgs).payload),
      update_defect: async (rawArgs) => {
        const { id, payload } = updateDefect.parse(rawArgs);
        return api.updateDefect(client, id, payload);
      },
      get_defect_test_results: async (rawArgs) => {
        const { id, page, size } = getDefectTestResults.parse(rawArgs);
        return api.getDefectTestResults(client, id, { page, size });
      },
      get_defect_test_cases: async (rawArgs) => {
        const { id, page, size } = getDefectTestCases.parse(rawArgs);
        return api.getDefectTestCases(client, id, { page, size });
      },
      get_defect_launches: async (rawArgs) => {
        const { id, page, size } = getDefectLaunches.parse(rawArgs);
        return api.getDefectLaunches(client, id, { page, size });
      },
      get_launch_defects: async (rawArgs) => {
        const { id, page, size } = getLaunchDefects.parse(rawArgs);
        return api.getLaunchDefects(client, id, { page, size });
      },
      find_similar_failures: async (rawArgs) => {
        const { launchId, defectId, page, size } = findSimilarFailures.parse(rawArgs);
        return api.matchDefects(client, { launchId, defectId, page, size });
      },
      link_defect_to_test_results: async (rawArgs) =>
        api.bulkLinkDefectToResults(client, linkDefectToTestResults.parse(rawArgs).payload),
      bulk_close_defects: async (rawArgs) =>
        api.bulkCloseDefects(client, bulkCloseDefects.parse(rawArgs).payload),
      bulk_reopen_defects: async (rawArgs) =>
        api.bulkReopenDefects(client, bulkReopenDefects.parse(rawArgs).payload),
      link_issue_to_defect: async (rawArgs) => {
        const { id, payload } = linkIssueToDefect.parse(rawArgs);
        return api.linkIssueToDefect(client, id, payload);
      },
      unlink_issue_from_defect: async (rawArgs) =>
        api.unlinkIssueFromDefect(client, unlinkIssueFromDefect.parse(rawArgs).id),
      apply_defect_matchers: async (rawArgs) =>
        api.applyDefectMatchersToLaunch(client, applyDefectMatchers.parse(rawArgs).id),
    },
  };
}
