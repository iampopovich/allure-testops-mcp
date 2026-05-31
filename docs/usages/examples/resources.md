# Resources

Static data (project lists, dashboards, test plans, etc.) is exposed via the MCP resource protocol.  
The LLM reads these directly with `resources/read` — no tool call, no argument tokens.

## Available Resources

All resources return the **first page with default server page size and no filters**.  
For filtering, pagination beyond page 0, or sorting — use the corresponding tool instead.

| URI | Quick listing of… | Use tool for filtering |
|-----|--------------------|------------------------|
| `allure://projects` | All accessible projects | — |
| `allure://env-vars` | All env variable keys | — |
| `allure://projects/{projectId}/launches` | Launches | `search_launches` |
| `allure://projects/{projectId}/test-plans` | Test plans | — |
| `allure://projects/{projectId}/dashboards` | Dashboards | — |
| `allure://projects/{projectId}/test-cases` | Test cases | `search_test_cases` |
| `allure://projects/{projectId}/defects` | Defects | `get_defect` |
| `allure://projects/{projectId}/shared-steps` | Shared steps | — |
| `allure://projects/{projectId}/custom-fields` | Custom fields | `list_custom_field_values` |

Replace `{projectId}` with a numeric project ID (e.g. `37`).

> **Note:** test results are not exposed as a resource — the unfiltered payload per launch can exceed 100 KB. Use `list_test_results` (with `page`/`size`/`search`) or `search_test_results` (RQL) instead.

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

Resources return the **first page with default page size and no filters** — they are intended for quick discovery, not for complete enumeration or filtered access.

| Use case | Prefer |
|----------|--------|
| Quick first look / discover IDs | Resource |
| Filter by status, name, RQL | Tool (`search_test_cases`, `search_test_results`, `search_launches`, …) |
| Paginate beyond the first page | Tool |
| Write (create / update / delete) | Tool |

**Pattern:** read a resource to get a starting ID → use a tool for deeper filtered queries.
