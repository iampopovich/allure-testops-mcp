import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AllureApiClient } from "../client.js";
import { exportTestCasesCsv } from "../api/exports.js";
import { fetchAllPages } from "../api/pagination.js";
import * as sharedSteps from "../api/shared-steps.js";
import * as testCases from "../api/test-cases.js";
import { listTestPlans, getTestPlan } from "../api/test-plans.js";
import type { PageDto } from "../types/entities.js";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  PATHS,
  errorMessage,
  mapLimit,
  writeBinary,
  writeJson,
  type AttachmentEntry,
  type BackupManifest,
  type Dictionaries,
  type NamedRef,
  type ScenarioDump,
  type SharedStepBackup,
  type TestCaseBackup,
} from "./format.js";

type JsonRecord = Record<string, unknown>;

export interface DumpOptions {
  /** Parent directory; the backup goes to `<outDir>/<projectId>-<timestamp>`. */
  outDir: string;
  includeDeleted?: boolean;
  /** Download attachment contents (default true). */
  attachments?: boolean;
  /** Also save Allure's native CSV export (default true). */
  csv?: boolean;
  /** Test cases fetched in parallel (the client's ALLURE_MAX_CONCURRENT still caps HTTP requests). */
  concurrency?: number;
  toolVersion?: string;
  supportedApiVersion?: string;
  baseUrl?: string;
  log?: (message: string) => void;
  now?: Date;
}

const ALL_TEST_CASES_RQL = "id > 0";

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function toNamedRefs(items: unknown[]): NamedRef[] {
  return items
    .map((item) => item as JsonRecord)
    .filter((item) => typeof item.id === "number" && typeof item.name === "string")
    .map((item) => ({ id: item.id as number, name: item.name as string }));
}

function pageContent<T>(page: PageDto<T> | T[]): T[] {
  return Array.isArray(page) ? page : page.content ?? [];
}

async function loadDictionaries(client: AllureApiClient, projectId: number): Promise<Dictionaries> {
  const [statuses, testLayers, workflows, roles, customFields] = await Promise.all([
    client.get<PageDto<JsonRecord>>("/api/status", { size: 1000 }),
    client.get<PageDto<JsonRecord>>("/api/testlayer", { size: 1000 }),
    client.get<PageDto<JsonRecord>>("/api/workflow", { size: 1000 }),
    testCases.listRoles(client),
    testCases.listProjectCustomFields(client, projectId, { size: 1000 }),
  ]);
  return {
    statuses: toNamedRefs(pageContent(statuses)),
    testLayers: toNamedRefs(pageContent(testLayers)),
    workflows: toNamedRefs(pageContent(workflows)),
    roles: toNamedRefs(roles),
    customFields: toNamedRefs(pageContent(customFields).map((row) => row.customField ?? {})),
  };
}

async function listTestCaseIds(client: AllureApiClient, projectId: number, deleted: boolean): Promise<number[]> {
  const rows = await fetchAllPages((page, size) =>
    testCases.searchTestCases(client, projectId, ALL_TEST_CASES_RQL, { page, size, sort: "id,asc", ...(deleted ? { deleted: true } : {}) }),
  );
  return rows.map((row) => row.id).filter((id): id is number => typeof id === "number");
}

function countSteps(scenario: ScenarioDump): number {
  return Object.keys(scenario.scenarioSteps ?? scenario.sharedStepScenarioSteps ?? {}).length;
}

async function dumpTestCase(
  client: AllureApiClient,
  projectId: number,
  id: number,
  root: string,
  withAttachments: boolean,
): Promise<TestCaseBackup> {
  const [testCase, scenario, tags, issues, customFields, members, relations, examples, attachmentRows] = await Promise.all([
    testCases.getTestCase(client, id),
    testCases.getTestCaseSteps(client, id),
    testCases.getTestCaseTags(client, id),
    testCases.getTestCaseIssues(client, id),
    testCases.getTestCaseCustomFields(client, id, projectId),
    testCases.getTestCaseMembers(client, id),
    testCases.getTestCaseRelations(client, id),
    testCases.getTestCaseExamples(client, id),
    fetchAllPages((page, size) => client.get<PageDto<JsonRecord>>("/api/testcase/attachment", { testCaseId: id, page, size })),
  ]);

  const attachments: AttachmentEntry[] = [];
  for (const row of attachmentRows) {
    if (typeof row.id !== "number") continue;
    const entry: AttachmentEntry = {
      id: row.id,
      name: String(row.name ?? `attachment-${row.id}`),
      contentType: String(row.contentType ?? "application/octet-stream"),
      ...(typeof row.contentLength === "number" ? { contentLength: row.contentLength } : {}),
    };
    if (withAttachments) {
      const content = await testCases.getTestCaseAttachmentContent(client, row.id);
      entry.file = PATHS.testCaseAttachment(id, row.id, entry.name);
      await writeBinary(root, entry.file, content.content);
    }
    attachments.push(entry);
  }

  return {
    testCase,
    scenario: scenario as ScenarioDump,
    tags: (tags as TestCaseBackup["tags"]) ?? [],
    issues: (issues as JsonRecord[]) ?? [],
    customFields: (customFields as TestCaseBackup["customFields"]) ?? [],
    members: members ?? [],
    relations: relations ?? [],
    examples: (examples.content ?? []).map((example) => example.parameters ?? []),
    attachments,
  };
}

