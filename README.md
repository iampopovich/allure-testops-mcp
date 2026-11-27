<h1 align="center">Allure TestOps MCP Server</h1>

<p align="center">Let an AI assistant search, triage and update your Allure TestOps test cases, launches and results.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/allure-testops-mcp"><img alt="npm version" src="https://img.shields.io/npm/v/allure-testops-mcp"></a>
  <a href="https://www.npmjs.com/package/allure-testops-mcp"><img alt="monthly downloads" src="https://img.shields.io/npm/dm/allure-testops-mcp"></a>
  <a href="https://www.npmjs.com/package/allure-testops-mcp"><img alt="total downloads" src="https://img.shields.io/npm/dt/allure-testops-mcp"></a>
  <a href="https://bundlephobia.com/package/allure-testops-mcp"><img alt="package size" src="https://img.shields.io/bundlephobia/min/allure-testops-mcp"></a>
  <a href="https://github.com/iampopovich/allure-testops-mcp/blob/main/LICENSE"><img alt="MIT License" src="https://img.shields.io/npm/l/allure-testops-mcp"></a>
  <a href="https://github.com/iampopovich/allure-testops-mcp/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/iampopovich/allure-testops-mcp/actions/workflows/ci.yml/badge.svg"></a>
</p>

QA engineers spend a lot of time clicking through the test management system: finding which tests failed in a launch, checking whether they failed before, grouping failures into defects, updating test cases after a release. This server lets an AI assistant (Claude, Cursor or any other MCP client) do that work through the official Allure TestOps API, using your own API token. It is a small Node.js process that runs on your machine and talks only to your Allure TestOps instance.

## What you can ask

- "Which tests failed in launch 412, and were they failing in earlier launches?"
- "Find failures similar to defect 57 in launch 412 and link them to the defect."
- "Create a test case 'Checkout with an expired card' with these steps and expected results, tagged smoke."
- "Run the 'Nightly regression' test plan as launch 'RC 4.2', then show its progress."
- "What is the success rate of test case 1830 over the last month?"
- "Export launch 412 to CSV."

## Quick start

You need Node.js 18 or newer, the URL of your Allure TestOps instance and an API token (Allure profile, API tokens).

Add the server to your MCP client configuration:

```json
{
  "mcpServers": {
    "allure-testops": {
      "command": "npx",
      "args": ["-y", "allure-testops-mcp"],
      "env": {
        "ALLURE_TESTOPS_URL": "https://allure.example.com",
        "ALLURE_TOKEN": "<your API token>",
        "ALLURE_PROJECT_ID": "<optional default project id>"
      }
    }
  }
}
```

Claude Code, in one line:

```bash
claude mcp add allure-testops -e ALLURE_TESTOPS_URL=https://allure.example.com -e ALLURE_TOKEN=<your API token> -- npx -y allure-testops-mcp
```

<details>
<summary>Other clients, Docker and the agent skill</summary>

- **Claude Desktop**: add the `mcpServers` entry above to `claude_desktop_config.json` and restart the app.
- **Cursor**: add the same entry to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global), then reload MCP servers.
- **Any other stdio MCP client**: command `npx`, args `-y allure-testops-mcp`, plus the environment variables below.
- **Docker** (no published image; build it from a checkout):

  ```bash
  docker build -t allure-testops-mcp .
  docker run -i --rm -e ALLURE_TESTOPS_URL=https://allure.example.com -e ALLURE_TOKEN=<token> allure-testops-mcp
  ```

  In an MCP client use `"command": "docker"` with `"args": ["run", "-i", "--rm", "-e", "ALLURE_TESTOPS_URL", "-e", "ALLURE_TOKEN", "allure-testops-mcp"]` and put the values in `env`.
- **Agent skill**: [`skills/allure-testops/`](skills/allure-testops/) tells the agent which tool to use for which task and how to avoid Allure API quirks that lose data. Copy it to `~/.claude/skills/` (Claude Code) or your agent's skills directory.

</details>

More guides: [running locally](docs/usages/running-locally.md), [integrations](docs/usages/integrations.md), [Docker](docs/usages/docker.md), [example prompts per area](docs/usages/examples/README.md), [user flows](docs/usages/user-flows.md), [AQL reference](docs/usages/aql-reference.md).

## Configuration

| Variable | Required | Description |
|---|---|---|
| `ALLURE_TESTOPS_URL` | yes | Base URL of your Allure TestOps instance, e.g. `https://allure.example.com`. |
| `ALLURE_TOKEN` | yes | Allure TestOps user API token. The server exchanges it for a short-lived JWT at `/api/uaa/oauth/token` and refreshes it before expiry. |
| `ALLURE_PROJECT_ID` | no | Default numeric project ID. Without it, project-scoped tools take `projectId` or `projectName` (resolved via `/api/project/suggest`). |
| `ALLURE_MAX_CONCURRENT` | no | Maximum parallel HTTP requests to Allure. Default `1`; `0` removes the limit. |
| `ALLURE_CACHE_DISABLED` | no | `1` turns off the in-memory response cache (by default GET responses are cached for 10 seconds to 5 minutes, depending on the endpoint). |
| `ALLURE_LOG_LEVEL` | no | `trace`, `debug`, `info` (default), `warn`, `error` or `fatal`. Logs go to stderr as JSON. |

## Safety

