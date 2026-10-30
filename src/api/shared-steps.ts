import type { AllureApiClient } from "../client.js";
import type { AttachmentContentDto, PageDto, TestCaseStepsResponse } from "../types/entities.js";

type QueryParams = Record<string, string | number | boolean | Array<string | number | boolean> | undefined>;

export function listSharedSteps(
  client: AllureApiClient,
  projectId: number,
  query: QueryParams,
): Promise<PageDto<Record<string, unknown>>> {
  return client.get("/api/sharedstep", { projectId, ...query });
}

export function getSharedStep(
  client: AllureApiClient,
  id: number,
): Promise<Record<string, unknown>> {
  return client.get(`/api/sharedstep/${id}`);
}

export function getSharedStepSteps(
  client: AllureApiClient,
  id: number,
): Promise<TestCaseStepsResponse> {
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

/**
 * Adds a step to a shared step the way the UI does (`POST /api/sharedstep/step`).
 * With `withExpectedResult` the API also creates an empty expected-result container; its id is
 * `scenario.sharedStepScenarioSteps[createdStepId].expectedResultId`. ER lines are then added as
 * children of that container (`parentId`).
 */
export function createSharedStepStep(
  client: AllureApiClient,
  payload: { sharedStepId: number; body?: string; bodyJson?: unknown; parentId?: number; attachmentId?: number },
  options: { afterId?: number; withExpectedResult?: boolean } = {},
): Promise<{ createdStepId?: number; scenario?: { sharedStepScenarioSteps?: Record<string, { expectedResultId?: number }> } }> {
  const query: QueryParams = { withExpectedResult: options.withExpectedResult ?? false };
  if (options.afterId !== undefined) query.afterId = options.afterId;
  return client.post("/api/sharedstep/step", payload, query);
}

export function listSharedStepAttachments(
  client: AllureApiClient,
  sharedStepId: number,
): Promise<PageDto<{ id?: number; name?: string; contentType?: string; contentLength?: number }>> {
  return client.get("/api/sharedstep/attachment", { sharedStepId, size: 1000 });
}

export function getSharedStepAttachmentContent(client: AllureApiClient, attachmentId: number): Promise<AttachmentContentDto> {
  return client.getRaw(`/api/sharedstep/attachment/${attachmentId}/content`);
}

export function uploadSharedStepAttachment(
  client: AllureApiClient,
  sharedStepId: number,
  filename: string,
  contentType: string,
  contentBase64: string,
): Promise<Array<{ id?: number }>> {
  const formData = new FormData();
  formData.append("file", new Blob([Buffer.from(contentBase64, "base64")], { type: contentType }), filename);
  return client.postMultipart("/api/sharedstep/attachment", formData, { sharedStepId });
}
