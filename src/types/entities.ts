/**
 * Shared response types for the Allure TestOps API.
 *
 * These are partial/minimal — they only declare the fields
 * the code actually accesses. The API may return additional
 * fields that are safe to ignore at runtime.
 */

// ─── Generic paginated response ──────────────────────────────────────────────

/** Wrapper returned by most list/search endpoints. */
export interface PageDto<T> {
  content?: T[];
  totalElements?: number;
  totalPages?: number;
  number?: number;
  size?: number;
}

// ─── Project ─────────────────────────────────────────────────────────────────

export interface ProjectSuggestDto {
  id?: number;
  name?: string;
}

export interface ProjectSuggestResponse {
  content?: ProjectSuggestDto[];
}

// ─── Custom fields ───────────────────────────────────────────────────────────

export interface CustomFieldDto {
  id?: number;
  name?: string;
}

export interface CustomFieldRowDto {
  customField?: CustomFieldDto;
}

export interface CustomFieldValueDto {
  id?: number;
  name?: string;
}

// ─── Test case steps (scenario) ──────────────────────────────────────────────

export interface ScenarioStepDto {
  id?: number;
  name?: string;
  body?: string;
  expectedResult?: string;
  children?: number[];
  sharedStepId?: number;
  parentId?: number;
  /** ID of the expected-result wrapper child (if the step has one). */
  expectedResultId?: number;
  /** Internal marker for expected-result wrapper nodes (read-only). */
  _wrapper?: boolean;
}

export interface StepExpectedResultWrapper {
  expectedResultId?: number;
}

export interface TestCaseStepsResponse {
  scenarioSteps?: Record<string, ScenarioStepDto>;
  root?: ScenarioStepDto;
}

// ─── Step creation / expected-result ─────────────────────────────────────────

export interface CreateStepResponse {
  createdStepId?: number;
  scenario?: {
    scenarioSteps?: Record<string, StepExpectedResultWrapper>;
  };
}

export interface SetExpectedResultResponse {
  scenarioSteps?: Record<string, StepExpectedResultWrapper>;
}

// ─── Attachments ─────────────────────────────────────────────────────────────

export interface AttachmentDto {
  id?: number;
  name?: string;
  contentType?: string;
  contentLength?: number;
}

/** Raw binary attachment content (from client.getRaw). */
export interface AttachmentContentDto {
  contentType: string;
  content: string;
  encoding: string;
}
