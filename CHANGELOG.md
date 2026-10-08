# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]

## [1.7.0] - 2026-10-09

### Fixed

- **Stale reads after writes from the server's own cache.** Write invalidation only stripped the path up to its first numeric segment, so writes to `/api/testcase/step[/{id}]` and `/api/v2/test-case/bulk/*` never evicted `/api/testcase/{id}/step|tag|cfv`, and those reads stayed stale for up to 60s. This was behind the "eventual consistency" note in `get_test_case_steps`, which has been corrected. Every write (including failed writes and multipart uploads) now clears the response cache except write-safe reference data (`/api/project/suggest`, release statuses and workflows). A GET that overlaps a write is no longer cached, and cached values are cloned so callers cannot mutate them.
- **Token exchange had no timeout.** A hung `/api/uaa/oauth/token` call blocked every tool call. It now uses the same 30s timeout as API requests.
- **No recovery from a revoked or early-expired JWT.** A 401 now triggers one token refresh and retry.
- **Request timeouts were not retried.** `AbortSignal.timeout` errors (`TimeoutError`) and undici error codes are now recognised as retryable for GET.
- **A malformed JSON-string `payload` was silently replaced with `{}`.** For example, `update_test_case` would send an empty PATCH and report success. It is now rejected with a validation error.
- Bulk test-case tools accept integer strings for IDs nested inside `payload`.
- The 10s TTL for test steps and scenarios never applied, because its pattern (`/api/scenario`) matched no real path.

### Changed

- **429 responses are retried** for every method (honouring `Retry-After`, capped at 10s). 502/503/504 are still retried only for GET.
- The concurrency permit is released during retry back-off, so with `ALLURE_MAX_CONCURRENT=1` one retrying request no longer blocks all others.
- **Tool annotations.** Every tool now advertises `readOnlyHint` / `destructiveHint` / `openWorldHint`, derived from its verb (`get_`/`list_`/`search_`/`find_`/`suggest_` are read-only; `delete_`/`remove_`/`unlink_` are destructive).
- **Resource templates.** The parameterised `allure://projects/{projectId}/...` URIs are now advertised via `resources/templates/list` instead of `resources/list`. Reading them works as before.
- Tool and resource responses are compact JSON instead of 2-space-indented JSON, which saves roughly 20–30% of response tokens.
- **`supportedApiVersion` bumped to `26.3.1.2`.**

### Added

- `tests/unit/client.unit.test.ts`: 25 unit tests covering the HTTP client and token manager (cache invalidation, 401/429/5xx/timeout retries, back-off permit release), plus tool annotations and `coerceObject`.

### Verified

- **No breaking changes for existing tools in 26.3.1.2.** An operation-level diff of the 26.3.1.1 → 26.3.1.2 specs shows no added, removed or changed endpoints (852 operations). Schema changes:
  - `LicenseStage` was removed; `LicenseInfoDto` gained `trial` and `readOnlyAt`; the `LicenseType` enum values were renamed.
  - `TestResultGroupNode.groups` and `ExtFormFieldList.fields` were added.
  - Step DTOs gained explicit `oneOf` typing for `steps`.

  None of these schemas are consumed by this server. The 26.3.1.2 spec is tracked on the `bump/version` branch (`076bb1a`).

## [1.6.0] - 2026-09-18

### Added

- **Release management tools (Allure TestOps 26.3+).** New `src/api/releases.ts` / `src/tools/releases.ts` bundle covering the `/api/release` surface introduced in 26.3.1.1: `list_releases`, `get_release`, `create_release`, `update_release`, `delete_release`, `get_release_statistic`, `list_release_defects`, `list_release_muted_results`, `get_release_test_case_tree`, `list_release_tags`, `set_release_tags`, `add_launch_to_release`, `remove_launch_from_release`, `get_release_test_case_selection`, `update_release_test_case_selection`, `create_release_from_test_cases`, `list_release_statuses`, `list_release_workflows`.
- **`restore_test_cases_bulk`** — restores several deleted test cases at once through the new `POST /api/testcase/bulk/restore` endpoint.

### Fixed

- **Every tool advertised an empty `inputSchema`.** `zodTool` converted schemas with `zod-to-json-schema@3`, which cannot read Zod v4 schemas and silently returned `{ "type": "object" }` — so since the Zod migration MCP clients received no parameter names, types or `required` lists for any of the 114 tools. `zodTool` now uses Zod v4's built-in `z.toJSONSchema()` with `io: "input"` (so coerced/JSON-string inputs are described by what a client may send) and drops the now-unused `zod-to-json-schema` dependency.

