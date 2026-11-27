# Usage via Docker

Use this option when you want an isolated runtime and no local Node.js dependency for execution.

No prebuilt image is published. Build it from a checkout of this repository first:

```bash
git clone https://github.com/iampopovich/allure-testops-mcp.git
cd allure-testops-mcp
docker build -t allure-testops-mcp .
```

## Run the Image with MCP stdio

```bash
docker run -i --rm \
  -e ALLURE_TESTOPS_URL=https://your-allure-instance \
  -e ALLURE_TOKEN=your-api-token \
  -e ALLURE_PROJECT_ID=37 \
  allure-testops-mcp
```

## MCP Server Command (Docker)

```json
{
  "command": "docker",
  "args": [
    "run",
    "-i",
    "--rm",
    "-e",
    "ALLURE_TESTOPS_URL=https://your-allure-instance",
    "-e",
    "ALLURE_TOKEN=your-api-token",
    "-e",
    "ALLURE_PROJECT_ID=37",
    "allure-testops-mcp"
  ]
}
```

## Notes

- Keep the `-i` flag; MCP stdio requires interactive stdin.
- If you do not set `ALLURE_PROJECT_ID`, pass `projectId` or `projectName` to project-scoped tools.
- For advanced Docker operations (compose, troubleshooting), see [`DOCKER.md`](../../DOCKER.md).
