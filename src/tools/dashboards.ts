import type { AllureApiClient } from "../client.js";
import * as api from "../api/dashboards.js";
import type { ToolBundle } from "./types.js";
import {
  asObject,
  getOptionalNumber,
  getOptionalString,
  getOptionalObjectPayload,
  getRequiredId,
  resolveProjectId,
  pickPagination,
} from "./utils.js";

export function createDashboardTools(client: AllureApiClient): ToolBundle {
  const tools = [
    {
      name: "list_dashboards",
      description: "List all dashboards for a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          page: { type: "number", description: "Page number (0-based)." },
          size: { type: "number", description: "Page size." },
        },
      },
    },
    {
      name: "create_dashboard",
      description: "Create a new dashboard in a project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          projectId: { type: "number", description: "Project ID." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          name: { type: "string", description: "Dashboard name." },
          shared: { type: "boolean", description: "Whether the dashboard is shared with the project." },
          payload: {
            type: "object",
            description: "Additional dashboard fields (e.g. description, widgets).",
          },
        },
        required: ["name"],
      },
    },
    {
      name: "get_dashboard",
      description: "Get a dashboard by ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Dashboard ID." },
        },
        required: ["id"],
      },
    },
    {
      name: "update_dashboard",
      description: "Update dashboard fields (name, shared status, etc.).",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Dashboard ID." },
          payload: {
            type: "object",
            description: "Fields to update (e.g. name, shared).",
          },
        },
        required: ["id", "payload"],
      },
    },
    {
      name: "delete_dashboard",
      description: "Delete a dashboard by ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Dashboard ID." },
        },
        required: ["id"],
      },
    },
    {
      name: "copy_dashboard",
      description: "Copy an existing dashboard to the same or another project.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Source dashboard ID." },
          name: { type: "string", description: "Name for the copied dashboard." },
          projectId: { type: "number", description: "Target project ID (defaults to source project)." },
          projectName: { type: "string", description: "Target project name (alternative to projectId)." },
          payload: {
            type: "object",
            description: "Additional copy options.",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "get_widget_data",
      description: "Get data for a specific dashboard widget.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Widget ID." },
          projectId: { type: "number", description: "Project ID for widget context." },
          projectName: { type: "string", description: "Project name (alternative to projectId)." },
          from: { type: "number", description: "Start of time range (Unix timestamp ms)." },
          to: { type: "number", description: "End of time range (Unix timestamp ms)." },
        },
        required: ["id"],
      },
    },
  ];

  const handlers = {
    list_dashboards: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const pagination = pickPagination(args);
      return api.listDashboards(client, { projectId, ...pagination });
    },

    create_dashboard: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const projectId = await resolveProjectId(args, client);
      const name = getOptionalString(args, "name");
      const extra = getOptionalObjectPayload(args) ?? {};
      return api.createDashboard(client, { projectId, name, ...extra });
    },

    get_dashboard: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const id = getRequiredId(args);
      return api.getDashboard(client, id);
    },

    update_dashboard: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const id = getRequiredId(args);
      const payload = getOptionalObjectPayload(args) ?? {};
      return api.updateDashboard(client, id, payload);
    },

    delete_dashboard: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const id = getRequiredId(args);
      return api.deleteDashboard(client, id);
    },

    copy_dashboard: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const id = getRequiredId(args);
      const name = getOptionalString(args, "name");
      const extra = getOptionalObjectPayload(args) ?? {};
      const body: Record<string, unknown> = { ...extra };
      if (name !== undefined) body.name = name;
      // resolve target project if provided
      const hasProject = args["projectId"] !== undefined || args["projectName"] !== undefined;
      if (hasProject) {
        body.projectId = await resolveProjectId(args, client);
      }
      return api.copyDashboard(client, id, body);
    },

    get_widget_data: async (rawArgs: unknown) => {
      const args = asObject(rawArgs);
      const widgetId = getRequiredId(args);
      const query: Record<string, string | number | boolean | undefined> = {};
      const from = getOptionalNumber(args, "from");
      const to = getOptionalNumber(args, "to");
      if (from !== undefined) query.from = from;
      if (to !== undefined) query.to = to;
      // projectId is optional context for some widgets
      if (args["projectId"] !== undefined || args["projectName"] !== undefined) {
        query.projectId = await resolveProjectId(args, client);
      }
      return api.getWidgetData(client, widgetId, query);
    },
  };

  return { tools, handlers };
}
