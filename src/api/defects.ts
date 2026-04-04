import type { AllureApiClient } from "../client.js";

type QueryParams = Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;

export function listDefects(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/defect", { projectId, ...query });
}

export function getDefect(client: AllureApiClient, id: number): Promise<unknown> {
  return client.get(`/api/defect/${id}`);
}

export function createDefect(
  client: AllureApiClient,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/defect", body);
}

export function updateDefect(
  client: AllureApiClient,
  id: number,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.patch(`/api/defect/${id}`, body);
}

export function deleteDefect(client: AllureApiClient, id: number): Promise<unknown> {
  return client.delete(`/api/defect/${id}`);
}

export function suggestDefects(
  client: AllureApiClient,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/defect/suggest", query);
}

export function getDefectTestResults(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/defect/${id}/testresult`, query);
}

export function getDefectTestCases(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/defect/${id}/testcase`, query);
}

export function getDefectLaunches(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/defect/${id}/launch`, query);
}

export function getLaunchDefects(
  client: AllureApiClient,
  launchId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/launch/${launchId}/defect`, query);
}

export function matchDefects(
  client: AllureApiClient,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/testresult/defect/match", query);
}

export function bulkCloseDefects(
  client: AllureApiClient,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/defect/bulk/close", body);
}

export function bulkReopenDefects(
  client: AllureApiClient,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/defect/bulk/reopen", body);
}

export function bulkRemoveDefects(
  client: AllureApiClient,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/defect/bulk/remove", body);
}

export function bulkLinkDefectToResults(
  client: AllureApiClient,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/testresult/bulk/defect/link", body);
}

export function linkIssueToDefect(
  client: AllureApiClient,
  defectId: number,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post(`/api/defect/${defectId}/issue`, body);
}

export function unlinkIssueFromDefect(
  client: AllureApiClient,
  defectId: number,
): Promise<unknown> {
  return client.delete(`/api/defect/${defectId}/issue`);
}

export function createIssueFromDefect(
  client: AllureApiClient,
  defectId: number,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post(`/api/defect/${defectId}/createissue`, body);
}

export function applyDefectMatchersToLaunch(
  client: AllureApiClient,
  launchId: number,
): Promise<unknown> {
  return client.post(`/api/launch/${launchId}/defect/apply`);
}
