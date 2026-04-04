import type { AllureApiClient } from "../client.js";
import * as api from "../api/members.js";
import type { ToolBundle } from "./types.js";
import {
  asObject,
  getOptionalNumber,
  getOptionalString,
  getRequiredId,
  pickPagination,
  resolveProjectId,
} from "./utils.js";

export function createMemberTools(client: AllureApiClient): ToolBundle {
  const tools = [
    {
      name: "suggest_users",
      description:
        "Search users by name or username for assignment and mention workflows. " +
        "Returns a paginated list of matching users with their IDs and display names. " +
        "Use this to look up a user before assigning a test result or test case.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Partial name or username to search for." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
        },
      },
    },
    {
      name: "list_project_members",
      description:
        "List members (collaborators) of a project with their roles and permission sets. " +
        "Use this to discover who is on the project, what roles they have, and who to assign work to. " +
        "Supports filtering by partial name via query parameter.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          query: { type: "string", description: "Partial name filter." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
        },
      },
    },
    {
      name: "get_launch_member_stats",
      description:
        "Get per-member workload statistics for a launch: how many test results each team member " +
        "has been assigned or has resolved. Use this to understand workload distribution and " +
        "identify team members who are overloaded or unassigned during a test run.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Launch ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
        },
        required: ["id"],
      },
    },
    {
      name: "get_test_case_members",
      description:
        "Get the list of members (roles) assigned to a test case. " +
        "Returns who owns, authored, or is responsible for this test case.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
        },
        required: ["testCaseId"],
      },
    },
    {
      name: "get_test_result_members",
      description:
        "Get the list of members assigned to a specific test result. " +
        "Returns who is responsible for investigating or resolving this result.",
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
    suggest_users: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.suggestUsers(client, {
        query: getOptionalString(args, "query"),
        ...pickPagination(args),
      });
    },

    list_project_members: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getProjectCollaborators(client, projectId, {
        query: getOptionalString(args, "query"),
        ...pickPagination(args),
      });
    },

    get_launch_member_stats: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getLaunchMemberStats(client, getRequiredId(args), pickPagination(args));
    },

    get_test_case_members: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseMembers(client, getRequiredId(args, "testCaseId"));
    },

    get_test_result_members: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestResultMembers(client, getRequiredId(args, "testResultId"));
    },
  };

  return { tools, handlers };
}
