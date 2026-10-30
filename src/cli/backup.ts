#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { diffNormalized, normalizeBackup } from "../backup/compare.js";
import { dumpProject } from "../backup/dump.js";
import { restoreProject } from "../backup/restore.js";
import { createClientFromEnv } from "../server-bootstrap.js";

const USAGE = `Usage:
  allure-testops-backup dump --project <id> [--out <dir>] [--include-deleted] [--no-attachments] [--no-csv] [--concurrency <n>]
  allure-testops-backup restore <backup-dir> --project <targetId> [--dry-run] [--allow-non-empty] [--include-deleted]
  allure-testops-backup compare <backup-a> <backup-b>

Environment: ALLURE_TESTOPS_URL, ALLURE_TOKEN (same as the MCP server); ALLURE_MAX_CONCURRENT caps parallel HTTP requests.

dump     saves one project to <out>/<projectId>-<timestamp>/ (JSON per entity + attachments + Allure's native CSV).
restore  recreates test cases, scenarios, shared steps and test plans from a dump in another (empty) project.
         Ids change; the old → new mapping is written next to the backup as restore-<target>-<time>.json.
compare  diffs two dumps ignoring ids, dates and authors (dump the target after a restore and compare).`;

function readPackage(): { version?: string; supportedApiVersion?: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", "..", "package.json"), join(here, "..", "package.json")]) {
    try {
      return JSON.parse(readFileSync(candidate, "utf-8")) as { version?: string; supportedApiVersion?: string };
    } catch {
      // try next location (src/ vs dist/ layouts)
    }
  }
  return {};
}

function parseProjectId(value: string | undefined): number {
  const id = Number(value);
  if (!value || !Number.isInteger(id) || id <= 0) {
    throw new Error("--project <id> is required and must be a positive integer.");
  }
  return id;
}

const log = (message: string) => process.stderr.write(message + "\n");

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      project: { type: "string", short: "p" },
      out: { type: "string", short: "o", default: "backup" },
      "include-deleted": { type: "boolean", default: false },
      "no-attachments": { type: "boolean", default: false },
      "no-csv": { type: "boolean", default: false },
      concurrency: { type: "string", default: "4" },
      "dry-run": { type: "boolean", default: false },
      "allow-non-empty": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [command, backupDir, otherDir] = positionals;
  if (values.help || !command) {
    log(USAGE);
    return values.help ? 0 : 1;
  }

  if (command === "compare") {
    if (!backupDir || !otherDir) throw new Error("compare needs two backup directories: compare <backup-a> <backup-b>");
    const differences = diffNormalized(await normalizeBackup(resolve(backupDir)), await normalizeBackup(resolve(otherDir)));
    if (differences.length === 0) {
      log("Backups are equivalent.");
      return 0;
    }
    log(`${differences.length} difference(s):`);
    for (const line of differences) log("  " + line);
    return 2;
  }

  const client = createClientFromEnv({ cache: false });
  const pkg = readPackage();

  if (command === "dump") {
    const { dir, manifest } = await dumpProject(client, parseProjectId(values.project), {
      outDir: resolve(values.out ?? "backup"),
      includeDeleted: values["include-deleted"],
      attachments: !values["no-attachments"],
      csv: !values["no-csv"],
      concurrency: Number(values.concurrency) || 4,
      toolVersion: pkg.version,
      supportedApiVersion: pkg.supportedApiVersion,
      baseUrl: process.env.ALLURE_TESTOPS_URL,
      log,
    });
    log(`Backup saved to ${dir}`);
    log(JSON.stringify(manifest.counts));
    for (const warning of manifest.warnings) log(`WARNING: ${warning}`);
    return manifest.warnings.length > 0 ? 2 : 0;
  }

  if (command === "restore") {
    if (!backupDir) throw new Error("restore needs the backup directory: restore <backup-dir> --project <targetId>");
    const report = await restoreProject(client, resolve(backupDir), parseProjectId(values.project), {
      dryRun: values["dry-run"],
      allowNonEmpty: values["allow-non-empty"],
      includeDeleted: values["include-deleted"],
      log,
    });
    log(JSON.stringify(report.created));
    for (const warning of report.warnings) log(`WARNING: ${warning}`);
    if (report.reportFile) log(`Report: ${report.reportFile}`);
    return report.warnings.length > 0 ? 2 : 0;
  }

  log(`Unknown command "${command}".\n\n${USAGE}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    log(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
