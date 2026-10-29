/**
 * Request-shape tests for the tools fixed after the UI-flow research
 * (docs/research/ui-flows-network-journal.md). Each case pins the exact request the Allure UI sends.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as testCasesApi from "../../src/api/test-cases.js";
import * as testResultsApi from "../../src/api/test-results.js";
import * as defectsApi from "../../src/api/defects.js";
import { createTestCaseTools } from "../../src/tools/test-cases.js";
import { createDefectTools } from "../../src/tools/defects.js";
import { createDashboardTools } from "../../src/tools/dashboards.js";
import { RESOURCES, readResourceContent } from "../../src/resources/index.js";
import { USER_FLOWS_GUIDE } from "../../src/resources/docs/user-flows.js";
import { createMockClient } from "./tool-test-helpers.js";

type Mock = ReturnType<typeof createMockClient>;

/** step 1 has ER container 3 with lines 4,5; step 2 is plain; step 6 is a nested sub-step of 2. */
const scenario = () => ({
  root: { children: [1, 2] },
  scenarioSteps: {
    "1": { id: 1, body: "Open page", expectedResultId: 3 },
    "2": { id: 2, body: "Enter creds", children: [6] },
    "3": { id: 3, body: "Expected Result", children: [4, 5] },
    "4": { id: 4, body: "Old ER 1" },
    "5": { id: 5, body: "Old ER 2" },
    "6": { id: 6, body: "Type user" },
  },
});

let client: Mock;
beforeEach(() => {
  client = createMockClient(1);
});

describe("create_test_case_step", () => {
  it("creates the ER container and one line per entry, in order", async () => {
    client.post
      .mockResolvedValueOnce({ createdStepId: 10, scenario: { scenarioSteps: { "10": { expectedResultId: 11 } } } })
      .mockResolvedValueOnce({ createdStepId: 12, scenario: {} })
      .mockResolvedValueOnce({ createdStepId: 13, scenario: { scenarioSteps: {} } });

    const result = await testCasesApi.createTestCaseStep(client as never, { testCaseId: 7, body: "Click" }, {
      expectedResult: "A; B", afterId: 2,
    });

    expect(client.post).toHaveBeenNthCalledWith(1, "/api/testcase/step",
      { testCaseId: 7, body: "Click", expectedResultId: -1 }, { afterId: 2, withExpectedResult: true });
    expect(client.post).toHaveBeenNthCalledWith(2, "/api/testcase/step",
      { testCaseId: 7, parentId: 11, body: "A" }, undefined);
    expect(client.post).toHaveBeenNthCalledWith(3, "/api/testcase/step",
      { testCaseId: 7, parentId: 11, body: "B" }, { afterId: 12 });
    expect(result).toMatchObject({ createdStepId: 10, expectedResultId: 11 });
  });

  it("never sends the unsupported expectedResult field and passes position for plain steps", async () => {
    client.post.mockResolvedValueOnce({ createdStepId: 10 });
    await testCasesApi.createTestCaseStep(client as never, { testCaseId: 7, body: "Click" }, { beforeId: 1 });
    expect(client.post).toHaveBeenCalledWith("/api/testcase/step", { testCaseId: 7, body: "Click" }, { beforeId: 1 });
  });

  it("handler rejects a step without body and sharedStepId", async () => {
    const bundle = createTestCaseTools(client as never);
    await expect(bundle.handlers.create_test_case_step({ testCaseId: 7 })).rejects.toThrow(/body/);
  });
});

