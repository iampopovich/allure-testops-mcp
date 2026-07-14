import type { AllureApiClient } from "../client.js";
import * as api from "../api/test-results.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, idSchema, paginationSchema, projectIdSchema, projectNameSchema, sortSchema } from "./schema.js";
import { AQL_SYNTAX, resolveProjectId } from "./utils.js";

const listTestResults = zodTool("list_test_results",
  "List test results for a launch. Supports filtering and pagination — prefer this over the resource when you need status filtering, a specific page, or a bounded result set.",
  z.object({
    launchId: idSchema("Launch"),
    search: z.string().optional(),
    filterId: idSchema("Saved filter").optional(),
    ...paginationSchema,
    sort: sortSchema,
  }),
);

const searchTestResults = zodTool("search_test_results",
  "Search test results by AQL query. The 'id' field in returned results is an integer — pass it as a number (not a string) to get_test_result or get_test_result_retries.",
  z.object({
    projectId: projectIdSchema.optional(),
    projectName: projectNameSchema.optional(),
    rql: z.string().describe(
      AQL_SYNTAX + " " +
      "Test result fields: id, name, fullName, testCase, status, category, tag, issue, " +
      "role[\"R\"], member, testedBy, cf[\"F\"], cfv, ev[\"VAR\"], evv, layer, " +
      "muted (boolean), hidden (boolean), launch, " +
      "createdDate, createdBy, lastModifiedDate, lastModifiedBy. " +
      "Examples: status = \"failed\" | status in [\"failed\", \"broken\"] | " +
      "name ~= \"login\" | muted = false | hidden = false | " +
      "launch = \"release-1.0\" | ev[\"OS\"] = \"Linux\" | " +
      "not tag in [\"nightly\"] | status = \"failed\" and muted = false",
    ),
    ...paginationSchema,
    sort: sortSchema,
  }),
);

const getTestResult = zodTool("get_test_result", "Get a test result by ID.",
  z.object({ id: z.number().int().describe("Test result ID. Must be an integer, not a string.") }),
);

const createTestResult = zodTool("create_test_result", "Create a new test result.",
  z.object({ payload: z.object({}).passthrough() }),
);

const updateTestResult = zodTool("update_test_result", "Update an existing test result.",
  z.object({ id: idSchema("Test result"), payload: z.object({}).passthrough() }),
);

const getTestResultHistory = zodTool("get_test_result_history", "Get history for a test result.",
  z.object({ id: idSchema("Test result"), ...paginationSchema, sort: sortSchema }),
);

const assignTestResult = zodTool("assign_test_result",
  "Assign a test result. payload must include username.",
  z.object({ id: idSchema("Test result"), payload: z.object({}).passthrough() }),
);

const resolveTestResult = zodTool("resolve_test_result",
  "Resolve a test result. payload must include status.",
  z.object({ id: idSchema("Test result"), payload: z.object({}).passthrough() }),
);

const getTestResultRetries = zodTool("get_test_result_retries",
  "Get the retry history for a test result. Returns the list of previous attempts for the same test in the same launch. Key tool for flaky test detection: if a test failed on attempt 1 but passed on attempt 2, it is a flaky test, not a real failure. Check status across retries to assess reliability.",
  z.object({ id: idSchema("Test result"), page: paginationSchema.page, size: paginationSchema.size }),
);

const listTestResultAttachments = zodTool("list_test_result_attachments",
  "List attachments (screenshots, logs, HAR files, etc.) for a test result. Returns attachment metadata: id, name, contentType, size. Use this to discover what evidence is available before calling get_test_result_attachment_content.",
  z.object({ testResultId: idSchema("Test result"), page: paginationSchema.page, size: paginationSchema.size }),
);

const getTestResultAttachmentContent = zodTool("get_test_result_attachment_content",
  "Download the binary content of a test result attachment. Returns base64-encoded content with its MIME type. Use attachment ID from list_test_result_attachments. For text-based attachments (logs, JSON, XML): decode base64 to read the content. For images (screenshots): the base64 PNG/JPEG can be rendered directly.",
  z.object({ attachmentId: idSchema("Attachment") }),
);

export function createTestResultTools(client: AllureApiClient): ToolBundle {
  return {
    tools: [
      listTestResults.definition,
      searchTestResults.definition,
      getTestResult.definition,
      createTestResult.definition,
      updateTestResult.definition,
      getTestResultHistory.definition,
      assignTestResult.definition,
      resolveTestResult.definition,
      getTestResultRetries.definition,
      listTestResultAttachments.definition,
      getTestResultAttachmentContent.definition,
    ],
    handlers: {
      list_test_results: async (rawArgs: unknown) => {
        const args = listTestResults.parse(rawArgs);
        return api.listTestResults(client, args.launchId, {
          search: args.search, filterId: args.filterId, page: args.page, size: args.size, sort: args.sort,
        });
      },
      search_test_results: async (rawArgs: unknown) => {
        const args = searchTestResults.parse(rawArgs);
        const projectId = await resolveProjectId(args, client);
        return api.searchTestResults(client, projectId, args.rql, { page: args.page, size: args.size, sort: args.sort });
      },
      get_test_result: async (rawArgs) => api.getTestResult(client, getTestResult.parse(rawArgs).id),
      create_test_result: async (rawArgs) => api.createTestResult(client, createTestResult.parse(rawArgs).payload),
      update_test_result: async (rawArgs) => {
        const { id, payload } = updateTestResult.parse(rawArgs);
        return api.updateTestResult(client, id, payload);
      },
      get_test_result_history: async (rawArgs) => {
        const { id, page, size, sort } = getTestResultHistory.parse(rawArgs);
        return api.getTestResultHistory(client, id, { page, size, sort });
      },
      assign_test_result: async (rawArgs) => {
        const { id, payload } = assignTestResult.parse(rawArgs);
        return api.assignTestResult(client, id, payload);
      },
      resolve_test_result: async (rawArgs) => {
        const { id, payload } = resolveTestResult.parse(rawArgs);
        return api.resolveTestResult(client, id, payload);
      },
      get_test_result_retries: async (rawArgs) => {
        const { id, page, size } = getTestResultRetries.parse(rawArgs);
        return api.getTestResultRetries(client, id, { page, size });
      },
      list_test_result_attachments: async (rawArgs) => {
        const { testResultId, page, size } = listTestResultAttachments.parse(rawArgs);
        return api.listTestResultAttachments(client, testResultId, { page, size });
      },
      get_test_result_attachment_content: async (rawArgs) =>
        api.getTestResultAttachmentContent(client, getTestResultAttachmentContent.parse(rawArgs).attachmentId),
    },
  };
}
