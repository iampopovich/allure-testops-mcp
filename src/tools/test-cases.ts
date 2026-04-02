import type { AllureApiClient } from "../client.js";
import * as api from "../api/test-cases.js";
import type { ToolBundle } from "./types.js";
import {
  asObject,
  ensureProjectIdInPayload,
  getOptionalBoolean,
  getObjectPayload,
  getOptionalNumber,
  getOptionalString,
  getRequiredId,
  getRequiredString,
  pickPagination,
  resolveProjectId,
} from "./utils.js";

type ToolObject = Record<string, unknown>;
type BulkTag = { id?: number; name?: string };
type BulkExternalLink = { url: string; name?: string; type?: string };

function asArray(value: unknown): unknown[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("Expected an array.");
  }
  return value;
}

function getBulkIdList(
  args: ToolObject,
  singleKey: string,
  multipleKey: string,
  entityLabel: string,
): number[] {
  const ids: number[] = [];

  const single = args[singleKey];
  if (single !== undefined) {
    if (typeof single !== "number" || Number.isNaN(single)) {
      throw new Error(`"${singleKey}" must be a number when provided.`);
    }
    ids.push(single);
  }

  const multiple = args[multipleKey];
  if (multiple !== undefined) {
    const values = asArray(multiple);
    if (!values || values.some((item) => typeof item !== "number" || Number.isNaN(item))) {
      throw new Error(`"${multipleKey}" must be an array of numbers when provided.`);
    }
    ids.push(...(values as number[]));
  }

  if (ids.length === 0) {
    throw new Error(
      `Either "${singleKey}" or "${multipleKey}" must be provided with at least one ${entityLabel} ID.`,
    );
  }

  return [...new Set(ids)];
}

function normalizeBulkTags(args: ToolObject): BulkTag[] {
  const items: unknown[] = [];
  if (args.tag !== undefined) {
    items.push(args.tag);
  }
  if (args.tags !== undefined) {
    const tags = asArray(args.tags);
    if (!tags) {
      throw new Error("\"tags\" must be an array when provided.");
    }
    items.push(...tags);
  }

  if (items.length === 0) {
    throw new Error("Either \"tag\" or \"tags\" must be provided with at least one tag.");
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`"tags[${index}]" must be an object.`);
    }
    const row = item as ToolObject;
    const id = typeof row.id === "number" ? row.id : undefined;
    const name = typeof row.name === "string" ? row.name : undefined;
    if (id === undefined && (name === undefined || name.trim().length === 0)) {
      throw new Error(`"tags[${index}]" must include at least one of "id" or non-empty "name".`);
    }
    return {
      ...(id !== undefined ? { id } : {}),
      ...(name !== undefined ? { name } : {}),
    };
  });
}

function normalizeBulkExternalLinks(args: ToolObject): BulkExternalLink[] {
  const items: unknown[] = [];
  if (args.link !== undefined) {
    items.push(args.link);
  }
  if (args.links !== undefined) {
    const links = asArray(args.links);
    if (!links) {
      throw new Error("\"links\" must be an array when provided.");
    }
    items.push(...links);
  }

  if (items.length === 0) {
    throw new Error("Either \"link\" or \"links\" must be provided with at least one external link.");
  }

  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`"links[${index}]" must be an object.`);
    }
    const row = item as ToolObject;
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (url.length === 0) {
      throw new Error(`"links[${index}].url" must be a non-empty string.`);
    }
    const name = row.name;
    if (name !== undefined && typeof name !== "string") {
      throw new Error(`"links[${index}].name" must be a string when provided.`);
    }
    const type = row.type;
    if (type !== undefined && typeof type !== "string") {
      throw new Error(`"links[${index}].type" must be a string when provided.`);
    }
    return {
      url,
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof type === "string" ? { type } : {}),
    };
  });
}

