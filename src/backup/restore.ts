import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AllureApiClient } from "../client.js";
import * as sharedSteps from "../api/shared-steps.js";
import * as testCases from "../api/test-cases.js";
import { createTestPlan } from "../api/test-plans.js";
import type { PageDto, ScenarioStepDto } from "../types/entities.js";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  PATHS,
  errorMessage,
  readBinaryBase64,
  readJson,
  writeJson,
  type BackupManifest,
  type Dictionaries,
  type NamedRef,
  type ScenarioDump,
  type SharedStepBackup,
  type TestCaseBackup,
  type TestPlanBackup,
} from "./format.js";

type JsonRecord = Record<string, unknown>;
type IdMap = Map<number, number>;

export interface RestoreOptions {
  /** Read and validate everything, report what would be created, write nothing. */
  dryRun?: boolean;
  /** Allow restoring into a project that already has test cases or shared steps. */
  allowNonEmpty?: boolean;
  /** Also recreate test cases that were in the trash when the backup was taken (they go back to the trash). */
  includeDeleted?: boolean;
  log?: (message: string) => void;
  now?: Date;
}

export interface RestoreReport {
  sourceProjectId: number;
  targetProjectId: number;
  dryRun: boolean;
  created: {
    testCases: number;
    steps: number;
    attachments: number;
    sharedSteps: number;
    testPlans: number;
    relations: number;
  };
  idMap: {
    testCases: Record<string, number>;
    sharedSteps: Record<string, number>;
  };
  warnings: string[];
  reportFile?: string;
}

/** Maps a source dictionary id to the target id of the entry with the same name. */
function nameMapper(source: NamedRef[], target: NamedRef[]): (id: number | undefined) => number | undefined {
  const byName = new Map(target.map((ref) => [ref.name, ref.id]));
  const sourceNames = new Map(source.map((ref) => [ref.id, ref.name]));
  return (id) => {
    if (id === undefined) return undefined;
    const name = sourceNames.get(id);
    return name === undefined ? undefined : byName.get(name);
  };
}

