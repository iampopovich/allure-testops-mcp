import type { AllureApiClient } from "../client.js";
import type {
  PageDto,
  CreateStepResponse,
  SetExpectedResultResponse,
  TestCaseStepsResponse,
  AttachmentDto,
  AttachmentContentDto,
  CustomFieldRowDto,
  CustomFieldValueDto,
} from "../types/entities.js";

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined>;

type JsonRecord = Record<string, unknown>;
type CustomFieldValueRef = { id?: number; name?: string };
type CustomFieldBulkAddValue = CustomFieldValueRef & { customField: { id: number } };
type TestTagRef = { id?: number; name?: string };
type ExternalLinkRef = { url: string; name?: string; type?: string };

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" ? (value as JsonRecord) : undefined;
}

function toCustomFieldValueRef(
  value: unknown,
  index: number,
  source: "values" | "flat",
): CustomFieldValueRef {
  const row = asRecord(value);
  if (!row) {
    throw new Error(`"payload[${index}]" must be an object.`);
  }

  const id = typeof row.id === "number" ? row.id : undefined;
  const name = typeof row.name === "string" ? row.name : undefined;
  if (id === undefined && name === undefined) {
    if (source === "values") {
      throw new Error(
        `"payload[${index}].values[]" items must include at least one of "id" or "name".`,
      );
    }
    throw new Error(`"payload[${index}]" must include at least one of "id" or "name".`);
  }

  return {
    ...(id !== undefined ? { id } : {}),
    ...(name !== undefined ? { name } : {}),
  };
}

export function normalizeCustomFieldBulkAddPayload(payload: unknown): CustomFieldBulkAddValue[] {
  if (!Array.isArray(payload)) {
    throw new Error("\"payload\" must be an array.");
  }

  const flattened: CustomFieldBulkAddValue[] = [];

  payload.forEach((entry, index) => {
    const row = asRecord(entry);
    if (!row) {
      throw new Error(`"payload[${index}]" must be an object.`);
    }

    const customField = asRecord(row.customField);
    const customFieldId = customField && typeof customField.id === "number"
      ? customField.id
      : undefined;
    if (customFieldId === undefined) {
      throw new Error(`"payload[${index}].customField.id" must be a number.`);
    }

    if ("values" in row) {
      if (!Array.isArray(row.values)) {
        throw new Error(`"payload[${index}].values" must be an array.`);
      }
      const values = row.values.map((value) => ({
        customField: { id: customFieldId },
        ...toCustomFieldValueRef(value, index, "values"),
      }));
      flattened.push(...values);
      return;
    }

    // Backward-compatible input shape support:
    // [{ id, name, customField: { id } }] -> bulk add cfv payload
    const flatValue = toCustomFieldValueRef(row, index, "flat");
    flattened.push({
      customField: { id: customFieldId },
      ...flatValue,
    });
  });

  if (flattened.length === 0) {
    throw new Error("\"payload\" must contain at least one custom field value.");
  }

  return flattened;
}

export function listTestCases(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<PageDto<Record<string, unknown>>> {
  return client.get("/api/testcase", {
    projectId,
    ...query,
  });
}

export function searchTestCases(
  client: AllureApiClient,
  projectId: number,
  rql: string,
  query: QueryParams,
): Promise<PageDto<Record<string, unknown>>> {
  return client.get("/api/testcase/__search", {
    projectId,
    rql,
    ...query,
  });
}

export function getTestCase(client: AllureApiClient, id: number): Promise<Record<string, unknown>> {
  return client.get(`/api/testcase/${id}`);
}

export function createTestCase(
  client: AllureApiClient,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/testcase", payload);
}


export function updateTestCase(
  client: AllureApiClient,
  id: number,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.patch(`/api/testcase/${id}`, payload);
}

export function deleteTestCase(client: AllureApiClient, id: number): Promise<unknown> {
  return client.delete(`/api/testcase/${id}`);
}

export function getTestCaseOverview(client: AllureApiClient, testCaseId: number): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/overview`);
}

export function getTestCaseHistory(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/testcase/${id}/history`, query);
}

/**
 * Legacy alias. `GET /api/testcase/{id}/scenario` is deprecated in API 26.3.x and always
 * returns `{"steps":[]}` for scenarios built in the step editor, so read the normalized
 * step tree instead.
 */
