# Shared Steps Example

## Example User Prompts

- `Show me the steps inside shared step 15 — I need to read the full procedure.`
- `List all shared steps in project 37.`
- `Which test cases use shared step 15? I want to check the impact before I edit it.`
- `Archive shared step 22 — it's been replaced.`

## Typical Tools

- `list_shared_steps`
- `get_shared_step`
- `get_shared_step_steps`
- `get_shared_step_usage`
- `create_shared_step`
- `update_shared_step`
- `archive_shared_step`
- `unarchive_shared_step`

## Example Calls

List the shared step library for a project:

```json
{
  "name": "list_shared_steps",
  "arguments": {
    "projectId": 37,
    "size": 50
  }
}
```

Read the full step content of a shared step (resolves `sharedStepId` references):

```json
{
  "name": "get_shared_step_steps",
  "arguments": {
    "id": 15
  }
}
```

Check impact before editing — which test cases reference this shared step:

```json
{
  "name": "get_shared_step_usage",
  "arguments": {
    "id": 15,
    "size": 100
  }
}
```

Create a new shared step:

```json
{
  "name": "create_shared_step",
  "arguments": {
    "payload": {
      "name": "Login as admin user",
      "projectId": 37
    }
  }
}
```

Archive an outdated shared step:

```json
{
  "name": "archive_shared_step",
  "arguments": {
    "id": 22
  }
}
```

## Notes

- When `get_test_case_steps` returns a step with a `sharedStepId` field, call `get_shared_step_steps` with that ID to inline the actual step body.
- Always run `get_shared_step_usage` before archiving or editing — a shared step may be referenced by many test cases.
- Archived shared steps are hidden from the active library but remain readable. Use `unarchive_shared_step` to restore them.
- `list_shared_steps` accepts `archived: true` to list only archived steps.