### Changed

- **`supportedApiVersion` bumped to `26.3.1.1`** and the tracked spec in `docs/versions/allure_api_docs.json` updated (36 new endpoints, none removed, 91 new schemas).
- **`create_launch`** description documents the new `releases` and `gitContext` fields of `LaunchCreateDto`.
- **`run_test_plan`** and **`add_test_plan_to_launch`** descriptions document the new `releaseId` field; the `run_test_plan` example now uses the real DTO field `launchName` instead of `name`.
- **Response cache** gained a 30s TTL bucket for `/api/release` paths, matching how quickly release statistics are recalculated.
- `scripts/compare-api-versions.py` knows about the `releases` module.

### Verified

- **No breaking changes for existing tools.** An operation-level diff of the 26.2.2.3 → 26.3.1.1 specs shows that every endpoint this server calls kept its parameters, request bodies and response schemas; the remaining differences are generated `operationId` renumbering. The endpoints whose signatures did change (`/api/account/me`, `/api/upload`, `/api/upload/file`, `/api/member/suggest`, `/api/status`, `/api/project`) are not used here.
- Deprecations noted for future work, none of them consumed by current tools: `GET /api/launch/{id}/tester` (superseded by `/api/v2/launch/{id}/tester`), `TestResultDto.testedBy` (superseded by `testedByUser`), `TestResultTreeLeafDtoV2.assignee` (superseded by `assigneeUser`).
- Not implemented yet from 26.3: coverage (`/api/coverage`, `/api/launch/{id}/coverage`), git repositories and launch git context, project labels, upload usage reporting.

## [1.5.0] - 2026-07-28

### Changed

- **Verified compatibility with Allure TestOps 26.2.2.3.** No changes required to implemented tools — the spec update deprecated `/api/license` (replaced by `/api/v2/license`) and added a `test-report-controller` (`/api/test-report/**`), neither of which this server exposes as tools. `/api/testcase/**` endpoints were relocated within the spec but kept identical operation IDs, paths, and payloads.
- Bumped `supportedApiVersion` to `26.2.2.3` in `package.json`.

## [1.4.0] - 2026-07-09

### Added

- **`find_test_cases` tool.** A broad, beginner-friendly search tool intended as the first step before creating a new test case (duplicate check). Supports name (`query`/`name`, contains match), custom field shortcuts (`suite`, `feature`, exact match), `tag`, `automated`, `status`, and a generic `customFieldFilters` array for arbitrary custom fields (exact or contains match). Internally builds and runs an AQL query via `search_test_cases`. Requires at least one search/filter parameter.

### Changed

- **`search_test_cases` description** now points AI agents to `find_test_cases` for broad multi-field discovery, reserving raw AQL for precise/complex queries, and documents `cf["Field"] = "value"` custom-field query patterns.

### Fixed

- **Silent no-op custom field filters.** Some Allure custom field configurations (e.g. multi-select/list-typed fields) treat `cf["Field"] = "value"` as a no-op that matches every test case instead of erroring or filtering — an unfiltered result set could easily be mistaken for "no matches" or a valid filtered list. `find_test_cases` (and any exact-match `customFieldFilters` entry) now validates that the field and value exist via `list_project_custom_fields`/`list_custom_field_values`, and additionally probes the filter against an unfiltered baseline count to detect and reject silently-broken equality filters, raising a clear error instead of returning wrong data.

## [1.3.2] - 2026-06-03

### Changed

- **`create_test_case` now sends steps via native `scenario` API.** Previously, `payload.steps` were stripped from the payload and each step was created separately through `POST /api/testcase/step`. Now steps are translated from the user-friendly format (`{ name, expectedResult, steps }`) into typed API DTOs (`BodyStepDto` with `expectedResultSteps`) and sent as `payload.scenario` in a single atomic `POST /api/testcase` call. This eliminates the race condition and "empty steps with descriptions" bug reported by QA — step body was not reaching the API when `name` field was missing.

### Fixed

- **`create_test_case` step body resolution.** The handler now correctly handles both `name` (user-friendly alias) and `body` (canonical API field) for step text. Previously only `name` was mapped, causing empty steps when the caller used `body` instead.

