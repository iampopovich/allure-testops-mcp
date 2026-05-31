# Resources

Static data (project lists, dashboards, test plans, etc.) is exposed via the MCP resource protocol.  
The LLM reads these directly with `resources/read` — no tool call, no argument tokens.

## Available Resources

| URI | Description |
|-----|-------------|
| `allure://projects` | All accessible Allure TestOps projects |
| `allure://env-vars` | All environment variable keys tracked in the system |
| `allure://projects/{projectId}/launches` | Launches for a given project |
| `allure://projects/{projectId}/test-plans` | Test plans for a given project |
| `allure://projects/{projectId}/dashboards` | Dashboards for a given project |

Replace `{projectId}` with a numeric project ID (e.g. `37`).

## Example: List Projects

```
resources/read  allure://projects
```

Response (truncated):

```json
{
  "content": [
    { "id": 37, "name": "Web Platform QA" },
    { "id": 42, "name": "Mobile Regression" }
  ]
}
```

## Example: List Launches for Project 37

```
resources/read  allure://projects/37/launches
```

## Example: List Test Plans for Project 37

```
resources/read  allure://projects/37/test-plans
```

## When to Use Resources vs Tools

| Use case | Prefer |
|----------|--------|
| Browse / discover (no filters) | Resource |
| Search with RQL / filter by status | Tool (`search_launches`, `search_test_results`, …) |
| Paginate with custom page size | Tool |
| Write (create / update / delete) | Tool |
