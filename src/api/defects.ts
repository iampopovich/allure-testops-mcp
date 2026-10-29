import type { AllureApiClient } from "../client.js";
import type { PageDto } from "../types/entities.js";

type QueryParams = Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;

export function listDefects(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<PageDto<Record<string, unknown>>> {
  return client.get("/api/defect", { projectId, ...query });
}

export function getDefect(client: AllureApiClient, id: number): Promise<Record<string, unknown>> {
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
): Promise<PageDto<Record<string, unknown>>> {
  return client.get(`/api/defect/${id}/testresult`, query);
}

export function getDefectTestCases(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<PageDto<Record<string, unknown>>> {
  return client.get(`/api/defect/${id}/testcase`, query);
}

export function getDefectLaunches(
  client: AllureApiClient,
  id: number,
  query: QueryParams,
): Promise<PageDto<Record<string, unknown>>> {
  return client.get(`/api/defect/${id}/launch`, query);
}

export function getLaunchDefects(
  client: AllureApiClient,
  launchId: number,
  query: QueryParams,
): Promise<PageDto<Record<string, unknown>>> {
  return client.get(`/api/launch/${launchId}/defect`, query);
}

export function matchDefects(
  client: AllureApiClient,
  query: QueryParams,
): Promise<unknown> {
  return client.get("/api/testresult/defect/match", query);
}

export function listDefectMatchers(
  client: AllureApiClient,
  defectId: number,
  query: QueryParams = {},
): Promise<PageDto<{ id?: number; name?: string; messageRegex?: string; traceRegex?: string }>> {
  return client.get(`/api/defect/${defectId}/matcher`, query);
}

/** DefectBulkDto: `{ projectId, selection: ListSelectionDto }` — the shape the Defects page bulk actions send. */
function defectBulkBody(projectId: number, defectIds: number[]): Record<string, unknown> {
  return {
    projectId,
    selection: { inverted: false, ids: defectIds, kind: "ListSelectionDto", projectId },
  };
}

export function bulkCloseDefects(
  client: AllureApiClient,
  projectId: number,
  defectIds: number[],
): Promise<unknown> {
  return client.post("/api/defect/bulk/close", defectBulkBody(projectId, defectIds));
}

export function bulkReopenDefects(
  client: AllureApiClient,
  projectId: number,
  defectIds: number[],
): Promise<unknown> {
  return client.post("/api/defect/bulk/reopen", defectBulkBody(projectId, defectIds));
}

export function bulkRemoveDefects(
  client: AllureApiClient,
  projectId: number,
  defectIds: number[],
): Promise<unknown> {
  return client.post("/api/defect/bulk/remove", defectBulkBody(projectId, defectIds));
}

/**
 * TestResultBulkEntityIdsDto: `ids` are the DEFECT ids, the test results are selected through a
 * launch-scoped tree selection (`leafsInclude` = test result ids).
 */
export function bulkLinkDefectToResults(
  client: AllureApiClient,
  args: { projectId: number; launchId: number; defectId: number; testResultIds: number[] },
): Promise<unknown> {
  return client.post("/api/testresult/bulk/defect/link", {
    ids: [args.defectId],
    selection: {
      kind: "TreeSelectionDto",
      projectId: args.projectId,
      launchId: args.launchId,
      inverted: false,
      leafsInclude: args.testResultIds,
      leafsExclude: [],
      groupsInclude: [],
      groupsExclude: [],
      path: [],
    },
  });
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
