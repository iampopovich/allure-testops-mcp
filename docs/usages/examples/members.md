# Members Example

## Example User Prompts

- `Who is working on launch 42? Show me the workload breakdown.`
- `List all members of project 37.`
- `Find user "anna" so I can assign this test result to her.`
- `Who is responsible for test case 101?`

## Typical Tools

- `suggest_users`
- `list_project_members`
- `get_launch_member_stats`
- `get_test_case_members`
- `get_test_result_members`

## Example Calls

Search for a user by partial name (before assigning):

```json
{
  "name": "suggest_users",
  "arguments": {
    "query": "anna",
    "size": 10
  }
}
```

List all collaborators for a project:

```json
{
  "name": "list_project_members",
  "arguments": {
    "projectId": 37
  }
}
```

Get workload distribution across team members in a launch:

```json
{
  "name": "get_launch_member_stats",
  "arguments": {
    "id": 42,
    "size": 50
  }
}
```

Get members assigned to a test case:

```json
{
  "name": "get_test_case_members",
  "arguments": {
    "testCaseId": 101
  }
}
```

Get members assigned to a specific test result:

```json
{
  "name": "get_test_result_members",
  "arguments": {
    "testResultId": 5500
  }
}
```

## Notes

- `suggest_users` is the right tool for free-text user lookup before calling `assign_test_result`.
- `get_launch_member_stats` gives resolved/assigned counts per person — useful for spotting unbalanced workloads.
- `list_project_members` returns roles and permission sets alongside user data.
