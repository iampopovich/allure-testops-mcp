import type { AllureApiClient } from "../client.js";
import * as api from "../api/dashboards.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, idSchema, projectIdSchema, projectNameSchema , coerceObject} from "./schema.js";
import { resolveProjectId } from "./utils.js";

const createDashboard = zodTool("create_dashboard",
  "Create a new dashboard in a project. Pass payload.templateId to get ready-made widgets (templateId -1 = the 'Automation' template from the UI); without it the dashboard is empty.",
  z.object({
    projectId: projectIdSchema.optional(),
    projectName: projectNameSchema.optional(),
    name: z.string().describe("Dashboard name."),
    shared: z.boolean().optional().describe("Whether the dashboard is shared with the project."),
    payload: coerceObject().optional().describe("Additional dashboard fields (e.g. description, widgets)."),
  }),
);

const getDashboard = zodTool("get_dashboard",
  "Get a dashboard by ID.",
  z.object({ id: idSchema("Dashboard") }),
);

const updateDashboard = zodTool("update_dashboard",
  "Update dashboard fields (name, shared status, etc.).",
  z.object({ id: idSchema("Dashboard"), payload: coerceObject().describe("Fields to update (e.g. name, shared).") }),
);

const deleteDashboard = zodTool("delete_dashboard",
  "Delete a dashboard by ID.",
  z.object({ id: idSchema("Dashboard") }),
);

const copyDashboard = zodTool("copy_dashboard",
  "Copy an existing dashboard (with its widgets) to the same or another project. preserveWidgetAql (default true) keeps the widgets' AQL filters in the copy.",
  z.object({
    id: idSchema("Source dashboard"),
    name: z.string().optional().describe("Name for the copied dashboard."),
    projectId: projectIdSchema.optional().describe("Target project ID (defaults to source project)."),
    projectName: projectNameSchema.optional().describe("Target project name (alternative to projectId)."),
    preserveWidgetAql: z.boolean().optional().describe("Keep widget AQL filters in the copy (default true)."),
    payload: coerceObject().optional().describe("Additional copy options."),
  }),
);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const getWidgetData = zodTool("get_widget_data",
  "Get the data of a dashboard widget for a date range (the same request the dashboard page makes). " +
  "Range: dateFrom / dateTo as YYYY-MM-DD (inclusive); without them the server uses its default period (last 14 days). " +
  "from / to (Unix ms) are still accepted and converted to dates. offset = timezone offset in HOURS (e.g. 3 or -3). page/size apply to list widgets.",
  z.object({
    id: idSchema("Widget"),
    dateFrom: z.string().regex(ISO_DATE).optional().describe("Start date, YYYY-MM-DD."),
    dateTo: z.string().regex(ISO_DATE).optional().describe("End date, YYYY-MM-DD."),
    from: z.coerce.number().optional().describe("Alternative to dateFrom: start as Unix timestamp ms (converted to a UTC date)."),
    to: z.coerce.number().optional().describe("Alternative to dateTo: end as Unix timestamp ms (converted to a UTC date)."),
    offset: z.coerce.number().int().optional().describe("Timezone offset in hours, e.g. 3 for UTC+3."),
    page: z.coerce.number().int().optional(),
    size: z.coerce.number().int().optional(),
  }),
);

export function createDashboardTools(client: AllureApiClient): ToolBundle {
  return {
    tools: [
      createDashboard.definition,
      getDashboard.definition,
      updateDashboard.definition,
      deleteDashboard.definition,
      copyDashboard.definition,
      getWidgetData.definition,
    ],
    handlers: {
      create_dashboard: async (rawArgs: unknown) => {
        const args = createDashboard.parse(rawArgs);
        const projectId = await resolveProjectId(args, client);
        const payload: Record<string, unknown> = { projectId, name: args.name, ...args.payload };
        if (args.shared !== undefined) payload.shared = args.shared;
        return api.createDashboard(client, payload);
      },
      get_dashboard: async (rawArgs) => api.getDashboard(client, getDashboard.parse(rawArgs).id),
      update_dashboard: async (rawArgs) => {
        const { id, payload } = updateDashboard.parse(rawArgs);
        return api.updateDashboard(client, id, payload);
      },
      delete_dashboard: async (rawArgs) => api.deleteDashboard(client, deleteDashboard.parse(rawArgs).id),
      copy_dashboard: async (rawArgs: unknown) => {
        const args = copyDashboard.parse(rawArgs);
        const body: Record<string, unknown> = { preserveWidgetAql: args.preserveWidgetAql ?? true, ...args.payload };
        if (args.name !== undefined) body.name = args.name;
        if (args.projectId !== undefined || args.projectName !== undefined) {
          body.projectId = await resolveProjectId(args, client);
        }
        return api.copyDashboard(client, args.id, body);
      },
      get_widget_data: async (rawArgs: unknown) => {
        const args = getWidgetData.parse(rawArgs);
        // The API ignores from/to; it reads dateFrom/dateTo (YYYY-MM-DD) from the `parameters` map.
        const query: Record<string, string | number | boolean | undefined> = {
          dateFrom: args.dateFrom ?? (args.from !== undefined ? toIsoDate(args.from) : undefined),
          dateTo: args.dateTo ?? (args.to !== undefined ? toIsoDate(args.to) : undefined),
          offset: args.offset,
          page: args.page,
          size: args.size,
        };
        return api.getWidgetData(client, args.id, query);
      },
    },
  };
}
