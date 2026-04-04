# Mutes Example

## Example User Prompts

- `How many tests are muted in project 37 right now?`
- `Show me all mutes for test case 101 — why is it silenced?`
- `How many failures were hidden by mutes in launch 55?`
- `Mute test result 5500 — it failed due to an infra outage, not a code bug.`
- `Unmute all results from launch 55 after the infra fix.`
- `Create a mute for test case 101 with reason "known flake, tracked in PROJ-999".`

## Typical Tools

- `get_muted_test_cases`
- `list_mutes`
- `create_mute`
- `delete_mute`
- `get_launch_muted_results`
- `mute_test_result`
- `unmute_test_result`
- `bulk_mute_test_results`
- `bulk_unmute_test_results`

## Example Calls

Sprint health check — all muted test cases in a project:

```json
{
  "name": "get_muted_test_cases",
  "arguments": {
    "projectId": 37,
    "size": 100
  }
}
```

Audit mutes for a specific test case (check reason and linked issue):

```json
{
  "name": "list_mutes",
  "arguments": {
    "testCaseId": 101
  }
}
```

See how many failures were hidden in a launch:

```json
{
  "name": "get_launch_muted_results",
  "arguments": {
    "id": 55,
    "size": 100
  }
}
```

Create a mute with a documented reason and issue link:

```json
{
  "name": "create_mute",
  "arguments": {
    "payload": {
      "testCaseId": 101,
      "name": "Known flake in payment flow — tracked in PROJ-999",
      "issues": [
        { "url": "https://jira.example.com/browse/PROJ-999", "name": "PROJ-999" }
      ]
    }
  }
}
```

Remove a mute after the fix is confirmed:

```json
{
  "name": "delete_mute",
  "arguments": {
    "id": 88
  }
}
```

Mute a single test result (infra-related failure):

```json
{
  "name": "mute_test_result",
  "arguments": {
    "id": 5500,
    "payload": {
      "reason": "DB connection timeout during infra maintenance window"
    }
  }
}
```

Bulk mute multiple results after an infra outage:

```json
{
  "name": "bulk_mute_test_results",
  "arguments": {
    "payload": {
      "testResultIds": [5500, 5501, 5502, 5503],
      "reason": "Redis outage 2026-04-04 — not a code regression"
    }
  }
}
```

Bulk unmute after the fix:

```json
{
  "name": "bulk_unmute_test_results",
  "arguments": {
    "payload": {
      "testResultIds": [5500, 5501, 5502, 5503]
    }
  }
}
```

## Notes

- Use `get_muted_test_cases` as a periodic health check: any mute older than 2 weeks with no linked issue is a red flag.
- Always provide `name` (reason) and `issues` when calling `create_mute` — silent mutes without accountability accumulate over time and hide real problems.
- `get_launch_muted_results` shows the real failure count hidden from the launch dashboard. Compare it to the visible failure count to understand how much risk is being suppressed.
- `bulk_mute_test_results` / `bulk_unmute_test_results` are the right tools for infrastructure incident response.