- **`update_test_case_step` description rewritten.** The tool description now explicitly documents the FULL REPLACE semantics of `expectedResult` — passing it wipes all existing expected-result lines and replaces them. Workflow section with numbered steps, CRITICAL warning, and a "WHAT TO AVOID" checklist added so AI agents understand the tool's behavior before calling it. The `expectedResult` parameter description now states "REPLACES ALL existing lines" directly.



## [1.3.1] - 2026-06-02

### Fixed

- **`get_test_case_steps` now annotates expected-result wrapper steps.** The response includes a `_meta` section with `expectedResultWrapperIds` (child nodes that are Expected Result containers) and `regularStepIds` (editable steps). Wrapper steps are also marked with `_wrapper: true` in `scenarioSteps`. This prevents AI agents from trying to directly `PATCH` wrapper child nodes, which returns 404 — they must be updated through the parent step's `expectedResult` parameter.
- **`update_test_case_step` expectedResult preservation.** When `expectedResult` is not provided, the existing value is preserved (not cleared). When `expectedResult` is provided, the `withExpectedResult=true` query parameter is now sent to the API — without it, the API silently drops the expected result child wrapper, causing expected results to disappear. Tool description updated to document this behavior and the expected-result wrapper limitation.

### Verified

- **API compatibility with Allure TestOps 26.2.1.5** — all 104 implemented endpoints
  (`/api/launch`, `/api/testcase`, `/api/testresult`, `/api/testplan`, `/api/defect`,
  `/api/sharedstep`, `/api/dashboard`, `/api/ev`, `/api/analytic`) verified against the
  OpenAPI/Swagger specification. HTTP methods, request paths, query parameters, and
  request bodies match. No breaking changes detected — the server is fully compatible
  with Allure TestOps version 26.2.1.5.

## [1.3.0] - 2026-05-31

### Added

- **MCP Resources support** — server now exposes `resources` capability alongside `tools`.
  Static and per-project data is available via `resources/read` without spending tool-call tokens:
  - `allure://projects` — all accessible projects
  - `allure://env-vars` — all environment variable definitions
  - `allure://projects/{projectId}/launches` — launches for a project
  - `allure://projects/{projectId}/test-plans` — test plans for a project
  - `allure://projects/{projectId}/dashboards` — dashboards for a project
  - `allure://projects/{projectId}/test-cases` — test cases for a project (first page)
  - `allure://projects/{projectId}/defects` — defects for a project (first page)
  - `allure://projects/{projectId}/shared-steps` — shared step library for a project (first page)
  - `allure://projects/{projectId}/custom-fields` — custom fields for a project (first page)
- **In-memory LRU cache** (`lru-cache`) for all GET requests, reducing redundant calls during agent polling and chain-of-thought loops.
  Cache is invalidated automatically on any write operation against the same resource collection.
  TTL is tuned per entity type (launches 15 s → projects 5 min).
- **`ALLURE_CACHE_DISABLED=1`** environment variable to disable the cache at runtime (useful for integration tests and debugging).
- **Pluggable `CacheStore` interface** (`src/cache.ts`) with `NullCacheStore` and `LruCacheStore` implementations.
  The client accepts any `CacheStore` via constructor injection — swap to Redis or a custom store without touching `AllureApiClient`.
- Documentation: `docs/usages/examples/resources.md` — resource URI table, usage patterns, and Resources vs Tools decision guide.
- Documentation: environment variable reference table and cache TTL matrix added to `docs/usages/running-locally.md` and `DOCKER.md`.

### Changed

- `list_launches`, `list_test_plans`, `list_dashboards`, `list_env_vars`, `list_test_cases`,
  `list_defects`, `list_shared_steps`, `list_project_custom_fields` removed as tools —
  replaced by the corresponding MCP resources above.
  Use `search_*` tools for filtered or paginated access.
- `list_test_results` **kept as a tool** (not exposed as a resource) — unfiltered launch payloads
  can exceed 100 KB; use `list_test_results` with `page`/`size`/`search` or `search_test_results` with RQL.

### Added

- Public OSS docs set (`CONTRIBUTING`, `LICENSE`, `CODE_OF_CONDUCT`, `SECURITY`)
- Expanded README with MCP setup instructions for Claude Desktop, Claude Code, Cursor, and other clients
- GitHub Actions CI (`build` then `lint`) for push and pull requests
- CODEOWNERS and automatic reviewer request for `@iampopovich`
- Dependabot, stale triage workflow, and release drafter automation
