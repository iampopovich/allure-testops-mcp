import type { AllureApiClient } from "../client.js";
import * as api from "../api/releases.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import {
  zodTool,
  idSchema,
  paginationSchema,
  projectIdSchema,
  projectNameSchema,
  sortSchema,
  coerceArray,
  coerceInt,
  coerceObject,
} from "./schema.js";
import { resolveProjectId } from "./utils.js";

const releaseTagSchema = z.union([
  z.string(),
  z.object({}).passthrough(),
]);

function normalizeReleaseTags(
  tags: Array<string | Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return tags.map((tag) => (typeof tag === "string" ? { name: tag } : tag));
}

const listReleases = zodTool("list_releases",
  "List releases of a project. A release groups launches and test cases around a delivery scope " +
  "and carries a workflow status (Allure TestOps 26.3+).",
  z.object({
    projectId: projectIdSchema.optional(),
    projectName: projectNameSchema.optional(),
    query: z.string().optional().describe("Free-text filter over release names."),
    ...paginationSchema,
    sort: sortSchema,
  }),
);

const getRelease = zodTool("get_release",
  "Get a release by ID, including its status, workflow and tags.",
  z.object({ id: idSchema("Release") }),
);

const createRelease = zodTool("create_release",
  "Create a release. payload fields: name (required), dueDate (13-digit Unix ms timestamp), " +
  "previousReleaseId, tags [{ name }]. projectId is added to the payload from projectId/projectName " +
  "or ALLURE_PROJECT_ID.",
  z.object({
    projectId: projectIdSchema.optional(),
    projectName: projectNameSchema.optional(),
    payload: coerceObject(),
  }),
);

const updateRelease = zodTool("update_release",
  "Update a release. payload fields: name, dueDate, previousReleaseId, statusId, workflowId. " +
  "Use list_release_statuses / list_release_workflows to resolve statusId and workflowId.",
  z.object({ id: idSchema("Release"), payload: coerceObject() }),
);

const deleteRelease = zodTool("delete_release", "Delete a release by ID.",
  z.object({ id: idSchema("Release") }),
);

const getReleaseStatistic = zodTool("get_release_statistic",
  "Get aggregated test status counts for a release.",
  z.object({ id: idSchema("Release") }),
);

const listReleaseDefects = zodTool("list_release_defects",
  "List defects detected within a release.",
  z.object({ id: idSchema("Release"), ...paginationSchema, sort: sortSchema }),
);

const listReleaseMutedResults = zodTool("list_release_muted_results",
  "List muted test results within a release.",
  z.object({ id: idSchema("Release"), ...paginationSchema, sort: sortSchema }),
);

const getReleaseTestCaseTree = zodTool("get_release_test_case_tree",
  "Browse the test case tree of a release: which test cases are in scope and their latest status.",
  z.object({
    id: idSchema("Release"),
    treeId: coerceInt().optional().describe("Tree layout ID."),
    path: coerceArray(coerceInt()).optional().describe("Group IDs of the branch to expand."),
    query: z.string().optional().describe("Free-text filter over leaf names."),
    ...paginationSchema,
    sort: sortSchema,
  }),
);

const listReleaseTags = zodTool("list_release_tags", "List tags attached to a release.",
  z.object({ releaseId: idSchema("Release") }),
);

const setReleaseTags = zodTool("set_release_tags",
  "Replace the tag set of a release. Accepts tag names as strings or { id, name } objects. " +
  "This REPLACES all existing tags — read list_release_tags first and send the merged list to append.",
  z.object({
    releaseId: idSchema("Release"),
    tags: coerceArray(releaseTagSchema).describe(
      'Tags to set, e.g. ["rc1", "hotfix"] or [{ "name": "rc1" }].',
    ),
  }),
);

const addLaunchToRelease = zodTool("add_launch_to_release",
  "Attach a launch to a release so its results count towards the release statistics. " +
  "Returns a task info object — recalculation runs asynchronously.",
  z.object({ releaseId: idSchema("Release"), launchId: idSchema("Launch") }),
);

const removeLaunchFromRelease = zodTool("remove_launch_from_release",
  "Detach a launch from a release.",
  z.object({ releaseId: idSchema("Release"), launchId: idSchema("Launch") }),
);

const getReleaseTestCaseSelection = zodTool("get_release_test_case_selection",
  "Get the rule that defines which test cases belong to a release (AQL and/or tree selection).",
  z.object({ releaseId: idSchema("Release") }),
);

const updateReleaseTestCaseSelection = zodTool("update_release_test_case_selection",
  "Change the test case scope of a release. payload fields: testCaseAql (AQL over test cases) " +
  "and/or treeSelection { leafsInclude, leafsExclude, groupsInclude, groupsExclude, path, inverted }. " +
  "Applied asynchronously — the response is a task info object.",
  z.object({ releaseId: idSchema("Release"), payload: coerceObject() }),
);

const createReleaseFromTestCases = zodTool("create_release_from_test_cases",
  "Create a release and populate it from a test case selection in one call. " +
  "release: { name, dueDate, previousReleaseId, tags }. " +
  "selection: { leafsInclude, leafsExclude, groupsInclude, groupsExclude, treeId, filterId, search, path, inverted } — " +
  "projectId and inverted=false are filled in automatically.",
  z.object({
    projectId: projectIdSchema.optional(),
    projectName: projectNameSchema.optional(),
    release: coerceObject(),
    selection: coerceObject().optional(),
  }),
);

