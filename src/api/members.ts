import type { AllureApiClient } from "../client.js";

type QueryParams = Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;

export function suggestUsers(
  client: AllureApiClient,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/user/suggest", query);
}

export function getProjectCollaborators(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/project/access/${projectId}/collaborator`, query);
}

export function getLaunchMemberStats(
  client: AllureApiClient,
  launchId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/launch/${launchId}/memberstats`, query);
}

export function getTestCaseMembers(
  client: AllureApiClient,
  testCaseId: number,
): Promise<unknown> {
  return client.get(`/api/testcase/${testCaseId}/members`);
}

export function getTestResultMembers(
  client: AllureApiClient,
  testResultId: number,
): Promise<unknown> {
  return client.get(`/api/testresult/${testResultId}/members`);
}