describe("update_test_case_step", () => {
  it("text-only edit keeps the existing expected result", async () => {
    client.get.mockResolvedValueOnce(scenario());
    await testCasesApi.updateTestCaseStep(client as never, 7, 1, { body: "Open login page" });
    expect(client.patch).toHaveBeenCalledWith("/api/testcase/step/1",
      { body: "Open login page", expectedResultId: 3 }, { withExpectedResult: true });
  });

  it("text-only edit of a plain step sends withExpectedResult=false", async () => {
    client.get.mockResolvedValueOnce(scenario());
    await testCasesApi.updateTestCaseStep(client as never, 7, 2, { body: "Enter valid creds" });
    expect(client.patch).toHaveBeenCalledWith("/api/testcase/step/2", { body: "Enter valid creds" }, { withExpectedResult: false });
  });

  it("expectedResult replaces all lines: delete old, append new", async () => {
    client.get.mockResolvedValue(scenario());
    client.post.mockResolvedValueOnce({ createdStepId: 20 }).mockResolvedValueOnce({ createdStepId: 21 });
    await testCasesApi.updateTestCaseStep(client as never, 7, 1, { expectedResult: "New A\nNew B" });
    expect(client.delete).toHaveBeenCalledWith("/api/testcase/step/4");
    expect(client.delete).toHaveBeenCalledWith("/api/testcase/step/5");
    expect(client.patch).not.toHaveBeenCalled();
    expect(client.post).toHaveBeenNthCalledWith(1, "/api/testcase/step", { testCaseId: 7, parentId: 3, body: "New A" }, undefined);
    expect(client.post).toHaveBeenNthCalledWith(2, "/api/testcase/step", { testCaseId: 7, parentId: 3, body: "New B" }, { afterId: 20 });
  });

  it("expectedResult on a step without ER creates the container first", async () => {
    client.get.mockResolvedValue(scenario());
    client.patch.mockResolvedValueOnce({ scenarioSteps: { "2": { expectedResultId: 30 } } });
    client.post.mockResolvedValueOnce({ createdStepId: 31 });
    await testCasesApi.updateTestCaseStep(client as never, 7, 2, { expectedResult: "Done" });
    expect(client.patch).toHaveBeenCalledWith("/api/testcase/step/2",
      { body: "Enter creds", expectedResultId: -1 }, { withExpectedResult: true });
    expect(client.post).toHaveBeenCalledWith("/api/testcase/step", { testCaseId: 7, parentId: 30, body: "Done" }, undefined);
  });

  it("empty expectedResult removes the expected result (Convert to step)", async () => {
    client.get.mockResolvedValueOnce(scenario());
    await testCasesApi.updateTestCaseStep(client as never, 7, 1, { expectedResult: "" });
    expect(client.patch).toHaveBeenCalledWith("/api/testcase/step/1", { body: "Open page" }, { withExpectedResult: false });
  });

  it("refuses a body-only edit of an ER container and an unknown step", async () => {
    client.get.mockResolvedValue(scenario());
    await expect(testCasesApi.updateTestCaseStep(client as never, 7, 3, { body: "x" })).rejects.toThrow(/container/);
    await expect(testCasesApi.updateTestCaseStep(client as never, 7, 99, { body: "x" })).rejects.toThrow(/not found/);
  });

  it("handler requires testCaseId", async () => {
    const bundle = createTestCaseTools(client as never);
    await expect(bundle.handlers.update_test_case_step({ stepId: 1, body: "x" })).rejects.toThrow();
  });
});

describe("set_test_case_step_expected_result", () => {
  it("uses the current body when none is given (avoids 400 step.onlyonedetail) and appends after existing lines", async () => {
    client.get.mockResolvedValue(scenario());
    client.post.mockResolvedValueOnce({ createdStepId: 40 });
    await testCasesApi.setStepExpectedResult(client as never, 1, 7, "Third line");
    expect(client.patch).not.toHaveBeenCalled();
    expect(client.post).toHaveBeenCalledWith("/api/testcase/step", { testCaseId: 7, parentId: 3, body: "Third line" }, { afterId: 5 });
  });

  it("creates the container with the current body for a step without ER", async () => {
    client.get.mockResolvedValue(scenario());
    client.patch.mockResolvedValueOnce({ scenarioSteps: { "2": { expectedResultId: 41 } } });
    client.post.mockResolvedValueOnce({ createdStepId: 42 });
    await testCasesApi.setStepExpectedResult(client as never, 2, 7, "Shown");
    expect(client.patch).toHaveBeenCalledWith("/api/testcase/step/2",
      { body: "Enter creds", expectedResultId: -1 }, { withExpectedResult: true });
  });
});