const listReleaseStatuses = zodTool("list_release_statuses",
  "List release statuses configured for a project. Use the returned ids as statusId in update_release.",
  z.object({
    projectId: projectIdSchema.optional(),
    projectName: projectNameSchema.optional(),
    activeOnly: z.boolean().optional().describe("Return only active statuses."),
    query: z.string().optional().describe("Free-text filter over status codes."),
    ...paginationSchema,
    sort: sortSchema,
  }),
);

const listReleaseWorkflows = zodTool("list_release_workflows",
  "List release workflows configured for a project. Use the returned ids as workflowId in update_release.",
  z.object({
    projectId: projectIdSchema.optional(),
    projectName: projectNameSchema.optional(),
    query: z.string().optional().describe("Free-text filter over workflow names."),
    ...paginationSchema,
    sort: sortSchema,
  }),
);

export function createReleaseTools(client: AllureApiClient): ToolBundle {
  return {
    tools: [
      listReleases.definition,
      getRelease.definition,
      createRelease.definition,
      updateRelease.definition,
      deleteRelease.definition,
      getReleaseStatistic.definition,
      listReleaseDefects.definition,
      listReleaseMutedResults.definition,
      getReleaseTestCaseTree.definition,
      listReleaseTags.definition,
      setReleaseTags.definition,
      addLaunchToRelease.definition,
      removeLaunchFromRelease.definition,
      getReleaseTestCaseSelection.definition,
      updateReleaseTestCaseSelection.definition,
      createReleaseFromTestCases.definition,
      listReleaseStatuses.definition,
      listReleaseWorkflows.definition,
    ],
    handlers: {
      list_releases: async (rawArgs) => {
        const { query, page, size, sort, ...scope } = listReleases.parse(rawArgs);
        const projectId = await resolveProjectId(scope, client);
        return api.listReleases(client, projectId, { query, page, size, sort });
      },
      get_release: async (rawArgs) => api.getRelease(client, getRelease.parse(rawArgs).id),
      create_release: async (rawArgs) => {
        const { payload, ...scope } = createRelease.parse(rawArgs);
        const projectId = await resolveProjectId(scope, client);
        return api.createRelease(client, { projectId, ...payload });
      },
      update_release: async (rawArgs) => {
        const { id, payload } = updateRelease.parse(rawArgs);
        return api.updateRelease(client, id, payload);
      },
      delete_release: async (rawArgs) => api.deleteRelease(client, deleteRelease.parse(rawArgs).id),
      get_release_statistic: async (rawArgs) =>
        api.getReleaseStatistic(client, getReleaseStatistic.parse(rawArgs).id),
      list_release_defects: async (rawArgs) => {
        const { id, page, size, sort } = listReleaseDefects.parse(rawArgs);
        return api.listReleaseDefects(client, id, { page, size, sort });
      },
      list_release_muted_results: async (rawArgs) => {
        const { id, page, size, sort } = listReleaseMutedResults.parse(rawArgs);
        return api.listReleaseMutedResults(client, id, { page, size, sort });
      },
      get_release_test_case_tree: async (rawArgs) => {
        const { id, ...query } = getReleaseTestCaseTree.parse(rawArgs);
        return api.getReleaseTestCaseTree(client, id, query);
      },
      list_release_tags: async (rawArgs) =>
        api.listReleaseTags(client, listReleaseTags.parse(rawArgs).releaseId),
      set_release_tags: async (rawArgs) => {
        const { releaseId, tags } = setReleaseTags.parse(rawArgs);
        return api.setReleaseTags(client, releaseId, normalizeReleaseTags(tags));
      },
      add_launch_to_release: async (rawArgs) => {
        const { releaseId, launchId } = addLaunchToRelease.parse(rawArgs);
        return api.addLaunchToRelease(client, releaseId, launchId);
      },
      remove_launch_from_release: async (rawArgs) => {
        const { releaseId, launchId } = removeLaunchFromRelease.parse(rawArgs);
        return api.removeLaunchFromRelease(client, releaseId, launchId);
      },
      get_release_test_case_selection: async (rawArgs) =>
        api.getReleaseTestCaseSelection(client, getReleaseTestCaseSelection.parse(rawArgs).releaseId),
      update_release_test_case_selection: async (rawArgs) => {
        const { releaseId, payload } = updateReleaseTestCaseSelection.parse(rawArgs);
        return api.updateReleaseTestCaseSelection(client, releaseId, payload);
      },
      create_release_from_test_cases: async (rawArgs) => {
        const { release, selection, ...scope } = createReleaseFromTestCases.parse(rawArgs);
        const projectId = await resolveProjectId(scope, client);
        return api.createReleaseFromTestCases(client, projectId, release, selection);
      },
      list_release_statuses: async (rawArgs) => {
        const { activeOnly, query, page, size, sort, ...scope } = listReleaseStatuses.parse(rawArgs);
        const projectId = await resolveProjectId(scope, client);
        return api.listReleaseStatuses(client, projectId, { activeOnly, query, page, size, sort });
      },
      list_release_workflows: async (rawArgs) => {
        const { query, page, size, sort, ...scope } = listReleaseWorkflows.parse(rawArgs);
        const projectId = await resolveProjectId(scope, client);
        return api.listReleaseWorkflows(client, projectId, { query, page, size, sort });
      },
    },
  };
}
