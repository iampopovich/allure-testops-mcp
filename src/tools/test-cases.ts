import type { AllureApiClient } from "../client.js";
import * as api from "../api/test-cases.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, coerceInt, idSchema, paginationSchema, projectIdSchema, projectNameSchema, sortSchema, coerceObject, coerceArray } from "./schema.js";
import { AQL_SYNTAX, ensureProjectIdInPayload, resolveProjectId } from "./utils.js";

// ─── Helpers (unchanged from pre-Zod) ────────────────────────────────────────

type ToolObject = Record<string, unknown>;
type BulkTag = { id?: number; name?: string };
type BulkExternalLink = { url: string; name?: string; type?: string };

function asArray(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Expected an array.");
  return value;
}

/**
 * Bulk tag/link/custom-field tools take these fields at the top level, but callers
 * frequently nest them inside `payload` (the convention used by most other tools in
 * this server). Fall back to `payload[key]` so both calling conventions work.
 */
function bulkField(args: ToolObject, key: string): unknown {
  if (args[key] !== undefined) return args[key];
  const payload = args.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return (payload as ToolObject)[key];
  }
  return undefined;
}

/** Accepts integers and integer strings — values nested inside `payload` bypass Zod coercion. */
function toId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

function getBulkIdList(
  args: ToolObject, singleKey: string, multipleKey: string, entityLabel: string,
): number[] {
  const ids: number[] = [];
  const single = bulkField(args, singleKey);
  if (single !== undefined) {
    const id = toId(single);
    if (id === undefined)
      throw new Error(`"${singleKey}" must be a number when provided.`);
    ids.push(id);
  }
  const multiple = bulkField(args, multipleKey);
  if (multiple !== undefined) {
    const values = asArray(multiple)?.map(toId);
    if (!values || values.some((item) => item === undefined))
      throw new Error(`"${multipleKey}" must be an array of numbers when provided.`);
    ids.push(...(values as number[]));
  }
  if (ids.length === 0) throw new Error(`Either "${singleKey}" or "${multipleKey}" must be provided with at least one ${entityLabel} ID.`);
  return [...new Set(ids)];
}

function normalizeBulkTags(args: ToolObject): BulkTag[] {
  const items: unknown[] = [];
  const tag = bulkField(args, "tag");
  if (tag !== undefined) items.push(tag);
  const tags = bulkField(args, "tags");
  if (tags !== undefined) {
    const tagsArray = asArray(tags);
    if (!tagsArray) throw new Error("\"tags\" must be an array when provided.");
    items.push(...tagsArray);
  }
  if (items.length === 0) throw new Error("Either \"tag\" or \"tags\" must be provided with at least one tag.");
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`"tags[${index}]" must be an object.`);
    const row = item as ToolObject;
    const id = typeof row.id === "number" ? row.id : undefined;
    const name = typeof row.name === "string" ? row.name : undefined;
    if (id === undefined && (name === undefined || name.trim().length === 0))
      throw new Error(`"tags[${index}]" must include at least one of "id" or non-empty "name".`);
    return { ...(id !== undefined ? { id } : {}), ...(name !== undefined ? { name } : {}) };
  });
}

function escapeAqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function validateCustomFieldValue(
  client: AllureApiClient, projectId: number, fieldName: string, value: string,
): Promise<void> {
  const fieldsResult = await api.listProjectCustomFields(client, projectId, { query: fieldName, size: 50 });
  const fields = fieldsResult.content ?? [];
  const field = fields.find((row) => row.customField?.name?.toLowerCase() === fieldName.toLowerCase());
  if (!field?.customField?.id) {
    const available = fields.map((row) => row.customField?.name).filter((n): n is string => typeof n === "string" && n.length > 0);
    throw new Error(`Custom field "${fieldName}" was not found in this project.` +
      (available.length > 0 ? ` Similar fields found: ${available.join(", ")}.` : " No similar custom fields were found either.") +
      " Check the exact field name before filtering.");
  }
  const valuesResult = await api.listCustomFieldValues(client, projectId, field.customField.id, { query: value, size: 50 });
  const values = valuesResult.content ?? [];
  const exists = values.some((row) => row.name?.toLowerCase() === value.toLowerCase());
  if (!exists) {
    const available = values.map((row) => row.name).filter((n): n is string => typeof n === "string" && n.length > 0);
    throw new Error(`Value "${value}" was not found for custom field "${fieldName}" in this project.` +
      (available.length > 0 ? ` Similar values found: ${available.join(", ")}.` : " No similar values were found either.") +
      " The filter would otherwise silently match every test case instead of none.");
  }
  const probeRql = `cf["${escapeAqlString(fieldName)}"] = "${escapeAqlString(value)}"`;
  const [probeResult, baselineResult] = await Promise.all([
    api.searchTestCases(client, projectId, probeRql, { size: 1 }),
    api.listTestCases(client, projectId, { size: 1 }),
  ]);
  const probeTotal = (probeResult as { totalElements?: number }).totalElements ?? 0;
  const baselineTotal = (baselineResult as { totalElements?: number }).totalElements ?? 0;
  if (baselineTotal > 5 && probeTotal === baselineTotal) {
    throw new Error(`Filter cf["${fieldName}"] = "${value}" did not narrow results — it matched all ` +
      `${baselineTotal} test cases in the project, same as no filter at all. This Allure ` +
      `instance treats equality on this custom field as a no-op (likely a multi-select/list ` +
      `field type). Use list_custom_field_values to inspect the field, or filter with tags ` +
      "or a different field instead.");
  }
}

