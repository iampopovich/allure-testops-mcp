import type { AllureApiClient } from "../client.js";
import type { ProjectSuggestDto, ProjectSuggestResponse } from "../types/entities.js";
export type ToolArgs = Record<string, unknown>;

/**
 * Shared AQL (Allure Query Language) reference — used by search_test_cases,
 * search_test_results, and search_launches to avoid duplicating the full
 * AQL syntax in every tool description.
 *
 * Full AQL docs: https://docs.qameta.io/reference/aql/
 */
export const AQL_SYNTAX =
  "AQL (Allure Query Language) filter expression. " +
  "This tool has no 'query' field — the filter goes in 'rql'. For plain keyword/name search, use find_test_cases instead. " +
  "Operators: = != ~= (contains) > < >= <= in [...] and or not, plus '= null' / 'is null' for empty fields. " +
  "IMPORTANT: 'not in' is written as 'not field in [...]', NOT 'field not in [...]'. " +
  "IMPORTANT: 'and' has higher precedence than 'or' — parenthesize explicitly when mixing them, e.g. '(a = \"x\" or a = \"y\") and b = true'. " +
  "Dates use 13-digit Unix ms timestamps. " +
  "Full syntax: https://docs.qameta.io/reference/aql/ — glossary: docs/usages/aql-reference.md";

export function asObject(args: unknown): ToolArgs {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }
  return args as ToolArgs;
}


export function getRequiredNumber(args: ToolArgs, key: string): number {
  const value = args[key];
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`"${key}" must be a number.`);
  }
  return value;
}

export function getOptionalNumber(args: ToolArgs, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`"${key}" must be a number when provided.`);
  }
  return value;
}

export function getRequiredString(args: ToolArgs, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`"${key}" must be a non-empty string.`);
  }
  return value;
}

export function getOptionalString(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`"${key}" must be a string when provided.`);
  }
  return value;
}

export function getOptionalBoolean(args: ToolArgs, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`"${key}" must be a boolean when provided.`);
  }
  return value;
}

export function getOptionalStringArray(
  args: ToolArgs,
  key: string,
): string[] | undefined {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`"${key}" must be an array of strings when provided.`);
  }
  return value;
}


export function getRequiredId(args: ToolArgs, key = "id"): number {
  return getRequiredNumber(args, key);
}

export async function resolveProjectId(
  args: ToolArgs,
  client: AllureApiClient,
): Promise<number> {
  const explicitProjectId = getOptionalNumber(args, "projectId");
  if (explicitProjectId !== undefined) {
    return explicitProjectId;
  }

  const projectName = getOptionalString(args, "projectName");
  if (projectName !== undefined) {
    if (projectName.trim().length === 0) {
      throw new Error("\"projectName\" must be a non-empty string when provided.");
    }

    const suggestResponse = await client.get<ProjectSuggestResponse>(
      "/api/project/suggest",
      { query: projectName },
    );

    const projects = Array.isArray(suggestResponse?.content)
      ? suggestResponse.content
      : [];

    const exactMatch = projects.find(
      (project) =>
        typeof project.name === "string" &&
        typeof project.id === "number" &&
        project.name.toLowerCase() === projectName.toLowerCase(),
    );

    if (!exactMatch || typeof exactMatch.id !== "number") {
      throw new Error(
        `Project "${projectName}" not found. Pass "projectId" explicitly or use an exact project name.`,
      );
    }

    return exactMatch.id;
  }

  if (client.defaultProjectId !== undefined) {
    return client.defaultProjectId;
  }

  throw new Error(
    "Project scope is required. Pass \"projectId\" or \"projectName\", or set ALLURE_PROJECT_ID in env.",
  );
}

export function getObjectPayload(
  args: ToolArgs,
  key = "payload",
): Record<string, unknown> {
  const payload = args[key];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`"${key}" must be an object.`);
  }
  return payload as Record<string, unknown>;
}

export function ensureProjectIdInPayload(
  payload: Record<string, unknown>,
  client: AllureApiClient,
): Record<string, unknown> {
  if (payload.projectId !== undefined) {
    return payload;
  }
  if (client.defaultProjectId !== undefined) {
    return { ...payload, projectId: client.defaultProjectId };
  }
  return payload;
}

export function getOptionalObjectPayload(
  args: ToolArgs,
  key = "payload",
): Record<string, unknown> | undefined {
  const payload = args[key];
  if (payload === undefined) {
    return undefined;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`"${key}" must be an object when provided.`);
  }
  return payload as Record<string, unknown>;
}

type QueryValue = string | number | boolean | Array<string | number | boolean>;
type QueryParams = Record<string, QueryValue | undefined>;

export function pickPagination(args: ToolArgs): QueryParams {
  return {
    page: getOptionalNumber(args, "page"),
    size: getOptionalNumber(args, "size"),
    sort: getOptionalStringArray(args, "sort"),
  };
}
