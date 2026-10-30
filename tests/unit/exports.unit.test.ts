import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildExportMapping, exportLaunchCsv, exportTestCasesCsv, waitForExport } from "../../src/api/exports.js";
import { countCsvRows, createExportTools } from "../../src/tools/exports.js";

const CSV = "allure_id;name\n1;Login\n2;Logout\n";

function exportClient(statuses: string[] = ["queued", "ready"]) {
  const queue = [...statuses];
  return {
    defaultProjectId: 7,
    get: vi.fn(async (path: string) => {
      if (path === "/api/export/testcase/csv/mapping") return ["allure_id", "name", "scenario", "tag", "custom_field", "role", "issue_integration", "example"];
      if (path === "/api/export/testresult/csv/mapping") return ["allure_id", "status"];
      if (path === "/api/export/5") return { id: 5, name: "test-cases.csv", status: queue.shift() ?? "ready" };
      if (path === "/api/project/7/cf") return { content: [{ customField: { id: -2, name: "Feature" } }] };
      if (path === "/api/role") return [{ id: -1, name: "Owner" }];
      if (path === "/api/launch/3") return { id: 3, projectId: 7 };
      if (path === "/api/testcase/__search") return { content: [{ id: 11 }, { id: 12 }], totalPages: 1 };
      throw new Error(`unexpected GET ${path}`);
    }),
    post: vi.fn(async () => ({ id: 5, name: "test-cases.csv", status: "queued" })),
    getRaw: vi.fn(async () => ({ contentType: "text/csv", content: Buffer.from(CSV).toString("base64"), encoding: "base64" })),
  };
}

const noSleep = async () => undefined;

describe("native CSV export", () => {
  it("buildExportMapping expands custom fields and roles and skips columns that need ids", () => {
    const mapping = buildExportMapping(["allure_id", "scenario", "tag", "custom_field", "role", "issue_integration", "example"], {
      customFields: [{ id: -2, name: "Feature" }, { id: 4, name: "Team" }],
      roles: [{ id: -1, name: "Owner" }],
    });
    expect(mapping).toEqual([
      { field: "allure_id", name: "allure_id" },
      { field: "scenario", name: "scenario", stepsSeparator: "\n", stepsIndent: "\t" },
      { field: "tag", name: "tag", itemsSeparator: "," },
      { field: "custom_field", name: "Feature", customFieldId: -2, itemsSeparator: "," },
      { field: "custom_field", name: "Team", customFieldId: 4, itemsSeparator: "," },
      { field: "role", name: "Owner", roleId: -1, itemsSeparator: "," },
    ]);
  });

  it("exportTestCasesCsv starts the export, polls until ready and decodes the file", async () => {
    const client = exportClient(["queued", "queued", "ready"]);
    const result = await exportTestCasesCsv(client as never, 7, { testCaseIds: [1, 2], sleep: noSleep });

    expect(client.post).toHaveBeenCalledWith("/api/v2/test-case/bulk/export/csv", expect.objectContaining({
      columnSeparator: ";",
      withHeaders: true,
      selection: expect.objectContaining({ projectId: 7, inverted: false, testCasesInclude: [1, 2] }),
    }));
    expect(client.get.mock.calls.filter(([path]) => path === "/api/export/5")).toHaveLength(3);
    expect(client.getRaw).toHaveBeenCalledWith("/api/export/download/5");
    expect(result).toEqual({ exportId: 5, fileName: "test-cases.csv", csv: CSV });
  });

  it("exportTestCasesCsv without ids selects the whole project (inverted selection)", async () => {
    const client = exportClient();
    await exportTestCasesCsv(client as never, 7, { sleep: noSleep });
    const body = client.post.mock.calls[0][1] as { selection: { inverted: boolean; testCasesInclude: number[] } };
    expect(body.selection).toMatchObject({ inverted: true, testCasesInclude: [] });
  });

  it("exportLaunchCsv selects every result of the launch", async () => {
    const client = exportClient();
    await exportLaunchCsv(client as never, 3, { sleep: noSleep });
    expect(client.post).toHaveBeenCalledWith("/api/export/testresult/csv", expect.objectContaining({
      selection: expect.objectContaining({ launchId: 3, inverted: true, leafsInclude: [] }),
    }));
  });

  it("waitForExport throws on failed status and on timeout", async () => {
    const failed = { get: vi.fn(async () => ({ id: 9, status: "failed", errorMessage: "boom" })) };
    await expect(waitForExport(failed as never, 9, { sleep: noSleep })).rejects.toThrow("Export 9 failed: boom");

    const stuck = { get: vi.fn(async () => ({ id: 9, status: "queued" })) };
    await expect(waitForExport(stuck as never, 9, { timeoutMs: 0, sleep: noSleep })).rejects.toThrow(/still "queued"/);
  });
});

describe("export MCP tools", () => {
  it("export_test_cases_csv resolves rql to ids and returns the CSV inline", async () => {
    const client = exportClient();
    const tools = createExportTools(client as never);

    const result = await tools.handlers.export_test_cases_csv({ rql: 'tag = "smoke"' }) as { csv: string; truncated: boolean };

    const body = client.post.mock.calls[0][1] as { selection: { testCasesInclude: number[] }; mapping: Array<{ name: string }> };
    expect(body.selection.testCasesInclude).toEqual([11, 12]);
    expect(body.mapping.map((m) => m.name)).toContain("Feature");
    expect(result).toMatchObject({ exportId: 5, truncated: false, csv: CSV });
  });

  it("export_test_cases_csv writes the file when savePath is given", async () => {
    const dir = await mkdtemp(join(tmpdir(), "allure-export-"));
    try {
      const client = exportClient();
      const path = join(dir, "nested", "cases.csv");
      const result = await createExportTools(client as never).handlers.export_test_cases_csv({ savePath: path });
      expect(result).toMatchObject({ savedTo: path, rows: 2 });
      expect(await readFile(path, "utf-8")).toBe(CSV);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("countCsvRows ignores line breaks inside quoted cells", () => {
    expect(countCsvRows('id;scenario\r\n1;"[step 1] A\n\t[step 1.1] B"\r\n2;plain\r\n')).toBe(2);
    expect(countCsvRows("id;name\n")).toBe(0);
  });

  it("export_launch_csv uses the launch's project for custom field columns", async () => {
    const client = exportClient();
    await createExportTools(client as never).handlers.export_launch_csv({ launchId: 3 });
    expect(client.get).toHaveBeenCalledWith("/api/launch/3");
    expect(client.get).toHaveBeenCalledWith("/api/project/7/cf", { size: 1000 });
  });
});