function normalizeBulkExternalLinks(args: ToolObject): BulkExternalLink[] {
  const items: unknown[] = [];
  const link = bulkField(args, "link");
  if (link !== undefined) items.push(link);
  const links = bulkField(args, "links");
  if (links !== undefined) {
    const linksArray = asArray(links);
    if (!linksArray) throw new Error("\"links\" must be an array when provided.");
    items.push(...linksArray);
  }
  if (items.length === 0) throw new Error("Either \"link\" or \"links\" must be provided with at least one external link.");
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error(`"links[${index}]" must be an object.`);
    const row = item as ToolObject;
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (url.length === 0) throw new Error(`"links[${index}].url" must be a non-empty string.`);
    const name = row.name;
    if (name !== undefined && typeof name !== "string") throw new Error(`"links[${index}].name" must be a string when provided.`);
    const type = row.type;
    if (type !== undefined && typeof type !== "string") throw new Error(`"links[${index}].type" must be a string when provided.`);
    return { url, ...(typeof name === "string" ? { name } : {}), ...(typeof type === "string" ? { type } : {}) };
  });
}

// ─── Zod tool definitions ────────────────────────────────────────────────────

const searchTestCases = zodTool("search_test_cases",
  "Search test cases by AQL (Allure Query Language) query. PREFER find_test_cases for broad multi-field search — it automatically searches name + Suite + Feature. Use this tool for precise, targeted AQL queries when you need custom field filters or complex logic.",
  z.object({
    projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(),
    rql: z.string().describe(
      AQL_SYNTAX + " " +
      "Test case fields: id, name, tag, issue, role[\"R\"], member, cf[\"F\"], cfv, layer, " +
      "status, workflow, testPlan, automation (boolean), muted, mutedDate, " +
      "createdDate, createdBy, lastModifiedDate, lastModifiedBy. " +
      "Custom field patterns: cf[\"Feature\"] = \"keyword\" | " +
      "cf[\"Epic\"] = \"Auth\" | cf[\"Suite\"] = \"MySuite\". " +
      "Examples: name ~= \"login\" | automation = true | automation = false | " +
      "status = \"Active\" | tag in [\"smoke\", \"regression\"] | " +
      "not tag in [\"nightly\"] | cf[\"Feature\"] = \"keyword\" and cf[\"Suite\"] = \"MySuite\" | " +
      "name ~= \"checkout\" and muted = false | (createdBy = \"a\" or createdBy = \"b\") and automation = true",
    ),
    ...paginationSchema, sort: sortSchema,
  }),
);

const findTestCases = zodTool("find_test_cases",
  "Broad search for test cases — use as the FIRST step before creating new test cases to check for duplicates. The \"query\" parameter searches test case name (contains match). Use \"feature\", \"suite\", or \"customFieldFilters\" to search by custom field values (exact match).\n\nWORKFLOW (general → specific):\n1. Broad search:   find_test_cases({ query: \"keyword\" }) — searches by test case name\n2. By custom field: find_test_cases({ feature: \"keyword\" }) — exact match on Feature custom field\n3. Combined:       find_test_cases({ query: \"login\", feature: \"Auth\", automated: true }) — name + filters\n4. Targeted AQL:   search_test_cases({ rql: 'cf[\"Feature\"] = \"keyword\" and automation = false' }) — precise query\n\nAt least one of the search/filter parameters must be provided.",
  z.object({
    projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(),
    query: z.string().optional().describe("Search keyword — searches test case name (contains match). Use for broad name-based discovery. To search custom fields, use the \"feature\", \"suite\", or \"customFieldFilters\" parameters."),
    name: z.string().optional().describe("Filter by test case name (contains match). Use to narrow results to a specific name pattern."),
    suite: z.string().optional().describe("Filter by Suite custom field value (exact match). Use to narrow results to a specific suite. NOTE: the custom field must be named \"Suite\" in this project — use customFieldFilters if the name differs."),
    feature: z.string().optional().describe("Filter by Feature custom field value (exact match). Use to narrow results to a specific feature. NOTE: the custom field must be named \"Feature\" in this project — use customFieldFilters if the name differs."),
    tag: z.string().optional().describe("Filter by tag name (exact match)."),
    automated: z.boolean().optional().describe("Filter by automation status: true = automated tests only, false = manual tests only."),
    status: z.string().optional().describe("Filter by test case status (exact match, e.g. 'Active', 'Draft', 'Deprecated')."),
    customFieldFilters: coerceArray(z.object({
      fieldName: z.string().describe("Custom field name, e.g. 'Suite', 'Feature', 'Epic'."),
      value: z.string().describe("Value to match."),
      exactMatch: z.boolean().optional().describe("If true, use exact match (=); if false/omitted, use contains match (~=). Default: false (contains). NOTE: ~= on custom fields is not officially documented and may cause 400 errors on some Allure versions."),
    })).optional().describe("Additional custom field filters for granular targeting. Each filter adds an AND condition. Example: [{ fieldName: \"Epic\", value: \"Auth\" }]."),
    ...paginationSchema, sort: sortSchema,
  }),
);

