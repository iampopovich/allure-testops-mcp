# Environments Example

## Example User Prompts

- `What environment did test result 5500 run on? Was it Chrome or Firefox?`
- `What browser values have been recorded across all runs?`
- `What environment variable keys are available so I can build an AQL filter?`
- `List all env var schemas configured for project 37.`

## Typical Tools

- `suggest_env_vars`
- `list_env_var_schemas`
- `list_env_var_values`
- `suggest_env_var_values`
- `get_test_result_env_vars`

Env var keys are also available as a read-only MCP resource at `allure://env-vars` (use `resources/read`, not `tools/call`) if you need the full raw list instead of a search.

## Example Calls

Search for an env var key by partial name:

```json
{
  "name": "suggest_env_vars",
  "arguments": {
    "query": "browser"
  }
}
```

List project-specific env var schemas (which keys are tracked per launch):

```json
{
  "name": "list_env_var_schemas",
  "arguments": {
    "projectId": 37
  }
}
```

List all recorded values for the "browser" env var (id from list_env_vars):

```json
{
  "name": "list_env_var_values",
  "arguments": {
    "envVarId": 3
  }
}
```

Autocomplete values for building an AQL filter:

```json
{
  "name": "suggest_env_var_values",
  "arguments": {
    "query": "Chrome",
    "envVarId": 3,
    "projectId": 37
  }
}
```

Get the environment context for a specific failed test result:

```json
{
  "name": "get_test_result_env_vars",
  "arguments": {
    "id": 5500
  }
}
```

## Notes

- Use `suggest_env_vars` (or read the `allure://env-vars` resource) to discover valid key names before writing AQL filters like `ev["browser"] = "Chrome 124"` in `search_test_results` or `search_launches`.
- Use `suggest_env_var_values` to find the exact value strings used in runs — values are case-sensitive in AQL.
- `get_test_result_env_vars` is the fastest way to check if a specific failure is environment-specific (e.g. only fails on Windows, only on Chrome).
- `list_env_var_schemas` shows which env vars a project is configured to capture per launch — useful to understand what context is available before querying.
