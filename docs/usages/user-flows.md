# Allure TestOps user flows — UI path → MCP tools → API

Reference of how the Allure TestOps UI (API 26.3.x) performs each user flow, and which MCP tools reproduce it.
Every flow below was recorded from the real UI network traffic and re-checked against the OpenAPI schema 26.3.1.2.
Legend: **tool** = MCP tool that performs the step; *no tool* = the UI uses an endpoint this server does not expose yet (listed so you can explain the limitation instead of guessing).

## 0. Ground rules

- **Write steps of one test case sequentially.** Parallel writes to the same scenario tree can drop a line.
- **Verify every write with a read-back.** Some Allure endpoints answer 200 without changing anything (for example a test result that is already resolved).
- **IDs come from reads, never from guesses.**
  - Status, layer and workflow ids are listed in section 11.
  - Custom field ids come from `get_test_case_custom_fields`.
  - Step ids come from `get_test_case_steps`.
- **Three different "selection" shapes exist.** The tools build them for you:
  - `leafsInclude`: v1 tree selection (launch add, release create, test plan, bulk run).
  - `testCasesInclude`: v2 bulk (`/api/v2/test-case/bulk/*`).
  - `leavesInclude`: tree drag-and-drop.
- **Soft delete vs hard delete.** `delete_test_case` moves a case to the trash, `restore_test_case(s)` brings it back. Permanent deletion is UI-only.

## 1. Find test cases

| UI | Tool | API |
|---|---|---|
| Test cases list + search box | `find_test_cases` (name / Feature / Suite / tag / status) | UI: `GET /api/v2/project/{pid}/test-case/flat?search=…` |
| Advanced AQL filter | `search_test_cases({rql})` | `GET /api/testcase/__search?projectId&rql` |
| Trees "Features" / "Suites" (grouping by custom field) | read via `search_test_cases` with `cf["Feature"] = "X"` | `GET /api/v2/project/{pid}/test-case/tree/tree-node?treeId` |

AQL: `name ~= "login"` (contains — `~` alone is rejected), `tag = "smoke"`, `cf["Feature"] = "Auth"`, `status = "Active"`, `automation = false`. Full syntax: resource `allure://guides/aql`.

## 2. Create a manual test case with a scenario (the main flow)

UI: `+ Test Case` → name → Enter → type step → Enter (next step) / Alt+Enter (step with expected result) → type expected result lines.

1. `create_test_case({payload:{name, description, precondition, …}})` — metadata only.
   - Do **not** pass `scenario`: the API stores empty step nodes.
   - `statusId` needs `workflowId` too.
2. For each step, in order, **one call at a time**: `create_test_case_step({testCaseId, body, expectedResult?})`.
   - `expectedResult: "A; B"` → an Expected Result container with lines A and B.
   - `parentId` makes a nested sub-step.
   - `sharedStepId` inserts a shared step.
   - `afterId` / `beforeId` position the step.
3. `get_test_case_steps({id})` to verify.

What the API does (for reference):
- New step: `POST /api/testcase/step?afterId={prev} {testCaseId, body|bodyJson}`.
- Step with ER: `POST /api/testcase/step?withExpectedResult=true {…, expectedResultId:-1}`, then one `POST /api/testcase/step {testCaseId, parentId: <container>, body}` per line.
- Sub-step: `POST /api/testcase/step {testCaseId, parentId: <step>, body}`.
- Shared step: `POST /api/testcase/step {testCaseId, sharedStepId}`.

### Scenario model (`get_test_case_steps`)

```
root.children            → ordered top-level step ids
scenarioSteps[id]        → { body, children?, expectedResultId?, sharedStepId?, attachmentId? }
step.expectedResultId    → id of the "Expected Result" CONTAINER
container.children       → the expected-result LINES
```

There are **two different "expected results"**:
- per-step ER (the containers above);
- the test case's own `expectedResult` field (`create_test_case` / `update_test_case`). It is shown in the UI only when the project enables the section.

`get_test_case_scenario` is an alias of `get_test_case_steps`. The legacy `/scenario` endpoint is deprecated and always empty.

## 3. Edit a scenario

