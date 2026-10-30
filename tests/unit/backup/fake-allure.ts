/**
 * In-memory fake of the Allure TestOps endpoints used by backup/restore.
 * It mirrors the behaviour recorded in docs/research/ui-flows-network-journal.md:
 * steps with `withExpectedResult=true` get an "Expected Result" container, `afterId` positions a
 * step after its sibling, members / relations / examples / tags are full replace, CFV add appends.
 */
type JsonRecord = Record<string, unknown>;
type Query = Record<string, unknown> | undefined;

interface Node {
  id: number;
  body?: string;
  bodyJson?: unknown;
  children: number[];
  expectedResultId?: number;
  sharedStepId?: number;
  attachmentId?: number;
}

interface Scenario {
  root: number[];
  nodes: Map<number, Node>;
}

interface TestCase {
  id: number;
  projectId: number;
  name: string;
  description?: string;
  precondition?: string;
  expectedResult?: string;
  fullName?: string;
  automated: boolean;
  external: boolean;
  deleted: boolean;
  links: JsonRecord[];
  status?: { id: number; name: string };
  workflow?: { id: number; name: string };
  testLayer?: { id: number; name: string };
  tags: Array<{ id: number; name: string }>;
  cfv: Array<{ id: number; name: string; customField: { id: number; name: string } }>;
  members: Array<{ name: string; role: { id: number; name: string } }>;
  relations: Array<{ type: string; target: { id: number; name: string } }>;
  examples: Array<Array<{ name: string; value: string }>>;
  issues: JsonRecord[];
  scenario: Scenario;
}

interface SharedStep {
  id: number;
  projectId: number;
  name: string;
  archived: boolean;
  scenario: Scenario;
}

interface Attachment {
  id: number;
  owner: number;
  name: string;
  contentType: string;
  content: string;
}

const STATUSES = [{ id: -1, name: "Draft" }, { id: -2, name: "Review" }, { id: -3, name: "Active" }];
const WORKFLOWS = [{ id: -1, name: "Default Manual" }, { id: -2, name: "Default Automated" }];
const LAYERS = [{ id: -1, name: "Unit Tests" }, { id: -2, name: "UI Tests" }, { id: -3, name: "API Tests" }];
const ROLES = [{ id: -1, name: "Owner" }, { id: -2, name: "Lead" }];
const FIELDS = [{ id: -2, name: "Feature" }, { id: -3, name: "Story" }, { id: -5, name: "Suite" }];

function page<T>(items: T[], query: Query): JsonRecord {
  const size = Number(query?.size ?? 20);
  const number = Number(query?.page ?? 0);
  return {
    content: items.slice(number * size, number * size + size),
    totalElements: items.length,
    totalPages: Math.ceil(items.length / size),
    number,
    size,
  };
}

function renderScenario(scenario: Scenario): { root: { children: number[] }; steps: Record<string, JsonRecord> } {
  const steps: Record<string, JsonRecord> = {};
  for (const node of scenario.nodes.values()) {
    steps[String(node.id)] = {
      id: node.id,
      ...(node.body !== undefined ? { body: node.body } : {}),
      ...(node.bodyJson !== undefined ? { bodyJson: node.bodyJson } : {}),
      ...(node.children.length ? { children: [...node.children] } : {}),
      ...(node.expectedResultId !== undefined ? { expectedResultId: node.expectedResultId } : {}),
      ...(node.sharedStepId !== undefined ? { sharedStepId: node.sharedStepId } : {}),
      ...(node.attachmentId !== undefined ? { attachmentId: node.attachmentId } : {}),
    };
  }
  return { root: { children: [...scenario.root] }, steps };
}

function bodyText(bodyJson: unknown): string | undefined {
  const doc = bodyJson as { content?: Array<{ content?: Array<{ text?: string }> }> } | undefined;
  return doc?.content?.flatMap((p) => p.content ?? []).map((t) => t.text ?? "").join("") || undefined;
}

export class FakeAllure {
  private nextId = 1000;
  readonly testCases = new Map<number, TestCase>();
  readonly sharedSteps = new Map<number, SharedStep>();
  readonly testPlans = new Map<number, JsonRecord>();
  readonly tcAttachments = new Map<number, Attachment>();
  readonly ssAttachments = new Map<number, Attachment>();
  readonly writes: string[] = [];

