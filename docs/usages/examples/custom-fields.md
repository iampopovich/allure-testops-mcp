# Custom Fields Example

## Example User Prompt

`Find custom field values for "Priority" in project 37 and set a test case priority to High.`

## Typical Tools

- `list_custom_field_values`
- `get_test_case_custom_fields`
- `set_test_case_custom_fields`

Project-level custom field definitions are looked up internally when needed (e.g. by `find_test_cases`'s `customFieldFilters`) — there is no standalone `list_project_custom_fields` tool. To find a field's ID for `list_custom_field_values`, check the project's custom field configuration in the Allure TestOps UI, or inspect `get_test_case_custom_fields` output on a test case that already has the field set.

## Example Calls

List values for a field:

```json
{
  "name": "list_custom_field_values",
  "arguments": {
    "projectId": 37,
    "customFieldId": 11,
    "page": 0,
    "size": 50
  }
}
```

Set values on a test case:

```json
{
  "name": "set_test_case_custom_fields",
  "arguments": {
    "projectId": 37,
    "testCaseId": 12345,
    "payload": [
      {
        "customField": {
          "id": 11
        },
        "values": [
          {
            "id": 101,
            "name": "High"
          }
        ]
      }
    ]
  }
}
```

Flat payload items are also accepted and normalized automatically:

```json
{
  "name": "set_test_case_custom_fields",
  "arguments": {
    "projectId": 37,
    "testCaseId": 12345,
    "payload": [
      {
        "id": 101,
        "name": "High",
        "customField": {
          "id": 11
        }
      }
    ]
  }
}
```

This tool adds values via `POST /api/v2/test-case/bulk/cfv/add` for the selected test case.
