# StaticMCP Bridge for Claude Web

A bridge server to support connection from Claude Web to StaticMCP files.

While there's already an existing implementation for both [`stdio`](https://github.com/StaticMCP/stdio_bridge) and [`sse`](https://github.com/StaticMCP/sse_bridge) StaticMCP bridges, it seems like Claude Web doesn't really work with the regular MCP standard of Streamable HTTP so this is built off of the [`sseAndStreamableHttpCompatibleServer` example provided in MCP's `typescript-sdk`](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/src/examples/server/sseAndStreamableHttpCompatibleServer.ts).

## Quick Start

### CLI Mode (Local Files)

```bash
npm install
npm run build
node dist/bridge.js ./path/to/staticmcp-folder
```

### CLI Mode (Remote URL)

```bash
node dist/bridge.js https://staticmcp.github.io/resume_smg
```

### Hosted Mode

```bash
node dist/bridge.js
# Server starts without arguments, accepts URLs via query parameter
# Usage: GET /mcp?url=https://staticmcp.com/mcp
```

## Installation

```bash
npm install
```

## Usage

On Claude Web (requires Pro plan)

1. Go to [Connectors](https://claude.ai/settings/connectors)
2. Click "Add custom connector"
3. Input full url where this bridge is running on
  - CLI mode (both local or remote) - https://{YOUR_DOMAIN}/mcp
  - Hosted mode - https://{YOUR_DOMAIN}/mcp?url={STATICMCP_PATH}
    - eg. https://claude.staticmcp.com/mcp?url=https://staticmcp.github.io/resume_smg

## API

### Root Endpoint

```
GET /
```

Returns usage instructions and server information.

### MCP Endpoint

```
POST|GET|DELETE /mcp
```

**CLI Mode**: Serves StaticMCP files from the configured source.

**Hosted Mode**: Requires `url` query parameter.
```
GET /mcp?url=https://staticmcp.com/mcp
POST /mcp?url=https://staticmcp.com/mcp
```

## Configuration

Set environment variables:

```bash
PORT=3000  # Server port (default: 3000)
```

## Development

```bash
# Install dependencies
npm install

# Development with hot reload
npm run dev

# Build TypeScript
npm run build

# Start production server
npm start
```

## Related Projects

- [StaticMCP](https://staticmcp.com) - The specification and ecosystem
- [Model Context Protocol](https://modelcontextprotocol.io) - The underlying protocol
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Official SDK
