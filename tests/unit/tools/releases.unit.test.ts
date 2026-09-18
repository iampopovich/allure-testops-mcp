import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReleaseTools } from "../../../src/tools/releases.js";
import * as api from "../../../src/api/releases.js";
import {
  createMockClient,
  expectObjectSchemas,
  expectRequiredFields,
  expectSchemaProperty,
  expectToolHandlerParity,
} from "../tool-test-helpers.js";

vi.mock("../../../src/api/releases.js", () => ({
  listReleases: vi.fn(),
  getRelease: vi.fn(),
  createRelease: vi.fn(),
  updateRelease: vi.fn(),
  deleteRelease: vi.fn(),
  getReleaseStatistic: vi.fn(),
  listReleaseDefects: vi.fn(),
  listReleaseMutedResults: vi.fn(),
  getReleaseTestCaseTree: vi.fn(),
  listReleaseTags: vi.fn(),
  setReleaseTags: vi.fn(),
  addLaunchToRelease: vi.fn(),
  removeLaunchFromRelease: vi.fn(),
  getReleaseTestCaseSelection: vi.fn(),
  updateReleaseTestCaseSelection: vi.fn(),
  createReleaseFromTestCases: vi.fn(),
  listReleaseStatuses: vi.fn(),
  listReleaseWorkflows: vi.fn(),
}));

describe("createReleaseTools", () => {
  const defaultProjectId = 15;
  const client = createMockClient(defaultProjectId);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defines tool schemas and handlers for every release tool", () => {
    const bundle = createReleaseTools(client as never);
    expectToolHandlerParity(bundle);
    expectObjectSchemas(bundle);
  });

  it("has expected required fields in critical tool schemas", () => {
    const bundle = createReleaseTools(client as never);

    expectRequiredFields(bundle.tools, "get_release", ["id"]);
    expectRequiredFields(bundle.tools, "create_release", ["payload"]);
    expectRequiredFields(bundle.tools, "update_release", ["id", "payload"]);
    expectRequiredFields(bundle.tools, "delete_release", ["id"]);
    expectRequiredFields(bundle.tools, "add_launch_to_release", ["releaseId", "launchId"]);
    expectRequiredFields(bundle.tools, "set_release_tags", ["releaseId", "tags"]);
    expectRequiredFields(bundle.tools, "create_release_from_test_cases", ["release"]);
    expectSchemaProperty(bundle.tools, "list_releases", "projectId");
    expectSchemaProperty(bundle.tools, "list_releases", "projectName");
  });

  it("list_releases forwards free-text query, pagination and default projectId", async () => {
    const bundle = createReleaseTools(client as never);
    vi.mocked(api.listReleases).mockResolvedValueOnce({ content: [] });

    await bundle.handlers.list_releases({ query: "24.", page: 1, size: 20 });

    expect(api.listReleases).toHaveBeenCalledWith(client, defaultProjectId, {
      query: "24.",
      page: 1,
      size: 20,
      sort: undefined,
    });
  });

  it("create_release injects the resolved projectId into the payload", async () => {
    const bundle = createReleaseTools(client as never);
    vi.mocked(api.createRelease).mockResolvedValueOnce({ id: 3 });

    await bundle.handlers.create_release({ payload: { name: "24.1" } });

    expect(api.createRelease).toHaveBeenCalledWith(client, {
      projectId: defaultProjectId,
      name: "24.1",
    });
  });

  it("get_release requires an id", async () => {
    const bundle = createReleaseTools(client as never);
    await expect(bundle.handlers.get_release({})).rejects.toThrow();
  });

  it("get_release coerces a stringified id", async () => {
    const bundle = createReleaseTools(client as never);
    vi.mocked(api.getRelease).mockResolvedValueOnce({ id: 12 });

    await bundle.handlers.get_release({ id: "12" });

    expect(api.getRelease).toHaveBeenCalledWith(client, 12);
  });

  it("set_release_tags normalizes string and object tags", async () => {
    const bundle = createReleaseTools(client as never);
    vi.mocked(api.setReleaseTags).mockResolvedValueOnce([]);

    await bundle.handlers.set_release_tags({ releaseId: 5, tags: ["rc1", { id: 9 }] });

    expect(api.setReleaseTags).toHaveBeenCalledWith(client, 5, [{ name: "rc1" }, { id: 9 }]);
  });

  it("set_release_tags accepts a JSON-encoded tags array", async () => {
    const bundle = createReleaseTools(client as never);
    vi.mocked(api.setReleaseTags).mockResolvedValueOnce([]);

    await bundle.handlers.set_release_tags({ releaseId: 5, tags: '["rc1"]' });

    expect(api.setReleaseTags).toHaveBeenCalledWith(client, 5, [{ name: "rc1" }]);
  });

  it("add_launch_to_release requires both ids", async () => {
    const bundle = createReleaseTools(client as never);
    vi.mocked(api.addLaunchToRelease).mockResolvedValueOnce({ taskId: 1 });

    await bundle.handlers.add_launch_to_release({ releaseId: 5, launchId: 77 });
    expect(api.addLaunchToRelease).toHaveBeenCalledWith(client, 5, 77);

    await expect(bundle.handlers.add_launch_to_release({ releaseId: 5 })).rejects.toThrow();
  });

  it("get_release_test_case_tree forwards tree filters and rejects a non-numeric path", async () => {
    const bundle = createReleaseTools(client as never);
    vi.mocked(api.getReleaseTestCaseTree).mockResolvedValueOnce({ content: [] });

    await bundle.handlers.get_release_test_case_tree({ id: 5, treeId: 2, path: [1, 2] });
    expect(api.getReleaseTestCaseTree).toHaveBeenCalledWith(client, 5, {
      treeId: 2,
      path: [1, 2],
      query: undefined,
      page: undefined,
      size: undefined,
      sort: undefined,
    });

    await expect(
      bundle.handlers.get_release_test_case_tree({ id: 5, path: ["not-a-number"] }),
    ).rejects.toThrow();
  });

  it("create_release_from_test_cases passes release and selection with project scope", async () => {
    const bundle = createReleaseTools(client as never);
    vi.mocked(api.createReleaseFromTestCases).mockResolvedValueOnce({ releaseId: 8 });

    await bundle.handlers.create_release_from_test_cases({
      release: { name: "24.2" },
      selection: { leafsInclude: [1, 2] },
    });

    expect(api.createReleaseFromTestCases).toHaveBeenCalledWith(
      client,
      defaultProjectId,
      { name: "24.2" },
      { leafsInclude: [1, 2] },
    );
  });

  it("list_release_statuses forwards activeOnly and rejects a non-boolean value", async () => {
    const bundle = createReleaseTools(client as never);
    vi.mocked(api.listReleaseStatuses).mockResolvedValueOnce({ content: [] });

    await bundle.handlers.list_release_statuses({ activeOnly: true });
    expect(api.listReleaseStatuses).toHaveBeenCalledWith(client, defaultProjectId, {
      activeOnly: true,
      query: undefined,
      page: undefined,
      size: undefined,
      sort: undefined,
    });

    await expect(bundle.handlers.list_release_statuses({ activeOnly: "yes" })).rejects.toThrow();
  });
});
