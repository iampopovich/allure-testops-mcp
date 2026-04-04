import type { AllureApiClient } from "../client.js";
import * as api from "../api/mutes.js";
import type { ToolBundle } from "./types.js";
import {
  asObject,
  getObjectPayload,
  getRequiredId,
  pickPagination,
  resolveProjectId,
} from "./utils.js";

export function createMuteTools(client: AllureApiClient): ToolBundle {
  const tools = [
    {
      name: "list_mutes",
      description:
        "List active mutes for a specific test case. " +
        "Returns mute records with their reason, linked issues, and creation date. " +
        "Use this to audit: 'why is this test case muted and is there a tracking issue?'",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based." },
          size: { type: "number", description: "Page size." },
        },
        required: ["testCaseId"],
      },
    },
    {
      name: "create_mute",
      description:
        "Mute a test case to suppress its failures from the launch statistics. " +
        "Always provide a reason and link to a tracking issue to keep mutes accountable. " +
        "payload must include: testCaseId (number). " +
        "Optional but strongly recommended: name (string reason), issues (array of {url, name}).",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload: {
            type: "object",
            additionalProperties: true,
            description: "Required: testCaseId. Recommended: name (reason string), issues (array of {url, name}).",
          },
        },
        required: ["payload"],
      },
    },
    {
      name: "delete_mute",
      description:
        "Remove a mute record to re-enable failure reporting for a test case. " +
        "Use this when the underlying issue is confirmed fixed.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Mute ID (from list_mutes). Must be a number (integer), not a string." },
        },
        required: ["id"],
      },
    },
    {
      name: "get_muted_test_cases",
      description:
        "List all currently muted test cases in a project. " +
        "This is the sprint health check tool: run this to answer " +
        "'how many tests are silenced right now and which ones have no linked issue?'",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          page: { type: "number", description: "Page number, 0-based." },
          size: { type: "number", description: "Page size." },
        },
      },
    },
    {
      name: "get_launch_muted_results",
      description:
        "Get test results that were muted in a specific launch. " +
        "Use this to understand the real failure count: " +
        "'how many failures were hidden by mutes in this run?'",
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
      name: "mute_test_result",
      description:
        "Mute a single test result to exclude it from launch statistics. " +
        "payload may include: reason (string). " +
        "Use for individual result suppression when the failure is a known infrastructure issue.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Test result ID. Must be a number (integer), not a string." },
          payload: {
            type: "object",
            additionalProperties: true,
            description: "Optional: reason (string).",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "unmute_test_result",
      description: "Remove the mute from a single test result, restoring it to active failure reporting.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Test result ID. Must be a number (integer), not a string." },
        },
        required: ["id"],
      },
    },
    {
      name: "bulk_mute_test_results",
      description:
        "Mute multiple test results at once — use during infrastructure outages to suppress known-bad results in bulk. " +
        "payload must include: testResultIds (array of numbers). Optional: reason (string).",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload: {
            type: "object",
            additionalProperties: true,
            description: "Required: testResultIds (array of numbers). Optional: reason (string).",
          },
        },
        required: ["payload"],
      },
    },
    {
      name: "bulk_unmute_test_results",
      description:
        "Unmute multiple test results at once — use after an infrastructure fix to restore full failure visibility. " +
        "payload must include: testResultIds (array of numbers).",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload: {
            type: "object",
            additionalProperties: true,
            description: "Required: testResultIds (array of numbers).",
          },
        },
        required: ["payload"],
      },
    },
  ];

  const handlers = {
    list_mutes: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.listMutes(client, getRequiredId(args, "testCaseId"), pickPagination(args));
    },

    create_mute: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.createMute(client, getObjectPayload(args));
    },

    delete_mute: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.deleteMute(client, getRequiredId(args));
    },

    get_muted_test_cases: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getMutedTestCases(client, projectId, pickPagination(args));
    },

    get_launch_muted_results: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getLaunchMutedResults(client, getRequiredId(args), pickPagination(args));
    },

    mute_test_result: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const payload = args.payload;
      const body =
        payload !== undefined &&
        typeof payload === "object" &&
        payload !== null &&
        !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {};
      return api.muteTestResult(client, getRequiredId(args), body);
    },

    unmute_test_result: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.unmuteTestResult(client, getRequiredId(args));
    },

    bulk_mute_test_results: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.bulkMuteTestResults(client, getObjectPayload(args));
    },

    bulk_unmute_test_results: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.bulkUnmuteTestResults(client, getObjectPayload(args));
    },
  };

  return { tools, handlers };
}
