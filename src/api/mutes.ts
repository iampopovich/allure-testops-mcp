import type { AllureApiClient } from "../client.js";

type QueryParams = Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;

export function listMutes(
  client: AllureApiClient,
  testCaseId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/mute", { testCaseId, ...query });
}

export function createMute(
  client: AllureApiClient,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/mute", body);
}

export function deleteMute(client: AllureApiClient, id: number): Promise<unknown> {
  return client.delete(`/api/mute/${id}`);
}

export function getMutedTestCases(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/testcase/muted", { projectId, ...query });
}

export function getLaunchMutedResults(
  client: AllureApiClient,
  launchId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/launch/${launchId}/muted`, query);
}

export function muteTestResult(
  client: AllureApiClient,
  id: number,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post(`/api/testresult/${id}/mute`, body);
}

export function unmuteTestResult(
  client: AllureApiClient,
  id: number,
): Promise<unknown> {
  return client.post(`/api/testresult/${id}/unmute`);
}

export function bulkMuteTestResults(
  client: AllureApiClient,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/testresult/bulk/mute", body);
}

export function bulkUnmuteTestResults(
  client: AllureApiClient,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/testresult/bulk/unmute", body);
}
