import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TestCaseStepsResponse } from "../types/entities.js";

export const BACKUP_FORMAT = "allure-testops-backup";
export const BACKUP_FORMAT_VERSION = 1;

type JsonRecord = Record<string, unknown>;

export interface NamedRef {
  id: number;
  name: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  toolVersion?: string;
  supportedApiVersion?: string;
  baseUrl?: string;
  projectId: number;
  projectName?: string;
  createdAt: string;
  includeDeleted: boolean;
  /** Relative path of Allure's native CSV export, or null when it was skipped / failed. */
  csv: string | null;
  counts: {
    testCases: number;
    deletedTestCases: number;
    steps: number;
    attachments: number;
    sharedSteps: number;
    testPlans: number;
  };
  warnings: string[];
}

export interface AttachmentEntry {
  id: number;
  name: string;
  contentType: string;
  contentLength?: number;
  /** Path relative to the backup root; absent when attachments were not downloaded. */
  file?: string;
}

/** A scenario as returned by `GET /api/testcase/{id}/step` or `GET /api/sharedstep/{id}/step`. */
export type ScenarioDump = TestCaseStepsResponse & {
  sharedStepScenarioSteps?: TestCaseStepsResponse["scenarioSteps"];
  attachments?: Record<string, JsonRecord>;
  [key: string]: unknown;
};

export interface TestCaseBackup {
  testCase: JsonRecord;
  scenario: ScenarioDump;
  tags: Array<{ id?: number; name: string }>;
  issues: JsonRecord[];
  customFields: Array<{ id?: number; name: string; customField: NamedRef }>;
  members: Array<{ name: string; role: { id: number; name?: string } }>;
  relations: Array<{ type: string; target: { id: number; name?: string } }>;
  examples: Array<Array<{ name: string; value: string }>>;
  attachments: AttachmentEntry[];
}

export interface SharedStepBackup {
  sharedStep: JsonRecord;
  scenario: ScenarioDump;
  attachments: AttachmentEntry[];
}

export interface TestPlanBackup {
  testPlan: JsonRecord;
}

export interface Dictionaries {
  statuses: NamedRef[];
  testLayers: NamedRef[];
  workflows: NamedRef[];
  roles: NamedRef[];
  customFields: NamedRef[];
}

export const PATHS = {
  manifest: "manifest.json",
  dictionaries: "project/dictionaries.json",
  project: "project/project.json",
  csv: "test-cases.csv",
  testCase: (id: number) => `test-cases/${id}.json`,
  sharedStep: (id: number) => `shared-steps/${id}.json`,
  testPlan: (id: number) => `test-plans/${id}.json`,
  testCaseAttachment: (testCaseId: number, attachmentId: number, name: string) =>
    `attachments/test-cases/${testCaseId}/${attachmentId}-${safeFileName(name)}`,
  sharedStepAttachment: (sharedStepId: number, attachmentId: number, name: string) =>
    `attachments/shared-steps/${sharedStepId}/${attachmentId}-${safeFileName(name)}`,
};

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return (cleaned || "file").slice(0, 80);
}

/** Recursively sorts object keys so that two backups of the same data diff cleanly. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as JsonRecord).sort().map((key) => [key, sortKeys((value as JsonRecord)[key])]),
    );
  }
  return value;
}

export async function writeJson(root: string, relativePath: string, data: unknown): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(sortKeys(data), null, 2) + "\n", "utf-8");
}

export async function readJson<T>(root: string, relativePath: string): Promise<T> {
  return JSON.parse(await readFile(join(root, relativePath), "utf-8")) as T;
}

export async function writeBinary(root: string, relativePath: string, base64: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(base64, "base64"));
}

export async function readBinaryBase64(root: string, relativePath: string): Promise<string> {
  return (await readFile(join(root, relativePath))).toString("base64");
}

/** Runs `worker` over `items` with at most `limit` in flight, preserving result order. */
export async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
