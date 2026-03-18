import type { AllureApiClient } from "../client.js";

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined>;

export function listDashboards(
  client: AllureApiClient,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/dashboard", query);
}

export function createDashboard(
  client: AllureApiClient,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post("/api/dashboard", body);
}

export function getDashboard(
  client: AllureApiClient,
  id: number,
): Promise<unknown> {
  return client.get(`/api/dashboard/${id}`);
}

export function updateDashboard(
  client: AllureApiClient,
  id: number,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.patch(`/api/dashboard/${id}`, body);
}

export function deleteDashboard(
  client: AllureApiClient,
  id: number,
): Promise<unknown> {
  return client.delete(`/api/dashboard/${id}`);
}

export function copyDashboard(
  client: AllureApiClient,
  id: number,
  body: Record<string, unknown>,
): Promise<unknown> {
  return client.post(`/api/dashboard/${id}/copy`, body);
}

export function getWidgetData(
  client: AllureApiClient,
  widgetId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/widget/${widgetId}/data`, query);
}
