import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ScenarioStepDto } from "../types/entities.js";
import {
  PATHS,
  readJson,
  type ScenarioDump,
  type SharedStepBackup,
  type TestCaseBackup,
  type TestPlanBackup,
} from "./format.js";

type JsonRecord = Record<string, unknown>;
type Step = ScenarioStepDto & JsonRecord;

/**
 * Id-free view of a backup: everything a restore must reproduce, keyed by names instead of ids
 * (test cases by name, shared steps by name, attachments by file name). Two dumps of the same
 * content taken from different projects normalize to equal objects.
 */
export interface NormalizedBackup {
  testCases: Record<string, unknown>;
  sharedSteps: Record<string, unknown>;
  testPlans: Record<string, unknown>;
}

async function ids(root: string, folder: string): Promise<number[]> {
  try {
    return (await readdir(join(root, folder))).filter((f) => /^\d+\.json$/.test(f)).map((f) => Number(f.slice(0, -5)));
  } catch {
    return [];
  }
}

function name(value: unknown): unknown {
  return (value as JsonRecord | undefined)?.name;
}

function stepTree(
  scenario: ScenarioDump,
  childIds: number[] | undefined,
  sharedStepNames: Map<number, string>,
  attachmentNames: Map<number, string>,
): unknown[] {
  const steps = (scenario.scenarioSteps ?? scenario.sharedStepScenarioSteps ?? {}) as Record<string, Step>;
  return (childIds ?? []).map((id) => {
    const step = steps[String(id)];
    if (!step) return { missing: id };
    const expected = typeof step.expectedResultId === "number" ? steps[String(step.expectedResultId)] : undefined;
    return {
      ...(step.body ? { body: step.body } : {}),
      ...(typeof step.sharedStepId === "number"
        ? { sharedStep: sharedStepNames.get(step.sharedStepId) ?? name(scenario.sharedSteps && (scenario.sharedSteps as JsonRecord)[String(step.sharedStepId)]) }
        : {}),
      ...(typeof step.attachmentId === "number" ? { attachment: attachmentNames.get(step.attachmentId as number) ?? step.attachmentId } : {}),
      ...(expected ? { expectedResult: stepTree(scenario, expected.children, sharedStepNames, attachmentNames) } : {}),
      ...(step.children?.length ? { children: stepTree(scenario, step.children, sharedStepNames, attachmentNames) } : {}),
    };
  });
}

function sorted<T>(items: T[]): T[] {
  return [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export async function normalizeBackup(root: string): Promise<NormalizedBackup> {
  const sharedStepNames = new Map<number, string>();
  const sharedSteps: Record<string, unknown> = {};
  for (const id of await ids(root, "shared-steps")) {
    const backup = await readJson<SharedStepBackup>(root, PATHS.sharedStep(id));
    sharedStepNames.set(id, String(backup.sharedStep.name));
  }
  for (const id of await ids(root, "shared-steps")) {
    const backup = await readJson<SharedStepBackup>(root, PATHS.sharedStep(id));
    const attachmentNames = new Map(backup.attachments.map((a) => [a.id, a.name]));
    sharedSteps[String(backup.sharedStep.name)] = {
      archived: backup.sharedStep.archived === true,
      attachments: sorted(backup.attachments.map((a) => ({ name: a.name, contentType: a.contentType, contentLength: a.contentLength }))),
      steps: stepTree(backup.scenario, backup.scenario.root?.children, sharedStepNames, attachmentNames),
    };
  }

  const testCaseNames = new Map<number, string>();
  const testCaseBackups: TestCaseBackup[] = [];
  for (const id of await ids(root, "test-cases")) {
    const backup = await readJson<TestCaseBackup>(root, PATHS.testCase(id));
    testCaseNames.set(id, String(backup.testCase.name));
    testCaseBackups.push(backup);
  }

  const testCases: Record<string, unknown> = {};
  for (const backup of testCaseBackups) {
    const tc = backup.testCase;
    const attachmentNames = new Map(backup.attachments.map((a) => [a.id, a.name]));
    let key = String(tc.name);
    while (key in testCases) key += " (dup)";
    testCases[key] = {
      automated: tc.automated === true,
      external: tc.external === true,
      deleted: tc.deleted === true,
      description: tc.description ?? null,
      precondition: tc.precondition ?? null,
      expectedResult: tc.expectedResult ?? null,
      fullName: tc.fullName ?? null,
      status: name(tc.status) ?? null,
      workflow: name(tc.workflow) ?? null,
      testLayer: name(tc.testLayer) ?? null,
      links: sorted(((tc.links as JsonRecord[]) ?? []).map((l) => ({ name: l.name ?? null, url: l.url }))),
      tags: backup.tags.map((t) => t.name).sort(),
      customFields: backup.customFields.map((v) => `${v.customField.name}=${v.name}`).sort(),
      members: backup.members.map((m) => `${m.role.name ?? m.role.id}:${m.name}`).sort(),
      relations: backup.relations.map((r) => `${r.type}:${testCaseNames.get(r.target.id) ?? r.target.name ?? r.target.id}`).sort(),
      examples: sorted(backup.examples.map((e) => sorted(e.map((p) => `${p.name}=${p.value}`)))),
      issues: backup.issues.map((i) => String(i.name)).sort(),
      attachments: sorted(backup.attachments.map((a) => ({ name: a.name, contentType: a.contentType, contentLength: a.contentLength }))),
      steps: stepTree(backup.scenario, backup.scenario.root?.children, sharedStepNames, attachmentNames),
    };
  }

  const testPlans: Record<string, unknown> = {};
  for (const id of await ids(root, "test-plans")) {
    const { testPlan } = await readJson<TestPlanBackup>(root, PATHS.testPlan(id));
    const selection = testPlan.treeSelection as JsonRecord | undefined;
    const names = (value: unknown) =>
      (Array.isArray(value) ? value : []).map((tcId) => testCaseNames.get(Number(tcId)) ?? `#${String(tcId)}`).sort();
    testPlans[String(testPlan.name)] = {
      baseRql: testPlan.baseRql ?? null,
      inverted: selection?.inverted === true,
      include: names(selection?.leafsInclude),
      exclude: names(selection?.leafsExclude),
    };
  }

  return { testCases, sharedSteps, testPlans };
}

/** Lists differences between two normalized backups as `path: left → right` lines (empty = equal). */
export function diffNormalized(left: unknown, right: unknown, path = ""): string[] {
  if (JSON.stringify(left) === JSON.stringify(right)) return [];
  const isObject = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (isObject(left) && isObject(right)) {
    const keys = [...new Set([...Object.keys(left as JsonRecord), ...Object.keys(right as JsonRecord)])].sort();
    return keys.flatMap((key) => diffNormalized((left as JsonRecord)[key], (right as JsonRecord)[key], path ? `${path}.${key}` : key));
  }
  return [`${path}: ${JSON.stringify(left)} → ${JSON.stringify(right)}`];
}
