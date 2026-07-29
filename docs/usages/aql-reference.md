# AQL Reference

AQL (Allure Query Language) is the filter syntax used by `search_test_cases`, `search_test_results`, and `search_launches` via their `rql` parameter. This page is a quick glossary to avoid the most common "invalid AQL" failures. Full upstream spec: https://docs.qameta.io/reference/aql/

## Wrong tool, not wrong syntax

The most common failure isn't bad AQL — it's calling the wrong tool:

- `search_test_cases({ query: "..." })` fails because this tool has **no `query` field**. The field is `rql`, and it's required.
- For broad "find test cases by keyword/name" searches, use `find_test_cases({ query: "..." })` instead. It builds valid AQL internally (`name ~= "keyword"`, `cf["Feature"] = "..."`, etc.) and calls the same search API.
- Reserve `search_test_cases` for precise `rql` queries — custom field logic, boolean combinations, `in [...]` lists.

## Operators

| Operator | Meaning |
|---|---|
| `=` / `!=` | equals / not equals |
| `~=` | contains (substring match) — **not** `~` |
| `>` `<` `>=` `<=` | comparison (numbers, dates) |
| `in [...]` | value is one of a list |
| `and` / `or` | boolean combination |
| `not` | negation — see note below |
| `= null` / `is null` | field is empty/unset |

**`not in` gotcha:** write `not field in [...]`, never `field not in [...]`. The latter is invalid AQL.

**Operator precedence:** `and` binds tighter than `or`. `a or b and c` parses as `a or (b and c)`, not `(a or b) and c`. Always parenthesize explicitly when mixing them: `(createdBy = "a" or createdBy = "b") and automation = true`.

**Dates:** always 13-digit Unix millisecond timestamps, not ISO strings.

**Strings:** double-quote values: `name ~= "login"`, `status = "Active"`.

**Null checks:** `cf["Feature"] = null` or `cf["Feature"] is null` to match test cases where a custom field/role/etc. is unset.

## Fields by entity

### Test cases (`search_test_cases`)
`id, name, tag, issue, role["R"], member, cf["F"], cfv, layer, status, workflow, testPlan, automation (boolean), muted, mutedDate, createdDate, createdBy, lastModifiedDate, lastModifiedBy`

```
name ~= "login"
automation = true
status = "Active"
tag in ["smoke", "regression"]
not tag in ["nightly"]
cf["Feature"] = "keyword" and cf["Suite"] = "MySuite"
name ~= "checkout" and muted = false
(createdBy = "a" or createdBy = "b") and automation = true
```

### Test results (`search_test_results`)
`id, name, fullName, testCase, status, category, tag, issue, role["R"], member, testedBy, cf["F"], cfv, ev["VAR"], evv, layer, muted (boolean), hidden (boolean), launch, createdDate, createdBy, lastModifiedDate, lastModifiedBy`

```
status = "failed"
status in ["failed", "broken"]
name ~= "login"
launch = "release-1.0"
ev["OS"] = "Linux"
not tag in ["nightly"]
status = "failed" and muted = false
```

### Launches (`search_launches`)
`id, name, tag, issue, job, ev["VAR"], evv, closed (boolean), createdDate, createdBy, lastModifiedDate, lastModifiedBy`

```
name ~= "nightly"
closed = false
tag in ["release", "pre-release"]
job = "jenkins_master"
ev["OS"] = "Linux"
not tag in ["devbuild"]
```

Note: launches have no numeric launch-id field in AQL — filter by `name`, `tag`, `job`, etc. instead.

## Custom fields (`cf[...]`) vs environment variables (`ev[...]`)

- `cf["FieldName"] = "value"` — custom field exact match (test cases, test results).
- `cfv` — custom field value id/lookup, distinct from `cf[...]`.
- `ev["VarName"] = "value"` — environment variable (launches, test results). Not available on test cases.
- `~=` on custom fields is not officially documented and may 400 on some Allure versions — prefer `=` unless you've confirmed `~=` works against your instance.

## Quick checklist when AQL fails

1. Are you calling `search_test_cases`/`search_test_results`/`search_launches` — or did you mean `find_test_cases` for a plain keyword search?
2. Is the field wrapped correctly — `cf["Name"]` / `ev["Name"]`, not bare `Name`?
3. Is `~=` used instead of `~` for contains?
4. Is `not` placed before the field (`not tag in [...]`), not after?
5. Are dates 13-digit ms timestamps?
6. Are string values double-quoted?
7. If mixing `and`/`or`, are parentheses grouping the `or` explicitly? (`and` has higher precedence.)
