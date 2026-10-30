import type { AllureApiClient } from "../client.js";
import type { AttachmentContentDto, CustomFieldRowDto, PageDto } from "../types/entities.js";

export type ExportStatus = "queued" | "failed" | "ready";

export interface ExportRequestDto {
  id: number;
  name?: string;
  status?: ExportStatus;
  errorMessage?: string;
  type?: string;
  projectId?: number;
}

export interface ExportFieldMapping {
  field: string;
  name: string;
  [key: string]: unknown;
}

export interface NamedRef {
  id: number;
  name: string;
}

export interface CsvExportResult {
  exportId: number;
  fileName: string;
  csv: string;
}

const ITEMS_SEPARATOR = ",";

export function getTestCaseExportFields(client: AllureApiClient): Promise<string[]> {
  return client.get("/api/export/testcase/csv/mapping");
}

export function getTestResultExportFields(client: AllureApiClient): Promise<string[]> {
  return client.get("/api/export/testresult/csv/mapping");
}

export function getExportRequest(client: AllureApiClient, id: number): Promise<ExportRequestDto> {
  return client.get(`/api/export/${id}`);
}

export function downloadExport(client: AllureApiClient, id: number): Promise<AttachmentContentDto> {
  return client.getRaw(`/api/export/download/${id}`);
}

/**
 * Builds the column mapping the UI sends ("Customize export" with every column on).
 * Some fields expand per entity: one column per custom field (`customFieldId`) and per role (`roleId`).
 * `issue_integration` needs an integration id and `example` has no flat form, so both are skipped.
 */
export function buildExportMapping(
  fields: string[],
  extras: { customFields?: NamedRef[]; roles?: NamedRef[] } = {},
): ExportFieldMapping[] {
  const mapping: ExportFieldMapping[] = [];
  for (const field of fields) {
    switch (field) {
      case "issue_integration":
      case "example":
        break;
      case "custom_field":
        for (const cf of extras.customFields ?? []) {
          mapping.push({ field, name: cf.name, customFieldId: cf.id, itemsSeparator: ITEMS_SEPARATOR });
        }
        break;
      case "role":
        for (const role of extras.roles ?? []) {
          mapping.push({ field, name: role.name, roleId: role.id, itemsSeparator: ITEMS_SEPARATOR });
        }
        break;
      case "scenario":
        mapping.push({ field, name: field, stepsSeparator: "\n", stepsIndent: "\t" });
        break;
      case "tag":
      case "link":
      case "parameter":
        mapping.push({ field, name: field, itemsSeparator: ITEMS_SEPARATOR });
        break;
      default:
        mapping.push({ field, name: field });
    }
  }
  return mapping;
}

/** Polls `GET /api/export/{id}` until the export is `ready` (throws on `failed` or timeout). */
export async function waitForExport(
  client: AllureApiClient,
  id: number,
  options: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ExportRequestDto> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const request = await getExportRequest(client, id);
    if (request.status === "ready") return request;
    if (request.status === "failed") {
      throw new Error(`Export ${id} failed: ${request.errorMessage ?? "no error message"}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Export ${id} is still "${request.status ?? "unknown"}" after ${timeoutMs} ms.`);
    }
    await sleep(intervalMs);
  }
}

async function finishExport(
  client: AllureApiClient,
  started: ExportRequestDto,
  options: { timeoutMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<CsvExportResult> {
  const ready = await waitForExport(client, started.id, options);
  const file = await downloadExport(client, started.id);
  return {
    exportId: started.id,
    fileName: ready.name ?? started.name ?? `export-${started.id}.csv`,
    csv: Buffer.from(file.content, "base64").toString("utf-8"),
  };
}

export interface TestCaseCsvExportOptions {
  /** Explicit test case ids; omitted = every test case of the project. */
  testCaseIds?: number[];
  fileName?: string;
  columnSeparator?: string;
  customFields?: NamedRef[];
  roles?: NamedRef[];
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Allure's native test case CSV export: `POST /api/v2/test-case/bulk/export/csv` → poll → download. */
export async function exportTestCasesCsv(
  client: AllureApiClient,
  projectId: number,
  options: TestCaseCsvExportOptions = {},
): Promise<CsvExportResult> {
  const fields = await getTestCaseExportFields(client);
  const ids = options.testCaseIds ?? [];
  const started = await client.post<ExportRequestDto>("/api/v2/test-case/bulk/export/csv", {
    name: options.fileName ?? "test-cases.csv",
    columnSeparator: options.columnSeparator ?? ";",
    withHeaders: true,
    mapping: buildExportMapping(fields, { customFields: options.customFields, roles: options.roles }),
    selection: { projectId, inverted: ids.length === 0, testCasesInclude: ids, testCasesExclude: [], groupsInclude: [], groupsExclude: [] },
  });
  return finishExport(client, started, options);
}

export interface LaunchCsvExportOptions {
  fileName?: string;
  columnSeparator?: string;
  customFields?: NamedRef[];
  roles?: NamedRef[];
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Allure's native launch (test results) CSV export: `POST /api/export/testresult/csv` → poll → download. */
export async function exportLaunchCsv(
  client: AllureApiClient,
  launchId: number,
  options: LaunchCsvExportOptions = {},
): Promise<CsvExportResult> {
  const fields = await getTestResultExportFields(client);
  const started = await client.post<ExportRequestDto>("/api/export/testresult/csv", {
    name: options.fileName ?? `launch-${launchId}.csv`,
    columnSeparator: options.columnSeparator ?? ";",
    withHeaders: true,
    mapping: buildExportMapping(fields, { customFields: options.customFields, roles: options.roles }),
    selection: { launchId, inverted: true, leafsInclude: [], leafsExclude: [], groupsInclude: [], groupsExclude: [], path: [] },
  });
  return finishExport(client, started, options);
}

/** Custom fields and roles of a project, used to expand `custom_field` / `role` export columns. */
export async function loadExportColumns(
  client: AllureApiClient,
  projectId: number,
): Promise<{ customFields: NamedRef[]; roles: NamedRef[] }> {
  const [fields, roles] = await Promise.all([
    client.get<PageDto<CustomFieldRowDto>>(`/api/project/${projectId}/cf`, { size: 1000 }),
    client.get<NamedRef[]>("/api/role"),
  ]);
  const customFields = (fields.content ?? [])
    .map((row) => row.customField)
    .filter((cf): cf is { id: number; name: string } => typeof cf?.id === "number" && typeof cf?.name === "string")
    .map((cf) => ({ id: cf.id, name: cf.name }));
  return { customFields, roles: roles.map((role) => ({ id: role.id, name: role.name })) };
}
