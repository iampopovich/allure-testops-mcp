# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project adheres to Semantic Versioning.

## [Unreleased]

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