describe("delete_test_case_step / get_test_case_scenario", () => {
  it("deletes a step by id", async () => {
    const bundle = createTestCaseTools(client as never);
    await bundle.handlers.delete_test_case_step({ stepId: 5 });
    expect(client.delete).toHaveBeenCalledWith("/api/testcase/step/5");
  });

  it("reads the normalized step tree instead of the deprecated /scenario endpoint", async () => {
    client.get.mockResolvedValueOnce(scenario());
    await testCasesApi.getTestCaseScenario(client as never, 7);
    expect(client.get).toHaveBeenCalledWith("/api/testcase/7/step");
  });
});

describe("set_test_case_issues", () => {
  it("rejects items without integrationId", async () => {
    const bundle = createTestCaseTools(client as never);
    await expect(bundle.handlers.set_test_case_issues({ testCaseId: 1, payload: [{ name: "JIRA-1" }] }))
      .rejects.toThrow(/integrationId/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("fails when Allure silently stores nothing", async () => {
    client.post.mockResolvedValueOnce([]);
    const bundle = createTestCaseTools(client as never);
    await expect(bundle.handlers.set_test_case_issues({ testCaseId: 1, payload: [{ integrationId: 5, name: "JIRA-1" }] }))
      .rejects.toThrow(/stored no issues/);
  });

  it("allows clearing with an empty list", async () => {
    client.post.mockResolvedValueOnce([]);
    const bundle = createTestCaseTools(client as never);
    await expect(bundle.handlers.set_test_case_issues({ testCaseId: 1, payload: [] })).resolves.toEqual([]);
  });
});

describe("resolve_test_result / update_test_result", () => {
  it("resolve keeps the run steps by sending the current execution back", async () => {
    client.get.mockResolvedValueOnce({ steps: [{ type: "body", body: "Open", status: "passed" }] });
    await testResultsApi.resolveTestResult(client as never, 9, { status: "failed", message: "boom" });
    expect(client.get).toHaveBeenCalledWith("/api/testresult/9/execution", { v2: true });
    expect(client.post).toHaveBeenCalledWith("/api/testresult/9/resolve", {
      status: "failed", message: "boom",
      execution: { status: "failed", steps: [{ type: "body", body: "Open", status: "passed" }] },
    });
  });

  it("resolve passes a caller-provided execution unchanged and requires status", async () => {
    const execution = { status: "passed", steps: [] };
    await testResultsApi.resolveTestResult(client as never, 9, { status: "passed", execution });
    expect(client.get).not.toHaveBeenCalled();
    expect(client.post).toHaveBeenCalledWith("/api/testresult/9/resolve", { status: "passed", execution });
    await expect(testResultsApi.resolveTestResult(client as never, 9, {})).rejects.toThrow(/status/);
  });

  it("update routes status/message through resolve and PATCHes the rest", async () => {
    client.get
      .mockResolvedValueOnce({ id: 9, name: "Old" })
      .mockResolvedValueOnce({ steps: [] });
    await testResultsApi.updateTestResult(client as never, 9, { name: "New", status: "broken", message: "m" });
    expect(client.patch).toHaveBeenCalledWith("/api/testresult/9", { id: 9, name: "New" });
    expect(client.post).toHaveBeenCalledWith("/api/testresult/9/resolve",
      { status: "broken", message: "m", execution: { status: "broken", steps: [] } });
  });

  it("update refuses message without status", async () => {
    await expect(testResultsApi.updateTestResult(client as never, 9, { message: "m" })).rejects.toThrow(/status/);
  });
});

describe("defects", () => {
  it("bulk close/reopen send DefectBulkDto with a ListSelectionDto", async () => {
    const bundle = createDefectTools(client as never);
    await bundle.handlers.bulk_close_defects({ ids: [1, 2] });
    expect(client.post).toHaveBeenCalledWith("/api/defect/bulk/close", {
      projectId: 1, selection: { inverted: false, ids: [1, 2], kind: "ListSelectionDto", projectId: 1 },
    });
    await bundle.handlers.bulk_reopen_defects({ payload: { ids: [3] } });
    expect(client.post).toHaveBeenLastCalledWith("/api/defect/bulk/reopen", {
      projectId: 1, selection: { inverted: false, ids: [3], kind: "ListSelectionDto", projectId: 1 },
    });
  });

  it("link_defect_to_test_results selects results through a launch-scoped tree selection", async () => {
    const bundle = createDefectTools(client as never);
    await bundle.handlers.link_defect_to_test_results({ defectId: 4, testResultIds: [5, 6], launchId: 2 });
    expect(client.post).toHaveBeenCalledWith("/api/testresult/bulk/defect/link", {
      ids: [4],
      selection: {
        kind: "TreeSelectionDto", projectId: 1, launchId: 2, inverted: false,
        leafsInclude: [5, 6], leafsExclude: [], groupsInclude: [], groupsExclude: [], path: [],
      },
    });
    await expect(bundle.handlers.link_defect_to_test_results({ defectId: 4, testResultIds: [5] }))
      .rejects.toThrow(/launchId/);
  });

  it("find_similar_failures requires a regex and can take it from the defect's matcher", async () => {
    const bundle = createDefectTools(client as never);
    client.get
      .mockResolvedValueOnce({ content: [{ name: "r", messageRegex: ".*Timeout.*" }] })
      .mockResolvedValueOnce({ content: [] });
    await bundle.handlers.find_similar_failures({ launchId: 2, defectId: 1 });
    expect(client.get).toHaveBeenNthCalledWith(1, "/api/defect/1/matcher", { size: 100 });
    expect(client.get).toHaveBeenNthCalledWith(2, "/api/testresult/defect/match",
      { launchId: 2, messageRegex: ".*Timeout.*", traceRegex: undefined, page: undefined, size: undefined });

    await expect(bundle.handlers.find_similar_failures({ launchId: 2 })).rejects.toThrow(/Regex/);
    await expect(bundle.handlers.find_similar_failures({ messageRegex: "x" })).rejects.toThrow();
  });

  it("api.bulkRemoveDefects uses the same bulk body", async () => {
    await defectsApi.bulkRemoveDefects(client as never, 3, [9]);
    expect(client.post).toHaveBeenCalledWith("/api/defect/bulk/remove",
      { projectId: 3, selection: { inverted: false, ids: [9], kind: "ListSelectionDto", projectId: 3 } });
  });
});

describe("dashboards", () => {
  it("get_widget_data sends dateFrom/dateTo (the API ignores from/to)", async () => {
    const bundle = createDashboardTools(client as never);
    await bundle.handlers.get_widget_data({ id: 2, dateFrom: "2026-10-20", dateTo: "2026-10-25", offset: 3 });
    expect(client.get).toHaveBeenCalledWith("/api/widget/2/data",
      { dateFrom: "2026-10-20", dateTo: "2026-10-25", offset: 3, page: undefined, size: undefined });

    await bundle.handlers.get_widget_data({ id: 2, from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 9, 5) });
    expect(client.get).toHaveBeenLastCalledWith("/api/widget/2/data",
      expect.objectContaining({ dateFrom: "2026-10-01", dateTo: "2026-10-05" }));
  });

  it("copy_dashboard sends preserveWidgetAql (required by the schema)", async () => {
    const bundle = createDashboardTools(client as never);
    await bundle.handlers.copy_dashboard({ id: 1, name: "Copy" });
    expect(client.post).toHaveBeenCalledWith("/api/dashboard/1/copy", { preserveWidgetAql: true, name: "Copy" });
  });
});

describe("user-flow guide resource", () => {
  it("is listed and served as markdown without API calls", async () => {
    expect(RESOURCES.map((r) => r.uri)).toEqual(expect.arrayContaining(["allure://guides/user-flows", "allure://guides/aql"]));
    const content = await readResourceContent(client as never, "allure://guides/user-flows");
    expect(content.mimeType).toBe("text/markdown");
    expect(content.text).toContain("## 7. Manual run");
    const aql = await readResourceContent(client as never, "allure://guides/aql");
    expect(aql.text).toContain("AQL");
    expect(client.get).not.toHaveBeenCalled();
  });

  it("bundled copies are in sync with docs/usages/user-flows.md (run npm run docs:user-flows)", () => {
    const root = resolve(__dirname, "../..");
    const source = readFileSync(resolve(root, "docs/usages/user-flows.md"), "utf8").replace(/\r\n/g, "\n");
    const skill = readFileSync(resolve(root, "skills/allure-testops/references/user-flows.md"), "utf8").replace(/\r\n/g, "\n");
    expect(USER_FLOWS_GUIDE).toBe(source);
    expect(skill).toBe(source);
  });
});
