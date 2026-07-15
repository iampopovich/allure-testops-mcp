import type { AllureApiClient } from "../client.js";
import * as api from "../api/shared-steps.js";
import type { ToolBundle } from "./types.js";
import { z } from "zod";
import { zodTool, idSchema, paginationSchema , coerceObject} from "./schema.js"

const getSharedStep = zodTool("get_shared_step",
  "Get a shared step by ID. Returns metadata: name, project, archived status.",
  z.object({ id: idSchema("Shared step") }),
);

const getSharedStepSteps = zodTool("get_shared_step_steps",
  "Get the full normalized scenario (list of steps) inside a shared step. This is the key tool for resolving sharedStepId references in test case scenarios: when get_test_case_steps returns a step with sharedStepId, call this tool to inline the actual step content. Returns the same NormalizedScenarioDto format as get_test_case_steps.",
  z.object({ id: idSchema("Shared step") }),
);

const getSharedStepUsage = zodTool("get_shared_step_usage",
  "Get the list of test cases that use a specific shared step. Use this for impact analysis before editing or archiving a shared step: shows which test cases would be affected.",
  z.object({ id: idSchema("Shared step"), ...paginationSchema }),
);

const createSharedStep = zodTool("create_shared_step",
  "Create a new shared step in a project. payload must include at minimum: name (string) and projectId (number). Use this to extract repeated test steps into a reusable library.",
  z.object({ payload: coerceObject().describe("Shared step creation data. Required fields: name, projectId.") }),
);

const updateSharedStep = zodTool("update_shared_step",
  "Update shared step metadata (name, etc.) by ID.",
  z.object({ id: idSchema("Shared step"), payload: coerceObject() }),
);

const archiveSharedStep = zodTool("archive_shared_step",
  "Archive a shared step to retire it from active use. Archived steps remain readable but are hidden from the active library. Run get_shared_step_usage first to check impact before archiving.",
  z.object({ id: idSchema("Shared step") }),
);

const unarchiveSharedStep = zodTool("unarchive_shared_step",
  "Restore an archived shared step back to active status.",
  z.object({ id: idSchema("Shared step") }),
);

export function createSharedStepTools(client: AllureApiClient): ToolBundle {
  return {
    tools: [
      getSharedStep.definition,
      getSharedStepSteps.definition,
      getSharedStepUsage.definition,
      createSharedStep.definition,
      updateSharedStep.definition,
      archiveSharedStep.definition,
      unarchiveSharedStep.definition,
    ],
    handlers: {
      get_shared_step: async (rawArgs) => api.getSharedStep(client, getSharedStep.parse(rawArgs).id),
      get_shared_step_steps: async (rawArgs) => api.getSharedStepSteps(client, getSharedStepSteps.parse(rawArgs).id),
      get_shared_step_usage: async (rawArgs) => {
        const { id, page, size } = getSharedStepUsage.parse(rawArgs);
        return api.getSharedStepUsage(client, id, { page, size });
      },
      create_shared_step: async (rawArgs) => api.createSharedStep(client, createSharedStep.parse(rawArgs).payload),
      update_shared_step: async (rawArgs) => {
        const { id, payload } = updateSharedStep.parse(rawArgs);
        return api.updateSharedStep(client, id, payload);
      },
      archive_shared_step: async (rawArgs) => api.archiveSharedStep(client, archiveSharedStep.parse(rawArgs).id),
      unarchive_shared_step: async (rawArgs) => api.unarchiveSharedStep(client, unarchiveSharedStep.parse(rawArgs).id),
    },
  };
}
