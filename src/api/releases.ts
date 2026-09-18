import type { AllureApiClient } from "../client.js";

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined>;

export function listReleases(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/release", {
    projectId,
    ...query,
  });
}

export function getRelease(client: AllureApiClient, id: number): Promise<unknown> {
  return client.get(`/api/release/${id}`);
}

export function createRelease(
  client: AllureApiClient,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/release", payload);
}

export function updateRelease(
  client: AllureApiClient,
  id: number,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.patch(`/api/release/${id}`, payload);
}

export function deleteRelease(client: AllureApiClient, id: number): Promise<unknown> {
  return client.delete(`/api/release/${id}`);
}

export function getReleaseStatistic(client: AllureApiClient, id: number): Promise<unknown> {
  return client.get(`/api/release/${id}/statistic`);
}

export function listReleaseDefects(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/release/${id}/defects`, query);
}

export function listReleaseMutedResults(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/release/${id}/muted`, query);
}

export function getReleaseTestCaseTree(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/release/${id}/test-case/tree`, query);
}

export function listReleaseTags(
  client: AllureApiClient,
  releaseId: number,
): Promise<unknown> {
  return client.get(`/api/release/${releaseId}/tag`);
}

export function setReleaseTags(
  client: AllureApiClient,
  releaseId: number,
  tags: Array<Record<string, unknown>>,
): Promise<unknown> {
  return client.post(`/api/release/${releaseId}/tag`, tags);
}

export function addLaunchToRelease(
  client: AllureApiClient,
  releaseId: number,
  launchId: number,
): Promise<unknown> {
  return client.post(`/api/release/${releaseId}/launch/${launchId}`);
}

export function removeLaunchFromRelease(
  client: AllureApiClient,
  releaseId: number,
  launchId: number,
): Promise<unknown> {
  return client.delete(`/api/release/${releaseId}/launch/${launchId}`);
}

export function getReleaseTestCaseSelection(
  client: AllureApiClient,
  releaseId: number,
): Promise<unknown> {
  return client.get(`/api/release/${releaseId}/test-case/selection`);
}

export function updateReleaseTestCaseSelection(
  client: AllureApiClient,
  releaseId: number,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.patch(`/api/release/${releaseId}/test-case/selection`, payload);
}

export function createReleaseFromTestCases(
  client: AllureApiClient,
  projectId: number,
  release: Record<string, unknown>,
  selection: Record<string, unknown> | undefined,
): Promise<unknown> {
  return client.post("/api/test-case/bulk/release/create", {
    release,
    selection: {
      projectId,
      inverted: false,
      ...selection,
    },
  });
}

export function listReleaseStatuses(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/project/release-status", {
    projectId,
    ...query,
  });
}

export function listReleaseWorkflows(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/project/release-workflow", {
    projectId,
    ...query,
  });
}
