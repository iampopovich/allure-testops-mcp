import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AllureApiClient } from "../client.js";
import * as api from "../api/exports.js";
import { getLaunch } from "../api/launches.js";
import { fetchAllPages } from "../api/pagination.js";
import { searchTestCases } from "../api/test-cases.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, coerceArray, coerceInt, idSchema, projectIdSchema, projectNameSchema } from "./schema.js";
import { resolveProjectId } from "./utils.js";

/** Inline CSV above this size is truncated; pass savePath for the full file. */
const MAX_INLINE_CSV_CHARS = 50_000;

const BACKUP_NOTE =
  "For a full project backup (JSON with scenarios, attachments, shared steps, test plans) and restore, use the CLI " +
  "`allure-testops-backup dump|restore` instead of calling tools in a loop. See MCP resource allure://guides/user-flows.";

const outputFields = {
  savePath: z.string().optional().describe(
    "Local file path to write the CSV to (directories are created). Without it the CSV text is returned inline " +
    `and truncated after ${MAX_INLINE_CSV_CHARS} characters.`,
  ),
  columnSeparator: z.string().optional().describe('CSV column separator. Default ";" (as in the UI).'),
};

const exportTestCasesCsv = zodTool("export_test_cases_csv",
  "Export test cases with Allure's native CSV export (UI: select test cases → Export → CSV, every column). " +
  "The export is asynchronous: POST /api/v2/test-case/bulk/export/csv → poll GET /api/export/{id} until ready → download. " +
  "Columns: allure_id, name, full_name, automated, description, precondition, expected_result, status, scenario (indented step tree with expected results and shared steps), " +
  "tag, link, parameter, one column per custom field and per role. Issues are not exported (they need an integration id).\n" +
  "Selection: testCaseIds, or rql (resolved to ids first), or neither = every test case of the project. " +
  "The CSV can be imported back in the UI (Test cases → Import → CSV). " + BACKUP_NOTE,
  z.object({
    projectId: projectIdSchema.optional(),
    projectName: projectNameSchema.optional(),
    testCaseIds: coerceArray(coerceInt()).optional().describe("Test case IDs to export."),
    rql: z.string().optional().describe('AQL filter for the test cases to export, e.g. tag = "smoke".'),
    ...outputFields,
  }),
);

const exportLaunchCsv = zodTool("export_launch_csv",
  "Export every test result of a launch with Allure's native CSV export (UI: launch ⋯ → Export → CSV). " +
  "Asynchronous: POST /api/export/testresult/csv → poll GET /api/export/{id} → download. Columns include status, start/stop/duration, " +
  "message, test_case_id, layer, scenario, tags, links, custom fields and roles.",
  z.object({ launchId: idSchema("Launch"), ...outputFields }),
);

/** Counts CSV data records (header excluded); quoted cells such as `scenario` contain line breaks. */
export function countCsvRows(csv: string): number {
  let records = 0;
  let inQuotes = false;
  let recordHasContent = false;
  for (const char of csv) {
    if (char === '"') inQuotes = !inQuotes;
    if (char === "\n" && !inQuotes) {
      if (recordHasContent) records += 1;
      recordHasContent = false;
    } else if (char !== "\r") {
      recordHasContent = true;
    }
  }
  if (recordHasContent) records += 1;
  return Math.max(0, records - 1);
}

async function deliver(result: api.CsvExportResult, savePath: string | undefined) {
  const rows = countCsvRows(result.csv);
  if (savePath) {
    const path = resolve(savePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, result.csv, "utf-8");
    return { exportId: result.exportId, fileName: result.fileName, savedTo: path, bytes: Buffer.byteLength(result.csv), rows };
  }
  const truncated = result.csv.length > MAX_INLINE_CSV_CHARS;
  return {
    exportId: result.exportId,
    fileName: result.fileName,
    rows,
    truncated,
    ...(truncated ? { note: "CSV truncated; pass savePath to get the full file." } : {}),
    csv: truncated ? result.csv.slice(0, MAX_INLINE_CSV_CHARS) : result.csv,
  };
}

export function createExportTools(client: AllureApiClient): ToolBundle {
  return {
    tools: [exportTestCasesCsv.definition, exportLaunchCsv.definition],
    handlers: {
      export_test_cases_csv: async (rawArgs: unknown) => {
        const args = exportTestCasesCsv.parse(rawArgs);
        const projectId = await resolveProjectId(args, client);
        let testCaseIds = args.testCaseIds;
        if (!testCaseIds && args.rql) {
          const rql = args.rql;
          const found = await fetchAllPages((page, size) => searchTestCases(client, projectId, rql, { page, size }));
          testCaseIds = found.map((tc) => tc.id).filter((id): id is number => typeof id === "number");
          if (testCaseIds.length === 0) throw new Error(`No test cases match rql: ${rql}`);
        }
        const columns = await api.loadExportColumns(client, projectId);
        const result = await api.exportTestCasesCsv(client, projectId, {
          testCaseIds,
          columnSeparator: args.columnSeparator,
          ...columns,
        });
        return deliver(result, args.savePath);
      },
      export_launch_csv: async (rawArgs: unknown) => {
        const args = exportLaunchCsv.parse(rawArgs);
        const launch = await getLaunch(client, args.launchId);
        const projectId = typeof launch.projectId === "number" ? launch.projectId : undefined;
        const columns = projectId !== undefined ? await api.loadExportColumns(client, projectId) : {};
        const result = await api.exportLaunchCsv(client, args.launchId, { columnSeparator: args.columnSeparator, ...columns });
        return deliver(result, args.savePath);
      },
    },
  };
}