- **Annotations.** Every tool carries MCP annotations derived from the verb in its name: 59 read-only tools (`get_`, `list_`, `search_`, `find_`, `suggest_`) are marked `readOnlyHint`, the 10 `delete_`, `remove_` and `unlink_` tools are marked `destructiveHint`. Other write tools (`update_`, `set_`, `close_`, `run_`, ...) carry no destructive flag, so clients treat them as potentially destructive by the MCP default and ask before running them.
- **No read-only mode yet.** Unlike the TestIT server, there is no switch that hides write tools. To keep an assistant read-only, approve tools one by one in your client or allow only the read-only ones.
- **Your token stays local.** The server runs on your machine and sends requests only to `ALLURE_TESTOPS_URL`. The JWT is kept in memory only.
- **Gentle on your instance.** Requests are serialised by default (`ALLURE_MAX_CONCURRENT=1`), 429 responses are retried with `Retry-After`, and GET requests are retried on transient errors.

## Tools

117 tools, plus MCP resources. The searchable catalog with input schemas is at **[iampopovich.github.io/allure-testops-mcp](https://iampopovich.github.io/allure-testops-mcp/)**.

- **Test cases** (30): search, find, get, create, update, delete, restore, bulk restore, overview, history, steps (get/create/update/delete, expected results), tags (get/set, bulk add/remove), issues (get/set), bulk external links, custom fields (values/get/set), attachments (list/upload/download/delete)
- **Launches** (11): search, get, create, update, delete, close, reopen, statistics, progress, add test cases, add test plan
- **Test results** (11): list, search, get, create, update, history, assign, resolve, retries, attachments (list/download)
- **Test plans** (5): get, create, update, delete, run
- **Releases** (18): list, get, create, create from test cases, update, delete, statistics, defects, muted results, test case tree and selection, tags, add/remove launch, statuses, workflows
- **Defects** (14): get, create, update, test results/cases/launches of a defect, launch defects, find similar failures, link to test results, bulk close/reopen, link/unlink issue, apply matchers
- **Analytics** (8): automation chart, group by automation/status, launch duration histogram, mute trend, statistic trend, test case last result, test case success rate
- **Dashboards** (6): get, create, update, delete, copy, widget data
- **Shared steps** (7): get, get steps, usage, create, update, archive, unarchive
- **Environments** (5): suggest variables and values, list schemas and values, environment of a test result
- **Exports** (2): test cases CSV, launch CSV (Allure's native asynchronous export)
- **Resources**: guides `allure://guides/user-flows` and `allure://guides/aql`; `allure://projects`, `allure://env-vars`; per project `allure://projects/{projectId}/launches`, `/test-plans`, `/dashboards`, `/test-cases`

### Backup CLI

The package also ships `allure-testops-backup`, a deterministic CLI (no LLM involved) that dumps a project to diffable JSON plus attachments and Allure's CSV, restores it into an empty project, and compares two dumps. It uses the same environment variables. See [docs/usages/backup.md](docs/usages/backup.md).

```bash
npx -p allure-testops-mcp allure-testops-backup dump --project 37 --out ./backup
npx -p allure-testops-mcp allure-testops-backup restore ./backup/37-<timestamp> --project 52 --dry-run
```

---

## For developers

```bash
git clone https://github.com/iampopovich/allure-testops-mcp.git
cd allure-testops-mcp
npm install
npm run build             # tsc -> dist/
npm run lint
npm test                  # unit tests; integration tests are skipped without ALLURE_* env
npm run dev               # run from source with tsx
npm run docs:generate     # regenerate docs/tools.json
npm run docs:user-flows   # regenerate the bundled user-flow guide

# integration tests against a real instance
ALLURE_TESTOPS_URL=https://allure.example.com ALLURE_TOKEN=<token> ALLURE_PROJECT_ID=<id> npm test
```

Architecture rules:

1. **One bundle per area.** `src/api/<area>.ts` holds typed HTTP calls; `src/tools/<area>.ts` exports `create<Area>Tools(client)` with tool definitions and handlers. `buildToolRegistry()` in `src/server-bootstrap.ts` registers every bundle.
2. **Tools are defined with Zod.** `zodTool(name, description, schema)` in `src/tools/schema.ts` produces the JSON Schema for MCP, a typed `parse()` for the handler and the annotations inferred from the name. Inputs accept numbers as strings and objects or arrays as JSON strings, because MCP clients often send them that way.
3. **One HTTP client.** `src/client.ts` gets the JWT from `TokenManager` (`src/auth.ts`), refreshes it on 401, limits concurrency, caches GET responses per endpoint and retries 429 and transient errors. The MCP server and the backup CLI build it the same way through `createClientFromEnv()`.
4. **The catalog is generated.** `scripts/generate-tool-catalog.ts` builds `docs/tools.json` from the tool bundles; the Pages workflow regenerates it and publishes the catalog site on every push to `main`.

Adding a tool: add the API call to `src/api/<area>.ts`, define it with `zodTool` in `src/tools/<area>.ts` and add it to the bundle's `tools` and `handlers`, add a unit test in `tests/unit/tools/`, run `npm run docs:generate` and note the change in `CHANGELOG.md`. A new area also needs a line in `buildToolRegistry()` and in the catalog script.

CI: [`ci.yml`](.github/workflows/ci.yml) runs build, lint and tests on every push and pull request; [`publish.yml`](.github/workflows/publish.yml) publishes to npm with provenance on a GitHub release; [`pages.yml`](.github/workflows/pages.yml) deploys the tool catalog; a weekly job compares `supportedApiVersion` (currently 26.3.1.2) with Allure TestOps release notes and opens an issue when a new version is out. Dependabot, release drafter and stale triage are configured too.

[Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Changelog](CHANGELOG.md)

Licence: [MIT](LICENSE).

See also: [testit-mcp-server](https://github.com/iampopovich/testit-mcp-server), the same kind of server for TestIT.
