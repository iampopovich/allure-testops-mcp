import type { AllureApiClient } from "../client.js";
import * as api from "../api/analytic.js";
import type { ToolBundle } from "./types.js";
import {
  asObject,
  getOptionalNumber,
  getOptionalString,
  resolveProjectId,
} from "./utils.js";

const ANALYTIC_INTERVAL_DESCRIPTION =
  'Time interval for grouping. One of: "hour", "day", "week", "month".';

const RANGE_PROPERTIES = {
  from: { type: "number", description: "Start of time range (Unix timestamp ms). Must be a number, not a string." },
  to: { type: "number", description: "End of time range (Unix timestamp ms). Must be a number, not a string." },
};

const RQL_PROPERTIES = {
  tcRql: { type: "string", description: "RQL filter for test cases." },
  launchRql: { type: "string", description: "RQL filter for launches." },
};

export function createAnalyticTools(client: AllureApiClient): ToolBundle {
  const tools = [
    {
      name: "get_automation_chart",
      description:
        "Get automation trend chart data for a project (test automation coverage over time).",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          ...RQL_PROPERTIES,
          ...RANGE_PROPERTIES,
          offset: { type: "number", description: "Timezone offset in minutes. Must be a number, not a string." },
          interval: { type: "string", description: ANALYTIC_INTERVAL_DESCRIPTION },
        },
      },
    },
    {
      name: "get_group_by_automation",
      description: "Get test case counts grouped by automation status for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          tcRql: RQL_PROPERTIES.tcRql,
        },
      },
    },
    {
      name: "get_group_by_status",
      description: "Get test case counts grouped by status for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          tcRql: RQL_PROPERTIES.tcRql,
        },
      },
    },
    {
      name: "get_launch_duration_histogram",
      description: "Get histogram of launch durations for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          ...RQL_PROPERTIES,
          ...RANGE_PROPERTIES,
          buckets: { type: "number", description: "Number of histogram buckets (default: 10). Must be a number, not a string." },
        },
      },
    },
    {
      name: "get_mute_trend",
      description: "Get trend of muted test cases over time for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          ...RANGE_PROPERTIES,
          interval: { type: "string", description: ANALYTIC_INTERVAL_DESCRIPTION },
        },
      },
    },
    {
      name: "get_statistic_trend",
      description: "Get test result statistic trend over time for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          ...RQL_PROPERTIES,
          ...RANGE_PROPERTIES,
          offset: { type: "number", description: "Timezone offset in minutes. Must be a number, not a string." },
          interval: { type: "string", description: ANALYTIC_INTERVAL_DESCRIPTION },
        },
      },
    },
    {
      name: "get_tc_last_result",
      description: "Get last test result for each test case in a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
        },
      },
    },
    {
      name: "get_tc_success_rate",
      description: "Get test case success rate analytics over time for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID. Must be a number (integer), not a string." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          ...RQL_PROPERTIES,
          ...RANGE_PROPERTIES,
          offset: { type: "number", description: "Timezone offset in minutes. Must be a number, not a string." },
          interval: { type: "string", description: ANALYTIC_INTERVAL_DESCRIPTION },
        },
      },
    },
  ];

  const handlers = {
    get_automation_chart: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getAutomationChart(client, projectId, {
        tcRql: getOptionalString(args, "tcRql"),
        launchRql: getOptionalString(args, "launchRql"),
        from: getOptionalNumber(args, "from"),
        to: getOptionalNumber(args, "to"),
        offset: getOptionalNumber(args, "offset"),
        interval: getOptionalString(args, "interval"),
      });
    },
    get_group_by_automation: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getGroupByAutomation(client, projectId, {
        tcRql: getOptionalString(args, "tcRql"),
      });
    },
    get_group_by_status: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getGroupByStatus(client, projectId, {
        tcRql: getOptionalString(args, "tcRql"),
      });
    },
    get_launch_duration_histogram: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getLaunchDurationHistogram(client, projectId, {
        tcRql: getOptionalString(args, "tcRql"),
        launchRql: getOptionalString(args, "launchRql"),
        from: getOptionalNumber(args, "from"),
        to: getOptionalNumber(args, "to"),
        buckets: getOptionalNumber(args, "buckets"),
      });
    },
    get_mute_trend: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getMuteTrend(client, projectId, {
        from: getOptionalNumber(args, "from"),
        to: getOptionalNumber(args, "to"),
        interval: getOptionalString(args, "interval"),
      });
    },
    get_statistic_trend: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getStatisticTrend(client, projectId, {
        tcRql: getOptionalString(args, "tcRql"),
        launchRql: getOptionalString(args, "launchRql"),
        from: getOptionalNumber(args, "from"),
        to: getOptionalNumber(args, "to"),
        offset: getOptionalNumber(args, "offset"),
        interval: getOptionalString(args, "interval"),
      });
    },
    get_tc_last_result: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getTcLastResult(client, projectId);
    },
    get_tc_success_rate: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getTcSuccessRate(client, projectId, {
        tcRql: getOptionalString(args, "tcRql"),
        launchRql: getOptionalString(args, "launchRql"),
        from: getOptionalNumber(args, "from"),
        to: getOptionalNumber(args, "to"),
        offset: getOptionalNumber(args, "offset"),
        interval: getOptionalString(args, "interval"),
      });
    },
  };

  return { tools, handlers };
}
