import type { AllureApiClient } from "../client.js";
import * as dashboardsApi from "../api/dashboards.js";
import * as testPlansApi from "../api/test-plans.js";
import * as launchesApi from "../api/launches.js";
import * as environmentsApi from "../api/environments.js";

export const RESOURCES = [
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
  {
    uri: "allure://projects/{projectId}/launches",
    name: "Project Launches",
    description: "Launches for a given project. Replace {projectId} with a numeric project ID.",
    mimeType: "application/json",
  },
  {
    uri: "allure://projects/{projectId}/test-plans",
    name: "Project Test Plans",
    description: "Test plans for a given project. Replace {projectId} with a numeric project ID.",
    mimeType: "application/json",
  },
  {
    uri: "allure://projects/{projectId}/dashboards",
    name: "Project Dashboards",
    description: "Dashboards for a given project. Replace {projectId} with a numeric project ID.",
    mimeType: "application/json",
  },
];

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

  throw new Error(`Unknown resource URI: ${uri}`);
}