| UI action | Tool | API |
|---|---|---|
| Edit step text (blur) | `update_test_case_step({testCaseId, stepId, body})` — keeps the ER | `PATCH /api/testcase/step/{id}?withExpectedResult=<hasER> {body, expectedResultId:<current>}` |
| Convert to → Step with expected result | `set_test_case_step_expected_result({testCaseId, stepId, expectedResult})` | `PATCH …?withExpectedResult=true {body, expectedResultId:-1}` + one POST per line |
| Add expected-result line | `set_test_case_step_expected_result` (appends) | `POST /api/testcase/step {parentId: container, body}` |
| Replace all ER lines | `update_test_case_step({testCaseId, stepId, expectedResult:"A; B"})` | DELETE old lines + POST new lines |
| Edit one ER line | `update_test_case_step({testCaseId, stepId: lineId, body})` | `PATCH /api/testcase/step/{lineId}` |
| Convert to → Step (remove ER) | `update_test_case_step({…, expectedResult: ""})` | `PATCH …?withExpectedResult=false {body}` |
| Delete step / line (cascades to ER and sub-steps) | `delete_test_case_step({stepId})` | `DELETE /api/testcase/step/{id}` |
| Duplicate step | *no tool* | `POST /api/testcase/step/{id}/copy {afterId}` |
| Move step (drag) | *no tool* | `POST /api/testcase/step/{id}/move {parentId | afterId | beforeId}` |
| Add attachment to a step | `upload_test_case_attachment` + *no tool* for the node | `POST /api/testcase/attachment?testCaseId` (multipart) → `POST /api/testcase/step {testCaseId, attachmentId}` |

**Never** send `scenario` in `update_test_case`: it replaces the whole scenario with empty nodes.

## 4. Test case fields and metadata

| UI | Tool | Notes |
|---|---|---|
| Description / Precondition / Rename | `update_test_case({id, payload:{description|precondition|name}})` | partial PATCH |
| Status badge | `update_test_case({payload:{statusId, workflowId}})` | ids in section 11 |
| ⋯ → Change test layer | `update_test_case({payload:{testLayerId}})` | |
| ⋯ → Manage links | `update_test_case({payload:{links:[{name,url}]}})` | full replace |
| Tags ✎ | `set_test_case_tags({testCaseId, payload:[{name}|{id}]})` | full replace; a name creates the tag |
| Tags (add/remove only) | `add_test_case_tags_bulk` / `remove_test_case_tags_bulk` | |
| Custom Fields ✎ | `set_test_case_custom_fields` (append, value by id or name) | removing a value: *no tool* (`POST /api/v2/test-case/bulk/cfv/remove {selection, ids:[cfvId]}`) |
| Issues links ✎ | `set_test_case_issues({payload:[{integrationId, name}]})` | requires an issue-tracker integration; otherwise nothing is stored |
| Members ✎ | *no tool* | `POST /api/testcase/{id}/members [{name, role:{id}}]` (roles: -1 Owner, -2 Lead), full replace |
| Relations ✎ | *no tool* | `POST /api/testcase/{id}/relation [{type, target:{id}}]`; types: related to, clones, is cloned by, duplicates, is duplicated by, automates, is automated by |
| ⋯ → Edit parameters | *no tool* | `POST /api/testcase/example/nwise?n=1` → `POST /api/testcase/{id}/example [[{name,value}]]` |
| ⋯ → Clone | *no tool* | `POST /api/testcase/{id}/clone {nameSuffix, strategy:"EXCLUDE", toProjectId, ignoreScenario?…}` — copies steps with ER, tags, links, members, params; status resets to Draft |
| ⋯ → Version history → Save | *no tool* | `POST /api/testcase/{id}/version {title, description}` (max 10) |
| Change log tab | *no tool* | `GET /api/testcase/audit?testCaseId` |
| Comments | *no tool* | `POST /api/comment {testCaseId, body}`, `PATCH /api/comment/{id} {body}`, `DELETE /api/comment/{id}` |
| Attachments tab | `list_test_case_attachments`, `upload_test_case_attachment`, `delete_test_case_attachment` | deleting an attachment also removes its scenario node |
| ⋯ → Move to trash / Trash → Restore | `delete_test_case` / `restore_test_case`, `restore_test_cases_bulk` | |
| ⋯ → Move to project | *no tool* | `POST /api/v2/test-case/bulk/move {selection, strategy, cfMapping, toProjectId}` |

