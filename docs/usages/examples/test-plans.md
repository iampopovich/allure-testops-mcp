# Test Plans Example

## Example User Prompt

`Create a smoke test plan in project 37 and run it in a new launch.`

## Typical Tools

- `create_test_plan`
- `update_test_plan`
- `run_test_plan`
- `delete_test_plan`

## Resources

Listing test plans is done via the MCP resource protocol — no tool call needed:

```
resources/read  allure://projects/37/test-plans
```

## Example Calls

Create:

```json
{
  "name": "create_test_plan",
  "arguments": {
    "payload": {
      "projectId": 37,
      "name": "Smoke Plan - Web"
    }
  }
}
```

Run:

```json
{
  "name": "run_test_plan",
  "arguments": {
    "id": 782,
    "payload": {
      "name": "Smoke Launch - 2026-03-03"
    }
  }
}
```