export function createTestCaseTools(
  client: AllureApiClient,
): ToolBundle {
  const tools = [
    {
      name: "list_test_cases",
      description: "List test cases for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          search: { type: "string" },
          filterId: { type: "number", description: "Saved filter ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "search_test_cases",
      description: "Search test cases by AQL query.",
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
              "Test case fields: id, name, tag, issue, role[\"R\"], member, cf[\"F\"], cfv, layer, " +
              "status, workflow, testPlan, automation (boolean), muted, mutedDate, " +
              "createdDate, createdBy, lastModifiedDate, lastModifiedBy. " +
              "Dates use 13-digit Unix ms timestamps. " +
              'Examples: name ~= "login" | automation = true | automation = false | ' +
              'status = "Active" | tag in ["smoke", "regression"] | ' +
              'not tag in ["nightly"] | cf["Epic"] = "Auth" | ' +
              'name ~= "checkout" and muted = false | (createdBy = "a" or createdBy = "b") and automation = true',
          },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["rql"],
      },
    },
    {
      name: "get_test_case",
      description: "Get a test case by ID.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "create_test_case",
      description:
        "Create a new test case. payload.projectId defaults to ALLURE_PROJECT_ID env when omitted. " +
        "payload.precondition (string) is the preconditions field — always use this for preconditions/prerequisites text, NOT payload.description. " +
        "payload.description (string) is the general test case description (unrelated to preconditions). " +
        "payload.customFields supports values like { customField: { id }, id, name }. " +
        "payload.steps is an optional array of step objects with { name (step text), expectedResult (optional expected result text) } — steps are created after the test case. " +
        "When a step has multiple expected results, list them in expectedResult separated by semicolons (e.g. \"Result A; Result B\") or as a bullet list (lines starting with -, *, or a number).",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload: { type: "object", additionalProperties: true },
        },
        required: ["payload"],
      },
    },
    {
      name: "update_test_case_step",
      description:
        "Update a test case step by ID. Supports updating body text and/or expectedResult. " +
        "If expectedResult is provided, the expected result node is created automatically if it does not exist yet.",
      inputSchema: {
        type: "object" as const,
        properties: {
          stepId: { type: "number", description: "Step ID to update. Must be a number (integer), not a string." },
          body: { type: "string", description: "New step body text." },
          expectedResult: { type: "string", description: "Expected result text for this step." },
        },
        required: ["stepId"],
      },
    },
    {
      name: "update_test_case",
      description:
        "Update an existing test case. payload.customFields supports values like { customField: { id }, id, name }.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          payload: { type: "object", additionalProperties: true },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "delete_test_case",
      description: "Delete a test case by ID.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "add_test_case_tags_bulk",
      description:
        "Add one or multiple tags to one or multiple test cases using bulk API.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          testCaseIds: { type: "array", items: { type: "number" } },
          tag: { type: "object", additionalProperties: true },
          tags: { type: "array", items: { type: "object" } },
        },
      },
    },
    {
      name: "remove_test_case_tags_bulk",
      description:
        "Remove one or multiple tags from one or multiple test cases using bulk API.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          testCaseIds: { type: "array", items: { type: "number" } },
          tagId: { type: "number", description: "Tag ID. Must be a number (integer), not a string." },
          tagIds: { type: "array", items: { type: "number" } },
        },
      },
    },
    {
      name: "add_test_case_external_links_bulk",
      description:
        "Add one or multiple external links to one or multiple test cases using bulk API.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          testCaseIds: { type: "array", items: { type: "number" } },
          link: { type: "object", additionalProperties: true },
          links: { type: "array", items: { type: "object" } },
        },
      },
    },
    {
      name: "get_test_case_overview",
      description: "Get test case overview data.",
      inputSchema: {
        type: "object" as const,
        properties: { testCaseId: { type: "number" } },
        required: ["testCaseId"],
      },
    },
    {
      name: "get_test_case_history",
      description: "Get test case run history.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["id"],
      },
    },
    {
      name: "get_test_case_scenario",
      description: "Get scenario for a test case.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number", description: "Test case ID. Must be a number (integer), not a string." } },
        required: ["id"],
      },
    },
    {
      name: "get_test_case_steps",
      description: "Get manual scenario steps for a test case. Returns a normalized scenario with root step and a flat map of all steps (scenarioSteps), where each step contains body, expectedResult, children IDs, and optional sharedStepId.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number", description: "Test case ID. Must be a number (integer), not a string." } },
        required: ["id"],
      },
    },
    {
      name: "get_test_case_tags",
      description: "Get tags assigned to a test case.",
      inputSchema: {
        type: "object" as const,
        properties: { testCaseId: { type: "number" } },
        required: ["testCaseId"],
      },
    },
    {
      name: "set_test_case_tags",
      description: "Set tags for a test case.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          payload: { type: "array", items: { type: "object" } },
        },
        required: ["testCaseId", "payload"],
      },
    },
    {
      name: "get_test_case_issues",
      description: "Get linked issues for a test case.",
      inputSchema: {
        type: "object" as const,
        properties: { testCaseId: { type: "number" } },
        required: ["testCaseId"],
      },
    },
    {
      name: "set_test_case_issues",
      description: "Set linked issues for a test case.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          payload: { type: "array", items: { type: "object" } },
        },
        required: ["testCaseId", "payload"],
      },
    },
    {
      name: "restore_test_case",
      description: "Restore a deleted test case.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    },
    {
      name: "list_project_custom_fields",
      description: "List custom fields configured for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          query: { type: "string" },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "list_custom_field_values",
      description: "List values for a custom field in a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          customFieldId: { type: "number", description: "Custom field ID. Must be a number (integer), not a string." },
          query: { type: "string" },
          global: { type: "boolean" },
          testCaseSearch: { type: "string" },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["customFieldId"],
      },
    },
    {
      name: "get_test_case_custom_fields",
      description: "Get custom field values for a test case.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
        },
        required: ["testCaseId"],
      },
    },
    {
      name: "set_test_case_custom_fields",
      description:
        "Add custom field values for a test case via bulk API. Supports grouped values [{ customField: { id }, values: [{ id|name }] }] and flat values [{ id|name, customField: { id } }].",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          payload: { type: "array", items: { type: "object" } },
        },
        required: ["testCaseId", "payload"],
      },
    },
    {
      name: "list_test_case_attachments",
      description: "List attachments for a test case.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
        },
        required: ["testCaseId"],
      },
    },
    {
      name: "upload_test_case_attachment",
      description:
        "Upload a file attachment to a test case. Provide file content as a base64-encoded string.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          filename: { type: "string", description: "File name including extension, e.g. screenshot.png." },
          contentType: { type: "string", description: "MIME type, e.g. image/png or application/pdf." },
          contentBase64: { type: "string", description: "File content encoded as a base64 string." },
        },
        required: ["testCaseId", "filename", "contentType", "contentBase64"],
      },
    },
    {
      name: "delete_test_case_attachment",
      description: "Delete an attachment from a test case by attachment ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          attachmentId: { type: "number", description: "Attachment ID. Must be a number (integer), not a string." },
        },
        required: ["attachmentId"],
      },
    },
    {
      name: "get_test_case_attachment_content",
      description:
        "Download the binary content of a test case attachment. Returns base64-encoded content with its MIME type.",
      inputSchema: {
        type: "object" as const,
        properties: {
          attachmentId: { type: "number", description: "Attachment ID. Must be a number (integer), not a string." },
        },
        required: ["attachmentId"],
      },
    },
  ];

  const handlers = {
    list_test_cases: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.listTestCases(client, projectId, {
        search: getOptionalString(args, "search"),
        filterId: getOptionalNumber(args, "filterId"),
        ...pickPagination(args),
      });
    },
    search_test_cases: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.searchTestCases(client, projectId, getRequiredString(args, "rql"), {
        ...pickPagination(args),
      });
    },
    get_test_case: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCase(client, getRequiredId(args));
    },
    create_test_case: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const payload = ensureProjectIdInPayload(getObjectPayload(args), client);

      // Steps are not accepted by POST /api/testcase — extract and create them separately.
      const { steps, ...testCasePayload } = payload;
      const result = await api.createTestCase(client, testCasePayload) as { id?: number };

      if (Array.isArray(steps) && steps.length > 0 && typeof result.id === "number") {
        const testCaseId = result.id;
        for (const step of steps) {
          const s = step as Record<string, unknown>;
          const body = typeof s.name === "string" ? s.name
            : typeof s.body === "string" ? s.body
            : undefined;
          const expectedResult = typeof s.expectedResult === "string" ? s.expectedResult : undefined;
          const hasExpectedResult = expectedResult !== undefined;

          // Parse multiple expected results: split by semicolons or bullet/numbered list lines.
          const expectedLines: string[] = [];
          if (hasExpectedResult) {
            const BULLET_RE = /^[\s]*(?:[-*•·]|\d+[.)]\s)\s*/;
            const byNewline = expectedResult!.split("\n")
              .map(l => l.replace(BULLET_RE, "").trim())
              .filter(l => l.length > 0);
            if (byNewline.length > 1) {
              expectedLines.push(...byNewline);
            } else {
              const bySemicolon = expectedResult!.split(";").map(l => l.trim()).filter(l => l.length > 0);
              expectedLines.push(...(bySemicolon.length > 1 ? bySemicolon : [expectedResult!.trim()]));
            }
          }

          // POST step; request an expectedResult header node when needed
          const created = await api.createTestCaseStep(
            client,
            { testCaseId, ...(body !== undefined ? { body } : {}) },
            hasExpectedResult,
          ) as { createdStepId?: number; scenario?: { scenarioSteps?: Record<string, { expectedResultId?: number }> } };

          if (hasExpectedResult && typeof created.createdStepId === "number") {
            // The POST response (ScenarioStepCreatedResponseDto) includes the full scenario.
            // Extract the expectedResult header node ID from it.
            const expectedResultId =
              created.scenario?.scenarioSteps?.[String(created.createdStepId)]?.expectedResultId;

            if (typeof expectedResultId === "number") {
              // Create one child step per expected result line.
              for (const line of expectedLines) {
                await api.createTestCaseStep(client, {
                  testCaseId,
                  parentId: expectedResultId,
                  body: line,
                });
              }
            }
          }
        }
      }

      return result;
    },
    update_test_case: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.updateTestCase(client, getRequiredId(args), getObjectPayload(args));
    },
    delete_test_case: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.deleteTestCase(client, getRequiredId(args));
    },
    add_test_case_tags_bulk: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
      const tags = normalizeBulkTags(args);
      return api.addTagsToTestCases(client, projectId, testCaseIds, tags);
    },
    remove_test_case_tags_bulk: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
      const tagIds = getBulkIdList(args, "tagId", "tagIds", "tag");
      return api.removeTagsFromTestCases(client, projectId, testCaseIds, tagIds);
    },
    add_test_case_external_links_bulk: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
      const links = normalizeBulkExternalLinks(args);
      return api.addExternalLinksToTestCases(client, projectId, testCaseIds, links);
    },
    get_test_case_overview: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseOverview(client, getRequiredId(args, "testCaseId"));
    },
    get_test_case_history: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseHistory(client, getRequiredId(args), pickPagination(args));
    },
    get_test_case_scenario: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseScenario(client, getRequiredId(args));
    },
    get_test_case_steps: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseSteps(client, getRequiredId(args));
    },
    get_test_case_tags: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseTags(client, getRequiredId(args, "testCaseId"));
    },
    set_test_case_tags: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.setTestCaseTags(client, getRequiredId(args, "testCaseId"), args.payload);
    },
    get_test_case_issues: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseIssues(client, getRequiredId(args, "testCaseId"));
    },
    set_test_case_issues: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.setTestCaseIssues(client, getRequiredId(args, "testCaseId"), args.payload);
    },
    restore_test_case: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.restoreTestCase(client, getRequiredId(args));
    },
    update_test_case_step: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const stepId = getRequiredId(args, "stepId");
      const body = getOptionalString(args, "body");
      const expectedResult = getOptionalString(args, "expectedResult");

      // Fetch current step metadata to get testCaseId and expectedResultId.
      const currentStep = await api.getTestCaseStep(client, stepId) as {
        expectedResultId?: number;
        testCaseId?: number;
      };

      // Update the step body if requested.
      if (body !== undefined) {
        await api.updateTestCaseStep(client, stepId, { body });
      }

      if (expectedResult === undefined) return currentStep;

      const testCaseId = currentStep.testCaseId;
      if (typeof testCaseId !== "number") {
        throw new Error("Could not determine testCaseId for this step.");
      }

      let expectedResultId = currentStep.expectedResultId;

      // If no expected result header exists yet, create it via PATCH withExpectedResult=true.
      if (typeof expectedResultId !== "number") {
        const patchScenario = await api.updateTestCaseStep(client, stepId, {}, true) as {
          scenarioSteps?: Record<string, { expectedResultId?: number }>;
        };
        expectedResultId = patchScenario?.scenarioSteps?.[String(stepId)]?.expectedResultId;
      }

      if (typeof expectedResultId !== "number") {
        throw new Error("Could not create or find expected result node for this step.");
      }

      // Get the full scenario to read the header node's children.
      const fullScenario = await api.getTestCaseSteps(client, testCaseId) as {
        scenarioSteps?: Record<string, { children?: number[] }>;
      };
      const children = fullScenario?.scenarioSteps?.[String(expectedResultId)]?.children ?? [];

      for (const childId of children) {
        return api.updateTestCaseStep(client, childId, { body: expectedResult });
      }

      // Children was empty — create a new text child node under the expected result header.
      return api.createTestCaseStep(client, {
        testCaseId,
        parentId: expectedResultId,
        body: expectedResult,
      });
    },
    list_project_custom_fields: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.listProjectCustomFields(client, projectId, {
        query: getOptionalString(args, "query"),
        ...pickPagination(args),
      });
    },
    list_custom_field_values: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.listCustomFieldValues(
        client,
        projectId,
        getRequiredId(args, "customFieldId"),
        {
        query: getOptionalString(args, "query"),
        global: getOptionalBoolean(args, "global"),
        testCaseSearch: getOptionalString(args, "testCaseSearch"),
        ...pickPagination(args),
        },
      );
    },
    get_test_case_custom_fields: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getTestCaseCustomFields(client, getRequiredId(args, "testCaseId"), projectId);
    },
    set_test_case_custom_fields: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const testCaseId = getRequiredId(args, "testCaseId");
      return api.setTestCaseCustomFields(client, projectId, testCaseId, args.payload);
    },
    list_test_case_attachments: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.listTestCaseAttachments(client, getRequiredId(args, "testCaseId"));
    },
    upload_test_case_attachment: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.uploadTestCaseAttachment(
        client,
        getRequiredId(args, "testCaseId"),
        getRequiredString(args, "filename"),
        getRequiredString(args, "contentType"),
        getRequiredString(args, "contentBase64"),
      );
    },
    delete_test_case_attachment: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.deleteTestCaseAttachment(client, getRequiredId(args, "attachmentId"));
    },
    get_test_case_attachment_content: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      return api.getTestCaseAttachmentContent(client, getRequiredId(args, "attachmentId"));
    },
  };

  return { tools, handlers };
}