const getTestCase = zodTool("get_test_case", "Get a test case by ID.", z.object({ id: idSchema("Test case") }));

const USER_FLOWS_HINT = "See MCP resource allure://guides/user-flows for the full UI-equivalent flow.";
const CONCURRENCY_NOTE = "CONCURRENCY: write steps of ONE test case sequentially (never 2+ step-writing calls for the same testCaseId in one batch) — parallel writes to the same scenario tree can silently drop a line. Different testCaseIds are safe to parallelize.";

const createTestCase = zodTool("create_test_case",
  "Create a new test case (metadata only). The scenario is added afterwards, step by step.\n\n" +
  "payload fields: name (required); projectId (defaults to ALLURE_PROJECT_ID); description (what the case verifies — always fill it); " +
  "precondition (preconditions text — NOT description); expectedResult (ONE overall expected result of the whole case — this is NOT the per-step expected result); " +
  "statusId together with workflowId (statusId alone → 400 'workflow and status are required'; default workflow 'Default Manual' = -1, statuses -1 Draft, -2 Review, -3 Active, -4 Outdated); " +
  "testLayerId (-1 Unit Tests, -2 UI Tests, -3 API Tests by default); tags [{id}|{name}] (a name creates the tag); links [{name, url}]; " +
  "customFields [{customField:{id}, id|name}]; automated.\n\n" +
  "DO NOT pass scenario/steps: the API accepts payload.scenario but stores only empty step nodes (text '<empty>', no expected results, no shared steps). " +
  "Workflow: create_test_case → for each step, sequentially, create_test_case_step({testCaseId, body, expectedResult}) → verify with get_test_case_steps. " +
  "Precondition / test-case expected result are shown in the UI only when the project enables those sections (project property testcase.sections.*.enabled); the API stores them either way. " +
  USER_FLOWS_HINT,
  z.object({ payload: coerceObject() }),
);

const createTestCaseStep = zodTool("create_test_case_step",
  "Add a step to a test case (new or existing) — the only correct way to build a scenario. Equivalent to pressing Enter / 'Step with expected result' in the UI scenario editor.\n\n" +
  "- body: step text (required unless sharedStepId is given).\n" +
  "- expectedResult (optional): one expected-result line per ';' or newline. The tool creates the step with an Expected Result container and then one child line per entry, so get_test_case_steps shows them under step.expectedResultId.\n" +
  "- parentId: create a nested sub-step under that step.\n" +
  "- sharedStepId: insert a shared step instead of body text.\n" +
  "- afterId / beforeId (optional): position among siblings; without them the step is appended at the end.\n\n" +
  "The response contains createdStepId (the step) and expectedResultId (its ER container, when expectedResult was given). " +
  "To add expected results to an existing step use set_test_case_step_expected_result; to change text use update_test_case_step. " +
  CONCURRENCY_NOTE + " " + USER_FLOWS_HINT,
  z.object({
    testCaseId: idSchema("Test case"),
    body: z.string().optional().describe("Step body text. Required unless sharedStepId is provided."),
    expectedResult: z.string().optional().describe("Expected result for the new step. Multiple lines: separate with ; or newlines — each becomes its own ER line."),
    parentId: coerceInt().optional().describe("Parent step ID for nested steps."),
    sharedStepId: coerceInt().optional().describe("Shared step ID to reference an existing shared step instead of providing body text."),
    afterId: coerceInt().optional().describe("Insert the new step right after this sibling step ID."),
    beforeId: coerceInt().optional().describe("Insert the new step right before this sibling step ID."),
  }).passthrough(),
);