function refId(value: unknown): number | undefined {
  const id = (value as JsonRecord | undefined)?.id;
  return typeof id === "number" ? id : undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function listJsonIds(root: string, folder: string): Promise<number[]> {
  try {
    const files = await readdir(join(root, folder));
    return files
      .filter((file) => /^\d+\.json$/.test(file))
      .map((file) => Number(file.slice(0, -5)))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * Writes one scenario level (and everything below it) in order, the way the UI builds it:
 * each node goes after the previous sibling; a step with an expected result is created with an
 * ER container, whose lines are then written under it; nested steps go under their parent.
 */
interface ScenarioWriter {
  create(node: {
    parentId?: number;
    afterId?: number;
    body?: string;
    bodyJson?: unknown;
    sharedStepId?: number;
    attachmentId?: number;
    withExpectedResult: boolean;
  }): Promise<{ id: number; expectedResultId?: number }>;
}

async function writeScenarioLevel(
  writer: ScenarioWriter,
  steps: Record<string, ScenarioStepDto & JsonRecord>,
  childIds: number[] | undefined,
  parentId: number | undefined,
  mapSharedStep: (id: number) => number | undefined,
  mapAttachment: (id: number) => number | undefined,
  counter: { steps: number; warnings: string[]; context: string },
): Promise<void> {
  let previous: number | undefined;
  for (const childId of childIds ?? []) {
    const step = steps[String(childId)];
    if (!step) continue;
    const expectedResult = typeof step.expectedResultId === "number" ? steps[String(step.expectedResultId)] : undefined;

    let sharedStepId: number | undefined;
    if (typeof step.sharedStepId === "number") {
      sharedStepId = mapSharedStep(step.sharedStepId);
      if (sharedStepId === undefined) {
        counter.warnings.push(`${counter.context}: shared step ${step.sharedStepId} is not in the backup; reference skipped`);
        continue;
      }
    }
    let attachmentId: number | undefined;
    if (typeof step.attachmentId === "number") {
      attachmentId = mapAttachment(step.attachmentId);
      if (attachmentId === undefined) {
        counter.warnings.push(`${counter.context}: attachment ${step.attachmentId} was not restored; attachment step skipped`);
        continue;
      }
    }

    const created = await writer.create({
      parentId,
      afterId: previous,
      ...(step.bodyJson !== undefined ? { bodyJson: step.bodyJson } : nonEmpty(step.body) ? { body: step.body } : {}),
      sharedStepId,
      attachmentId,
      withExpectedResult: expectedResult !== undefined,
    });
    counter.steps += 1;
    previous = created.id;

    if (expectedResult) {
      if (created.expectedResultId === undefined) {
        counter.warnings.push(`${counter.context}: expected result container was not returned for step ${childId}`);
      } else {
        await writeScenarioLevel(writer, steps, expectedResult.children, created.expectedResultId, mapSharedStep, mapAttachment, counter);
      }
    }
    await writeScenarioLevel(writer, steps, step.children, created.id, mapSharedStep, mapAttachment, counter);
  }
}

function testCaseWriter(client: AllureApiClient, testCaseId: number): ScenarioWriter {
  return {
    async create(node) {
      const body: JsonRecord = { testCaseId };
      if (node.parentId !== undefined) body.parentId = node.parentId;
      if (node.bodyJson !== undefined) body.bodyJson = node.bodyJson;
      else if (node.body !== undefined) body.body = node.body;
      if (node.sharedStepId !== undefined) body.sharedStepId = node.sharedStepId;
      if (node.attachmentId !== undefined) body.attachmentId = node.attachmentId;
      if (node.withExpectedResult) body.expectedResultId = -1;
      const query: Record<string, number | boolean> = { withExpectedResult: node.withExpectedResult };
      if (node.afterId !== undefined) query.afterId = node.afterId;
      const response = await client.post<{ createdStepId?: number; scenario?: { scenarioSteps?: Record<string, { expectedResultId?: number }> } }>(
        "/api/testcase/step", body, query,
      );
      if (typeof response.createdStepId !== "number") throw new Error("POST /api/testcase/step returned no createdStepId");
      return {
        id: response.createdStepId,
        expectedResultId: response.scenario?.scenarioSteps?.[String(response.createdStepId)]?.expectedResultId,
      };
    },
  };
}

function sharedStepWriter(client: AllureApiClient, sharedStepId: number): ScenarioWriter {
  return {
    async create(node) {
      const response = await sharedSteps.createSharedStepStep(
        client,
        {
          sharedStepId,
          ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
          ...(node.bodyJson !== undefined ? { bodyJson: node.bodyJson } : node.body !== undefined ? { body: node.body } : {}),
          ...(node.attachmentId !== undefined ? { attachmentId: node.attachmentId } : {}),
        },
        { afterId: node.afterId, withExpectedResult: node.withExpectedResult },
      );
      if (typeof response.createdStepId !== "number") throw new Error("POST /api/sharedstep/step returned no createdStepId");
      return {
        id: response.createdStepId,
        expectedResultId: response.scenario?.sharedStepScenarioSteps?.[String(response.createdStepId)]?.expectedResultId,
      };
    },
  };
}

function scenarioSteps(scenario: ScenarioDump): Record<string, ScenarioStepDto & JsonRecord> {
  return (scenario.scenarioSteps ?? scenario.sharedStepScenarioSteps ?? {}) as Record<string, ScenarioStepDto & JsonRecord>;
}

function countScenarioNodes(scenario: ScenarioDump): number {
  const steps = scenarioSteps(scenario);
  const containers = new Set(Object.values(steps).map((step) => step.expectedResultId).filter((id) => id !== undefined));
  return Object.keys(steps).filter((id) => !containers.has(Number(id))).length;
}

async function loadDictionaries(client: AllureApiClient, projectId: number): Promise<Dictionaries> {
  const named = (rows: unknown[]): NamedRef[] =>
    rows
      .map((row) => row as JsonRecord)
      .filter((row) => typeof row.id === "number" && typeof row.name === "string")
      .map((row) => ({ id: row.id as number, name: row.name as string }));
  const content = (page: PageDto<JsonRecord>) => page.content ?? [];
  const [statuses, testLayers, workflows, roles, customFields] = await Promise.all([
    client.get<PageDto<JsonRecord>>("/api/status", { size: 1000 }),
    client.get<PageDto<JsonRecord>>("/api/testlayer", { size: 1000 }),
    client.get<PageDto<JsonRecord>>("/api/workflow", { size: 1000 }),
    testCases.listRoles(client),
    testCases.listProjectCustomFields(client, projectId, { size: 1000 }),
  ]);
  return {
    statuses: named(content(statuses)),
    testLayers: named(content(testLayers)),
    workflows: named(content(workflows)),
    roles: named(roles),
    customFields: named((customFields.content ?? []).map((row) => row.customField ?? {})),
  };
}

function testCaseCreatePayload(
  source: JsonRecord,
  projectId: number,
  map: { status: (id?: number) => number | undefined; layer: (id?: number) => number | undefined; workflow: (id?: number) => number | undefined },
  warnings: string[],
): JsonRecord {
  const payload: JsonRecord = { projectId, name: source.name };
  for (const field of ["fullName", "description", "precondition", "expectedResult"]) {
    if (nonEmpty(source[field])) payload[field] = source[field];
  }
  if (typeof source.automated === "boolean") payload.automated = source.automated;
  if (Array.isArray(source.links) && source.links.length > 0) {
    payload.links = (source.links as JsonRecord[]).map((link) => ({
      url: link.url,
      ...(nonEmpty(link.name) ? { name: link.name } : {}),
      ...(nonEmpty(link.type) ? { type: link.type } : {}),
    }));
  }
  const workflowId = map.workflow(refId(source.workflow));
  const statusId = map.status(refId(source.status));
  if (workflowId !== undefined) {
    payload.workflowId = workflowId;
    if (statusId !== undefined) payload.statusId = statusId;
  } else if (refId(source.workflow) !== undefined) {
    warnings.push(`test case ${String(source.id)}: workflow "${String((source.workflow as JsonRecord).name)}" not found in target; default workflow/status used`);
  }
  const layerId = map.layer(refId(source.testLayer));
  if (layerId !== undefined) payload.testLayerId = layerId;
  else if (refId(source.testLayer) !== undefined) {
    warnings.push(`test case ${String(source.id)}: test layer "${String((source.testLayer as JsonRecord).name)}" not found in target`);
  }
  return payload;
}

function mapIds(ids: unknown, idMap: IdMap): number[] {
  return Array.isArray(ids) ? ids.map((id) => idMap.get(Number(id))).filter((id): id is number => id !== undefined) : [];
}

function testPlanPayload(source: JsonRecord, projectId: number, idMap: IdMap, warnings: string[]): JsonRecord {
  const payload: JsonRecord = { projectId, name: source.name };
  if (nonEmpty(source.baseRql)) payload.baseRql = source.baseRql;
  const selection = source.treeSelection as JsonRecord | undefined;
  if (selection) {
    const groups = [selection.groupsInclude, selection.groupsExclude, selection.path].some((value) => Array.isArray(value) && value.length > 0);
    if (groups) warnings.push(`test plan "${String(source.name)}": tree groups/path are tree-specific and were not restored`);
    const leafsInclude = mapIds(selection.leafsInclude, idMap);
    const leafsExclude = mapIds(selection.leafsExclude, idMap);
    const lost = (Array.isArray(selection.leafsInclude) ? selection.leafsInclude.length : 0) - leafsInclude.length;
    if (lost > 0) warnings.push(`test plan "${String(source.name)}": ${lost} selected test case(s) are not in the restore`);
    payload.treeSelection = {
      inverted: selection.inverted === true,
      leafsInclude,
      leafsExclude,
      groupsInclude: [],
      groupsExclude: [],
    };
  }
  return payload;
}

/**
 * Recreates a project dump (see dumpProject) in `targetProjectId`.
 *
 * Order: shared steps (+ their steps and attachments) → test cases (fields, tags, custom field
 * values by name, members, parameters, attachments, then the scenario written step by step) →
 * relations (second pass, through the old → new id map) → test plans (selection remapped).
 * Statuses, workflows, test layers, roles and custom fields are matched BY NAME in the target.
 * Issues are re-linked only when the target project has the same integration; otherwise they
 * are reported. Ids change; the mapping is returned and saved as restore-<target>-<time>.json.
 */
export async function restoreProject(
  client: AllureApiClient,
  root: string,
  targetProjectId: number,
  options: RestoreOptions = {},
): Promise<RestoreReport> {
  const log = options.log ?? (() => undefined);
  const dryRun = options.dryRun === true;
  const manifest = await readJson<BackupManifest>(root, PATHS.manifest);
  if (manifest.format !== BACKUP_FORMAT || manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error(`${root} is not a supported backup (format ${String(manifest.format)} v${String(manifest.formatVersion)}).`);
  }

  const warnings: string[] = [];
  const created = { testCases: 0, steps: 0, attachments: 0, sharedSteps: 0, testPlans: 0, relations: 0 };
  const testCaseIds: IdMap = new Map();
  const sharedStepIds: IdMap = new Map();

  if (!options.allowNonEmpty) {
    const existing = await testCases.searchTestCases(client, targetProjectId, "id > 0", { size: 1 });
    const existingShared = await sharedSteps.listSharedSteps(client, targetProjectId, { size: 1 });
    const count = (existing.totalElements ?? 0) + (existingShared.totalElements ?? 0);
    if (count > 0) {
      throw new Error(`Target project ${targetProjectId} is not empty (test cases / shared steps exist). Use --allow-non-empty to restore anyway.`);
    }
  }

  const sourceDictionaries = await readJson<Dictionaries>(root, PATHS.dictionaries);
  const targetDictionaries = await loadDictionaries(client, targetProjectId);
  const map = {
    status: nameMapper(sourceDictionaries.statuses, targetDictionaries.statuses),
    layer: nameMapper(sourceDictionaries.testLayers, targetDictionaries.testLayers),
    workflow: nameMapper(sourceDictionaries.workflows, targetDictionaries.workflows),
    role: nameMapper(sourceDictionaries.roles, targetDictionaries.roles),
  };
  const targetFieldByName = new Map(targetDictionaries.customFields.map((cf) => [cf.name, cf.id]));
  const missingFields = sourceDictionaries.customFields.filter((cf) => !targetFieldByName.has(cf.name));
  for (const cf of missingFields) {
    warnings.push(`custom field "${cf.name}" is not enabled in target project ${targetProjectId}; its values are skipped`);
  }

  // ── Shared steps ──────────────────────────────────────────────────────────
  const sharedStepSourceIds = await listJsonIds(root, "shared-steps");
  for (const sourceId of sharedStepSourceIds) {
    const backup = await readJson<SharedStepBackup>(root, PATHS.sharedStep(sourceId));
    const context = `shared step ${sourceId}`;
    if (dryRun) {
      created.sharedSteps += 1;
      created.steps += countScenarioNodes(backup.scenario);
      created.attachments += backup.attachments.length;
      continue;
    }
    try {
      const sharedStep = await sharedSteps.createSharedStep(client, { projectId: targetProjectId, name: backup.sharedStep.name }) as JsonRecord;
      const newId = refId(sharedStep);
      if (newId === undefined) throw new Error("POST /api/sharedstep returned no id");
      sharedStepIds.set(sourceId, newId);
      created.sharedSteps += 1;

      const attachmentIds: IdMap = new Map();
      for (const attachment of backup.attachments) {
        if (!attachment.file) continue;
        const uploaded = await sharedSteps.uploadSharedStepAttachment(
          client, newId, attachment.name, attachment.contentType, await readBinaryBase64(root, attachment.file),
        );
        const uploadedId = refId(uploaded[0]);
        if (uploadedId !== undefined) {
          attachmentIds.set(attachment.id, uploadedId);
          created.attachments += 1;
        }
      }
      const counter = { steps: 0, warnings, context };
      await writeScenarioLevel(
        sharedStepWriter(client, newId), scenarioSteps(backup.scenario), backup.scenario.root?.children, undefined,
        () => undefined, (id) => attachmentIds.get(id), counter,
      );
      created.steps += counter.steps;
      if (backup.sharedStep.archived === true) await sharedSteps.archiveSharedStep(client, newId);
    } catch (error) {
      warnings.push(`${context}: ${errorMessage(error)}`);
    }
  }
  log(`Shared steps: ${created.sharedSteps}`);

  // ── Test cases ────────────────────────────────────────────────────────────
  const testCaseSourceIds = await listJsonIds(root, "test-cases");
  const relationsToWrite: Array<{ sourceId: number; relations: TestCaseBackup["relations"] }> = [];
  let done = 0;
  for (const sourceId of testCaseSourceIds) {
    const backup = await readJson<TestCaseBackup>(root, PATHS.testCase(sourceId));
    const context = `test case ${sourceId}`;
    done += 1;
    if (done % 50 === 0 || done === testCaseSourceIds.length) log(`  ${done}/${testCaseSourceIds.length} test cases`);
    if (backup.testCase.deleted === true && !options.includeDeleted) continue;
    if (backup.relations.length > 0) relationsToWrite.push({ sourceId, relations: backup.relations });
    if (backup.issues.length > 0) {
      warnings.push(`${context}: ${backup.issues.length} issue link(s) need an integration in the target; check them manually`);
    }
    if (dryRun) {
      testCaseIds.set(sourceId, sourceId);
      created.testCases += 1;
      created.steps += countScenarioNodes(backup.scenario);
      created.attachments += backup.attachments.length;
      continue;
    }
    try {
      const testCase = await testCases.createTestCase(
        client, testCaseCreatePayload(backup.testCase, targetProjectId, map, warnings),
      ) as JsonRecord;
      const newId = refId(testCase);
      if (newId === undefined) throw new Error("POST /api/testcase returned no id");
      testCaseIds.set(sourceId, newId);
      created.testCases += 1;

      if (backup.tags.length > 0) {
        await testCases.setTestCaseTags(client, newId, backup.tags.map((tag) => ({ name: tag.name })));
      }
      const values = backup.customFields
        .map((value) => ({ customField: { id: targetFieldByName.get(value.customField.name) }, name: value.name }))
        .filter((value): value is { customField: { id: number }; name: string } => value.customField.id !== undefined);
      if (values.length > 0) await testCases.setTestCaseCustomFields(client, targetProjectId, newId, values);

      const members = backup.members
        .map((member) => ({ name: member.name, role: { id: map.role(member.role.id) } }))
        .filter((member): member is testCases.TestCaseMember => member.role.id !== undefined);
      if (members.length < backup.members.length) warnings.push(`${context}: some member roles are missing in the target`);
      if (members.length > 0) await testCases.setTestCaseMembers(client, newId, members);

      if (backup.examples.length > 0) {
        await testCases.setTestCaseExamples(
          client, newId, backup.examples.map((example) => example.map(({ name, value }) => ({ name, value }))),
        );
      }

      if (backup.issues.length > 0) {
        await testCases.setTestCaseIssues(client, newId, backup.issues.map((issue) => ({ integrationId: issue.integrationId, name: issue.name })));
      }

      const attachmentIds: IdMap = new Map();
      for (const attachment of backup.attachments) {
        if (!attachment.file) {
          warnings.push(`${context}: attachment "${attachment.name}" was not downloaded in the backup`);
          continue;
        }
        const uploaded = await testCases.uploadTestCaseAttachment(
          client, newId, attachment.name, attachment.contentType, await readBinaryBase64(root, attachment.file),
        ) as unknown[];
        const uploadedId = refId(uploaded?.[0]);
        if (uploadedId !== undefined) {
          attachmentIds.set(attachment.id, uploadedId);
          created.attachments += 1;
        }
      }

      const counter = { steps: 0, warnings, context };
      await writeScenarioLevel(
        testCaseWriter(client, newId), scenarioSteps(backup.scenario), backup.scenario.root?.children, undefined,
        (id) => sharedStepIds.get(id), (id) => attachmentIds.get(id), counter,
      );
      created.steps += counter.steps;

      if (backup.testCase.external === true) await testCases.updateTestCase(client, newId, { external: true });
      if (backup.testCase.deleted === true) await testCases.deleteTestCase(client, newId);
    } catch (error) {
      warnings.push(`${context}: ${errorMessage(error)}`);
    }
  }
  log(`Test cases: ${created.testCases}`);

  // ── Relations (need both ends restored) ───────────────────────────────────
  for (const { sourceId, relations } of relationsToWrite) {
    const mapped = relations
      .map((relation) => ({ type: relation.type, target: { id: testCaseIds.get(relation.target.id) } }))
      .filter((relation): relation is testCases.TestCaseRelation => relation.target.id !== undefined);
    if (mapped.length < relations.length) {
      warnings.push(`test case ${sourceId}: ${relations.length - mapped.length} relation(s) point outside the backup and were skipped`);
    }
    if (dryRun) {
      created.relations += mapped.length;
      continue;
    }
    const newId = testCaseIds.get(sourceId);
    if (newId === undefined || mapped.length === 0) continue;
    try {
      await testCases.setTestCaseRelations(client, newId, mapped);
      created.relations += mapped.length;
    } catch (error) {
      warnings.push(`test case ${sourceId} relations: ${errorMessage(error)}`);
    }
  }

  // ── Test plans ────────────────────────────────────────────────────────────
  for (const sourceId of await listJsonIds(root, "test-plans")) {
    const { testPlan } = await readJson<TestPlanBackup>(root, PATHS.testPlan(sourceId));
    const payload = testPlanPayload(testPlan, targetProjectId, testCaseIds, warnings);
    if (dryRun) {
      created.testPlans += 1;
      continue;
    }
    try {
      await createTestPlan(client, payload);
      created.testPlans += 1;
    } catch (error) {
      warnings.push(`test plan ${sourceId}: ${errorMessage(error)}`);
    }
  }
  log(`Test plans: ${created.testPlans}`);

  const report: RestoreReport = {
    sourceProjectId: manifest.projectId,
    targetProjectId,
    dryRun,
    created,
    idMap: {
      testCases: dryRun ? {} : Object.fromEntries(testCaseIds),
      sharedSteps: Object.fromEntries(sharedStepIds),
    },
    warnings,
  };
  if (!dryRun) {
    const stamp = (options.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    report.reportFile = join(root, `restore-${targetProjectId}-${stamp}.json`);
    await writeJson(root, `restore-${targetProjectId}-${stamp}.json`, report);
  }
  return report;
}

