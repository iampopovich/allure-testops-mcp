import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffNormalized, normalizeBackup } from "../../../src/backup/compare.js";
import { dumpProject } from "../../../src/backup/dump.js";
import { restoreProject } from "../../../src/backup/restore.js";
import { FakeAllure } from "./fake-allure.js";

const SOURCE = 1;
const TARGET = 2;

function seed(fake: FakeAllure) {
  const shared = fake.addSharedStep(SOURCE, "SS Login as admin");
  const ssLogin = fake.addStep(shared.scenario, { body: "Open /login" });
  const ssSubmit = fake.addStep(shared.scenario, { body: "Submit admin credentials", afterId: ssLogin.id }, true);
  fake.addStep(shared.scenario, { body: "Admin dashboard opened", parentId: ssSubmit.expectedResultId });
  fake.addAttachment(shared.id, "ss-note.txt", "shared attachment", true);

  const full = fake.addTestCase(SOURCE, {
    name: "TC full",
    description: "Verifies **login**",
    precondition: "User exists",
    links: [{ name: "Spec", url: "https://example.com/spec" }],
    status: { id: -3, name: "Active" },
    workflow: { id: -1, name: "Default Manual" },
    testLayer: { id: -2, name: "UI Tests" },
    tags: [{ id: 1, name: "smoke" }, { id: 2, name: "login" }],
    cfv: [
      { id: 10, name: "Authentication", customField: { id: -2, name: "Feature" } },
      { id: 11, name: "Happy path", customField: { id: -3, name: "Story" } },
    ],
    members: [{ name: "klumba", role: { id: -1, name: "Owner" } }],
    examples: [[{ name: "browser", value: "firefox" }], [{ name: "browser", value: "chrome" }]],
  });
  const attachment = fake.addAttachment(full.id, "notes.txt", "hello");
  const open = fake.addStep(full.scenario, { bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Open login page" }] }] } }, true);
  fake.addStep(full.scenario, { body: "Form is displayed", parentId: open.expectedResultId });
  const sharedRef = fake.addStep(full.scenario, { sharedStepId: shared.id, afterId: open.id });
  const enter = fake.addStep(full.scenario, { body: "Enter credentials", afterId: sharedRef.id }, true);
  const type = fake.addStep(full.scenario, { body: "Type username", parentId: enter.id });
  fake.addStep(full.scenario, { body: "Type password", parentId: enter.id, afterId: type.id });
  const line1 = fake.addStep(full.scenario, { body: "Redirected to dashboard", parentId: enter.expectedResultId });
  fake.addStep(full.scenario, { body: "Welcome toast", parentId: enter.expectedResultId, afterId: line1.id });
  fake.addStep(full.scenario, { attachmentId: attachment.id, afterId: enter.id });

  const minimal = fake.addTestCase(SOURCE, { name: "TC minimal", expectedResult: "Overall: logged in", status: { id: -2, name: "Review" }, workflow: { id: -1, name: "Default Manual" } });
  full.relations = [{ type: "related to", target: { id: minimal.id, name: minimal.name } }];
  minimal.relations = [{ type: "related to", target: { id: full.id, name: full.name } }];
  fake.addTestCase(SOURCE, { name: "TC trashed", deleted: true, status: { id: -1, name: "Draft" }, workflow: { id: -1, name: "Default Manual" } });

  fake.testPlans.set(900, { id: 900, projectId: SOURCE, name: "TP explicit", treeSelection: { inverted: false, leafsInclude: [full.id, minimal.id], leafsExclude: [] } });
  fake.testPlans.set(901, { id: 901, projectId: SOURCE, name: "TP smoke", baseRql: 'tag = "smoke"' });
  return { full, minimal };
}

describe("project backup and restore", () => {
  let dir: string;
  let fake: FakeAllure;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "allure-backup-"));
    fake = new FakeAllure();
    seed(fake);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const dump = (projectId: number, now: Date) =>
    dumpProject(fake.client as never, projectId, { outDir: dir, includeDeleted: true, csv: false, now });

  it("dumps every entity into the documented layout", async () => {
    const { dir: root, manifest } = await dump(SOURCE, new Date("2026-10-30T10:00:00Z"));

    expect(root.endsWith("1-20261030-100000")).toBe(true);
    expect(manifest.counts).toEqual({ testCases: 3, deletedTestCases: 1, steps: 11, attachments: 2, sharedSteps: 1, testPlans: 2 });
    expect(manifest.warnings).toEqual([]);
    expect((await readdir(join(root, "test-cases"))).length).toBe(3);
    const attachmentFolders = await readdir(join(root, "attachments", "test-cases"));
    expect(attachmentFolders.length).toBe(1);
    const tcFile = JSON.parse(await readFile(join(root, "test-cases", `${[...fake.testCases.keys()][0]}.json`), "utf-8"));
    expect(Object.keys(tcFile)).toEqual(["attachments", "customFields", "examples", "issues", "members", "relations", "scenario", "tags", "testCase"]);
  });

  it("restores into an empty project so that a new dump is equivalent (ids aside)", async () => {
    const source = await dump(SOURCE, new Date("2026-10-30T10:00:00Z"));
    const report = await restoreProject(fake.client as never, source.dir, TARGET, { includeDeleted: true });

    expect(report.warnings).toEqual([]);
    expect(report.created).toEqual({ testCases: 3, steps: 12, attachments: 2, sharedSteps: 1, testPlans: 2, relations: 2 });
    expect(Object.keys(report.idMap.testCases)).toHaveLength(3);

    const target = await dump(TARGET, new Date("2026-10-30T11:00:00Z"));
    const differences = diffNormalized(await normalizeBackup(source.dir), await normalizeBackup(target.dir));
    expect(differences).toEqual([]);
  });

  it("dry run reports counts and writes nothing", async () => {
    const source = await dump(SOURCE, new Date("2026-10-30T10:00:00Z"));
    const writesBefore = fake.writes.length;

    const report = await restoreProject(fake.client as never, source.dir, TARGET, { dryRun: true });

    expect(fake.writes.length).toBe(writesBefore);
    expect(report.dryRun).toBe(true);
    expect(report.created).toEqual({ testCases: 2, steps: 12, attachments: 2, sharedSteps: 1, testPlans: 2, relations: 2 });
    expect(report.warnings).toEqual([]);
    expect(report.reportFile).toBeUndefined();
  });

  it("refuses a non-empty target unless allowNonEmpty is set", async () => {
    const source = await dump(SOURCE, new Date("2026-10-30T10:00:00Z"));
    fake.addTestCase(TARGET, { name: "already here" });

    await expect(restoreProject(fake.client as never, source.dir, TARGET)).rejects.toThrow(/not empty/);
    const report = await restoreProject(fake.client as never, source.dir, TARGET, { allowNonEmpty: true });
    expect(report.created.testCases).toBe(2);
  });

  it("skips trashed test cases by default and reports relations/plans that point outside the restore", async () => {
    const source = await dump(SOURCE, new Date("2026-10-30T10:00:00Z"));
    const report = await restoreProject(fake.client as never, source.dir, TARGET);

    expect(report.created.testCases).toBe(2);
    const restored = [...fake.testCases.values()].filter((tc) => tc.projectId === TARGET);
    expect(restored.map((tc) => tc.name).sort()).toEqual(["TC full", "TC minimal"]);
    expect(restored.every((tc) => !tc.deleted)).toBe(true);
  });

  it("writes steps in order with expected-result containers and remapped shared steps", async () => {
    const source = await dump(SOURCE, new Date("2026-10-30T10:00:00Z"));
    await restoreProject(fake.client as never, source.dir, TARGET);

    const restored = [...fake.testCases.values()].find((tc) => tc.projectId === TARGET && tc.name === "TC full")!;
    const nodes = restored.scenario.nodes;
    const top = restored.scenario.root.map((id) => nodes.get(id)!);
    expect(top.map((n) => n.body ?? (n.sharedStepId ? "shared" : "attachment"))).toEqual(["Open login page", "shared", "Enter credentials", "attachment"]);

    const newShared = [...fake.sharedSteps.values()].find((ss) => ss.projectId === TARGET)!;
    expect(top[1].sharedStepId).toBe(newShared.id);
    const erLines = nodes.get(top[2].expectedResultId!)!.children.map((id) => nodes.get(id)!.body);
    expect(erLines).toEqual(["Redirected to dashboard", "Welcome toast"]);
    expect(top[2].children.map((id) => nodes.get(id)!.body)).toEqual(["Type username", "Type password"]);
    const newAttachment = [...fake.tcAttachments.values()].find((a) => a.owner === restored.id)!;
    expect(top[3].attachmentId).toBe(newAttachment.id);
  });

  it("rejects a directory that is not a backup", async () => {
    await expect(restoreProject(fake.client as never, dir, TARGET)).rejects.toThrow();
  });
});
