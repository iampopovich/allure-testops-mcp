import pino from "pino";

/**
 * Structured JSON logger — writes to stderr (stdout is reserved
 * for the MCP protocol transport).
 *
 * Level is controlled via ALLURE_LOG_LEVEL env var (default "info").
 * Set to "debug" or "trace" for verbose output during development.
 */
export const logger = pino({
  name: "allure-testops-mcp",
  level: process.env.ALLURE_LOG_LEVEL ?? "info",
});