## 5. Bulk actions on the test case list

UI: tick checkboxes → `Selected: N` → ⋯. All use `/api/v2/test-case/bulk/*` with `selection {projectId, testCasesInclude, inverted:false, deleted:false}`.

| Action | Tool | API |
|---|---|---|
| Add tags / links / custom field values | `add_test_case_tags_bulk`, `add_test_case_external_links_bulk`, `set_test_case_custom_fields` | `…/tag/add`, `…/external-link/add`, `…/cfv/add` |
| Remove tags | `remove_test_case_tags_bulk` | `…/tag/remove {ids}` |
| Remove custom field values, members, issues | *no tool* | `…/cfv/remove {ids}`, `…/member/remove`, `…/issue/remove` |
| Status / Layer | *no tool* | `…/status/set {workflowId, statusId}`, `…/layer/set {layerId}` |
| Create test plan from selection | *no tool* | `…/test-plan/create {testPlanName}` |
| Mute | *no tool* | `…/mute/add {mute:{name, reason}}` |
| Clone / Move to project | *no tool* | `…/clone {nameSuffix, strategy, ignore*}`, `…/move {toProjectId}` |
| Move to trash / Delete permanently | *no tool* | `…/remove` (`deleted:true` in the trash = permanent) |
| Export CSV | *no tool* | `…/export/csv {mapping}` → `GET /api/export/{id}` → `GET /api/export/download/{id}` |
| Release from selection | `create_release_from_test_cases` | `POST /api/test-case/bulk/release/create` |

## 6. Shared steps

| UI | Tool | API |
|---|---|---|
| Shared steps page | resource `allure://projects/{id}/shared-steps` | `GET /api/sharedstep?projectId&archived=false` |
| `+ Shared step` → name | `create_shared_step` (creates it empty) | `POST /api/sharedstep {name, projectId}` |
| Add steps inside a shared step | *no tool* | `POST /api/sharedstep/step {sharedStepId, body}` (`?withExpectedResult`, `parentId`, `afterId` work as in test cases) |
| Insert into a test case | `create_test_case_step({testCaseId, sharedStepId})` | |
| Read content / usage | `get_shared_step_steps`, `get_shared_step_usage` | |
| Archive / Unarchive | `archive_shared_step` / `unarchive_shared_step` | |

## 7. Manual run (launch → execute → resolve)

1. **Create the run.**
   - UI: test case ⋯ → Run, or list → Run. This sends `POST /api/testcase/bulk/run {selection, launchName}` in one call.
   - MCP: `create_launch({payload:{name}})`, then `add_test_cases_to_launch({id, payload:{selection:{projectId, leafsInclude:[ids], inverted:false}}})`. Results appear asynchronously.
   - From a plan: `run_test_plan({id, payload:{launchName}})`, or `add_test_plan_to_launch`.
   - From files: *no tool* (`POST /api/launch/upload` / `POST /api/launch/{id}/upload`, multipart `info` + allure-results).
2. **Find the results.** `list_test_results({id: launchId})` or `search_test_results`.
3. **Take the result.**
   - `assign_test_result({id, payload:{username}})`. The UI does this automatically on the first step click.
4. **Record the outcome.**
   - `resolve_test_result({id, payload:{status, message?}})`. This is the Passed / Failed buttons.
   - The run steps (execution) are preserved automatically.
   - For per-step statuses, pass `execution:{status, steps}` with `steps[i].status` set.
5. **Already resolved?** The result cannot change status again. In the UI use "Rerun manually" (*no tool*: `POST /api/testresult/{id}/rerun {username}`), then resolve the new result.
6. **Close.** `close_launch({id})`; reopen with `reopen_launch`.

Other launch actions:
- Edit: `update_launch`, a partial PATCH.
- Delete: `delete_launch`.
- Copy / Merge: *no tool* (`POST /api/launch/{id}/copy {launchName}`, `POST /api/launch/merge {from, to}` — the source launch disappears).
- Export: *no tool*.
- Result mute / unmute: *no tool* (`POST /api/testresult/{id}/mute {name, reason}`, `…/unmute`).
- `update_test_result` changes name, description and the like. Status, message and trace go through resolve.

## 8. Test plans

