# Usage via Local Run

Use this option when you want to run the server from local source code.

## Prerequisites

- Node.js 18+
- npm

## 1) Install and Build

```bash
npm install
npm run build
```

## 2) Set Environment Variables

```bash
export ALLURE_TESTOPS_URL="https://your-allure-instance.com"
export ALLURE_TOKEN="your-api-token"
# Optional:
export ALLURE_PROJECT_ID="37"
export ALLURE_CACHE_DISABLED="1"   # set to disable in-memory LRU cache (enabled by default)
```

### Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ALLURE_TESTOPS_URL` | Yes | — | Base URL of your Allure TestOps instance |
| `ALLURE_TOKEN` | Yes | — | API token for authentication |
| `ALLURE_PROJECT_ID` | No | — | Default project ID used when not provided in tool arguments |
| `ALLURE_CACHE_DISABLED` | No | — | Set to `1` to disable the in-memory LRU cache |

#### About the cache

The server caches GET responses in memory to reduce redundant requests to Allure TestOps.  
Cache is invalidated automatically on any write operation (create / update / delete) against the same resource.

TTL by entity type:

| Entity | TTL |
|--------|-----|
| Projects, env vars | 5 min |
| Dashboards, test plans, shared steps | 2 min |
| Test cases | 60 sec |
| Defects, test results, widgets | 30 sec |
| Launches | 15 sec |
| Scenario / steps | 10 sec |

Disable the cache when:
- Debugging stale data issues
- Running integration tests that require fresh state after each write
- The Allure instance is updated by external processes concurrently

## 3) Run

Production build:

```bash
npm start
```

Development mode:

```bash
npm run dev
```

## Local Debug UI

Start a browser-based chatbot UI for calling MCP tools and inspecting requests and responses:

```bash
npm run dev:ui
# Open http://localhost:3333
```

Optionally change the port:

```bash
DEV_UI_PORT=4000 npm run dev:ui
```

The UI lists all available tools. Click a tool, edit the JSON arguments, press **Call**, and inspect the result inline.

Each tool includes ready payload examples:
- **Required payload**: only required schema fields
- **Required + optional payload**: full payload with optional fields filled with sample values
- **Last working example**: the last successful payload you used for that tool

## MCP Server Command (Local Build)

```json
{
  "command": "node",
  "args": ["/absolute/path/to/allure-testops-mcp/dist/index.js"],
  "env": {
    "ALLURE_TESTOPS_URL": "https://your-allure-instance.com",
    "ALLURE_TOKEN": "your-api-token",
    "ALLURE_PROJECT_ID": "37"
  }
}
```