const setTestCaseStepExpectedResult = zodTool("set_test_case_step_expected_result",
  "APPEND expected-result lines to an existing step. If the step has no expected result yet, the Expected Result container is created first (the UI's 'Convert to → Step with expected result'); existing lines are kept and the new ones are added after them.\n\n" +
  "stepId may be the step itself or its Expected Result container. body is optional — the current step text is used when omitted.\n" +
  "To REPLACE all expected-result lines use update_test_case_step({testCaseId, stepId, expectedResult}). To add a step together with its expected result use create_test_case_step({..., expectedResult}). " +
  "Multiple lines: separate with ; or newlines. " + CONCURRENCY_NOTE,
  z.object({
    stepId: coerceInt().describe("Step ID (or its Expected Result container ID)."),
    testCaseId: idSchema("Test case"),
    body: z.string().optional().describe("Optional new step text; the current text is kept when omitted."),
    expectedResult: z.string().describe("Expected result text to append. Separate multiple lines with ; or newlines."),
  }),
);

const updateTestCaseStep = zodTool("update_test_case_step",
  "Update a step's text and/or REPLACE its expected result, without losing data. The tool reads the scenario first (that is why testCaseId is required) and sends exactly what the UI sends.\n\n" +
  "1. Text only — {testCaseId, stepId, body}: the existing expected result is preserved.\n" +
  "2. Replace expected result — {testCaseId, stepId, expectedResult: \"A; B\"}: ALL current ER lines are deleted and replaced by these lines (include every line you want to keep). The container is created if the step had none.\n" +
  "3. Both — pass body and expectedResult in ONE call.\n" +
  "4. Remove the expected result — expectedResult: \"\" (UI 'Convert to → Step').\n" +
  "5. Edit one ER line — {testCaseId, stepId: <line id from the container's children>, body}.\n" +
  "6. stepId may also be an Expected Result container: then expectedResult replaces its lines.\n\n" +
  "Read IDs with get_test_case_steps (step.expectedResultId → container; container.children → lines). " + CONCURRENCY_NOTE,
  z.object({
    testCaseId: idSchema("Test case"),
    stepId: coerceInt().describe("Step ID to update. Must be a number (integer), not a string."),
    body: z.string().optional().describe("New step text. Omit to keep the current text."),
    expectedResult: z.string().optional().describe("FULL replacement of the expected result (lines separated by ; or newlines). \"\" removes it. Omit to keep the current expected result."),
  }),
);

const deleteTestCaseStep = zodTool("delete_test_case_step",
  "Delete a scenario step (UI: step menu → Delete). Deletion cascades: the step's expected result and nested sub-steps are deleted too and cannot be restored. " +
  "Can also delete a single expected-result line (pass the line's id from the container's children). Returns the updated scenario.",
  z.object({ stepId: coerceInt().describe("Step (or expected-result line) ID to delete.") }),
);

const updateTestCase = zodTool("update_test_case",
  "Partially update test case metadata (only the fields you pass are changed): name, description, precondition, expectedResult (test-case level, not per-step), " +
  "statusId (+ workflowId), testLayerId, automated, links, tags, customFields.\n\n" +
  "FULL REPLACE fields: links, tags and customFields replace the whole list — pass every item you want to keep (for incremental tag changes use add_test_case_tags_bulk / remove_test_case_tags_bulk; for custom fields use set_test_case_custom_fields).\n" +
  "NEVER pass scenario: the API replaces the WHOLE scenario with empty step nodes (all step texts and expected results are lost). Edit steps with create_test_case_step / update_test_case_step / delete_test_case_step.",
  z.object({ id: idSchema("Test case"), payload: coerceObject() }),
);

const deleteTestCase = zodTool("delete_test_case", "Delete a test case by ID.", z.object({ id: idSchema("Test case") }));

const addTestCaseTagsBulk = zodTool("add_test_case_tags_bulk",
  "Add one or multiple tags to one or multiple test cases using bulk API. testCaseId/testCaseIds/tag/tags may be passed as top-level arguments or nested inside a \"payload\" object — both forms work.",
  z.object({
    projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(),
    testCaseId: coerceInt().optional().describe("Test case ID. Must be a number (integer), not a string."),
    testCaseIds: coerceArray(coerceInt()).optional().describe("Test case IDs."),
    tag: coerceObject().optional(),
    tags: coerceArray(coerceObject()).optional(),
  }).passthrough(),
);

const restoreTestCasesBulk = zodTool("restore_test_cases_bulk",
  "Restore one or multiple test cases from the project trash (soft-deleted via delete_test_case). " +
  "Only trashed test cases can be restored — a non-deleted ID makes the API answer 400 'can-not-restore-not-deleted-test-case'. " +
  "For a single test case, restore_test_case is equivalent.",
  z.object({
    projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(),
    testCaseId: coerceInt().optional().describe("Test case ID. Must be a number (integer), not a string."),
    testCaseIds: coerceArray(coerceInt()).optional().describe("Test case IDs."),
  }).passthrough(),
);

