import type { AllureApiClient } from "../client.js";
import * as api from "../api/defects.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, idSchema, paginationSchema, coerceObject, coerceInt, coerceArray, projectIdSchema, projectNameSchema } from "./schema.js";
import { resolveProjectId } from "./utils.js";

type ToolObject = Record<string, unknown>;

/** Accepts the value at the top level or nested in `payload` (older calling convention). */
function field(args: ToolObject, key: string): unknown {
  if (args[key] !== undefined) return args[key];
  const payload = args.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as ToolObject)[key] : undefined;
}

function toIdList(value: unknown, label: string): number[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const ids = list.map((v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v));
  if (ids.length === 0 || ids.some((v) => typeof v !== "number" || !Number.isInteger(v)))
    throw new Error(`"${label}" must be a non-empty array of integer IDs.`);
  return ids as number[];
}

const getDefect = zodTool("get_defect",
  "Get a defect by ID. Returns the defect name, description and closed flag. Its automation rules (matchers) are separate: use find_similar_failures({launchId, defectId}) to apply them to a launch.",
  z.object({ id: idSchema("Defect") }),
);

const createDefect = zodTool("create_defect",
  "Create a defect that groups a failure pattern. payload: name (required), projectId (required), description (markdown), " +
  "matcher (optional automation rule, the UI's 'Create automation rule'): { name (required), messageRegex, traceRegex } — results whose error message / stack trace match are auto-linked by apply_defect_matchers. " +
  "linkIssue (optional, needs an issue-tracker integration): { integrationId, name }.",
  z.object({ payload: coerceObject().describe("Required: name, projectId. Optional: description, matcher {name, messageRegex, traceRegex}, linkIssue {integrationId, name}.") }),
);

const updateDefect = zodTool("update_defect",
  "Partially update a defect: name, description, closed. Close one defect: { closed: true }; reopen: { closed: false } (the same request the UI's Close/Reopen menu sends). For several defects use bulk_close_defects / bulk_reopen_defects.",
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
  "Find test results in a launch whose error message and/or stack trace match a regex — the same matching defect automation rules use. " +
  "launchId is required. Give messageRegex and/or traceRegex directly, or give defectId to reuse that defect's automation rules (its first matcher with a regex is used). " +
  "Returns matching results (id, name, message, status) — candidates for link_defect_to_test_results.",
  z.object({
    launchId: idSchema("Launch").describe("Launch ID to search in (required by the API)."),
    messageRegex: z.string().optional().describe("Java regex matched against the failure message, e.g. \".*Timeout.*\"."),
    traceRegex: z.string().optional().describe("Java regex matched against the stack trace."),
    defectId: idSchema("Defect").optional().describe("Take the regex from this defect's automation rule when messageRegex/traceRegex are not given."),
    ...paginationSchema,
  }),
);

const linkDefectToTestResults = zodTool("link_defect_to_test_results",
  "Link test results of ONE launch to a defect (UI: Link defect). Arguments: defectId, testResultIds, launchId (the launch the results belong to — required by the API), projectId/projectName (optional). " +
  "The values may also be nested in `payload` (older calling convention).",
  z.object({
    defectId: coerceInt().optional().describe("Defect ID."),
    testResultIds: coerceArray(coerceInt()).optional().describe("Test result IDs (all from the same launch)."),
    launchId: coerceInt().optional().describe("Launch ID the test results belong to."),
    projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(),
    payload: coerceObject().optional().describe("Legacy: { defectId, testResultIds, launchId }."),
  }),
);

const bulkCloseDefects = zodTool("bulk_close_defects",
  "Close several defects at once (UI: Defects → select → Bulk actions → Close). Arguments: ids (defect IDs), projectId/projectName (optional, defaults to the configured project). " +
  "For a single defect update_defect({id, payload:{closed:true}}) is equivalent.",
  z.object({
    ids: coerceArray(coerceInt()).optional().describe("Defect IDs to close."),
    projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(),
    payload: coerceObject().optional().describe("Legacy: { ids }."),
  }),
);

const bulkReopenDefects = zodTool("bulk_reopen_defects",
  "Reopen several closed defects at once (UI: Bulk actions → Reopen). Arguments: ids (defect IDs), projectId/projectName (optional).",
  z.object({
    ids: coerceArray(coerceInt()).optional().describe("Defect IDs to reopen."),
    projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(),
    payload: coerceObject().optional().describe("Legacy: { ids }."),
  }),
);

const linkIssueToDefect = zodTool("link_issue_to_defect",
  "Link a tracker issue to a defect. payload: { integrationId (required — an issue-tracker integration connected to the project), name (required — issue key, e.g. \"JIRA-123\") }. " +
  "Without an integration the API answers 409 'integrationId must not be null'.",
  z.object({
    id: idSchema("Defect"),
    payload: coerceObject().describe("Required: integrationId (number), name (issue key)."),
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
        const { launchId, defectId, page, size, ...regex } = findSimilarFailures.parse(rawArgs);
        let { messageRegex, traceRegex } = regex;
        if (!messageRegex && !traceRegex && defectId !== undefined) {
          const matchers = (await api.listDefectMatchers(client, defectId, { size: 100 })).content ?? [];
          const matcher = matchers.find((m) => m.messageRegex || m.traceRegex);
          messageRegex = matcher?.messageRegex || undefined;
          traceRegex = matcher?.traceRegex || undefined;
        }
        if (!messageRegex && !traceRegex)
          throw new Error("Provide messageRegex and/or traceRegex, or a defectId whose automation rule has a regex.");
        return api.matchDefects(client, { launchId, messageRegex, traceRegex, page, size });
      },
      link_defect_to_test_results: async (rawArgs) => {
        const args = linkDefectToTestResults.parse(rawArgs) as ToolObject;
        const defectId = toIdList(field(args, "defectId"), "defectId")[0];
        const testResultIds = toIdList(field(args, "testResultIds"), "testResultIds");
        const launchId = toIdList(field(args, "launchId"), "launchId")[0];
        const projectId = await resolveProjectId(args, client);
        return api.bulkLinkDefectToResults(client, { projectId, launchId, defectId, testResultIds });
      },
      bulk_close_defects: async (rawArgs) => {
        const args = bulkCloseDefects.parse(rawArgs) as ToolObject;
        const projectId = await resolveProjectId(args, client);
        return api.bulkCloseDefects(client, projectId, toIdList(field(args, "ids"), "ids"));
      },
      bulk_reopen_defects: async (rawArgs) => {
        const args = bulkReopenDefects.parse(rawArgs) as ToolObject;
        const projectId = await resolveProjectId(args, client);
        return api.bulkReopenDefects(client, projectId, toIdList(field(args, "ids"), "ids"));
      },
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
