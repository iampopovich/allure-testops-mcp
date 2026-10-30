# Backup and restore of test cases

Allure TestOps Cloud gives no database access, so a backup has to go through the API. This package ships a separate CLI, `allure-testops-backup`, that does it deterministically without an LLM, so you can run it from cron or CI. It reuses the same API layer and environment variables as the MCP server.

For a one-off export from an agent conversation there are MCP tools as well (`export_test_cases_csv`, `export_launch_csv`, see below).

## What gets saved

```
backup/<projectId>-<YYYYMMDD-HHmmss>/
  manifest.json                     format version, source URL/project, counts, warnings
  project/project.json              the project
  project/dictionaries.json         statuses, workflows, test layers, roles, custom fields (id ↔ name)
  test-cases/<id>.json              test case + scenario + tags + issues + custom field values
                                    + members + relations + parameters + attachment list
  attachments/test-cases/<id>/…     attachment files
  shared-steps/<id>.json            shared step + its steps + attachment list
  attachments/shared-steps/<id>/…
  test-plans/<id>.json              name, baseRql, selection
  test-cases.csv                    Allure's native CSV export (every column)
```

The JSON is pretty-printed with sorted keys, so a backup can be committed to git and diffed between runs.

The scenario is stored exactly as `GET /api/testcase/{id}/step` returns it. That covers the step tree, the expected-result containers with their lines, shared-step references and attachment steps.

## Commands

Set `ALLURE_TESTOPS_URL` and `ALLURE_TOKEN` as for the MCP server. `ALLURE_MAX_CONCURRENT` caps parallel HTTP requests; the default is 1.

```bash
# from npm
npx -p allure-testops-mcp allure-testops-backup dump --project 37 --out ./backup

# from a checkout
npm run backup -- --project 37 --out ./backup --include-deleted
npm run restore -- ./backup/37-20261030-101500 --project 52 --dry-run
npm run restore -- ./backup/37-20261030-101500 --project 52
npm run backup:compare -- ./backup/37-20261030-101500 ./backup/52-20261030-103000
# or, from npm: allure-testops-backup compare <backup-a> <backup-b>

# from the Docker image
docker run --rm -e ALLURE_TESTOPS_URL -e ALLURE_TOKEN -v "$PWD/backup:/backup" \
  iampopovich/allure-testops-mcp:latest node dist/cli/backup.js dump --project 37 --out /backup
```

### `dump` options

| Option | Default | Meaning |
|---|---|---|
| `--project <id>` | required | Project to back up. |
| `--out <dir>` | `backup` | Parent folder; each run creates its own subfolder. |
| `--include-deleted` | off | Also save test cases from the trash. |
| `--no-attachments` | off | Skip downloading attachment files (the metadata is still saved). |
| `--no-csv` | off | Skip the native CSV export. |
| `--concurrency <n>` | 4 | Test cases fetched in parallel. HTTP is still capped by `ALLURE_MAX_CONCURRENT`. |

### `restore` options

| Option | Meaning |
|---|---|
| `<backup-dir>` | A folder created by `dump`. |
| `--project <id>` | Target project. It must be empty (no test cases and no shared steps), unless `--allow-non-empty` is given. |
| `--dry-run` | Reads the backup and the target dictionaries, then prints what would be created and every warning. Writes nothing. |
| `--include-deleted` | Recreates trashed test cases and moves them back to the trash. |

### `compare`

`compare <backup-a> <backup-b>` lists the differences between two dumps, ignoring ids, dates and authors. To check a restore: dump the target project and compare it with the source dump. Exit code 0 = equivalent, 2 = differences printed.

Exit codes:
- `0`: success.
- `1`: error.
- `2`: done, but with warnings. The warnings are printed, and they are also listed in `manifest.json` or in the restore report.

## How restore works

Restore runs in this order, mirroring the UI flows (`allure://guides/user-flows`):

1. **Matching by name.** Statuses, workflows, test layers, roles and custom fields are matched by name in the target, never by id. System custom fields (Epic, Feature, Story, Component, Suite) match everywhere.
2. **Shared steps.** Each one is created, then its attachments are uploaded and its steps are written one by one (`POST /api/sharedstep/step`).
3. **Test cases.** Each test case is created without `scenario`. Then tags, custom field values (by value name), members, parameters, issues and attachments are added. Finally the scenario is written step by step, in order:
   - expected results go into ER containers;
   - shared-step references point to the new shared steps;
   - attachment steps point to the re-uploaded files.
4. **Relations.** These are written in a second pass, because both ends must already exist.
5. **Test plans.** Each plan keeps its `baseRql`. The explicit selection is remapped to the new test case ids.

All ids change. The old → new map is saved next to the backup as `restore-<target>-<time>.json`.

## What is not restored

- Run history, launches, test results, defects and mutes.
- Test case versions, the change log and comments.
- Authors and creation dates. The restore runs as the token's user.
- Issue links, unless the target project has the same issue integration. They are reported as warnings.
- Test plan folder or path selections. These are tree-specific, so they are reported, and the explicit test case ids are kept.
- Test cases that had no status or workflow (created by result import). They get the target's default workflow and status.

## Native CSV

`test-cases.csv` is Allure's own export, the same as Test cases → select → Export → CSV with every column. It covers:
- the indented scenario;
- one column per custom field and per role;
- tags, links and parameters.

Use it for spreadsheets, or to re-import through the UI. It loses attachments, shared-step links, relations and ids, so use the JSON for a full restore.

## MCP tools

| Tool | Use |
|---|---|
| `export_test_cases_csv({ projectId?, testCaseIds? \| rql?, savePath?, columnSeparator? })` | Native CSV of selected or all test cases. Without `savePath` the CSV is returned inline (truncated after 50 000 characters). |
| `export_launch_csv({ launchId, savePath?, columnSeparator? })` | Native CSV of every result in a launch. |

Restore is deliberately not exposed as an MCP tool, because it writes to the instance in bulk.

## Scheduled backup (GitHub Actions)

```yaml
name: allure-backup
on:
  schedule: [{ cron: "0 2 * * *" }]
  workflow_dispatch:
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx -y -p allure-testops-mcp allure-testops-backup dump --project 37 --out backup --include-deleted
        env:
          ALLURE_TESTOPS_URL: ${{ secrets.ALLURE_TESTOPS_URL }}
          ALLURE_TOKEN: ${{ secrets.ALLURE_TOKEN }}
          ALLURE_MAX_CONCURRENT: "4"
      - uses: actions/upload-artifact@v4
        with: { name: allure-backup, path: backup, retention-days: 30 }
```