  id(): number {
    this.nextId += 1;
    return this.nextId;
  }

  // ── seeding helpers ──────────────────────────────────────────────────────
  addTestCase(projectId: number, fields: Partial<TestCase> & { name: string }): TestCase {
    const tc: TestCase = {
      id: this.id(), projectId, automated: false, external: false, deleted: false, links: [], tags: [], cfv: [],
      members: [], relations: [], examples: [], issues: [], scenario: { root: [], nodes: new Map() }, ...fields,
    };
    this.testCases.set(tc.id, tc);
    return tc;
  }

  addSharedStep(projectId: number, name: string): SharedStep {
    const ss: SharedStep = { id: this.id(), projectId, name, archived: false, scenario: { root: [], nodes: new Map() } };
    this.sharedSteps.set(ss.id, ss);
    return ss;
  }

  addStep(scenario: Scenario, node: Omit<Node, "id" | "children"> & { parentId?: number; afterId?: number }, withExpectedResult = false): Node {
    const created: Node = { id: this.id(), children: [], ...node };
    delete (created as Partial<Node> & { parentId?: number }).parentId;
    delete (created as Partial<Node> & { afterId?: number }).afterId;
    if (created.body === undefined && created.bodyJson !== undefined) created.body = bodyText(created.bodyJson);
    scenario.nodes.set(created.id, created);
    const siblings = node.parentId !== undefined ? scenario.nodes.get(node.parentId)!.children : scenario.root;
    const index = node.afterId !== undefined ? siblings.indexOf(node.afterId) + 1 : siblings.length;
    siblings.splice(index, 0, created.id);
    if (withExpectedResult) {
      const container: Node = { id: this.id(), body: "Expected Result", children: [] };
      scenario.nodes.set(container.id, container);
      created.expectedResultId = container.id;
    }
    return created;
  }

  addAttachment(owner: number, name: string, content: string, shared = false): Attachment {
    const attachment = { id: this.id(), owner, name, contentType: "text/plain", content: Buffer.from(content).toString("base64") };
    (shared ? this.ssAttachments : this.tcAttachments).set(attachment.id, attachment);
    return attachment;
  }

  // ── client surface ───────────────────────────────────────────────────────
  readonly client = {
    defaultProjectId: undefined,
    get: async (path: string, query?: Query) => this.handleGet(path, query),
    post: async (path: string, body?: unknown, query?: Query) => this.handleWrite("POST", path, body, query),
    patch: async (path: string, body?: unknown, query?: Query) => this.handleWrite("PATCH", path, body, query),
    put: async (path: string, body?: unknown, query?: Query) => this.handleWrite("PUT", path, body, query),
    delete: async (path: string, query?: Query) => this.handleWrite("DELETE", path, undefined, query),
    getRaw: async (path: string) => {
      const match = path.match(/^\/api\/(testcase|sharedstep)\/attachment\/(\d+)\/content$/);
      const store = match?.[1] === "sharedstep" ? this.ssAttachments : this.tcAttachments;
      const attachment = match ? store.get(Number(match[2])) : undefined;
      if (!attachment) throw new Error(`404 ${path}`);
      return { contentType: attachment.contentType, content: attachment.content, encoding: "base64" };
    },
    postMultipart: async (path: string, form: FormData, query?: Query) => {
      const file = form.get("file") as File;
      const content = Buffer.from(await file.arrayBuffer()).toString("utf-8");
      this.writes.push(`POST ${path}`);
      if (path === "/api/testcase/attachment") return [this.toRow(this.addAttachment(Number(query?.testCaseId), file.name, content))];
      if (path === "/api/sharedstep/attachment") return [this.toRow(this.addAttachment(Number(query?.sharedStepId), file.name, content, true))];
      throw new Error(`unexpected multipart ${path}`);
    },
  };

  private toRow(attachment: Attachment): JsonRecord {
    return { id: attachment.id, name: attachment.name, contentType: attachment.contentType, contentLength: Buffer.from(attachment.content, "base64").length };
  }

  private sharedStepRow(ss: SharedStep): JsonRecord {
    return { id: ss.id, projectId: ss.projectId, name: ss.name, archived: ss.archived };
  }