const removeTestCaseTagsBulk = zodTool("remove_test_case_tags_bulk",
  "Remove one or multiple tags from one or multiple test cases using bulk API. testCaseId/testCaseIds/tagId/tagIds may be passed as top-level arguments or nested inside a \"payload\" object — both forms work.",
  z.object({
    projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(),
    testCaseId: coerceInt().optional().describe("Test case ID."),
    testCaseIds: coerceArray(coerceInt()).optional(),
    tagId: coerceInt().optional().describe("Tag ID."),
    tagIds: coerceArray(coerceInt()).optional(),
  }).passthrough(),
);

const addTestCaseExternalLinksBulk = zodTool("add_test_case_external_links_bulk",
  "Add one or multiple external links to one or multiple test cases using bulk API. testCaseId/testCaseIds/link/links may be passed as top-level arguments or nested inside a \"payload\" object — both forms work.",
  z.object({
    projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(),
    testCaseId: coerceInt().optional(),
    testCaseIds: coerceArray(coerceInt()).optional(),
    link: coerceObject().optional(),
    links: coerceArray(coerceObject()).optional(),
  }).passthrough(),
);

const getTestCaseOverview = zodTool("get_test_case_overview", "Get test case overview data.",
  z.object({ id: idSchema("Test case") }),
);

const getTestCaseHistory = zodTool("get_test_case_history", "Get test case run history.",
  z.object({ id: idSchema("Test case"), ...paginationSchema, sort: sortSchema }),
);

const getTestCaseScenario = zodTool("get_test_case_scenario",
  "Alias of get_test_case_steps (kept for compatibility). The legacy endpoint GET /api/testcase/{id}/scenario is deprecated and returns an empty list for editor-built scenarios, so this tool reads the normalized step tree instead. Prefer get_test_case_steps.",
  z.object({ id: idSchema("Test case") }),
);

const getTestCaseStepsTool = zodTool("get_test_case_steps",
  "Read the manual scenario of a test case (the same tree the UI renders). Response: root.children = ordered top-level step IDs; scenarioSteps = flat map id → step. " +
  "A step has body, optional children (nested sub-steps), optional sharedStepId (inserted shared step — read its content with get_shared_step_steps), optional attachmentId (attachment node), " +
  "and optional expectedResultId → the Expected Result CONTAINER node; the container's children are the expected-result lines. " +
  "_meta.expectedResultWrapperIds lists all containers; _meta.regularStepIds lists the rest. " +
  "Use these IDs with update_test_case_step / set_test_case_step_expected_result / delete_test_case_step. The response cache is cleared on every write. " +
  USER_FLOWS_HINT,
  z.object({ id: idSchema("Test case") }),
);

const getTestCaseTags = zodTool("get_test_case_tags", "Get tags assigned to a test case.",
  z.object({ id: idSchema("Test case") }),
);

const setTestCaseTags = zodTool("set_test_case_tags",
  "REPLACE the full tag list of a test case. payload: [{id}] or [{name}] — a name that does not exist yet creates the tag. " +
  "Tags not in the payload are removed; [] clears all tags. To add or remove tags without touching the others use add_test_case_tags_bulk / remove_test_case_tags_bulk.",
  z.object({ testCaseId: idSchema("Test case"), payload: coerceArray(coerceObject()) }),
);

const getTestCaseIssues = zodTool("get_test_case_issues", "Get linked issues for a test case.",
  z.object({ id: idSchema("Test case") }),
);

const setTestCaseIssues = zodTool("set_test_case_issues",
  "REPLACE the issue links of a test case. payload: [{integrationId, name}] where integrationId is an issue-tracker integration connected to the project and name is the issue key (e.g. \"JIRA-123\"). " +
  "Issues only exist through an integration: without integrationId the API returns 200 with an empty list and stores nothing — this tool therefore rejects items without integrationId and verifies the result. [] clears all issues.",
  z.object({ testCaseId: idSchema("Test case"), payload: coerceArray(coerceObject()) }),
);

const restoreTestCase = zodTool("restore_test_case", "Restore a deleted test case.",
  z.object({ id: idSchema("Test case") }),
);

const listCustomFieldValues = zodTool("list_custom_field_values", "List values for a custom field in a project.",
  z.object({
    projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(),
    customFieldId: idSchema("Custom field"),
    query: z.string().optional(), global: z.boolean().optional(), testCaseSearch: z.string().optional(),
    ...paginationSchema, sort: sortSchema,
  }).passthrough(),
);

const getTestCaseCustomFields = zodTool("get_test_case_custom_fields", "Get custom field values for a test case.",
  z.object({ id: idSchema("Test case"), projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional() }),
);

