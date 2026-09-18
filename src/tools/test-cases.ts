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

function getBulkIdList(
  args: ToolObject, singleKey: string, multipleKey: string, entityLabel: string,
): number[] {
  const ids: number[] = [];
  const single = bulkField(args, singleKey);
  if (single !== undefined) {
    if (typeof single !== "number" || Number.isNaN(single))
      throw new Error(`"${singleKey}" must be a number when provided.`);
    ids.push(single);
  }
  const multiple = bulkField(args, multipleKey);
  if (multiple !== undefined) {
    const values = asArray(multiple);
    if (!values || values.some((item) => typeof item !== "number" || Number.isNaN(item)))
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

const createTestCase = zodTool("create_test_case",
  "Create a new test case. payload.projectId defaults to ALLURE_PROJECT_ID env when omitted. payload.precondition (string) is the preconditions field — always use this for preconditions/prerequisites text, NOT payload.description. payload.description (string) is the general test case description — always populate this with a meaningful summary of what the test case verifies. payload.customFields supports values like { customField: { id }, id, name }. IMPORTANT: steps are NOT created via this tool. The Allure API does not support creating steps through the test-case payload — payload.steps is silently ignored. After creating the test case, use create_test_case_step to add each step individually. Example workflow: create_test_case → for each step call create_test_case_step.",
  z.object({ payload: coerceObject() }),
);

const createTestCaseStep = zodTool("create_test_case_step",
  "Add a new step to a test case — works for both NEW and EXISTING test cases. This is the ONLY correct tool for adding steps. NEVER use update_test_case to add steps — it replaces the entire scenario and loses expected results.\n\nUSE THIS TOOL whenever the user asks to add a step. No need to read the scenario first — just call with testCaseId and body.\n\nexpectedResult is optional. When provided, the expected result is set on the new step automatically via the Allure API (body and expectedResult are passed in a single request). Multiple expected result lines: separate with ; or newlines.\n\nNOTE: when expectedResult is provided, the API response includes a created wrapper step whose body is initially a placeholder (e.g. Expected Result) — this is normal Allure API behavior, not a bug. The wrapper step gets an ID and can be edited later via update_test_case_step. The actual expectedResult text is accessible through get_test_case_steps.\n\nparentId creates a child step under the given parent (for nested structures). sharedStepId references an existing shared step instead of providing body text.\n\nCONCURRENCY WARNING: NEVER issue 2+ concurrent calls (in the same message/batch) against create_test_case_step / update_test_case_step / set_test_case_step_expected_result for the SAME testCaseId — the API has a race condition when writing to the same scenario tree in parallel, and one of the leaf texts can be silently lost. Steps for the same test case must be written ONE AT A TIME, sequentially. Calls targeting DIFFERENT testCaseIds are safe to parallelize.",
  z.object({
    testCaseId: idSchema("Test case"),
    body: z.string().optional().describe("Step body text. Required unless sharedStepId is provided."),
    expectedResult: z.string().optional().describe("Expected result text for the new step. Separate multiple lines with ; or newlines."),
    parentId: coerceInt().optional().describe("Parent step ID for nested steps."),
    sharedStepId: coerceInt().optional().describe("Shared step ID to reference an existing shared step instead of providing body text."),
  }).passthrough(),
);

const setTestCaseStepExpectedResult = zodTool("set_test_case_step_expected_result",
  "Set the expected result on a step that has NO expected result yet. Call this after create_test_case_step when an expected result is needed.\n\nWHEN TO USE:\n- User asks to add a step with expected result → use create_test_case_step with expectedResult instead (preferred)\n- User asks to set expected result on an existing step that does NOT have one yet (verify via get_test_case_steps — the step has no expectedResultId / no wrapper children)\n\nWHEN NOT TO USE — this tool APPENDS, it does not replace:\nIf the step ALREADY has expected-result text, calling this tool again creates a NEW sibling leaf under the same wrapper instead of replacing the old one — you end up with duplicated expected-result lines on the same step. There is no delete_test_case_step in this toolset, so an accidentally created duplicate cannot be removed automatically; it must be cleaned up manually in the Allure UI. To change existing expected-result text, use update_test_case_step(leafId, { body: newText }) directly on the existing leaf's step id instead (see update_test_case_step's WRAPPER STEPS note).\n\nbody: pass the step's current body text. Omitting it may cause 400 step.onlyonedetail on some API versions.\nMultiple expected result lines: separate with ; or newlines.",
  z.object({
    stepId: coerceInt().describe("Step ID. Use createdStepId from create_test_case_step response."),
    testCaseId: idSchema("Test case"),
    body: z.string().optional().describe("Step body text (current or unchanged). Required by the API."),
    expectedResult: z.string().describe("Expected result text. Separate multiple lines with ; or newlines."),
  }),
);

const updateTestCaseStep = zodTool("update_test_case_step",
  "Update a test case step by ID. Supports updating body text and/or expectedResult.\n\nWORKFLOW — read before using:\n1. Change ONLY step text:   { stepId, body: \"new text\" }. Omit expectedResult — existing expected results stay untouched.\n2. Change ONLY expected result: { stepId, expectedResult: \"A; B\" }. Omit body — step text stays as-is.\n3. Change BOTH:             { stepId, body: \"new text\", expectedResult: \"A; B\" }.\n\nCRITICAL — expectedResult is a FULL REPLACE, not an append.\nWhen you pass expectedResult, the API deletes ALL existing expected-result lines for that step and replaces them with what you provide. You MUST include EVERY expected-result line you want to keep, separated by semicolons (e.g. \"Check value; Verify status\") or newlines.\nIf you have 3 expected-result lines and only pass 1, the other 2 are GONE.\n\nWRAPPER STEPS — silent no-op risk.\nSteps marked _wrapper=true in get_test_case_steps output (or listed in _meta.expectedResultWrapperIds) are Expected Result container nodes. Passing expectedResult to update_test_case_step targeting a wrapper ONLY works the first time (when the wrapper has no children yet — it creates the leaf). If the wrapper already HAS a child (check its `children` array via get_test_case_steps), calling update_test_case_step(wrapperId, { expectedResult }) again returns 200 and bumps lastModifiedDate but the text is NOT changed — this is a silent no-op, not an error. In that case, call update_test_case_step(leafId, { body: newText }) directly on the child step id instead, and OMIT expectedResult entirely.\n\nWHAT TO AVOID:\n- Calling this tool with expectedResult, then calling it again — the second call overwrites the first. Update body and expectedResult together in ONE call.\n- Mixing update_test_case_step with update_test_case (full scenario replace) on the same step — pick one approach and stick with it.\n- Passing a partial expectedResult string — it BECOMES the entire expected result. Old lines are wiped.\n- Issuing 2+ concurrent calls (same message/batch) against create_test_case_step / update_test_case_step / set_test_case_step_expected_result for the SAME testCaseId — the API race-conditions when writing to the same scenario tree in parallel and can silently drop one of the leaf texts. Write steps for one test case sequentially; only different testCaseIds are safe to parallelize.",
  z.object({
    stepId: coerceInt().describe("Step ID to update. Must be a number (integer), not a string."),
    body: z.string().optional().describe("New step body text."),
    expectedResult: z.string().optional().describe("FULL expected result text — REPLACES ALL existing lines. Use semicolons or newlines for multiple lines. When omitted, existing expected results are preserved."),
  }),
);

const updateTestCase = zodTool("update_test_case",
  "Update an existing test case metadata (name, description, precondition, tags, customFields, etc.). payload.customFields supports values like { customField: { id }, id, name }. DO NOT use this tool to add or edit steps — use create_test_case_step / update_test_case_step instead. NOTE: there is no delete_test_case_step tool in this toolset — steps cannot be deleted programmatically; removing a step requires the Allure UI.",
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
  "Restore one or multiple deleted test cases from the project trash (Allure TestOps 26.3+). " +
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

const getTestCaseScenario = zodTool("get_test_case_scenario", "Get scenario for a test case.",
  z.object({ id: idSchema("Test case") }),
);

const getTestCaseStepsTool = zodTool("get_test_case_steps",
  "Get manual scenario steps for a test case. Returns a normalized scenario with root step and a flat map of all steps (scenarioSteps). Each step contains body, expectedResult, children IDs, and optional sharedStepId. IMPORTANT: the response includes a _meta section with expectedResultWrapperIds — these are Expected Result container nodes. See _meta.note for the exact create-vs-edit workflow (whether to target the wrapper or its existing leaf child).\n\nEVENTUAL CONSISTENCY: right after create_test_case_step / update_test_case_step / set_test_case_step_expected_result, an immediate get_test_case_steps call MAY still return a stale snapshot missing the just-written leaf, due to replication/cache lag on the Allure API side — this is NOT necessarily an error. Don't treat a missing/unchanged leaf as proof the write failed; re-check with a fresh get_test_case_steps call a turn or two later (e.g. after another unrelated call) before concluding the write didn't take effect.",
  z.object({ id: idSchema("Test case") }),
);

const getTestCaseTags = zodTool("get_test_case_tags", "Get tags assigned to a test case.",
  z.object({ id: idSchema("Test case") }),
);

const setTestCaseTags = zodTool("set_test_case_tags", "Set tags for a test case.",
  z.object({ testCaseId: idSchema("Test case"), payload: coerceArray(coerceObject()) }),
);

const getTestCaseIssues = zodTool("get_test_case_issues", "Get linked issues for a test case.",
  z.object({ id: idSchema("Test case") }),
);

const setTestCaseIssues = zodTool("set_test_case_issues", "Set linked issues for a test case.",
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
  "Add custom field values for a test case via bulk API. Supports grouped values [{ customField: { id }, values: [{ id|name }] }] and flat values [{ id|name, customField: { id } }].\n\nIMPORTANT — customField.id MUST be a NUMBER, never a name. Passing customField: { name: \"Feature\" } fails client-side with '\"payload[0].customField.id\" must be a number' — there is no name-to-id resolution for the field itself (values MAY accept name, but resolving to id first is safer and not guaranteed to work on every Allure version).\n\nThere is no dedicated \"list custom fields\" tool. To find a field's numeric id: call get_test_case_custom_fields on ANY already-populated test case in the same project — its response shows each customField's id alongside its name. System fields commonly have NEGATIVE ids (e.g. Feature = -2, Suite = -5) — these vary per Allure instance, do not hardcode them.\n\nTo find a VALUE's numeric id: call list_custom_field_values({ customFieldId, query: \"<value text>\" }).\n\nCorrect workflow: 1) get_test_case_custom_fields(anyPopulatedTestCaseId) → note customField ids. 2) list_custom_field_values({customFieldId, query}) → note value id. 3) set_test_case_custom_fields({testCaseId, payload: [{ customField: { id: -2 }, values: [{ id: 3170 }] }]}) — all numeric ids, resolved ahead of time.",
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
        return api.createTestCaseStep(client, payload, args.expectedResult !== undefined);
      },
      set_test_case_step_expected_result: async (rawArgs: unknown) => {
        const { stepId, testCaseId, expectedResult, body } = setTestCaseStepExpectedResult.parse(rawArgs);
        return api.setStepExpectedResult(client, stepId, testCaseId, expectedResult, body);
      },
      update_test_case_step: async (rawArgs: unknown) => {
        const { stepId, body, expectedResult } = updateTestCaseStep.parse(rawArgs);
        return api.updateTestCaseStep(client, stepId, { body, expectedResult }, expectedResult !== undefined);
      },
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
        return { ...data, _meta: { expectedResultWrapperIds: [...wrapperIds], regularStepIds: regularIds, note: "Steps with IDs in expectedResultWrapperIds are Expected Result container (wrapper) nodes. If a wrapper has NO children yet, set its text via update_test_case_step(wrapperId, { expectedResult }) — this creates the leaf. If a wrapper ALREADY has a child (its `children` array is non-empty), that call silently no-ops (200 OK, lastModifiedDate bumps, text unchanged) — instead call update_test_case_step(leafId, { body: newText }) directly on the child id from `children`, WITHOUT the expectedResult parameter." } };
      },
      get_test_case_tags: async (rawArgs) => api.getTestCaseTags(client, getTestCaseTags.parse(rawArgs).id),
      set_test_case_tags: async (rawArgs) => {
        const { testCaseId, payload } = setTestCaseTags.parse(rawArgs);
        return api.setTestCaseTags(client, testCaseId, payload);
      },
      get_test_case_issues: async (rawArgs) => api.getTestCaseIssues(client, getTestCaseIssues.parse(rawArgs).id),
      set_test_case_issues: async (rawArgs) => {
        const { testCaseId, payload } = setTestCaseIssues.parse(rawArgs);
        return api.setTestCaseIssues(client, testCaseId, payload);
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
