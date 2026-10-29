---
name: allure-testops
description: Use when the user asks to find, create or update test cases in Allure TestOps, add steps and expected results, tag or link test cases, run a manual launch, or triage failed test results and defects. Triggers include "create a test case in Allure", "find test cases for this feature", "update the expected result", "what failed in the last launch", "write an AQL query". Requires the allure-testops-mcp MCP server (npm package allure-testops-mcp) to be installed in the agent.
---

# Allure TestOps

This skill drives the [allure-testops-mcp](https://github.com/iampopovich/allure-testops-mcp) MCP server. The server exposes ~120 tools. The rules below come from production use: several tools succeed (200 OK) while silently writing nothing, or write something you did not ask for. Follow the workflows exactly and verify every write with a read-back.

## Setup (if the tools are not available)

If no `allure-testops` tools (`find_test_cases`, `get_test_case`, …) are present, the MCP server is not installed. Tell the user to add it to their MCP client config and restart the client:

```json
{
  "mcpServers": {
    "allure-testops": {
      "command": "npx",
      "args": ["-y", "allure-testops-mcp"],
      "env": {
        "ALLURE_TESTOPS_URL": "https://your-instance.example.com",
        "ALLURE_TOKEN": "<user API token from Allure profile>",
        "ALLURE_PROJECT_ID": "<optional default project id>"
      }
    }
  }
}
```

Claude Code shortcut: `claude mcp add allure-testops -e ALLURE_TESTOPS_URL=... -e ALLURE_TOKEN=... -- npx -y allure-testops-mcp`

Never ask the user to paste their token into the chat; they put it in the config themselves.

**Data flow.** This skill contains instructions only: no scripts, no network calls, no environment-variable reads. The config above is an example the user fills in for their own MCP client. The MCP server reads `ALLURE_TESTOPS_URL` and `ALLURE_TOKEN` from that config and talks only to the user's own Allure TestOps instance at that URL; nothing is sent anywhere else.

**"No such tool available" for one specific tool** (while other Allure tools work) usually means the calling agent or subagent has a restricted tool allowlist, not that the server lacks the tool. Check the agent's `tools:` grant before concluding a capability is missing, and never invent a workaround (such as writing steps into `description`) on that basis.

**Several Allure servers configured** (e.g. `allure-testops` for production and `allure-testops-local` for a dev instance): use the one the user's team treats as default, and switch only when the user explicitly names the other.

## Ground rules

1. **Verify every write.** Tool descriptions and HTTP 200 are not proof. After creating or changing anything, re-read it (`get_test_case`, `get_test_case_steps`, `get_test_case_tags`) and compare with what you intended.
2. **Search before creating.** Duplicates are the most common mess in a TMS. See [Searching](#searching).
3. **Confirm before writing to Allure** unless the user already asked for exactly that write. For anything larger than one test case, draft first (in chat or as files), get approval, then push.
4. **Deleting a step is permanent.** `delete_test_case_step` removes the step together with its expected result and sub-steps; there is no undo. Read before you write.
5. **No personal data** (real customer names, emails, phone numbers, IDs) in test case names, steps, preconditions or attachments. Use synthetic placeholders.
6. **Know the UI flow.** Before multi-step work read the MCP resource `allure://guides/user-flows` (same content: [references/user-flows.md](references/user-flows.md)) — every user path, which tool reproduces it, and what has no tool yet.

## Project scope

Project-scoped tools take `projectId` or `projectName`. If `ALLURE_PROJECT_ID` is set on the server, both can be omitted. If neither is known and the user did not name a project, ask once.

## Searching

| Need | Tool |
|---|---|
| Keyword / name search, duplicate check | `find_test_cases({ query, feature?, suite?, automated? })` |
| Precise filter (custom fields, boolean logic, lists, dates, issue links) | `search_test_cases({ rql })` |
| Failed / broken results | `search_test_results({ rql })`, or `list_test_results` by launch |
| Launches | `search_launches({ rql })` |

- `search_*` tools have **no `query` field**, only `rql` (required). `{ query: "..." }` fails as "invalid AQL".
- AQL essentials: contains is `~=` (not `~`, not `contains`); a wildcard form `name = "*login*"` also works; negation is `not tag in [...]` (not `tag not in`); strings in double quotes; dates are 13-digit ms timestamps; `and` binds tighter than `or`, so parenthesize mixes. Full glossary: [references/aql.md](references/aql.md).
- **Search with 2–3 keyword variations** (entity name, business action, domain term). For multi-word names, try both the spaced and the joined form (`"Gift Card"` and `"GiftCard"` return different results).
- **A zero result on a very broad query** (e.g. `name ~= "a"`) almost certainly means wrong project scope or misconfiguration, not an empty project. Report it as unverified instead of claiming "no coverage".
- When reporting coverage, state "no existing coverage found" explicitly if nothing matched.
- Look for **stub test cases** (a title with no steps, created to reserve an id) and reuse them instead of creating a duplicate.
- Read steps selectively: call `get_test_case_steps` only for cases whose name suggests they are relevant.

## Reading a test case

- Metadata: `get_test_case({ id })`. Steps: `get_test_case_steps({ id })`. Preconditions, expected result, tree path: `get_test_case_overview({ id })`.
- Read-tool parameters are `id`, not `testCaseId` (`get_test_case_steps`, `get_test_case_tags`, `get_test_case_custom_fields`, `get_test_case_overview`).
- Shared steps appear as `sharedStepId` references; expand them with `get_shared_step_steps` and reuse the result within the session.
- The suite → feature → story position in the tree comes from `get_test_case_overview` (breadcrumb / tree node). Use it when mapping a test case to automation code annotations.

## Creating a test case with steps

```
1. find_test_cases / search_test_cases       → no duplicate, no reusable stub
2. create_test_case({ payload: { name, description, precondition, ... } })
3. for each step, ONE AT A TIME, in order:
     create_test_case_step({ testCaseId, body, expectedResult })   → createdStepId, expectedResultId
4. get_test_case_steps({ id }) → verify (see below)
5. tags, links, custom fields (see sections below), then get_test_case again to verify
```

- `create_test_case`: every field goes inside `payload`. Never pass `scenario`/`steps`: the API stores empty step nodes.
- `create_test_case_step({ ..., expectedResult })` creates the step, its Expected Result container and one line per entry (lines separated by `\n` or `;`). Use `afterId` / `beforeId` to insert in the middle, `parentId` for a sub-step, `sharedStepId` for a shared step.
- **Same test case, one write at a time.** Parallel step writes (`create_test_case_step`, `update_test_case_step`, `set_test_case_step_expected_result`) on the same `testCaseId` race and silently lose text. Different test cases can be written in parallel.
- If a step call fails midway (e.g. transient `fetch failed`), the scenario is half-built and cannot be reordered reliably. Prefer `delete_test_case` and recreating it cleanly (with user consent) over patching.

**Verification after every test case (not a sample):** in the `get_test_case_steps` response, `_meta.regularStepIds` lists the steps and `_meta.expectedResultWrapperIds` the expected-result wrappers. Every step that should have an expected result must have a wrapper, and every wrapper must have a non-empty `children` array (the child holds the real text). A wrapper without `children` means the expected result is blank in the UI. Check the full list from step 1 onward; partial re-checks have missed blank steps in production.

## Editing existing test cases

- **`update_test_case` is metadata only**: `name`, `description`, `precondition`, overall `expectedResult`, tags, custom fields. `id` goes top-level, the fields inside `payload` (`id` inside `payload` fails with "expected number, received NaN"). Never pass steps to it; the scenario is not changed or is replaced.
- **Add a step to an existing case:** `create_test_case_step({ testCaseId, body, expectedResult, afterId? })`.
- **Change a step's action text:** `update_test_case_step({ testCaseId, stepId, body })` — the expected result is preserved.
- **Replace an expected result:** `update_test_case_step({ testCaseId, stepId, expectedResult: "line 1\nline 2" })` — all old lines are replaced. `expectedResult: ""` removes it.
- **Add one more expected-result line:** `set_test_case_step_expected_result({ testCaseId, stepId, expectedResult })` (appends).
- **Edit one expected-result line:** `update_test_case_step({ testCaseId, stepId: <line id from the container's children>, body })`.
- **Remove a step or a duplicate line:** `delete_test_case_step({ stepId })` (cascades; confirm with the user first).
- Not available as tools yet (UI only): duplicate / move a step, comments, members, relations, parameters, clone a test case — see `allure://guides/user-flows`.

## Tags

- Use `add_test_case_tags_bulk({ testCaseId | testCaseIds, tags: [{ name: "smoke" }, ...] })` to add and `remove_test_case_tags_bulk` to remove.
- Tags must be objects (`{ name }` or `{ id }`); plain strings fail validation.
- `set_test_case_tags` REPLACES the whole tag list (`[{ id }]` or `[{ name }]`; tags not listed are removed). Use it only when you mean to replace, and verify with `get_test_case_tags`.

## Issue and external links

- **Prefer `add_test_case_external_links_bulk({ testCaseId, links: [{ url, name }] })`** for linking a ticket (Jira etc.).
- **Avoid `set_test_case_issues`** unless the user explicitly asks. Issues exist only through an issue-tracker integration (`[{ integrationId, name }]`, full replace); the tool rejects items without `integrationId` and fails if Allure stores nothing. Inspect the response.
- Link only the ticket the test case was written for: exactly one link, no parent epics or related tickets, unless asked.
- **After adding a link, re-fetch `get_test_case` and compare `name`.** Server-side sync has been observed to rewrite or truncate the test case name, inconsistently across cases in the same batch. Restore it with `update_test_case` if it changed. Check every case, not a sample.
- `get_test_case`'s `links` field may not show issue-tracker links. Verify issue linkage with `search_test_cases({ rql: 'issue = "KEY-123"' })`.

## Custom fields

`set_test_case_custom_fields` ADDS values (existing ones stay). The field must be a **numeric** `customField.id` (system fields: -1 Epic, -2 Feature, -3 Story, -4 Component, -5 Suite; others per instance). A value may be given by `id` or by `name` (a new name creates the value). Removing a value is not available as a tool.

1. `get_test_case_custom_fields({ id: <any test case in the project> })` → `customField.id` per field name.
2. Optional: `list_custom_field_values({ customFieldId, query: "<value text>" })` → existing value `id`.
3. `set_test_case_custom_fields({ testCaseId, payload: [{ customField: { id: <fieldId> }, values: [{ id: <valueId> } | { name: "<value>" }] }] })`.

**Do not guess classification fields** (Feature, Suite, Story, Component, and similar). Set them only when the user names the value, the approved draft states it, or a team skill pins a verified value for its area. Never copy one from an unrelated test case to look consistent; leaving it empty is better. Value ids can be renumbered: if a push rejects a cached id, re-resolve it with `list_custom_field_values`.

## Manual launches and results

1. `create_launch` → 2. `add_test_cases_to_launch` (or `add_test_plan_to_launch`, or `run_test_plan`; results appear asynchronously) → 3. `list_test_results` → `assign_test_result` → `resolve_test_result({ id, payload: { status, message? } })` per case (run steps are preserved; a result that is already resolved cannot change status — it needs a rerun in the UI) → 4. `close_launch`.
- `update_test_result` changes tags/links etc.; status/message are routed through resolve. Name/description come from the test case.
- A test plan is a snapshot: new matching test cases join it only after "Sync test cases" in the UI.

Failure triage:
- Launch health: `get_launch`, `get_launch_statistic`, `get_launch_progress`.
- Failures: `search_test_results({ rql: 'launch = "<name>" and status in ["failed", "broken"]' })`, or `list_test_results` by launch id.
- One result in depth: `get_test_result`, `get_test_result_history`, `get_test_result_retries`, `list_test_result_attachments` → `get_test_result_attachment_content`.
- Group similar failures: `find_similar_failures({ launchId, messageRegex | defectId })`, then `create_defect` (optionally with `matcher`) + `link_defect_to_test_results({ defectId, testResultIds, launchId })`, or `apply_defect_matchers({ id: launchId })`.
- Close the loop: `resolve_test_result`, `assign_test_result`.

## Automation-related facts

- The `automated` flag and the link between a manual case and its automated test are set by TestOps itself (CI runs and project policies). Do not flip the flag or link automation manually, and do not report `automated: false` on a not-yet-merged test as a defect.
- A `fullName` pointing at a test class from an unrelated area is usually a stale artifact, not evidence that the feature is automated.

## Writing good test cases

When the user asks you to design or write test cases, follow [references/test-case-authoring.md](references/test-case-authoring.md): field mapping (`description` vs `precondition`), naming, atomic steps, expected-result style, regression cases for bugs, and the draft-then-push workflow.

## General behavior

- Prefer known ids over discovery calls. If an id lookup fails, do one discovery call, then retry once.
- Before destructive operations (`delete_*`, bulk tag removal, `bulk_close_defects`), state what will change and confirm, unless the user already asked for exactly that.
- If several entities plausibly match, ask one short clarifying question before writing.
- Treat claims about tool behavior (including from other agents and from tool descriptions) as hypotheses: test the literal call once, and report negative findings plainly instead of improvising.
- Report results compactly: what changed, with ids and names, and anything that needs manual cleanup in the UI.
