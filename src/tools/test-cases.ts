import type { AllureApiClient } from "../client.js";
import * as api from "../api/test-cases.js";
import type { ToolBundle } from "./types.js";
import {
  AQL_SYNTAX,
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

function escapeAqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// AQL treats cf["Field"] = "value" as a no-op (matches everything) instead of erroring
// or matching nothing when the field name or value doesn't exist — so a typo'd/stale
// custom field filter silently returns the unfiltered list. Validate field + value exist
// up front so a bad filter fails loudly instead of looking like "no results filtered".
async function validateCustomFieldValue(
  client: AllureApiClient,
  projectId: number,
  fieldName: string,
  value: string,
): Promise<void> {
  const fieldsResult = (await api.listProjectCustomFields(client, projectId, {
    query: fieldName,
    size: 50,
  })) as { content?: Array<{ customField?: { id?: number; name?: string } }> };

  const fields = fieldsResult.content ?? [];
  const field = fields.find(
    (row) => row.customField?.name?.toLowerCase() === fieldName.toLowerCase(),
  );

  if (!field?.customField?.id) {
    const available = fields
      .map((row) => row.customField?.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    throw new Error(
      `Custom field "${fieldName}" was not found in this project.` +
        (available.length > 0
          ? ` Similar fields found: ${available.join(", ")}.`
          : " No similar custom fields were found either.") +
        " Check the exact field name before filtering.",
    );
  }

  const valuesResult = (await api.listCustomFieldValues(client, projectId, field.customField.id, {
    query: value,
    size: 50,
  })) as { content?: Array<{ name?: string }> };

  const values = valuesResult.content ?? [];
  const exists = values.some((row) => row.name?.toLowerCase() === value.toLowerCase());

  if (!exists) {
    const available = values
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    throw new Error(
      `Value "${value}" was not found for custom field "${fieldName}" in this project.` +
        (available.length > 0
          ? ` Similar values found: ${available.join(", ")}.`
          : " No similar values were found either.") +
        " The filter would otherwise silently match every test case instead of none.",
    );
  }

  // Even with a confirmed-existing field + value, some Allure custom field configurations
  // (e.g. multi-select/list-typed fields) treat cf["Field"] = "value" as a no-op — matching
  // every test case in the project instead of filtering. Probe the actual filter against an
  // unfiltered baseline so a silently-broken filter fails loudly instead of returning wrong data.
  const probeRql = `cf["${escapeAqlString(fieldName)}"] = "${escapeAqlString(value)}"`;
  const [probeResult, baselineResult] = await Promise.all([
    api.searchTestCases(client, projectId, probeRql, { size: 1 }),
    api.listTestCases(client, projectId, { size: 1 }),
  ]);
  const probeTotal = (probeResult as { totalElements?: number }).totalElements ?? 0;
  const baselineTotal = (baselineResult as { totalElements?: number }).totalElements ?? 0;

  if (baselineTotal > 5 && probeTotal === baselineTotal) {
    throw new Error(
      `Filter cf["${fieldName}"] = "${value}" did not narrow results — it matched all ` +
        `${baselineTotal} test cases in the project, same as no filter at all. This Allure ` +
        `instance treats equality on this custom field as a no-op (likely a multi-select/list ` +
        `field type). Use list_custom_field_values to inspect the field, or filter with tags ` +
        "or a different field instead.",
    );
  }
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
      name: "search_test_cases",
      description:
        "Search test cases by AQL (Allure Query Language) query. " +
        "PREFER find_test_cases for broad multi-field search — it automatically searches name + Suite + Feature. " +
        "Use this tool for precise, targeted AQL queries when you need custom field filters or complex logic.",
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
          },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
        required: ["rql"],
      },
    },
    {
      name: "find_test_cases",
      description:
        "Broad search for test cases — use as the FIRST step before creating new test cases to check for duplicates. " +
        "The \"query\" parameter searches test case name (contains match). " +
        "Use \"feature\", \"suite\", or \"customFieldFilters\" to search by custom field values (exact match).\n" +
        "\n" +
        "WORKFLOW (general → specific):\n" +
        "1. Broad search:   find_test_cases({ query: \"keyword\" }) — searches by test case name\n" +
        "2. By custom field: find_test_cases({ feature: \"keyword\" }) — exact match on Feature custom field\n" +
        "3. Combined:       find_test_cases({ query: \"login\", feature: \"Auth\", automated: true }) — name + filters\n" +
        "4. Targeted AQL:   search_test_cases({ rql: 'cf[\"Feature\"] = \"keyword\" and automation = false' }) — precise query\n" +
        "\n" +
        "At least one of the search/filter parameters must be provided.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: {
            type: "string",
            description: "Project name (alternative to projectId).",
          },
          query: {
            type: "string",
            description:
              "Search keyword — searches test case name (contains match). " +
              "Use for broad name-based discovery. To search custom fields, use the \"feature\", \"suite\", or \"customFieldFilters\" parameters.",
          },
          name: {
            type: "string",
            description: "Filter by test case name (contains match). Use to narrow results to a specific name pattern.",
          },
          suite: {
            type: "string",
            description:
              "Filter by Suite custom field value (exact match). Use to narrow results to a specific suite. " +
              "NOTE: the custom field must be named \"Suite\" in this project — use customFieldFilters if the name differs.",
          },
          feature: {
            type: "string",
            description:
              "Filter by Feature custom field value (exact match). Use to narrow results to a specific feature. " +
              "NOTE: the custom field must be named \"Feature\" in this project — use customFieldFilters if the name differs.",
          },
          tag: {
            type: "string",
            description: "Filter by tag name (exact match).",
          },
          automated: {
            type: "boolean",
            description: "Filter by automation status: true = automated tests only, false = manual tests only.",
          },
          status: {
            type: "string",
            description: "Filter by test case status (exact match, e.g. 'Active', 'Draft', 'Deprecated').",
          },
          customFieldFilters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fieldName: { type: "string", description: "Custom field name, e.g. 'Suite', 'Feature', 'Epic'." },
                value: { type: "string", description: "Value to match." },
                exactMatch: {
                  type: "boolean",
                  description:
                    "If true, use exact match (=); if false/omitted, use contains match (~=). " +
                    "Default: false (contains). NOTE: ~= on custom fields is not officially documented and may cause 400 errors on some Allure versions.",
                },
              },
              required: ["fieldName", "value"],
            },
            description:
              "Additional custom field filters for granular targeting. " +
              "Each filter adds an AND condition. Example: [{ fieldName: \"Epic\", value: \"Auth\" }].",
          },
          page: { type: "number", description: "Page number, 0-based. Must be a number (integer), not a string." },
          size: { type: "number", description: "Page size. Must be a number (integer), not a string." },
          sort: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "get_test_case",
      description: "Get a test case by ID.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "number", description: "Test case ID. Must be a number (integer), not a string." } },
        required: ["id"],
      },
    },
    {
      name: "create_test_case",
      description:
        "Create a new test case. payload.projectId defaults to ALLURE_PROJECT_ID env when omitted. " +
        "payload.precondition (string) is the preconditions field — always use this for preconditions/prerequisites text, NOT payload.description. " +
        "payload.description (string) is the general test case description — always populate this with a meaningful summary of what the test case verifies. " +
        "payload.customFields supports values like { customField: { id }, id, name }. " +
        "IMPORTANT: steps are NOT created via this tool. The Allure API does not support creating steps through the test-case payload — " +
        "payload.steps is silently ignored. After creating the test case, use create_test_case_step to add each step individually. " +
        "Example workflow: create_test_case → for each step call create_test_case_step.",
      inputSchema: {
        type: "object" as const,
        properties: {
          payload: { type: "object", additionalProperties: true },
        },
        required: ["payload"],
      },
    },
    {
      name: "create_test_case_step",
      description:
        "Add a new step to a test case — works for both NEW and EXISTING test cases. " +
        "This is the ONLY correct tool for adding steps. NEVER use update_test_case to add steps — it replaces the entire scenario and loses expected results.\n" +
        "\n" +
        "USE THIS TOOL whenever the user asks to add a step. " +
        "No need to read the scenario first — just call with testCaseId and body.\n" +
        "\n" +
        "expectedResult is optional. When provided, the expected result is set on the new step automatically. " +
        "Multiple expected result lines: separate with ; or newlines.\n" +
        "\n" +
        "parentId creates a child step under the given parent (for nested structures). " +
        "sharedStepId references an existing shared step instead of providing body text.",
      inputSchema: {
        type: "object" as const,
        properties: {
          testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." },
          body: { type: "string", description: "Step body text. Required unless sharedStepId is provided." },
          expectedResult: { type: "string", description: "Expected result text for the new step. Separate multiple lines with ; or newlines." },
          parentId: { type: "number", description: "Parent step ID for nested steps." },
          sharedStepId: { type: "number", description: "Shared step ID to reference an existing shared step instead of providing body text." },
        },
        required: ["testCaseId"],
      },
    },
    {
      name: "set_test_case_step_expected_result",
      description:
        "Set the expected result on an existing step. Call this after create_test_case_step when an expected result is needed.\n" +
        "\n" +
        "WHEN TO USE:\n" +
        "- User asks to add a step with expected result → use create_test_case_step with expectedResult instead (preferred)\n" +
        "- User asks to set/update expected result on an already-existing step\n" +
        "\n" +
        "body: pass the step's current body text. Omitting it may cause 400 step.onlyonedetail on some API versions.\n" +
        "Multiple expected result lines: separate with ; or newlines.",
      inputSchema: {
        type: "object" as const,
        properties: {
          stepId: { type: "number", description: "Step ID. Use createdStepId from create_test_case_step response." },
          testCaseId: { type: "number", description: "Test case ID that owns this step." },
          body: { type: "string", description: "Step body text (current or unchanged). Required by the API." },
          expectedResult: { type: "string", description: "Expected result text. Separate multiple lines with ; or newlines." },
        },
        required: ["stepId", "testCaseId", "expectedResult"],
      },
    },
    {
      name: "update_test_case_step",
      description:
        "Update a test case step by ID. Supports updating body text and/or expectedResult.\n" +
        "\n" +
        "WORKFLOW — read before using:\n" +
        "1. Change ONLY step text:   { stepId, body: \"new text\" }. Omit expectedResult — existing expected results stay untouched.\n" +
        "2. Change ONLY expected result: { stepId, expectedResult: \"A; B\" }. Omit body — step text stays as-is.\n" +
        "3. Change BOTH:             { stepId, body: \"new text\", expectedResult: \"A; B\" }.\n" +
        "\n" +
        "CRITICAL — expectedResult is a FULL REPLACE, not an append.\n" +
        "When you pass expectedResult, the API deletes ALL existing expected-result lines for that step " +
        "and replaces them with what you provide. You MUST include EVERY expected-result line you want to keep, " +
        "separated by semicolons (e.g. \"Check value; Verify status\") or newlines.\n" +
        "If you have 3 expected-result lines and only pass 1, the other 2 are GONE.\n" +
        "\n" +
        "WRAPPER STEPS — do not target them directly.\n" +
        "Steps marked _wrapper=true in get_test_case_steps output (or listed in _meta.expectedResultWrapperIds) " +
        "are internal child nodes managed by the API. To edit their content, update the PARENT step " +
        "and pass the complete expectedResult text.\n" +
        "\n" +
        "WHAT TO AVOID:\n" +
        "- Calling this tool with expectedResult, then calling it again — the second call overwrites the first. " +
        "Update body and expectedResult together in ONE call.\n" +
        "- Mixing update_test_case_step with update_test_case (full scenario replace) on the same step — pick one approach and stick with it.\n" +
        "- Passing a partial expectedResult string — it BECOMES the entire expected result. Old lines are wiped.",
      inputSchema: {
        type: "object" as const,
        properties: {
          stepId: { type: "number", description: "Step ID to update. Must be a number (integer), not a string." },
          body: { type: "string", description: "New step body text." },
          expectedResult: { type: "string", description: "FULL expected result text — REPLACES ALL existing lines. Use semicolons or newlines for multiple lines. When omitted, existing expected results are preserved." },
        },
        required: ["stepId"],
      },
    },
    {
      name: "update_test_case",
      description:
        "Update an existing test case metadata (name, description, precondition, tags, customFields, etc.). " +
        "payload.customFields supports values like { customField: { id }, id, name }. " +
        "DO NOT use this tool to add, edit, or delete steps — use create_test_case_step / update_test_case_step / delete_test_case_step instead.",
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
        properties: { id: { type: "number", description: "Test case ID. Must be a number (integer), not a string." } },
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
          testCaseIds: { type: "array", items: { type: "number", description: "Test case ID. Must be a number (integer), not a string." } },
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
          testCaseIds: { type: "array", items: { type: "number", description: "Test case ID. Must be a number (integer), not a string." } },
          tagId: { type: "number", description: "Tag ID. Must be a number (integer), not a string." },
          tagIds: { type: "array", items: { type: "number", description: "Tag ID. Must be a number (integer), not a string." } },
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
          testCaseIds: { type: "array", items: { type: "number", description: "Test case ID. Must be a number (integer), not a string." } },
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
        properties: { testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." } },
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
      description:
        "Get manual scenario steps for a test case. Returns a normalized scenario with root step and a flat map of all steps (scenarioSteps). " +
        "Each step contains body, expectedResult, children IDs, and optional sharedStepId. " +
        "IMPORTANT: the response includes a _meta section with expectedResultWrapperIds — these child nodes are Expected Result containers " +
        "that CANNOT be edited directly via update_test_case_step. To update expected results, pass the `expectedResult` parameter " +
        "on the parent step instead. Only steps listed in _meta.regularStepIds should be targeted by update_test_case_step.",
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
        properties: { testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." } },
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
        properties: { testCaseId: { type: "number", description: "Test case ID. Must be a number (integer), not a string." } },
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
        properties: { id: { type: "number", description: "Test case ID. Must be a number (integer), not a string." } },
        required: ["id"],
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
    search_test_cases: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.searchTestCases(client, projectId, getRequiredString(args, "rql"), {
        ...pickPagination(args),
      });
    },
    find_test_cases: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);

      const query = getOptionalString(args, "query");
      const name = getOptionalString(args, "name");
      const suite = getOptionalString(args, "suite");
      const feature = getOptionalString(args, "feature");
      const tag = getOptionalString(args, "tag");
      const automated = getOptionalBoolean(args, "automated");
      const status = getOptionalString(args, "status");
      const customFieldFilters = args.customFieldFilters;

      const conditions: string[] = [];

      // Broad search query — searches name with contains match
      if (query !== undefined) {
        conditions.push(`name ~= "${escapeAqlString(query)}"`);
      }

      // Name filter (narrowing)
      if (name !== undefined) {
        conditions.push(`name ~= "${escapeAqlString(name)}"`);
      }

      // Suite filter (narrowing)
      if (suite !== undefined) {
        await validateCustomFieldValue(client, projectId, "Suite", suite);
        conditions.push(`cf["Suite"] = "${escapeAqlString(suite)}"`);
      }

      // Feature filter (narrowing)
      if (feature !== undefined) {
        await validateCustomFieldValue(client, projectId, "Feature", feature);
        conditions.push(`cf["Feature"] = "${escapeAqlString(feature)}"`);
      }

      // Tag filter
      if (tag !== undefined) {
        conditions.push(`tag = "${escapeAqlString(tag)}"`);
      }

      // Automated filter
      if (automated !== undefined) {
        conditions.push(`automation = ${automated}`);
      }

      // Status filter
      if (status !== undefined) {
        conditions.push(`status = "${escapeAqlString(status)}"`);
      }

      // Custom field filters (granular targeting)
      if (customFieldFilters !== undefined) {
        if (!Array.isArray(customFieldFilters)) {
          throw new Error("\"customFieldFilters\" must be an array when provided.");
        }
        for (let i = 0; i < customFieldFilters.length; i++) {
          const filter = customFieldFilters[i] as Record<string, unknown>;
          const cfName = filter.fieldName;
          const cfValue = filter.value;
          const exactMatch = filter.exactMatch === true;

          if (typeof cfName !== "string" || cfName.length === 0) {
            throw new Error(
              `"customFieldFilters[${i}].fieldName" must be a non-empty string.`,
            );
          }
          if (typeof cfValue !== "string" || cfValue.length === 0) {
            throw new Error(
              `"customFieldFilters[${i}].value" must be a non-empty string.`,
            );
          }

          if (exactMatch) {
            await validateCustomFieldValue(client, projectId, cfName, cfValue);
          }

          const operator = exactMatch ? "=" : "~=";
          conditions.push(
            `cf["${escapeAqlString(cfName)}"] ${operator} "${escapeAqlString(cfValue)}"`,
          );
        }
      }

      if (conditions.length === 0) {
        throw new Error(
          "At least one search or filter parameter must be provided. " +
            "Use \"query\" for broad multi-field search, or provide at least one of: " +
            "name, suite, feature, tag, automated, status, customFieldFilters.",
        );
      }

      const rql = conditions.join(" and ");

      return api.searchTestCases(client, projectId, rql, {
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

      // Steps are not supported via the test-case payload — the Allure API either
      // returns 400 or silently ignores them. Drop them and let the caller use
      // update_test_case_step after creation.
      delete payload.steps;

      return api.createTestCase(client, payload);
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
      const data = (await api.getTestCaseSteps(client, getRequiredId(args))) as Record<string, unknown>;

      const scenarioSteps = (data.scenarioSteps ?? {}) as Record<string, Record<string, unknown>>;

      // Identify expected-result wrapper steps: these are child nodes referenced by
      // another step's `expectedResultId`. They cannot be edited directly via
      // update_test_case_step — use the parent step's `expectedResult` parameter instead.
      const wrapperIds = new Set<number>();
      for (const step of Object.values(scenarioSteps)) {
        const erId = step.expectedResultId;
        if (typeof erId === "number") {
          wrapperIds.add(erId);
        }
      }

      const regularIds: number[] = [];
      for (const [idStr, step] of Object.entries(scenarioSteps)) {
        const id = Number(idStr);
        if (wrapperIds.has(id)) {
          step._wrapper = true; // mark in the step object itself
        } else {
          regularIds.push(id);
        }
      }

      return {
        ...data,
        _meta: {
          expectedResultWrapperIds: [...wrapperIds],
          regularStepIds: regularIds,
          note:
            "Steps with IDs in expectedResultWrapperIds are Expected Result container nodes. " +
            "They cannot be edited directly via update_test_case_step — update the parent step " +
            "passing the new text as the `expectedResult` parameter instead.",
        },
      };
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
    create_test_case_step: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const testCaseId = getRequiredId(args, "testCaseId");
      const body = getOptionalString(args, "body");
      const expectedResult = getOptionalString(args, "expectedResult");
      const parentId = getOptionalNumber(args, "parentId");
      const sharedStepId = getOptionalNumber(args, "sharedStepId");

      const payload: Record<string, unknown> = { testCaseId };
      if (body !== undefined) payload.body = body;
      if (parentId !== undefined) payload.parentId = parentId;
      if (sharedStepId !== undefined) payload.sharedStepId = sharedStepId;

      const created = await api.createTestCaseStep(
        client,
        payload,
        expectedResult !== undefined,
      ) as { createdStepId?: number; scenario?: { scenarioSteps?: Record<string, { expectedResultId?: number }> } };

      if (expectedResult !== undefined && typeof created.createdStepId === "number") {
        const erHeaderId = created.scenario?.scenarioSteps?.[String(created.createdStepId)]?.expectedResultId;
        if (typeof erHeaderId === "number") {
          await api.createTestCaseStep(client, {
            testCaseId,
            parentId: erHeaderId,
            body: expectedResult,
          });
        }
      }

      return created;
    },
    set_test_case_step_expected_result: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const stepId = getRequiredId(args, "stepId");
      const testCaseId = getRequiredId(args, "testCaseId");
      const expectedResult = getRequiredString(args, "expectedResult");
      const body = getOptionalString(args, "body");
      return api.setStepExpectedResult(client, stepId, testCaseId, expectedResult, body);
    },
    update_test_case_step: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const stepId = getRequiredId(args, "stepId");
      const body = getOptionalString(args, "body");
      const expectedResult = getOptionalString(args, "expectedResult");

      const payload: Record<string, unknown> = {};
      if (body !== undefined) payload.body = body;
      if (expectedResult !== undefined) payload.expectedResult = expectedResult;

      // When expectedResult is provided, the API requires withExpectedResult=true
      // query parameter to actually process and persist the expected result.
      // Without it, the expected result child wrapper is silently dropped.
      return api.updateTestCaseStep(client, stepId, payload, expectedResult !== undefined);
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
