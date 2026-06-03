# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

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
