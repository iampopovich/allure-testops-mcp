import type { AllureApiClient } from "../client.js";
import * as dashboardsApi from "../api/dashboards.js";
import * as testPlansApi from "../api/test-plans.js";
import * as launchesApi from "../api/launches.js";
import * as testCasesApi from "../api/test-cases.js";
import * as defectsApi from "../api/defects.js";
import * as sharedStepsApi from "../api/shared-steps.js";
import * as environmentsApi from "../api/environments.js";
import { AQL_SYNTAX } from "../tools/utils.js";
import { USER_FLOWS_GUIDE } from "./docs/user-flows.js";

/** Static markdown guides bundled with the server (no API call). */
const GUIDES: Record<string, string> = {
  "allure://guides/user-flows": USER_FLOWS_GUIDE,
  "allure://guides/aql": `# Allure Query Language (AQL)\n\n${AQL_SYNTAX}\n\nSee also allure://guides/user-flows section 1.\n`,
};

export const RESOURCES = [
  {
    uri: "allure://guides/user-flows",
    name: "Allure TestOps user flows (UI path → tools → API)",
    description: "Reference of every Allure TestOps user flow as the UI performs it: which MCP tool reproduces each step, " +
      "the exact order of calls, scenario/expected-result model, reference ids and known traps. Read it before multi-step work on test cases, runs, plans or defects.",
    mimeType: "text/markdown",
  },
  {
    uri: "allure://guides/aql",
    name: "AQL syntax",
    description: "Allure Query Language syntax used by search_test_cases, search_launches, search_test_results and test plan baseRql.",
    mimeType: "text/markdown",
  },
  {
    uri: "allure://projects",
    name: "All Projects",
    description: "All accessible Allure TestOps projects.",
    mimeType: "application/json",
  },
  {
    uri: "allure://env-vars",
    name: "Environment Variables",
    description: "All environment variable keys tracked in Allure TestOps.",
    mimeType: "application/json",
  },
];

/** Parameterised resources — advertised via resources/templates/list, read via readResource(). */
export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: "allure://projects/{projectId}/launches",
    name: "Project Launches",
    description: "Launches for a given project. Replace {projectId} with a numeric project ID.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "allure://projects/{projectId}/test-plans",
    name: "Project Test Plans",
    description: "Test plans for a given project. Replace {projectId} with a numeric project ID.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "allure://projects/{projectId}/dashboards",
    name: "Project Dashboards",
    description: "Dashboards for a given project. Replace {projectId} with a numeric project ID.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "allure://projects/{projectId}/test-cases",
    name: "Project Test Cases",
    description: "First page of test cases for a given project (quick listing). For filtered or paginated access use the search_test_cases tool.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "allure://projects/{projectId}/defects",
    name: "Project Defects",
    description: "First page of defect records for a given project (quick listing). For status/name filtering use the get_defect tool or query directly.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "allure://projects/{projectId}/shared-steps",
    name: "Project Shared Steps",
    description: "First page of active shared steps for a given project (quick listing).",
    mimeType: "application/json",
  },
  {
    uriTemplate: "allure://projects/{projectId}/custom-fields",
    name: "Project Custom Fields",
    description: "First page of custom fields configured for a given project (quick listing). For value lookup use the list_custom_field_values tool.",
    mimeType: "application/json",
  },
];

/** Reads a resource and serializes it: guides as markdown, API-backed resources as JSON. */
export async function readResourceContent(
  client: AllureApiClient,
  uri: string,
): Promise<{ mimeType: string; text: string }> {
  const guide = GUIDES[uri];
  if (guide !== undefined) return { mimeType: "text/markdown", text: guide };
  return { mimeType: "application/json", text: JSON.stringify(await readResource(client, uri)) };
}

export async function readResource(client: AllureApiClient, uri: string): Promise<unknown> {
  if (uri === "allure://projects") {
    return client.get("/api/project/suggest");
  }

  if (uri === "allure://env-vars") {
    return environmentsApi.listEnvVars(client);
  }

  const launchesMatch = /^allure:\/\/projects\/(\d+)\/launches$/.exec(uri);
  if (launchesMatch) {
    return launchesApi.listLaunches(client, Number(launchesMatch[1]), {});
  }

  const testPlansMatch = /^allure:\/\/projects\/(\d+)\/test-plans$/.exec(uri);
  if (testPlansMatch) {
    return testPlansApi.listTestPlans(client, Number(testPlansMatch[1]), {});
  }

  const dashboardsMatch = /^allure:\/\/projects\/(\d+)\/dashboards$/.exec(uri);
  if (dashboardsMatch) {
    return dashboardsApi.listDashboards(client, { projectId: Number(dashboardsMatch[1]) });
  }

  const testCasesMatch = /^allure:\/\/projects\/(\d+)\/test-cases$/.exec(uri);
  if (testCasesMatch) {
    return testCasesApi.listTestCases(client, Number(testCasesMatch[1]), {});
  }

  const defectsMatch = /^allure:\/\/projects\/(\d+)\/defects$/.exec(uri);
  if (defectsMatch) {
    return defectsApi.listDefects(client, Number(defectsMatch[1]), {});
  }

  const sharedStepsMatch = /^allure:\/\/projects\/(\d+)\/shared-steps$/.exec(uri);
  if (sharedStepsMatch) {
    return sharedStepsApi.listSharedSteps(client, Number(sharedStepsMatch[1]), {});
  }

  const customFieldsMatch = /^allure:\/\/projects\/(\d+)\/custom-fields$/.exec(uri);
  if (customFieldsMatch) {
    return testCasesApi.listProjectCustomFields(client, Number(customFieldsMatch[1]), {});
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}
