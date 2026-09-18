# Releases Example

Releases are available in Allure TestOps 26.3 and later. A release groups a set of test
cases and the launches that verify them, and it carries a workflow status.

## Example User Prompt

`Create release 24.1 in project 37, put the regression suite in it, attach launch 5120 and show me the status breakdown.`

## Typical Tools

- `list_releases`, `get_release`
- `create_release`, `create_release_from_test_cases`
- `update_release`, `delete_release`
- `get_release_statistic`, `list_release_defects`, `list_release_muted_results`
- `get_release_test_case_tree`, `get_release_test_case_selection`, `update_release_test_case_selection`
- `add_launch_to_release`, `remove_launch_from_release`
- `list_release_tags`, `set_release_tags`
- `list_release_statuses`, `list_release_workflows`

## Example Calls

Create an empty release (`projectId` is taken from the argument, `projectName`, or `ALLURE_PROJECT_ID`):

```json
{
  "name": "create_release",
  "arguments": {
    "projectId": 37,
    "payload": {
      "name": "24.1",
      "dueDate": 1774000000000,
      "tags": [{ "name": "rc" }]
    }
  }
}
```

Create a release and fill it from a test case selection in one call:

```json
{
  "name": "create_release_from_test_cases",
  "arguments": {
    "projectId": 37,
    "release": { "name": "24.1" },
    "selection": { "leafsInclude": [101, 102, 103] }
  }
}
```

Define the release scope by AQL instead of an explicit list:

```json
{
  "name": "update_release_test_case_selection",
  "arguments": {
    "releaseId": 12,
    "payload": { "testCaseAql": "tag in [\"regression\"] and automated = false" }
  }
}
```

Attach a launch and read the status breakdown:

```json
{ "name": "add_launch_to_release", "arguments": { "releaseId": 12, "launchId": 5120 } }
```

```json
{ "name": "get_release_statistic", "arguments": { "id": 12 } }
```

Move the release along its workflow — resolve the status id first:

```json
{ "name": "list_release_statuses", "arguments": { "projectId": 37, "activeOnly": true } }
```

```json
{
  "name": "update_release",
  "arguments": { "id": 12, "payload": { "statusId": 4 } }
}
```

## Notes

- `add_launch_to_release`, `remove_launch_from_release`, `update_release_test_case_selection`
  and `create_release_from_test_cases` return a task info object (`{ releaseId, taskId }`);
  statistics are recalculated asynchronously, so re-read `get_release_statistic` after a moment.
- `set_release_tags` replaces the whole tag set. Read `list_release_tags` first and send the
  merged list if you want to append.
- Launches can also be bound to a release at creation time (`create_launch` payload field
  `releases: [{ "id": 12 }]`) or when running a test plan (`run_test_plan` payload field `releaseId`).
