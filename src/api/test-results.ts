import type { AllureApiClient } from "../client.js";
import type { PageDto, AttachmentDto, AttachmentContentDto } from "../types/entities.js";

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined>;

export function listTestResults(
  client: AllureApiClient,
  launchId: number,
  query: QueryParams,
): Promise<PageDto<Record<string, unknown>>> {
  return client.get("/api/testresult", {
    launchId,
    ...query,
  });
}

export function searchTestResults(
  client: AllureApiClient,
  projectId: number,
  rql: string,
  query: QueryParams,
): Promise<PageDto<Record<string, unknown>>> {
  return client.get("/api/testresult/__search", {
    projectId,
    rql,
    ...query,
  });
}

export function getTestResult(client: AllureApiClient, id: number): Promise<Record<string, unknown>> {
  return client.get(`/api/testresult/${id}`);
}

export function createTestResult(
  client: AllureApiClient,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/testresult", payload);
}

/** Fields that only `POST /testresult/{id}/resolve` can change (they are not part of TestResultPatchDto). */
const RESOLVE_ONLY_FIELDS = ["status", "message", "trace", "categoryId"] as const;

export async function updateTestResult(
  client: AllureApiClient,
  id: number,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const resolvePart: Record<string, unknown> = {};
  const patchPart: Record<string, unknown> = { ...payload };
  for (const field of RESOLVE_ONLY_FIELDS) {
    if (field in patchPart) {
      resolvePart[field] = patchPart[field];
      delete patchPart[field];
    }
  }

  let result: unknown;
  if (Object.keys(patchPart).length > 0) {
    const current = await client.get<Record<string, unknown>>(`/api/testresult/${id}`);
    result = await client.patch(`/api/testresult/${id}`, { ...current, ...patchPart });
  }
  if (Object.keys(resolvePart).length > 0) {
    if (resolvePart.status === undefined) {
      throw new Error("\"message\"/\"trace\"/\"categoryId\" can only be changed together with \"status\" (they are saved through resolve).");
    }
    result = await resolveTestResult(client, id, resolvePart);
  }
  return result;
}

export function getTestResultHistory(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/testresult/${id}/history`, query);
}

export function assignTestResult(
  client: AllureApiClient,
  id: number,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.post(`/api/testresult/${id}/assign`, payload);
}

export function getTestResultExecution(
  client: AllureApiClient,
  id: number,
): Promise<{ steps?: unknown[] }> {
  return client.get(`/api/testresult/${id}/execution`, { v2: true });
}

/**
 * Sets the final status of a (manual) test result the way the UI's Passed/Failed buttons do.
 * Resolve without `execution` wipes the recorded run steps, so the current execution is read
 * and sent back when the caller does not pass one.
 */
export async function resolveTestResult(
  client: AllureApiClient,
  id: number,
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (payload.status === undefined) throw new Error("\"status\" is required to resolve a test result.");
  const body: Record<string, unknown> = { ...payload };
  if (body.execution === undefined) {
    const execution = await getTestResultExecution(client, id);
    body.execution = { status: payload.status, steps: execution?.steps ?? [] };
  }
  return client.post(`/api/testresult/${id}/resolve`, body);
}

export function getTestResultRetries(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/testresult/${id}/retries`, query);
}

export function listTestResultAttachments(
  client: AllureApiClient,
  testResultId: number,
  query: QueryParams,
): Promise<PageDto<AttachmentDto>> {
  return client.get("/api/testresult/attachment", { testResultId, ...query });
}

export function getTestResultAttachmentContent(
  client: AllureApiClient,
  attachmentId: number,
): Promise<AttachmentContentDto> {
  return client.getRaw(`/api/testresult/attachment/${attachmentId}/content`);
}
