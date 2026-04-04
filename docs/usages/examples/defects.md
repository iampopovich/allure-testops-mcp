# Defects Example

## Example User Prompts

- `What are all open defects in project 37?`
- `Show me all failures grouped under defect 12.`
- `What failure patterns appeared in launch 55? Give me a defect summary.`
- `Find test results in launch 55 that match defect 12.`
- `Close defects 10, 11, and 14 — the fix was deployed.`
- `Link Jira issue PROJ-1234 to defect 12.`
- `Auto-triage launch 55 by applying all defect matchers.`

## Typical Tools

- `list_defects`
- `get_defect`
- `create_defect`
- `get_defect_test_results`
- `get_defect_test_cases`
- `get_defect_launches`
- `get_launch_defects`
- `find_similar_failures`
- `link_defect_to_test_results`
- `bulk_close_defects`
- `bulk_reopen_defects`
- `link_issue_to_defect`
- `unlink_issue_from_defect`
- `apply_defect_matchers`

## Example Calls

List all open defects for a project:

```json
{
  "name": "list_defects",
  "arguments": {
    "projectId": 37,
    "status": "OPEN",
    "size": 50
  }
}
```

Get a failure summary for a launch (all distinct defect patterns):

```json
{
  "name": "get_launch_defects",
  "arguments": {
    "id": 55,
    "size": 100
  }
}
```

Get all test results grouped under a defect:

```json
{
  "name": "get_defect_test_results",
  "arguments": {
    "id": 12,
    "size": 50
  }
}
```

Find test results in a launch that match a specific defect pattern:

```json
{
  "name": "find_similar_failures",
  "arguments": {
    "launchId": 55,
    "defectId": 12,
    "size": 50
  }
}
```

Link multiple test results to a defect (bulk):

```json
{
  "name": "link_defect_to_test_results",
  "arguments": {
    "payload": {
      "defectId": 12,
      "testResultIds": [1001, 1002, 1003]
    }
  }
}
```

Close multiple defects after a fix is deployed:

```json
{
  "name": "bulk_close_defects",
  "arguments": {
    "payload": {
      "ids": [10, 11, 14]
    }
  }
}
```

Link an external issue to a defect:

```json
{
  "name": "link_issue_to_defect",
  "arguments": {
    "id": 12,
    "payload": {
      "url": "https://jira.example.com/browse/PROJ-1234",
      "name": "PROJ-1234"
    }
  }
}
```

Auto-triage a launch using all configured defect matchers:

```json
{
  "name": "apply_defect_matchers",
  "arguments": {
    "id": 55
  }
}
```

## Notes

- `get_launch_defects` is the fastest entry point for a post-launch failure analysis: call it first, then drill into individual defects with `get_defect_test_results`.
- `apply_defect_matchers` runs all project-level matcher rules against unresolved results in the launch — useful for automated triage after a nightly run.
- `find_similar_failures` helps when you suspect multiple unlinked results belong to the same root cause.
- Always use `link_issue_to_defect` to connect defects to your issue tracker — it makes mute audits and "is this fixed?" checks much faster.
