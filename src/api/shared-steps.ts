import type { AllureApiClient } from "../client.js";

type QueryParams = Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;

export function listSharedSteps(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/sharedstep", { projectId, ...query });
}

export function getSharedStep(
  client: AllureApiClient,
  id: number,
): Promise<unknown> {
  return client.get(`/api/sharedstep/${id}`);
}

export function getSharedStepSteps(
  client: AllureApiClient,
  id: number,
): Promise<unknown> {
  return client.get(`/api/sharedstep/${id}/step`);
}

export function getSharedStepUsage(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/sharedstep/${id}/usage`, query);
}

export function createSharedStep(
  client: AllureApiClient,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/sharedstep", body);
}

export function updateSharedStep(
  client: AllureApiClient,
  id: number,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.patch(`/api/sharedstep/${id}`, body);
}

export function deleteSharedStep(
  client: AllureApiClient,
  id: number,
): Promise<unknown> {
  return client.delete(`/api/sharedstep/${id}`);
}

export function archiveSharedStep(
  client: AllureApiClient,
  id: number,
): Promise<unknown> {
  return client.post(`/api/sharedstep/${id}/archive`);
}

export function unarchiveSharedStep(
  client: AllureApiClient,
  id: number,
): Promise<unknown> {
  return client.post(`/api/sharedstep/${id}/unarchive`);
}