| UI | Tool | Notes |
|---|---|---|
| `+ Test plan` → name + AQL / tree selection | `create_test_plan({payload:{name, baseRql, treeSelection:{inverted:true}}})` | `{name}` alone = whole project; `inverted:true` + `leafsInclude` = exclusions |
| ⋯ → Edit | `update_test_plan` | |
| "N test cases +k" → ⋯ → Sync test cases | *no tool* | `GET /api/testplan/{id}/diff`, `POST /api/testplan/{id}/sync` — the plan is a snapshot; sync before running if new cases should be included |
| ▷ Run | `run_test_plan({id, payload:{launchName}})` | |
| ⋯ → Delete | `delete_test_plan` | |

## 9. Defects

| UI | Tool | API / notes |
|---|---|---|
| `+ Defect` (name, description, automation rule) | `create_defect({payload:{name, projectId, description, matcher:{name, messageRegex, traceRegex}}})` | |
| Automation rules `+` / 🗑 | *no tool* | `POST /api/defect/matcher {defectId, name, messageRegex}`, `DELETE /api/defect/matcher/{id}` |
| ⋯ → Rename / Close / Reopen | `update_defect({id, payload:{name}|{closed:true|false}})` | |
| Bulk Close / Reopen | `bulk_close_defects({ids})` / `bulk_reopen_defects({ids})` | `{projectId, selection:{ids, inverted:false, kind:"ListSelectionDto"}}` |
| Result → Failed → Link defect | `link_defect_to_test_results({defectId, testResultIds, launchId})` | single result: `POST /api/testresult/{trId}/defect/{defectId}` |
| Similar failures | `find_similar_failures({launchId, messageRegex | defectId})` | |
| Apply automation rules to a launch | `apply_defect_matchers({id: launchId})` | async; links results whose message/trace match |
| ⋯ → Delete | *no tool* | `DELETE /api/defect/{id}` |
| Create issue / Link issue | `link_issue_to_defect({id, payload:{integrationId, name}})` | needs an issue-tracker integration |

## 10. Releases, dashboards, analytics

- Releases:
  - `create_release` → `update_release_test_case_selection` (async) or `create_release_from_test_cases` → `add_launch_to_release` → `get_release_statistic`.
  - `get_release_test_case_selection` returns 404 until a selection is set.
  - `get_release_test_case_tree` needs a sort (defaults to `id,asc`).
- Dashboards:
  - `create_dashboard({name, payload:{templateId:-1}})` creates one with ready widgets.
  - Widget creation: *no tool* (`POST /api/widget {dashboardId, type, name, options:{tcRql, groupBy}}`).
  - `get_widget_data({id, dateFrom:"YYYY-MM-DD", dateTo})`.
- Analytics tools: `from` / `to` in ms, `offset` in **hours**, `interval` = hour | day | week | month.
- AQL validation: *no tool*. `GET /api/testcase/query/validate?projectId&rql` returns the match count and is used by the widget editor.

## 11. Reference ids (default instance values — verify on yours)

| Kind | Values |
|---|---|
| Test case statuses (workflow -1 "Default Manual") | -1 Draft, -2 Review, -3 Active, -4 Outdated |
| Workflows | -1 Default Manual, -2 Default Automated |
| Test layers | -1 Unit Tests, -2 UI Tests, -3 API Tests |
| System custom fields | -1 Epic, -2 Feature, -3 Story, -4 Component, -5 Suite |
| Member roles | -1 Owner, -2 Lead |
| Test result statuses | passed, failed, broken, skipped, unknown |

## 12. Known traps

1. Two expected results: per-step ER containers vs the test case `expectedResult` field.
2. `scenario` in `create_test_case` / `update_test_case` produces empty steps — never use it.
3. A resolved test result does not change status again (202 without effect) — rerun first.
4. A test plan is a snapshot — sync it before running if new test cases should be included.
5. Issues, test keys and jobs need integrations. Without one, issue writes are silently empty.
6. Precondition and the test case expected result are hidden in the UI until the project enables them (Settings → Test case sections). The API stores them regardless.
7. Folders in the Features / Suites tree are custom field values. Renaming a folder re-assigns a new value to all its cases.
8. Bulk and launch writes (add test cases, apply matchers, release selection) are asynchronous — read back after a moment.
