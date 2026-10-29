/**
 * Builds the bundled copies of the user-flow guide from its single source,
 * docs/usages/user-flows.md:
 *  - src/resources/docs/user-flows.ts  (served as MCP resource allure://guides/user-flows; compiled into dist)
 *  - skills/allure-testops/references/user-flows.md (Claude skill reference)
 *
 * Run: npm run docs:user-flows
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "docs/usages/user-flows.md");
const moduleTarget = resolve(root, "src/resources/docs/user-flows.ts");
const skillTarget = resolve(root, "skills/allure-testops/references/user-flows.md");

const markdown = readFileSync(source, "utf8").replace(/\r\n/g, "\n");

mkdirSync(dirname(moduleTarget), { recursive: true });
writeFileSync(
  moduleTarget,
  "// GENERATED from docs/usages/user-flows.md by scripts/generate-user-flows.ts — do not edit by hand.\n" +
    `export const USER_FLOWS_GUIDE = ${JSON.stringify(markdown)};\n`,
);
writeFileSync(skillTarget, markdown);

console.log(`user-flows guide written to ${moduleTarget} and ${skillTarget}`);