const setTestCaseCustomFields = zodTool("set_test_case_custom_fields",
  "ADD custom field values to a test case (append — existing values stay; adding a value that is already set is a no-op). Supports grouped values [{ customField: { id }, values: [{ id|name }] }] and flat values [{ id|name, customField: { id } }].\n\n" +
  "customField.id MUST be a NUMBER. A value may be given by id or by name — a name that does not exist yet is created as a new value of that field.\n" +
  "Built-in system fields have negative ids: -1 Epic, -2 Feature, -3 Story, -4 Component, -5 Suite. For other fields, read the id from get_test_case_custom_fields (any test case of the project lists every field with its id) and value ids from list_custom_field_values({ customFieldId, query }).\n\n" +
  "This tool cannot REMOVE a value (no remove tool yet — in the UI it is the bulk action Remove metadata → Custom field values).",
  z.object({ testCaseId: idSchema("Test case"), projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(), payload: coerceArray(coerceObject()) }),
);

const listTestCaseAttachments = zodTool("list_test_case_attachments", "List attachments for a test case.",
  z.object({ id: idSchema("Test case") }),
);

const uploadTestCaseAttachment = zodTool("upload_test_case_attachment",
  "Upload a file attachment to a test case. Provide file content as a base64-encoded string.",
  z.object({
    testCaseId: idSchema("Test case"),
    filename: z.string().describe("File name including extension, e.g. screenshot.png."),
    contentType: z.string().describe("MIME type, e.g. image/png or application/pdf."),
    contentBase64: z.string().describe("File content encoded as a base64 string."),
  }),
);

const deleteTestCaseAttachment = zodTool("delete_test_case_attachment",
  "Delete an attachment from a test case by attachment ID.",
  z.object({ attachmentId: idSchema("Attachment") }),
);

const getTestCaseAttachmentContent = zodTool("get_test_case_attachment_content",
  "Download the binary content of a test case attachment. Returns base64-encoded content with its MIME type.",
  z.object({ attachmentId: idSchema("Attachment") }),
);

// ─── createTestCaseTools ─────────────────────────────────────────────────────

