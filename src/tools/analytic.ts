import type { AllureApiClient } from "../client.js";
import * as api from "../api/analytic.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, paginationSchema, projectIdSchema, projectNameSchema } from "./schema.js";
import { resolveProjectId } from "./utils.js";

const rangeFields = {
  from: z.coerce.number().optional().describe("Start of time range (Unix timestamp ms). Must be a number, not a string."),
  to: z.coerce.number().optional().describe("End of time range (Unix timestamp ms). Must be a number, not a string."),
};

const rqlFields = {
  tcRql: z.string().optional().describe("RQL filter for test cases."),
  launchRql: z.string().optional().describe("RQL filter for launches."),
};

const intervalField = {
  interval: z.enum(["hour", "day", "week", "month"]).optional()
    .describe('Time interval for grouping. One of: "hour", "day", "week", "month".'),
};

const offsetField = {
  offset: z.coerce.number().optional().describe("Timezone offset in minutes. Must be a number, not a string."),
};

const getAutomationChart = zodTool("get_automation_chart",
  "Get automation trend chart data for a project (test automation coverage over time).",
  z.object({ projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(), ...rqlFields, ...rangeFields, ...offsetField, ...intervalField }),
);

const getGroupByAutomation = zodTool("get_group_by_automation",
  "Get test case counts grouped by automation status for a project.",
  z.object({ projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(), tcRql: rqlFields.tcRql }),
);

const getGroupByStatus = zodTool("get_group_by_status",
  "Get test case counts grouped by status for a project.",
  z.object({ projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(), tcRql: rqlFields.tcRql }),
);

const getLaunchDurationHistogram = zodTool("get_launch_duration_histogram",
  "Get histogram of launch durations for a project.",
  z.object({ projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(), ...rqlFields, ...rangeFields, buckets: z.coerce.number().optional().describe("Number of histogram buckets (default: 10). Must be a number, not a string.") }),
);

const getMuteTrend = zodTool("get_mute_trend",
  "Get trend of muted test cases over time for a project.",
  z.object({ projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(), ...rangeFields, ...intervalField }),
);

const getStatisticTrend = zodTool("get_statistic_trend",
  "Get test result statistic trend over time for a project.",
  z.object({ projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(), ...rqlFields, ...rangeFields, ...offsetField, ...intervalField }),
);

const getTcLastResult = zodTool("get_tc_last_result",
  "Get last test result for each test case in a project.",
  z.object({ projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional() }),
);

const getTcSuccessRate = zodTool("get_tc_success_rate",
  "Get test case success rate analytics over time for a project.",
  z.object({ projectId: projectIdSchema.optional(), projectName: projectNameSchema.optional(), ...rqlFields, ...rangeFields, ...offsetField, ...intervalField }),
);

export function createAnalyticTools(client: AllureApiClient): ToolBundle {
  const tools = [
    getAutomationChart.definition,
    getGroupByAutomation.definition,
    getGroupByStatus.definition,
    getLaunchDurationHistogram.definition,
    getMuteTrend.definition,
    getStatisticTrend.definition,
    getTcLastResult.definition,
    getTcSuccessRate.definition,
  ];

  const handlers = {
    get_automation_chart: async (rawArgs: unknown) => {
      const args = getAutomationChart.parse(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getAutomationChart(client, projectId, {
        tcRql: args.tcRql, launchRql: args.launchRql,
        from: args.from, to: args.to, offset: args.offset, interval: args.interval,
      });
    },
    get_group_by_automation: async (rawArgs: unknown) => {
      const args = getGroupByAutomation.parse(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getGroupByAutomation(client, projectId, { tcRql: args.tcRql });
    },
    get_group_by_status: async (rawArgs: unknown) => {
      const args = getGroupByStatus.parse(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getGroupByStatus(client, projectId, { tcRql: args.tcRql });
    },
    get_launch_duration_histogram: async (rawArgs: unknown) => {
      const args = getLaunchDurationHistogram.parse(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getLaunchDurationHistogram(client, projectId, {
        tcRql: args.tcRql, launchRql: args.launchRql,
        from: args.from, to: args.to, buckets: args.buckets,
      });
    },
    get_mute_trend: async (rawArgs: unknown) => {
      const args = getMuteTrend.parse(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getMuteTrend(client, projectId, { from: args.from, to: args.to, interval: args.interval });
    },
    get_statistic_trend: async (rawArgs: unknown) => {
      const args = getStatisticTrend.parse(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getStatisticTrend(client, projectId, {
        tcRql: args.tcRql, launchRql: args.launchRql,
        from: args.from, to: args.to, offset: args.offset, interval: args.interval,
      });
    },
    get_tc_last_result: async (rawArgs: unknown) => {
      const args = getTcLastResult.parse(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getTcLastResult(client, projectId);
    },
    get_tc_success_rate: async (rawArgs: unknown) => {
      const args = getTcSuccessRate.parse(rawArgs);
      const projectId = await resolveProjectId(args, client);
      return api.getTcSuccessRate(client, projectId, {
        tcRql: args.tcRql, launchRql: args.launchRql,
        from: args.from, to: args.to, offset: args.offset, interval: args.interval,
      });
    },
  };

  return { tools, handlers };
}
