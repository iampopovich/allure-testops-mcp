import { TokenManager } from "./auth.js";
import { LruCacheStore } from "./cache.js";
import { AllureApiClient } from "./client.js";
import { createAnalyticTools } from "./tools/analytic.js";
import { createDashboardTools } from "./tools/dashboards.js";
import { createDefectTools } from "./tools/defects.js";
import { createEnvironmentTools } from "./tools/environments.js";
import { createExportTools } from "./tools/exports.js";
import { createLaunchTools } from "./tools/launches.js";
import { createReleaseTools } from "./tools/releases.js";
import { createSharedStepTools } from "./tools/shared-steps.js";
import { createTestCaseTools } from "./tools/test-cases.js";
import { createTestPlanTools } from "./tools/test-plans.js";
import { createTestResultTools } from "./tools/test-results.js";
import { McpToolDefinition, ToolHandler } from "./tools/types.js";

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function parseOptionalProjectId(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error("ALLURE_PROJECT_ID must be a number when provided.");
  }
  return parsed;
}

export function parseMaxConcurrent(value: string | undefined): number {
  if (!value) {
    return 1; // default: limit to 1 concurrent requests
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error("ALLURE_MAX_CONCURRENT must be a non-negative integer.");
  }
  return parsed;
}

/**
 * Builds the API client from ALLURE_* env vars (shared by the MCP server and the backup CLI).
 * `cache: false` forces the cache off (the backup CLI always reads fresh data).
 */
export function createClientFromEnv(options: { cache?: boolean } = {}): AllureApiClient {
  const baseUrl = requiredEnv("ALLURE_TESTOPS_URL");
  const apiToken = requiredEnv("ALLURE_TOKEN");
  const defaultProjectId = parseOptionalProjectId(process.env.ALLURE_PROJECT_ID);

  const tokenManager = new TokenManager({ baseUrl, apiToken });
  const cacheEnabled = options.cache !== false && process.env.ALLURE_CACHE_DISABLED !== "1";
  const cache = cacheEnabled ? new LruCacheStore() : undefined;
  const maxConcurrent = parseMaxConcurrent(process.env.ALLURE_MAX_CONCURRENT);
  return new AllureApiClient({ baseUrl, tokenManager, defaultProjectId, cache, maxConcurrent });
}

export function buildToolRegistry(
  client: AllureApiClient,
): { tools: McpToolDefinition[]; handlers: Map<string, ToolHandler> } {
  const bundles = [
    createTestCaseTools(client),
    createLaunchTools(client),
    createTestResultTools(client),
    createTestPlanTools(client),
    createReleaseTools(client),
    createAnalyticTools(client),
    createDashboardTools(client),
    createDefectTools(client),
    createSharedStepTools(client),
    createEnvironmentTools(client),
    createExportTools(client),
  ];

  const tools: McpToolDefinition[] = [];
  const handlers = new Map<string, ToolHandler>();
  for (const bundle of bundles) {
    tools.push(...bundle.tools);
    for (const [name, handler] of Object.entries(bundle.handlers)) {
      handlers.set(name, handler);
    }
  }

  return { tools, handlers };
}
