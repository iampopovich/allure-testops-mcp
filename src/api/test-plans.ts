import type { AllureApiClient } from "../client.js";
import type { PageDto } from "../types/entities.js";

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined>;

export function listTestPlans(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<PageDto<Record<string, unknown>>> {
  return client.get("/api/testplan", {
    projectId,
    ...query,
  });
}

export function getTestPlan(client: AllureApiClient, id: number): Promise<Record<string, unknown>> {
  return client.get(`/api/testplan/${id}`);
}

export function createTestPlan(
  client: AllureApiClient,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/testplan", payload);
}

export function updateTestPlan(
  client: AllureApiClient,
  id: number,
  payload: Record<string, unknown>,
): Promise<unknown> {
  return client.patch(`/api/testplan/${id}`, payload);
}

export function deleteTestPlan(client: AllureApiClient, id: number): Promise<unknown> {
  return client.delete(`/api/testplan/${id}`);
}

export function runTestPlan(
  client: AllureApiClient,
  id: number,
  payload: Record<string, unknown> | undefined,
): Promise<unknown> {
  return client.post(`/api/testplan/${id}/run`, payload);
}
