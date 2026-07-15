import type { AllureApiClient } from "../client.js";
import * as api from "../api/dashboards.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, idSchema, projectIdSchema, projectNameSchema , coerceObject} from "./schema.js";
import { resolveProjectId } from "./utils.js";

const createDashboard = zodTool("create_dashboard",
  "Create a new dashboard in a project.",
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
  "Copy an existing dashboard to the same or another project.",
  z.object({
    id: idSchema("Source dashboard"),
    name: z.string().optional().describe("Name for the copied dashboard."),
    projectId: projectIdSchema.optional().describe("Target project ID (defaults to source project)."),
    projectName: projectNameSchema.optional().describe("Target project name (alternative to projectId)."),
    payload: coerceObject().optional().describe("Additional copy options."),
  }),
);

const getWidgetData = zodTool("get_widget_data",
  "Get data for a specific dashboard widget.",
  z.object({
    id: idSchema("Widget"),
    projectId: projectIdSchema.optional().describe("Project ID for widget context. Must be a number (integer), not a string."),
    projectName: projectNameSchema.optional().describe("Project name (alternative to projectId)."),
    from: z.coerce.number().optional().describe("Start of time range (Unix timestamp ms). Must be a number, not a string."),
    to: z.coerce.number().optional().describe("End of time range (Unix timestamp ms). Must be a number, not a string."),
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
        const body: Record<string, unknown> = { ...args.payload };
        if (args.name !== undefined) body.name = args.name;
        if (args.projectId !== undefined || args.projectName !== undefined) {
          body.projectId = await resolveProjectId(args, client);
        }
        return api.copyDashboard(client, args.id, body);
      },
      get_widget_data: async (rawArgs: unknown) => {
        const args = getWidgetData.parse(rawArgs);
        const query: Record<string, string | number | boolean | undefined> = {};
        if (args.from !== undefined) query.from = args.from;
        if (args.to !== undefined) query.to = args.to;
        if (args.projectId !== undefined || args.projectName !== undefined) {
          query.projectId = await resolveProjectId(args, client);
        }
        return api.getWidgetData(client, args.id, query);
      },
    },
  };
}
