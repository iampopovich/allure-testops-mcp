import type { AllureApiClient } from "../client.js";
import * as api from "../api/test-results.js";
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

export function createTestResultTools(
  client: AllureApiClient,
): ToolBundle {
  const tools = [
    {
      name: "list_test_results",
      description: "List test results for a launch.",
      inputSchema: {
        type: "object" as const,
        properties: {
          launchId: { type: "number" },
          search: { type: "string" },
          filterId: { type: "number", description: "Saved filter ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["launchId"],
      },
    },
    {
      name: "search_test_results",
      description: "Search test results by AQL query.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          rql: {
            type: "string",
            description:
              "AQL (Allure Query Language) filter expression. " +
              "Operators: = != ~= (contains) > < >= <= in [...] and or not. " +
              "IMPORTANT: 'not in' is written as 'not field in [...]', NOT 'field not in [...]'. " +
              "Test result fields: id, name, fullName, testCase, status, category, tag, issue, " +
              "role[\"R\"], member, testedBy, cf[\"F\"], cfv, ev[\"VAR\"], evv, layer, " +
              "muted (boolean), hidden (boolean), launch, " +
              "createdDate, createdBy, lastModifiedDate, lastModifiedBy. " +
              "Dates use 13-digit Unix ms timestamps. " +
              'Examples: status = "failed" | status in ["failed", "broken"] | ' +
              'name ~= "login" | muted = false | hidden = false | ' +
              'launch = "release-1.0" | ev["OS"] = "Linux" | ' +
              'not tag in ["nightly"] | status = "failed" and muted = false',
          },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["rql"],
      },
    },
    {
      name: "get_test_result",
      description: "Get a test result by ID.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "create_test_result",
      description: "Create a new test result.",
      inputSchema: {
        type: "object" as const,
        properties: { payload: { type: "object", additionalProperties: true } },
        required: ["payload"],
      },
    },
    {
      name: "update_test_result",
      description: "Update an existing test result.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Test result ID. Must be a number (integer), not a string." },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "get_test_result_history",
      description: "Get history for a test result.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Test result ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["id"],
      },
    },
    {
      name: "assign_test_result",
      description: "Assign a test result. payload must include username.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Test result ID. Must be a number (integer), not a string." },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "resolve_test_result",
      description: "Resolve a test result. payload must include status.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Test result ID. Must be a number (integer), not a string." },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "get_test_result_retries",
      description:
        "Get the retry history for a test result. " +
        "Returns the list of previous attempts for the same test in the same launch. " +
        "Key tool for flaky test detection: if a test failed on attempt 1 but passed on attempt 2, " +
        "it is a flaky test, not a real failure. Check status across retries to assess reliability.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Test result ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based." },
          size: { type: "number", description: "Page size." },
        },
        required: ["id"],
      },
    },
    {
      name: "list_test_result_attachments",
      description:
        "List attachments (screenshots, logs, HAR files, etc.) for a test result. " +
        "Returns attachment metadata: id, name, contentType, size. " +
        "Use this to discover what evidence is available before calling get_test_result_attachment_content.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testResultId: { type: "number", description: "Test result ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based." },
          size: { type: "number", description: "Page size." },
        },
        required: ["testResultId"],
      },
    },
    {
      name: "get_test_result_attachment_content",
      description:
        "Download the binary content of a test result attachment. " +
        "Returns base64-encoded content with its MIME type. " +
        "Use attachment ID from list_test_result_attachments. " +
        "For text-based attachments (logs, JSON, XML): decode base64 to read the content. " +
        "For images (screenshots): the base64 PNG/JPEG can be rendered directly.",
      inputSchema: {
        type: "object" as const,
        properties: {
          attachmentId: { type: "number", description: "Attachment ID from list_test_result_attachments. Must be a number (integer), not a string." },
        },
        required: ["attachmentId"],
      },
    },
  ];

  const handlers = {
    list_test_results: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.listTestResults(client, getRequiredId(args, "launchId"), {
        search: getOptionalString(args, "search"),
        filterId: getOptionalNumber(args, "filterId"),
        ...pickPagination(args),
      });
    },
    search_test_results: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.searchTestResults(client, projectId, getRequiredString(args, "rql"), {
        ...pickPagination(args),
      });
    },
    get_test_result: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestResult(client, getRequiredId(args));
    },
    create_test_result: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.createTestResult(client, getObjectPayload(args));
    },
    update_test_result: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.updateTestResult(client, getRequiredId(args), getObjectPayload(args));
    },
    get_test_result_history: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestResultHistory(client, getRequiredId(args), pickPagination(args));
    },
    assign_test_result: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.assignTestResult(client, getRequiredId(args), getObjectPayload(args));
    },
    resolve_test_result: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.resolveTestResult(client, getRequiredId(args), getObjectPayload(args));
    },
    get_test_result_retries: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestResultRetries(client, getRequiredId(args), pickPagination(args));
    },
    list_test_result_attachments: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.listTestResultAttachments(
        client,
        getRequiredId(args, "testResultId"),
        pickPagination(args),
      );
    },
    get_test_result_attachment_content: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestResultAttachmentContent(client, getRequiredId(args, "attachmentId"));
    },
  };

  return { tools, handlers };
}
