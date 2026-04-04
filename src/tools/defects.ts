import type { AllureApiClient } from "../client.js";
import * as api from "../api/defects.js";
import type { ToolBundle } from "./types.js";
import {
  asObject,
  getObjectPayload,
  getOptionalNumber,
  getOptionalString,
  getRequiredId,
  getRequiredString,
  pickPagination,
  resolveProjectId,
} from "./utils.js";

export function createDefectTools(client: AllureApiClient): ToolBundle {
  const tools = [
    {
      name: "list_defects",
      description:
        "List defect records for a project. Defects group similar test result failures by root cause. " +
        "Each defect has a name, status (open/closed), and optional matcher rules. " +
        "Use this as the entry point for failure pattern analysis: " +
        "'what are the top open defects in this project right now?'",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          status: {
            type: "string",
            description: "Filter by defect status. Values: OPEN, CLOSED. Omit to return all.",
          },
          name: { type: "string", description: "Filter by partial defect name." },
          page: { type: "number", description: "Page number, 0-based." },
          size: { type: "number", description: "Page size." },
        },
      },
    },
    {
      name: "get_defect",
      description:
        "Get a defect by ID. Returns the defect name, status, description, and matcher configuration.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Defect ID. Must be a number (integer), not a string." },
        },
        required: ["id"],
      },
    },
    {
      name: "create_defect",
      description:
        "Create a new defect record to group a novel failure pattern. " +
        "payload must include: name (string), projectId (number). " +
        "Optional: description (string).",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload: {
            type: "object",
            additionalProperties: true,
            description: "Required: name, projectId. Optional: description.",
          },
        },
        required: ["payload"],
      },
    },
    {
      name: "update_defect",
      description: "Update defect name, description, or status.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Defect ID. Must be a number (integer), not a string." },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "get_defect_test_results",
      description:
        "Get the test results grouped under a specific defect. " +
        "Use this to see how many failures belong to this defect and in which launches they appeared.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Defect ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based." },
          size: { type: "number", description: "Page size." },
        },
        required: ["id"],
      },
    },
    {
      name: "get_defect_test_cases",
      description:
        "Get the test cases affected by a specific defect. " +
        "Use this to understand which test scenarios are impacted by the failure pattern.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Defect ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based." },
          size: { type: "number", description: "Page size." },
        },
        required: ["id"],
      },
    },
    {
      name: "get_defect_launches",
      description:
        "Get launches in which a specific defect has appeared. " +
        "Use this to understand the blast radius: is this defect appearing in every run or only in specific environments?",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Defect ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based." },
          size: { type: "number", description: "Page size." },
        },
        required: ["id"],
      },
    },
    {
      name: "get_launch_defects",
      description:
        "Get all defects present in a specific launch. " +
        "This is the fastest way to get a defect summary for a launch: " +
        "'what are all the distinct failure patterns in this test run?'",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Launch ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based." },
          size: { type: "number", description: "Page size." },
        },
        required: ["id"],
      },
    },
    {
      name: "find_similar_failures",
      description:
        "Find test results that match a defect pattern within a launch. " +
        "Use this to detect flaky tests and group failures by root cause: " +
        "pass launchId to scope the search, optionally pass a defectId to check match against a specific defect. " +
        "Returns test results that are candidates for linking to the defect.",
      inputSchema: {
        type: "object" as const,
        properties: {
          launchId: { type: "number", description: "Launch ID to scope the search. Must be a number (integer), not a string." },
          defectId: { type: "number", description: "Defect ID to match against. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based." },
          size: { type: "number", description: "Page size." },
        },
      },
    },
    {
      name: "link_defect_to_test_results",
      description:
        "Link one or multiple test results to a defect record (bulk API). " +
        "payload must include: defectId (number) and testResultIds (array of numbers).",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload: {
            type: "object",
            additionalProperties: true,
            description: "Required: defectId (number), testResultIds (array of numbers).",
          },
        },
        required: ["payload"],
      },
    },
    {
      name: "bulk_close_defects",
      description:
        "Close multiple defects at once — mark them as resolved after a fix is confirmed. " +
        "payload must include: ids (array of defect IDs).",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload: {
            type: "object",
            additionalProperties: true,
            description: "Required: ids (array of defect ID numbers).",
          },
        },
        required: ["payload"],
      },
    },
    {
      name: "bulk_reopen_defects",
      description:
        "Reopen multiple closed defects — use when a regression is detected after a fix was marked complete. " +
        "payload must include: ids (array of defect IDs).",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload: {
            type: "object",
            additionalProperties: true,
            description: "Required: ids (array of defect ID numbers).",
          },
        },
        required: ["payload"],
      },
    },
    {
      name: "link_issue_to_defect",
      description:
        "Link an external issue (Jira, GitHub, etc.) to a defect record. " +
        "payload must include: url (string) and name (string). " +
        "Use this to associate a tracker ticket with a failure pattern.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Defect ID. Must be a number (integer), not a string." },
          payload: {
            type: "object",
            additionalProperties: true,
            description: "Required: url (string), name (string). Optional: type (string).",
          },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "unlink_issue_from_defect",
      description: "Remove the external issue link from a defect record.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Defect ID. Must be a number (integer), not a string." },
        },
        required: ["id"],
      },
    },
    {
      name: "apply_defect_matchers",
      description:
        "Apply all configured defect matcher rules to a launch. " +
        "This auto-triages unresolved test results by matching them to existing defect records " +
        "based on error message patterns. Run this after a launch completes to auto-group failures.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Launch ID. Must be a number (integer), not a string." },
        },
        required: ["id"],
      },
    },
  ];

  const handlers = {
    list_defects: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.listDefects(client, projectId, {
        status: getOptionalString(args, "status"),
        name: getOptionalString(args, "name"),
        ...pickPagination(args),
      });
    },

    get_defect: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getDefect(client, getRequiredId(args));
    },

    create_defect: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.createDefect(client, getObjectPayload(args));
    },

    update_defect: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.updateDefect(client, getRequiredId(args), getObjectPayload(args));
    },

    get_defect_test_results: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getDefectTestResults(client, getRequiredId(args), pickPagination(args));
    },

    get_defect_test_cases: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getDefectTestCases(client, getRequiredId(args), pickPagination(args));
    },

    get_defect_launches: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getDefectLaunches(client, getRequiredId(args), pickPagination(args));
    },

    get_launch_defects: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getLaunchDefects(client, getRequiredId(args), pickPagination(args));
    },

    find_similar_failures: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.matchDefects(client, {
        launchId: getOptionalNumber(args, "launchId"),
        defectId: getOptionalNumber(args, "defectId"),
        ...pickPagination(args),
      });
    },

    link_defect_to_test_results: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.bulkLinkDefectToResults(client, getObjectPayload(args));
    },

    bulk_close_defects: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.bulkCloseDefects(client, getObjectPayload(args));
    },

    bulk_reopen_defects: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.bulkReopenDefects(client, getObjectPayload(args));
    },

    link_issue_to_defect: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.linkIssueToDefect(client, getRequiredId(args), getObjectPayload(args));
    },

    unlink_issue_from_defect: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.unlinkIssueFromDefect(client, getRequiredId(args));
    },

    apply_defect_matchers: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.applyDefectMatchersToLaunch(client, getRequiredId(args));
    },
  };

  return { tools, handlers };
}