  private tc(id: number): TestCase {
    const tc = this.testCases.get(id);
    if (!tc) throw new Error(`404 test case ${id}`);
    return tc;
  }

  private testCaseDto(tc: TestCase): JsonRecord {
    const fields = ["id", "projectId", "name", "description", "precondition", "expectedResult", "fullName",
      "automated", "external", "deleted", "status", "workflow", "testLayer"] as const;
    const dto: JsonRecord = Object.fromEntries(fields.filter((key) => tc[key] !== undefined).map((key) => [key, tc[key]]));
    return { ...dto, tags: tc.tags.map((t) => ({ ...t })), links: tc.links.map((l) => ({ ...l })) };
  }

  private handleGet(path: string, query: Query): unknown {
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/api\/project\/(\d+)$/))) return { id: Number(m[1]), name: `project ${m[1]}` };
    if (path === "/api/status") return page(STATUSES, { size: 1000 });
    if (path === "/api/testlayer") return page(LAYERS, { size: 1000 });
    if (path === "/api/workflow") return page(WORKFLOWS, { size: 1000 });
    if (path === "/api/role") return ROLES;
    if ((m = path.match(/^\/api\/project\/(\d+)\/cf$/))) return page(FIELDS.map((f) => ({ customField: f })), query);
    if (path === "/api/testcase/__search") {
      const deleted = query?.deleted === true;
      const rows = [...this.testCases.values()]
        .filter((tc) => tc.projectId === Number(query?.projectId) && tc.deleted === deleted)
        .sort((a, b) => a.id - b.id)
        .map((tc) => this.testCaseDto(tc));
      return page(rows, query);
    }
    if (path === "/api/testcase/attachment") {
      return page([...this.tcAttachments.values()].filter((a) => a.owner === Number(query?.testCaseId)).map((a) => this.toRow(a)), query);
    }
    if ((m = path.match(/^\/api\/testcase\/(\d+)(?:\/(\w+))?$/))) {
      const tc = this.tc(Number(m[1]));
      switch (m[2]) {
        case undefined: return this.testCaseDto(tc);
        case "step": {
          const { root, steps } = renderScenario(tc.scenario);
          return { root, scenarioSteps: steps, attachments: {}, sharedSteps: {}, sharedStepScenarioSteps: {} };
        }
        case "tag": return tc.tags;
        case "issue": return tc.issues;
        case "cfv": return tc.cfv;
        case "members": return tc.members;
        case "relation": return tc.relations;
        case "example": return page(tc.examples.map((parameters, i) => ({ id: i + 1, parameters })), query);
      }
    }
    if (path === "/api/sharedstep") {
      const archived = query?.archived === true;
      return page([...this.sharedSteps.values()]
        .filter((ss) => ss.projectId === Number(query?.projectId) && (query?.archived === undefined || ss.archived === archived))
        .map((ss) => this.sharedStepRow(ss)), query);
    }
    if (path === "/api/sharedstep/attachment") {
      return page([...this.ssAttachments.values()].filter((a) => a.owner === Number(query?.sharedStepId)).map((a) => this.toRow(a)), query);
    }
    if ((m = path.match(/^\/api\/sharedstep\/(\d+)\/step$/))) {
      const { root, steps } = renderScenario(this.sharedSteps.get(Number(m[1]))!.scenario);
      return { root, sharedStepScenarioSteps: steps, sharedStepAttachments: {} };
    }
    if (path === "/api/testplan") {
      return page([...this.testPlans.values()].filter((tp) => tp.projectId === Number(query?.projectId)), query);
    }
    if ((m = path.match(/^\/api\/testplan\/(\d+)$/))) return this.testPlans.get(Number(m[1]));
    throw new Error(`unexpected GET ${path}`);
  }

  private handleWrite(method: string, path: string, body: unknown, query: Query): unknown {
    this.writes.push(`${method} ${path}`);
    const data = body as JsonRecord;
    let m: RegExpMatchArray | null;
    if (method === "POST" && path === "/api/testcase") {
      const tc = this.addTestCase(Number(data.projectId), {
        name: String(data.name),
        ...(data.description !== undefined ? { description: String(data.description) } : {}),
        ...(data.precondition !== undefined ? { precondition: String(data.precondition) } : {}),
        ...(data.expectedResult !== undefined ? { expectedResult: String(data.expectedResult) } : {}),
        ...(data.fullName !== undefined ? { fullName: String(data.fullName) } : {}),
        automated: data.automated === true,
        links: (data.links as JsonRecord[]) ?? [],
        workflow: WORKFLOWS.find((w) => w.id === data.workflowId) ?? WORKFLOWS[0],
        status: STATUSES.find((s) => s.id === data.statusId) ?? STATUSES[0],
        ...(data.testLayerId !== undefined ? { testLayer: LAYERS.find((l) => l.id === data.testLayerId) } : {}),
      });
      return this.testCaseDto(tc);
    }
    if (method === "POST" && path === "/api/testcase/step") {
      const tc = this.tc(Number(data.testCaseId));
      const withExpectedResult = query?.withExpectedResult === true;
      if (withExpectedResult && data.expectedResultId !== -1) throw new Error("ER container needs expectedResultId -1");
      const node = this.addStep(tc.scenario, {
        parentId: data.parentId as number | undefined,
        afterId: query?.afterId as number | undefined,
        body: data.body as string | undefined,
        bodyJson: data.bodyJson,
        sharedStepId: data.sharedStepId as number | undefined,
        attachmentId: data.attachmentId as number | undefined,
      }, withExpectedResult);
      return { createdStepId: node.id, scenario: { scenarioSteps: renderScenario(tc.scenario).steps } };
    }
    if (method === "POST" && path === "/api/sharedstep/step") {
      const ss = this.sharedSteps.get(Number(data.sharedStepId))!;
      const node = this.addStep(ss.scenario, {
        parentId: data.parentId as number | undefined,
        afterId: query?.afterId as number | undefined,
        body: data.body as string | undefined,
        bodyJson: data.bodyJson,
        attachmentId: data.attachmentId as number | undefined,
      }, query?.withExpectedResult === true);
      return { createdStepId: node.id, scenario: { sharedStepScenarioSteps: renderScenario(ss.scenario).steps } };
    }
    if (method === "POST" && path === "/api/sharedstep") {
      return this.sharedStepRow(this.addSharedStep(Number(data.projectId), String(data.name)));
    }
    if ((m = path.match(/^\/api\/sharedstep\/(\d+)\/archive$/))) {
      this.sharedSteps.get(Number(m[1]))!.archived = true;
      return undefined;
    }
    if (method === "POST" && path === "/api/v2/test-case/bulk/cfv/add") {
      const selection = data.selection as { testCasesInclude: number[] };
      for (const id of selection.testCasesInclude) {
        const tc = this.tc(id);
        for (const value of data.cfv as Array<{ customField: { id: number }; name: string }>) {
          const field = FIELDS.find((f) => f.id === value.customField.id)!;
          tc.cfv.push({ id: this.id(), name: value.name, customField: { ...field } });
        }
      }
      return undefined;
    }
    if (method === "POST" && path === "/api/testplan") {
      const plan = { ...data, id: this.id() };
      this.testPlans.set(plan.id as number, plan);
      return plan;
    }
    if ((m = path.match(/^\/api\/testcase\/(\d+)(?:\/(\w+))?$/))) {
      const tc = this.tc(Number(m[1]));
      if (method === "DELETE" && m[2] === undefined) { tc.deleted = true; return undefined; }
      if (method === "PATCH" && m[2] === undefined) { Object.assign(tc, data); return this.testCaseDto(tc); }
      switch (m[2]) {
        case "tag":
          tc.tags = (body as Array<{ name: string }>).map((t) => ({ id: this.id(), name: t.name }));
          return tc.tags;
        case "members":
          tc.members = (body as Array<{ name: string; role: { id: number } }>).map((x) => ({ name: x.name, role: ROLES.find((r) => r.id === x.role.id)! }));
          return tc.members;
        case "relation":
          tc.relations = (body as Array<{ type: string; target: { id: number } }>).map((r) => ({ type: r.type, target: { id: r.target.id, name: this.tc(r.target.id).name } }));
          return tc.relations;
        case "example":
          tc.examples = body as TestCase["examples"];
          return undefined;
        case "issue":
          tc.issues = body as JsonRecord[];
          return tc.issues;
      }
    }
    throw new Error(`unexpected ${method} ${path}`);
  }
}