async function dumpSharedSteps(
  client: AllureApiClient,
  projectId: number,
  root: string,
  withAttachments: boolean,
): Promise<SharedStepBackup[]> {
  const rows: JsonRecord[] = [];
  for (const archived of [false, true]) {
    rows.push(...await fetchAllPages((page, size) => sharedSteps.listSharedSteps(client, projectId, { archived, page, size })));
  }
  const unique = [...new Map(rows.filter((row) => typeof row.id === "number").map((row) => [row.id as number, row])).values()];

  const result: SharedStepBackup[] = [];
  for (const row of unique) {
    const id = row.id as number;
    const scenario = await sharedSteps.getSharedStepSteps(client, id);
    const attachments: AttachmentEntry[] = [];
    const attachmentRows = (await sharedSteps.listSharedStepAttachments(client, id)).content ?? [];
    for (const attachment of attachmentRows) {
      if (typeof attachment.id !== "number") continue;
      const entry: AttachmentEntry = {
        id: attachment.id,
        name: attachment.name ?? `attachment-${attachment.id}`,
        contentType: attachment.contentType ?? "application/octet-stream",
        ...(typeof attachment.contentLength === "number" ? { contentLength: attachment.contentLength } : {}),
      };
      if (withAttachments) {
        const content = await sharedSteps.getSharedStepAttachmentContent(client, attachment.id);
        entry.file = PATHS.sharedStepAttachment(id, attachment.id, entry.name);
        await writeBinary(root, entry.file, content.content);
      }
      attachments.push(entry);
    }
    result.push({ sharedStep: row, scenario: scenario as ScenarioDump, attachments });
  }
  return result;
}

/**
 * Saves a full, restorable copy of one project: every test case with its scenario (steps, expected
 * results, shared-step references, attachments), tags, custom field values, links, members,
 * relations and parameters, plus shared steps, test plans, dictionaries and Allure's native CSV.
 * Errors on a single entity are recorded in `manifest.warnings` and do not stop the backup.
 */
export async function dumpProject(
  client: AllureApiClient,
  projectId: number,
  options: DumpOptions,
): Promise<{ dir: string; manifest: BackupManifest }> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? new Date();
  const withAttachments = options.attachments !== false;
  const root = join(options.outDir, `${projectId}-${timestamp(now)}`);
  await mkdir(root, { recursive: true });
  const warnings: string[] = [];

  const project = await client.get<JsonRecord>(`/api/project/${projectId}`);
  await writeJson(root, PATHS.project, project);
  await writeJson(root, PATHS.dictionaries, await loadDictionaries(client, projectId));

  const activeIds = await listTestCaseIds(client, projectId, false);
  const deletedIds = options.includeDeleted ? await listTestCaseIds(client, projectId, true) : [];
  const ids = [...new Set([...activeIds, ...deletedIds])].sort((a, b) => a - b);
  log(`Test cases: ${activeIds.length} active, ${deletedIds.length} deleted`);

  let done = 0;
  let steps = 0;
  let attachments = 0;
  let saved = 0;
  await mapLimit(ids, options.concurrency ?? 4, async (id) => {
    try {
      const backup = await dumpTestCase(client, projectId, id, root, withAttachments);
      await writeJson(root, PATHS.testCase(id), backup);
      steps += countSteps(backup.scenario);
      attachments += backup.attachments.length;
      saved += 1;
    } catch (error) {
      warnings.push(`test case ${id}: ${errorMessage(error)}`);
    }
    done += 1;
    if (done % 50 === 0 || done === ids.length) log(`  ${done}/${ids.length} test cases`);
  });

  let sharedStepCount = 0;
  try {
    const dumped = await dumpSharedSteps(client, projectId, root, withAttachments);
    for (const sharedStep of dumped) {
      await writeJson(root, PATHS.sharedStep(sharedStep.sharedStep.id as number), sharedStep);
      attachments += sharedStep.attachments.length;
    }
    sharedStepCount = dumped.length;
    log(`Shared steps: ${sharedStepCount}`);
  } catch (error) {
    warnings.push(`shared steps: ${errorMessage(error)}`);
  }

  let testPlanCount = 0;
  try {
    const plans = await fetchAllPages((page, size) => listTestPlans(client, projectId, { page, size }));
    for (const row of plans) {
      if (typeof row.id !== "number") continue;
      await writeJson(root, PATHS.testPlan(row.id), { testPlan: await getTestPlan(client, row.id) });
      testPlanCount += 1;
    }
    log(`Test plans: ${testPlanCount}`);
  } catch (error) {
    warnings.push(`test plans: ${errorMessage(error)}`);
  }

  let csv: string | null = null;
  if (options.csv !== false && activeIds.length > 0) {
    try {
      const dictionaries = await loadDictionaries(client, projectId);
      const exported = await exportTestCasesCsv(client, projectId, {
        customFields: dictionaries.customFields,
        roles: dictionaries.roles,
      });
      await writeFile(join(root, PATHS.csv), exported.csv, "utf-8");
      csv = PATHS.csv;
      log("CSV export saved");
    } catch (error) {
      warnings.push(`csv export: ${errorMessage(error)}`);
    }
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    ...(options.toolVersion ? { toolVersion: options.toolVersion } : {}),
    ...(options.supportedApiVersion ? { supportedApiVersion: options.supportedApiVersion } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    projectId,
    ...(typeof project.name === "string" ? { projectName: project.name } : {}),
    createdAt: now.toISOString(),
    includeDeleted: options.includeDeleted === true,
    csv,
    counts: {
      testCases: saved,
      deletedTestCases: deletedIds.length,
      steps,
      attachments,
      sharedSteps: sharedStepCount,
      testPlans: testPlanCount,
    },
    warnings: warnings.sort(),
  };
  await writeJson(root, PATHS.manifest, manifest);
  return { dir: root, manifest };
}
