# Allure TestOps skill

An agent skill for working with [Allure TestOps](https://qameta.io/) through the [allure-testops-mcp](https://github.com/iampopovich/allure-testops-mcp) MCP server.

The MCP server gives the agent about 120 Allure tools. This skill tells the agent which tool to use for which task and how to avoid the Allure API quirks that silently lose or corrupt data: steps that are never saved, expected results that get duplicated, tags that are not persisted, test case names rewritten by link sync, parallel writes that race.

## What it covers

- Searching test cases, results and launches, including AQL syntax and its common mistakes
- Creating test cases with steps and expected results, and verifying them afterwards
- Editing steps and expected results without duplicates or data loss
- Tags, issue and external links, custom fields (resolving numeric ids)
- Manual launches, recording results, failure triage, defects
- Conventions for writing clear manual test cases

## Requirements

- An Allure TestOps instance and a user API token (Allure profile → API tokens)
- Node.js 18+ (the MCP server runs through `npx`)
- An agent that supports both MCP servers and skills, such as Claude Code

## Installation

**1. Install the MCP server.** Add it to your MCP client config:

```json
{
  "mcpServers": {
    "allure-testops": {
      "command": "npx",
      "args": ["-y", "allure-testops-mcp"],
      "env": {
        "ALLURE_TESTOPS_URL": "https://your-instance.example.com",
        "ALLURE_TOKEN": "<your API token>",
        "ALLURE_PROJECT_ID": "<optional default project id>"
      }
    }
  }
}
```

In Claude Code:

```bash
claude mcp add allure-testops -e ALLURE_TESTOPS_URL=https://your-instance.example.com -e ALLURE_TOKEN=<your API token> -- npx -y allure-testops-mcp
```

**2. Install the skill.** Copy the `allure-testops` folder into your agent's skills directory:

- Claude Code, for one user: `~/.claude/skills/allure-testops/`
- Claude Code, for one project: `.claude/skills/allure-testops/` in the repository
- Other agents: see their documentation for the skills location

**3. Restart the agent**, then ask something like "find test cases for checkout in Allure" or "create a test case with these steps".

## Using it with project rules

The skill is domain-neutral. Keep project-specific conventions (domain vocabulary, required tags, fixed custom field values, draft locations) in your own `CLAUDE.md`, rules files or a team skill: this skill provides the general layer, and your project adds its own rules on top. If one of your rules contradicts the skill, say explicitly in your rule that it overrides the skill.

## Files

| File | Purpose |
|---|---|
| `SKILL.md` | Main instructions, loaded by the agent when the task matches |
| `references/aql.md` | AQL operators, fields per entity and common mistakes |
| `references/test-case-authoring.md` | How to write manual test cases: fields, naming, atomic steps |
| `references/user-flows.md` | Every Allure TestOps user flow: UI path → MCP tool → API (generated from `docs/usages/user-flows.md`; also MCP resource `allure://guides/user-flows`) |

## Security

The skill contains Markdown instructions only: no scripts, no network calls, no environment-variable reads. Your API token stays in your own MCP client config. The MCP server sends requests only to the Allure instance in `ALLURE_TESTOPS_URL`.

## License

MIT, see [LICENSE](LICENSE).

## Feedback

Issues and suggestions: https://github.com/iampopovich/allure-testops-mcp/issues
