# Docker Deployment Guide for Allure TestOps MCP Server

This guide explains how to build and run the Allure TestOps MCP server as a Docker container.

No prebuilt image is published to a registry. Build the image locally from this repository; every command below uses the local image name `allure-testops-mcp`.

## Prerequisites

- Docker installed (Docker Desktop or Docker Engine)
- A checkout of this repository
- Allure TestOps instance with API access
- API token from Allure TestOps

## Building the Docker Image

The Dockerfile uses a multi-stage build process to create an optimized production image:
- **Build stage**: Compiles TypeScript code
- **Production stage**: Contains only runtime dependencies and compiled code

### Build Locally

```bash
docker build -t allure-testops-mcp .
```

### Build with Version Tag

```bash
docker build -t allure-testops-mcp:1.9.0 -t allure-testops-mcp .
```

## Running the Container

### Using Docker Run

#### Basic Usage

```bash
docker run -i --rm \
  -e ALLURE_TESTOPS_URL=https://your-allure-instance \
  -e ALLURE_TOKEN=your-api-token \
  -e ALLURE_PROJECT_ID=1 \
  allure-testops-mcp
```

#### With Cache Disabled

```bash
docker run -i --rm \
  -e ALLURE_TESTOPS_URL=https://your-allure-instance \
  -e ALLURE_TOKEN=your-api-token \
  -e ALLURE_PROJECT_ID=1 \
  -e ALLURE_CACHE_DISABLED=1 \
  allure-testops-mcp
```

#### Run in Background

```bash
docker run -d --name allure-mcp -i \
  -e ALLURE_TESTOPS_URL=https://your-allure-instance \
  -e ALLURE_TOKEN=your-api-token \
  -e ALLURE_PROJECT_ID=1 \
  --restart unless-stopped \
  allure-testops-mcp
```

### Using Docker Compose

The `docker-compose.yml` in the repository builds the image from the local Dockerfile (`build: .`). A minimal service definition looks like this:

```yaml
services:
  allure-testops-mcp:
    build: .
    image: allure-testops-mcp
    container_name: allure-testops-mcp
    environment:
      - ALLURE_TESTOPS_URL=${ALLURE_TESTOPS_URL:?set ALLURE_TESTOPS_URL in .env}
      - ALLURE_TOKEN=${ALLURE_TOKEN}
      - ALLURE_PROJECT_ID=${ALLURE_PROJECT_ID:-}
      # - ALLURE_CACHE_DISABLED=1   # uncomment to disable in-memory LRU cache
    restart: unless-stopped
    stdin_open: true
```

Create a `.env` file in the same directory:

```bash
ALLURE_TESTOPS_URL=https://your-allure-instance
ALLURE_TOKEN=your-api-token-here
ALLURE_PROJECT_ID=1
# ALLURE_CACHE_DISABLED=1
```

Build and run with Docker Compose:

```bash
docker compose up -d --build
```

## Configuring MCP Clients

### Claude Desktop (Docker Container)

Add to your MCP client configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "allure-testops": {
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
        "ALLURE_PROJECT_ID=1",
        "allure-testops-mcp"
      ]
    }
  }
}
```

### Using Environment Variables from Host

If you prefer to keep credentials in a `.env` file on the host:

```json
{
  "mcpServers": {
    "allure-testops": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--env-file",
        "/path/to/your/.env",
        "allure-testops-mcp"
      ]
    }
  }
}
```

Create `.env` file with:

```bash
ALLURE_TESTOPS_URL=https://your-allure-instance
ALLURE_TOKEN=your-api-token-here
ALLURE_PROJECT_ID=1
```

### Using Docker Compose Service

If running as a Docker Compose service, you can connect to it directly:

```json
{
  "mcpServers": {
    "allure-testops": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "allure-testops-mcp",
        "node",
        "dist/index.js"
      ]
    }
  }
}
```

Note: The container must be running before starting the MCP client.

## Verifying the Image

### Test the Container

```bash
# Run interactively
docker run -i --rm \
  -e ALLURE_TESTOPS_URL=https://your-allure-instance \
  -e ALLURE_TOKEN=your-token \
  -e ALLURE_PROJECT_ID=1 \
  allure-testops-mcp
```

You should see a JSON log line with `"msg":"server started"` on stderr (stdout is reserved for MCP traffic; set `ALLURE_LOG_LEVEL=debug` for more detail).

### Check Image Size

```bash
docker images allure-testops-mcp
```

### Inspect Image Layers

```bash
docker history allure-testops-mcp
```

## Troubleshooting

### Container Exits Immediately

Make sure to use the `-i` flag (interactive mode) as the MCP server uses stdio for communication.

### `Unable to find image 'allure-testops-mcp:latest' locally`

The image is not on any registry. Run `docker build -t allure-testops-mcp .` in the repository first.

### Authentication Errors

Verify your environment variables:
```bash
docker run --rm \
  -e ALLURE_TESTOPS_URL=https://your-allure-instance \
  -e ALLURE_TOKEN=your-token \
  -e ALLURE_PROJECT_ID=1 \
  allure-testops-mcp \
  node -e "console.log(process.env.ALLURE_TESTOPS_URL)"
```

### View Container Logs

```bash
docker logs allure-testops-mcp
```

### Interactive Shell for Debugging

```bash
docker run -it --rm \
  -e ALLURE_TESTOPS_URL=https://your-allure-instance \
  -e ALLURE_TOKEN=your-token \
  -e ALLURE_PROJECT_ID=1 \
  allure-testops-mcp \
  sh
```

## Security Best Practices

1. **Never commit credentials**: Keep `.env` files in `.gitignore`
2. **Use secrets management**: For production, use Docker secrets or vault solutions
3. **Scan images**: Regularly scan for vulnerabilities
   ```bash
   docker scout cves allure-testops-mcp
   ```
4. **Keep images updated**: Rebuild regularly to get security updates of the base image
5. **Use specific tags**: Tag builds with the version (`allure-testops-mcp:1.9.0`) instead of relying on `:latest`

## Updating the Image

When you pull new code or make changes:

```bash
git pull
docker build -t allure-testops-mcp:1.9.1 -t allure-testops-mcp .
```

## Building for Another Architecture (Optional)

To build for a different platform (for example arm64 on an amd64 host) and load it into the local image store:

```bash
docker buildx build --platform linux/arm64 -t allure-testops-mcp --load .
```

## Using the Image on Several Machines

There is no registry image to pull, so either build on each machine or move the image:

```bash
# On the build machine
docker save allure-testops-mcp | gzip > allure-testops-mcp.tar.gz

# On the target machine
docker load < allure-testops-mcp.tar.gz
```

Then create a `.env` file with `ALLURE_TESTOPS_URL`, `ALLURE_TOKEN` and optionally `ALLURE_PROJECT_ID`, and configure the MCP client with the `--env-file` command shown above.

If you push the image to your own private registry, replace `allure-testops-mcp` in the commands above with your registry path.

## Support

For issues or questions:
- Check the main README.md for usage details
- Review Docker logs: `docker logs allure-testops-mcp`
- Verify environment variables are set correctly
- Ensure Allure TestOps instance is accessible from the container