export function getTestCaseScenario(client: AllureApiClient, id: number): Promise<TestCaseStepsResponse> {
  return getTestCaseSteps(client, id);
}

export function getTestCaseSteps(client: AllureApiClient, id: number): Promise<TestCaseStepsResponse> {
  return client.get(`/api/testcase/${id}/step`);
}

export function getTestCaseTags(client: AllureApiClient, testCaseId: number): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/tag`);
}

export function setTestCaseTags(
  client: AllureApiClient,
  testCaseId: number,
  payload: unknown,
): Promise<unknown> {
  return client.post(`/api/testcase/${testCaseId}/tag`, payload);
}

export function getTestCaseIssues(client: AllureApiClient, testCaseId: number): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/issue`);
}

export function setTestCaseIssues(
  client: AllureApiClient,
  testCaseId: number,
  payload: unknown,
): Promise<unknown> {
  return client.post(`/api/testcase/${testCaseId}/issue`, payload);
}

export function restoreTestCase(client: AllureApiClient, id: number): Promise<unknown> {
  return client.post(`/api/testcase/${id}/restore`);
}

/** Splits "A; B" or multi-line text into expected-result lines (one ER leaf per line). */
export function splitExpectedResultLines(text: string): string[] {
  return text.split(/;|\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

type StepPosition = { afterId?: number; beforeId?: number };

function positionQuery(position: StepPosition): QueryParams | undefined {
  const query: QueryParams = {};
  if (position.afterId !== undefined) query.afterId = position.afterId;
  if (position.beforeId !== undefined) query.beforeId = position.beforeId;
  return Object.keys(query).length > 0 ? query : undefined;
}

/**
 * Appends one ER leaf per line under an expected-result container, keeping the order
 * (each next line goes after the previous one, as the UI does).
 */
async function appendExpectedResultLines(
  client: AllureApiClient,
  testCaseId: number,
  wrapperId: number,
  lines: string[],
  afterId?: number,
): Promise<CreateStepResponse | undefined> {
  let last: CreateStepResponse | undefined;
  let previous = afterId;
  for (const line of lines) {
    last = await client.post<CreateStepResponse>(
      "/api/testcase/step",
      { testCaseId, parentId: wrapperId, body: line },
      positionQuery({ afterId: previous }),
    );
    previous = last.createdStepId;
  }
  return last;
}

/**
 * Creates a step the way the UI does. The step DTO has no `expectedResult` field, so an
 * expected result is created as a container (`expectedResultId: -1` + `withExpectedResult=true`)
 * and then one child leaf per line.
 */
export async function createTestCaseStep(
  client: AllureApiClient,
  payload: Record<string, unknown>,
  options: StepPosition & { expectedResult?: string } = {},
): Promise<CreateStepResponse & { expectedResultId?: number }> {
  const lines = options.expectedResult !== undefined ? splitExpectedResultLines(options.expectedResult) : [];
  const query = positionQuery(options);
  if (lines.length === 0) {
    return client.post("/api/testcase/step", payload, query);
  }

  const created = await client.post<CreateStepResponse>(
    "/api/testcase/step",
    { ...payload, expectedResultId: -1 },
    { ...query, withExpectedResult: true },
  );
  const stepId = created.createdStepId;
  const wrapperId = typeof stepId === "number"
    ? created.scenario?.scenarioSteps?.[String(stepId)]?.expectedResultId
    : undefined;
  if (typeof stepId !== "number" || typeof wrapperId !== "number") {
    throw new Error("Step was created but the expected result container was not returned by the API.");
  }
  const last = await appendExpectedResultLines(client, payload.testCaseId as number, wrapperId, lines);
  return { createdStepId: stepId, expectedResultId: wrapperId, scenario: last?.scenario ?? created.scenario };
}

export function deleteTestCaseStep(client: AllureApiClient, stepId: number): Promise<unknown> {
  return client.delete(`/api/testcase/step/${stepId}`);
}

function findStep(scenario: TestCaseStepsResponse, stepId: number, testCaseId: number) {
  const steps = scenario.scenarioSteps ?? {};
  const step = steps[String(stepId)];
  if (!step) {
    throw new Error(`Step ${stepId} was not found in test case ${testCaseId}. Check both IDs with get_test_case_steps.`);
  }
  const isWrapper = Object.values(steps).some((s) => s.expectedResultId === stepId);
  return { step, isWrapper };
}

/**
 * Updates a step without losing its expected result.
 *
 * `PATCH /step/{id}` with `withExpectedResult=false` (or omitted) is how the UI converts a step
 * WITH an expected result into a plain one, so the current `expectedResultId` must always be
 * sent back with `withExpectedResult=true` when the step has an ER.
 * `expectedResult` is a full replace: old ER lines are deleted, new ones are appended.
 * An empty `expectedResult` ("") removes the expected result from the step.
 */
export async function updateTestCaseStep(
  client: AllureApiClient,
  testCaseId: number,
  stepId: number,
  changes: { body?: string; expectedResult?: string },
): Promise<unknown> {
  const scenario = await getTestCaseSteps(client, testCaseId);
  const { step, isWrapper } = findStep(scenario, stepId, testCaseId);
  const steps = scenario.scenarioSteps ?? {};

  if (isWrapper) {
    if (changes.expectedResult === undefined) {
      throw new Error(`Step ${stepId} is an "Expected Result" container. Edit its child line via update_test_case_step(childId, { body }) or pass expectedResult to replace all lines.`);
    }
    for (const childId of step.children ?? []) await deleteTestCaseStep(client, childId);
    const lines = splitExpectedResultLines(changes.expectedResult);
    await appendExpectedResultLines(client, testCaseId, stepId, lines);
    return getTestCaseSteps(client, testCaseId);
  }

  const body = changes.body ?? step.body ?? "";
  const currentWrapper = step.expectedResultId;

  if (changes.expectedResult === undefined) {
    // Text-only edit: keep the existing expected result untouched.
    return currentWrapper !== undefined
      ? client.patch(`/api/testcase/step/${stepId}`, { body, expectedResultId: currentWrapper }, { withExpectedResult: true })
      : client.patch(`/api/testcase/step/${stepId}`, { body }, { withExpectedResult: false });
  }

  const lines = splitExpectedResultLines(changes.expectedResult);
  if (lines.length === 0) {
    // Explicitly clear the expected result ("Convert to step" in the UI).
    return client.patch(`/api/testcase/step/${stepId}`, { body }, { withExpectedResult: false });
  }

  let wrapperId = currentWrapper;
  if (wrapperId === undefined) {
    const patched = await client.patch<SetExpectedResultResponse>(
      `/api/testcase/step/${stepId}`, { body, expectedResultId: -1 }, { withExpectedResult: true },
    );
    wrapperId = patched.scenarioSteps?.[String(stepId)]?.expectedResultId;
    if (typeof wrapperId !== "number") {
      throw new Error(`Expected result container was not created for step ${stepId}.`);
    }
  } else {
    if (changes.body !== undefined) {
      await client.patch(`/api/testcase/step/${stepId}`, { body, expectedResultId: wrapperId }, { withExpectedResult: true });
    }
    for (const childId of steps[String(wrapperId)]?.children ?? []) await deleteTestCaseStep(client, childId);
  }
  await appendExpectedResultLines(client, testCaseId, wrapperId, lines);
  return getTestCaseSteps(client, testCaseId);
}

/**
 * Appends expected-result lines to a step, creating the container if the step has none.
 * The PATCH needs the step body (the API rejects a body-less PATCH with `step.onlyonedetail`),
 * so the current body is read from the scenario when not supplied.
 */
export async function setStepExpectedResult(
  client: AllureApiClient,
  stepId: number,
  testCaseId: number,
  expectedResult: string,
  body?: string,
): Promise<unknown> {
  const lines = splitExpectedResultLines(expectedResult);
  if (lines.length === 0) throw new Error("\"expectedResult\" must contain at least one non-empty line.");

  const scenario = await getTestCaseSteps(client, testCaseId);
  const { step, isWrapper } = findStep(scenario, stepId, testCaseId);
  if (isWrapper) {
    const existing = step.children ?? [];
    await appendExpectedResultLines(client, testCaseId, stepId, lines, existing[existing.length - 1]);
    return getTestCaseSteps(client, testCaseId);
  }

  let wrapperId = step.expectedResultId;
  if (wrapperId === undefined) {
    const patched = await client.patch<SetExpectedResultResponse>(
      `/api/testcase/step/${stepId}`,
      { body: body ?? step.body ?? "", expectedResultId: -1 },
      { withExpectedResult: true },
    );
    wrapperId = patched.scenarioSteps?.[String(stepId)]?.expectedResultId;
    if (typeof wrapperId !== "number") {
      throw new Error(`Expected result wrapper not found in response for step ${stepId}`);
    }
  } else if (body !== undefined) {
    await client.patch(`/api/testcase/step/${stepId}`, { body, expectedResultId: wrapperId }, { withExpectedResult: true });
  }
  const existing = scenario.scenarioSteps?.[String(wrapperId)]?.children ?? [];
  await appendExpectedResultLines(client, testCaseId, wrapperId, lines, existing[existing.length - 1]);
  return getTestCaseSteps(client, testCaseId);
}


export function listProjectCustomFields(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<PageDto<CustomFieldRowDto>> {
  return client.get(`/api/project/${projectId}/cf`, query);
}

export function listCustomFieldValues(
  client: AllureApiClient,
  projectId: number,
  customFieldId: number,
  query: QueryParams,
): Promise<PageDto<CustomFieldValueDto>> {
  return client.get(`/api/project/${projectId}/cfv`, {
    customFieldId,
    ...query,
  });
}

export function getTestCaseCustomFields(
  client: AllureApiClient,
  testCaseId: number,
  projectId: number,
): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/cfv`, {
    projectId,
  });
}

export function setTestCaseCustomFields(
  client: AllureApiClient,
  projectId: number,
  testCaseId: number,
  payload: unknown,
): Promise<unknown> {
  const cfv = normalizeCustomFieldBulkAddPayload(payload);
  return client.post("/api/v2/test-case/bulk/cfv/add", {
    selection: {
      projectId,
      testCasesInclude: [testCaseId],
      inverted: false,
    },
    cfv,
  });
}

export function restoreTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
): Promise<unknown> {
  return client.post("/api/testcase/bulk/restore", {
    selection: {
      projectId,
      deleted: true,
      leafsInclude: testCaseIds,
      inverted: false,
    },
  });
}

export function addTagsToTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  tags: TestTagRef[],
): Promise<unknown> {
  return client.post("/api/v2/test-case/bulk/tag/add", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    tags,
  });
}

export function removeTagsFromTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  tagIds: number[],
): Promise<unknown> {
  return client.post("/api/v2/test-case/bulk/tag/remove", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    ids: tagIds,
  });
}

export function listTestCaseAttachments(
  client: AllureApiClient,
  testCaseId: number,
): Promise<PageDto<AttachmentDto>> {
  return client.get("/api/testcase/attachment", { testCaseId });
}

export async function uploadTestCaseAttachment(
  client: AllureApiClient,
  testCaseId: number,
  filename: string,
  contentType: string,
  contentBase64: string,
): Promise<unknown> {
  const buffer = Buffer.from(contentBase64, "base64");
  const blob = new Blob([buffer], { type: contentType });
  const formData = new FormData();
  formData.append("file", blob, filename);
  return client.postMultipart("/api/testcase/attachment", formData, { testCaseId });
}

export function deleteTestCaseAttachment(
  client: AllureApiClient,
  attachmentId: number,
): Promise<unknown> {
  return client.delete(`/api/testcase/attachment/${attachmentId}`);
}

export function getTestCaseAttachmentContent(
  client: AllureApiClient,
  attachmentId: number,
): Promise<AttachmentContentDto> {
  return client.getRaw(`/api/testcase/attachment/${attachmentId}/content`);
}

export function addExternalLinksToTestCases(
  client: AllureApiClient,
  projectId: number,
  testCaseIds: number[],
  links: ExternalLinkRef[],
): Promise<unknown> {
  return client.post("/api/v2/test-case/bulk/external-link/add", {
    selection: {
      projectId,
      testCasesInclude: testCaseIds,
      inverted: false,
    },
    links,
  });
}
