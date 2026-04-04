import type { AllureApiClient } from "../client.js";

type QueryParams = Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;

export function listEnvVars(
  client: AllureApiClient,
): Promise<unknown> {
  return client.get("/api/ev");
}

export function suggestEnvVars(
  client: AllureApiClient,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/ev/suggest", query);
}

export function getEnvVar(
  client: AllureApiClient,
  id: number,
): Promise<unknown> {
  return client.get(`/api/ev/${id}`);
}

export function listEnvVarSchemas(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/evschema", { projectId, ...query });
}

export function listEnvVarValues(
  client: AllureApiClient,
  envVarId: number,
): Promise<unknown> {
  return client.get("/api/evv", { envVarId });
}

export function suggestEnvVarValues(
  client: AllureApiClient,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/evv/suggest", query);
}

export function getTestResultEnvVars(
  client: AllureApiClient,
  testResultId: number,
): Promise<unknown> {
  return client.get(`/api/testresult/${testResultId}/evv`);
}
