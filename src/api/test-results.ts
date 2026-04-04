import type { AllureApiClient } from "../client.js";

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined>;

export function listTestResults(
  client: AllureApiClient,
  launchId: number,
  query: QueryParams,
): Promise<unknown> {
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
): Promise<unknown> {
  return client.get("/api/testresult/__search", {
    projectId,
    rql,
    ...query,
  });
}

export function getTestResult(client: AllureApiClient, id: number): Promise<unknown> {
  return client.get(`/api/testresult/${id}`);
}

export function createTestResult(
  client: AllureApiClient,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/testresult", payload);
}

export function updateTestResult(
  client: AllureApiClient,
  id: number,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.patch(`/api/testresult/${id}`, payload);
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

export function resolveTestResult(
  client: AllureApiClient,
  id: number,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.post(`/api/testresult/${id}/resolve`, payload);
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
): Promise<unknown> {
  return client.get("/api/testresult/attachment", { testResultId, ...query });
}

export function getTestResultAttachmentContent(
  client: AllureApiClient,
  attachmentId: number,
): Promise<unknown> {
  return client.getRaw(`/api/testresult/attachment/${attachmentId}/content`);
}
