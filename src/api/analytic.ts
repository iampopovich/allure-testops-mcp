import type { AllureApiClient } from "../client.js";

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined>;

export function getAutomationChart(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/analytic/${projectId}/automation_chart`, query);
}

export function getGroupByAutomation(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/analytic/${projectId}/group_by_automation`, query);
}

export function getGroupByStatus(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/analytic/${projectId}/group_by_status`, query);
}

export function getLaunchDurationHistogram(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/analytic/${projectId}/launch_duration_histogram`, query);
}

export function getMuteTrend(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/analytic/${projectId}/mute_trend`, query);
}

export function getStatisticTrend(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/analytic/${projectId}/statistic_trend`, query);
}

export function getTcLastResult(
  client: AllureApiClient,
  projectId: number,
): Promise<unknown> {
  return client.get(`/api/analytic/${projectId}/tc_last_result`);
}

export function getTcSuccessRate(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<unknown> {
  return client.get(`/api/analytic/${projectId}/tc_success_rate`, query);
}