export function createTestCaseTools(client: AllureApiClient): ToolBundle {
  return {
    tools: [
      searchTestCases.definition,
      findTestCases.definition,
      getTestCase.definition,
      createTestCase.definition,
      createTestCaseStep.definition,
      setTestCaseStepExpectedResult.definition,
      updateTestCaseStep.definition,
      deleteTestCaseStep.definition,
      updateTestCase.definition,
      deleteTestCase.definition,
      addTestCaseTagsBulk.definition,
      restoreTestCasesBulk.definition,
      removeTestCaseTagsBulk.definition,
      addTestCaseExternalLinksBulk.definition,
      getTestCaseOverview.definition,
      getTestCaseHistory.definition,
      getTestCaseScenario.definition,
      getTestCaseStepsTool.definition,
      getTestCaseTags.definition,
      setTestCaseTags.definition,
      getTestCaseIssues.definition,
      setTestCaseIssues.definition,
      restoreTestCase.definition,
      listCustomFieldValues.definition,
      getTestCaseCustomFields.definition,
      setTestCaseCustomFields.definition,
      listTestCaseAttachments.definition,
      uploadTestCaseAttachment.definition,
      deleteTestCaseAttachment.definition,
      getTestCaseAttachmentContent.definition,
    ],
    handlers: {
      search_test_cases: async (rawArgs: unknown) => {
        const args = searchTestCases.parse(rawArgs);
        const projectId = await resolveProjectId(args, client);
        return api.searchTestCases(client, projectId, args.rql, { page: args.page, size: args.size, sort: args.sort });
      },
      find_test_cases: async (rawArgs: unknown) => {
        const args = findTestCases.parse(rawArgs);
        const projectId = await resolveProjectId(args, client);
        const conditions: string[] = [];
        if (args.query !== undefined) conditions.push(`name ~= "${escapeAqlString(args.query)}"`);
        if (args.name !== undefined) conditions.push(`name ~= "${escapeAqlString(args.name)}"`);
        if (args.suite !== undefined) { await validateCustomFieldValue(client, projectId, "Suite", args.suite); conditions.push(`cf["Suite"] = "${escapeAqlString(args.suite)}"`); }
        if (args.feature !== undefined) { await validateCustomFieldValue(client, projectId, "Feature", args.feature); conditions.push(`cf["Feature"] = "${escapeAqlString(args.feature)}"`); }
        if (args.tag !== undefined) conditions.push(`tag = "${escapeAqlString(args.tag)}"`);
        if (args.automated !== undefined) conditions.push(`automation = ${args.automated}`);
        if (args.status !== undefined) conditions.push(`status = "${escapeAqlString(args.status)}"`);
        if (args.customFieldFilters !== undefined) {
          for (let i = 0; i < args.customFieldFilters.length; i++) {
            const f = args.customFieldFilters[i];
            if (f.exactMatch) await validateCustomFieldValue(client, projectId, f.fieldName, f.value);
            const op = f.exactMatch ? "=" : "~=";
            conditions.push(`cf["${escapeAqlString(f.fieldName)}"] ${op} "${escapeAqlString(f.value)}"`);
          }
        }
        if (conditions.length === 0) throw new Error("At least one search or filter parameter must be provided.");
        return api.searchTestCases(client, projectId, conditions.join(" and "), { page: args.page, size: args.size, sort: args.sort });
      },
      get_test_case: async (rawArgs: unknown) => api.getTestCase(client, getTestCase.parse(rawArgs).id),
      create_test_case: async (rawArgs: unknown) => {
        const { payload } = createTestCase.parse(rawArgs);
        const enriched = ensureProjectIdInPayload(payload, client);
        delete enriched.steps;
        return api.createTestCase(client, enriched);
      },
      create_test_case_step: async (rawArgs: unknown) => {
        const args = createTestCaseStep.parse(rawArgs);
        const payload: Record<string, unknown> = { testCaseId: args.testCaseId };
        if (args.body !== undefined) payload.body = args.body;
        if (args.expectedResult !== undefined) payload.expectedResult = args.expectedResult;
        if (args.parentId !== undefined) payload.parentId = args.parentId;
        if (args.sharedStepId !== undefined) payload.sharedStepId = args.sharedStepId;
        if (payload.body === undefined && payload.sharedStepId === undefined)
          throw new Error("Either \"body\" or \"sharedStepId\" must be provided.");
        return api.createTestCaseStep(client, payload, {
          expectedResult: args.expectedResult, afterId: args.afterId, beforeId: args.beforeId,
        });
      },
      set_test_case_step_expected_result: async (rawArgs: unknown) => {
        const { stepId, testCaseId, expectedResult, body } = setTestCaseStepExpectedResult.parse(rawArgs);
        return api.setStepExpectedResult(client, stepId, testCaseId, expectedResult, body);
      },
      update_test_case_step: async (rawArgs: unknown) => {
        const { testCaseId, stepId, body, expectedResult } = updateTestCaseStep.parse(rawArgs);
        if (body === undefined && expectedResult === undefined)
          throw new Error("Provide \"body\" and/or \"expectedResult\".");
        return api.updateTestCaseStep(client, testCaseId, stepId, { body, expectedResult });
      },
      delete_test_case_step: async (rawArgs: unknown) =>
        api.deleteTestCaseStep(client, deleteTestCaseStep.parse(rawArgs).stepId),
      update_test_case: async (rawArgs: unknown) => {
        const { id, payload } = updateTestCase.parse(rawArgs);
        return api.updateTestCase(client, id, payload);
      },
      delete_test_case: async (rawArgs) => api.deleteTestCase(client, deleteTestCase.parse(rawArgs).id),
      add_test_case_tags_bulk: async (rawArgs: unknown) => {
        const args = addTestCaseTagsBulk.parse(rawArgs) as unknown as ToolObject;
        const projectId = await resolveProjectId(args, client);
        const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
        return api.addTagsToTestCases(client, projectId, testCaseIds, normalizeBulkTags(args));
      },
      restore_test_cases_bulk: async (rawArgs: unknown) => {
        const args = restoreTestCasesBulk.parse(rawArgs) as unknown as ToolObject;
        const projectId = await resolveProjectId(args, client);
        const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
        return api.restoreTestCases(client, projectId, testCaseIds);
      },
      remove_test_case_tags_bulk: async (rawArgs: unknown) => {
        const args = removeTestCaseTagsBulk.parse(rawArgs) as unknown as ToolObject;
        const projectId = await resolveProjectId(args, client);
        const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
        const tagIds = getBulkIdList(args, "tagId", "tagIds", "tag");
        return api.removeTagsFromTestCases(client, projectId, testCaseIds, tagIds);
      },
      add_test_case_external_links_bulk: async (rawArgs: unknown) => {
        const args = addTestCaseExternalLinksBulk.parse(rawArgs) as unknown as ToolObject;
        const projectId = await resolveProjectId(args, client);
        const testCaseIds = getBulkIdList(args, "testCaseId", "testCaseIds", "test case");
        return api.addExternalLinksToTestCases(client, projectId, testCaseIds, normalizeBulkExternalLinks(args));
      },
      get_test_case_overview: async (rawArgs) => api.getTestCaseOverview(client, getTestCaseOverview.parse(rawArgs).id),
      get_test_case_history: async (rawArgs) => {
        const { id, page, size, sort } = getTestCaseHistory.parse(rawArgs);
        return api.getTestCaseHistory(client, id, { page, size, sort });
      },
      get_test_case_scenario: async (rawArgs) => api.getTestCaseScenario(client, getTestCaseScenario.parse(rawArgs).id),
      get_test_case_steps: async (rawArgs: unknown) => {
        const { id } = getTestCaseStepsTool.parse(rawArgs);
        const data = await api.getTestCaseSteps(client, id);
        const scenarioSteps = data.scenarioSteps ?? {};
        const wrapperIds = new Set<number>();
        for (const step of Object.values(scenarioSteps)) {
          if (typeof step.expectedResultId === "number") wrapperIds.add(step.expectedResultId);
        }
        const regularIds: number[] = [];
        for (const [idStr, step] of Object.entries(scenarioSteps)) {
          const sid = Number(idStr);
          if (wrapperIds.has(sid)) step._wrapper = true; else regularIds.push(sid);
        }
        return { ...data, _meta: { expectedResultWrapperIds: [...wrapperIds], regularStepIds: regularIds, note: "IDs in expectedResultWrapperIds are Expected Result containers (step.expectedResultId points to them); their `children` are the expected-result lines. Replace all lines: update_test_case_step({testCaseId, stepId, expectedResult}). Append lines: set_test_case_step_expected_result. Edit one line: update_test_case_step({testCaseId, stepId: lineId, body}). Delete a step or a line: delete_test_case_step." } };
      },
      get_test_case_tags: async (rawArgs) => api.getTestCaseTags(client, getTestCaseTags.parse(rawArgs).id),
      set_test_case_tags: async (rawArgs) => {
        const { testCaseId, payload } = setTestCaseTags.parse(rawArgs);
        return api.setTestCaseTags(client, testCaseId, payload);
      },
      get_test_case_issues: async (rawArgs) => api.getTestCaseIssues(client, getTestCaseIssues.parse(rawArgs).id),
      set_test_case_issues: async (rawArgs) => {
        const { testCaseId, payload } = setTestCaseIssues.parse(rawArgs);
        payload.forEach((item, index) => {
          if (typeof item.integrationId !== "number")
            throw new Error(`"payload[${index}].integrationId" must be a number — issues can only be linked through an issue-tracker integration connected to the project.`);
          if (typeof item.name !== "string" || item.name.trim().length === 0)
            throw new Error(`"payload[${index}].name" must be the issue key, e.g. "JIRA-123".`);
        });
        const result = await api.setTestCaseIssues(client, testCaseId, payload);
        if (payload.length > 0 && Array.isArray(result) && result.length === 0)
          throw new Error("Allure accepted the request but stored no issues — check that the integrationId belongs to an issue-tracker integration connected to this project.");
        return result;
      },
      restore_test_case: async (rawArgs) => api.restoreTestCase(client, restoreTestCase.parse(rawArgs).id),
      list_custom_field_values: async (rawArgs: unknown) => {
        const args = listCustomFieldValues.parse(rawArgs) as unknown as ToolObject;
        const projectId = await resolveProjectId(args, client);
        return api.listCustomFieldValues(client, projectId, args.customFieldId as number, {
          query: args.query as string | undefined, global: args.global as boolean | undefined,
          testCaseSearch: args.testCaseSearch as string | undefined,
          page: args.page as number | undefined, size: args.size as number | undefined, sort: args.sort as string[] | undefined,
        });
      },
      get_test_case_custom_fields: async (rawArgs: unknown) => {
        const args = getTestCaseCustomFields.parse(rawArgs);
        const projectId = await resolveProjectId(args, client);
        return api.getTestCaseCustomFields(client, args.id, projectId);
      },
      set_test_case_custom_fields: async (rawArgs: unknown) => {
        const args = setTestCaseCustomFields.parse(rawArgs);
        const projectId = await resolveProjectId(args, client);
        return api.setTestCaseCustomFields(client, projectId, args.testCaseId, args.payload);
      },
      list_test_case_attachments: async (rawArgs) =>
        api.listTestCaseAttachments(client, listTestCaseAttachments.parse(rawArgs).id),
      upload_test_case_attachment: async (rawArgs) => {
        const { testCaseId, filename, contentType, contentBase64 } = uploadTestCaseAttachment.parse(rawArgs);
        return api.uploadTestCaseAttachment(client, testCaseId, filename, contentType, contentBase64);
      },
      delete_test_case_attachment: async (rawArgs) =>
        api.deleteTestCaseAttachment(client, deleteTestCaseAttachment.parse(rawArgs).attachmentId),
      get_test_case_attachment_content: async (rawArgs) =>
        api.getTestCaseAttachmentContent(client, getTestCaseAttachmentContent.parse(rawArgs).attachmentId),
    },
  };
}
