import express from 'express';
import { randomUUID } from "node:crypto";
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from './eventStore.js';
import { SchemaConverter } from './converter.js';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
const staticSourcePath = process.argv[2];
const isHostedMode = !staticSourcePath;
const isRemoteUrl = staticSourcePath?.startsWith('http://') || staticSourcePath?.startsWith('https://');
if (!isHostedMode) {
    const resolvedPath = isRemoteUrl ? staticSourcePath : path.resolve(staticSourcePath);
    console.log(`StaticMCP Bridge starting with ${isRemoteUrl ? 'URL' : 'folder'}: ${resolvedPath}`);
}
async function readFile(filePath) {
    if (filePath.startsWith('http')) {
        const response = await fetch(filePath);
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        return response.text();
    }
    else {
        return fs.readFile(filePath, 'utf-8');
    }
}
async function readDir(dirPath) {
    if (isRemoteUrl) {
        throw new Error('Directory listing not supported for remote URLs');
    }
    else {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.map(entry => entry.name);
    }
}
async function pathExists(filePath) {
    if (filePath.startsWith('http')) {
        try {
            const response = await fetch(filePath, { method: 'HEAD' });
            return response.ok;
        }
        catch {
            return false;
        }
    }
    else {
        try {
            await fs.access(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
}
function joinPath(basePath, ...segments) {
    if (basePath.startsWith('http')) {
        const baseUrl = basePath.endsWith('/') ? basePath : basePath + '/';
        return new URL(segments.join('/'), baseUrl).href;
    }
    else {
        return path.join(basePath, ...segments);
    }
}
async function loadManifest(sourcePath) {
    try {
        const manifestPath = joinPath(sourcePath, 'mcp.json');
        const manifestContent = await readFile(manifestPath);
        const rawManifest = JSON.parse(manifestContent);
        const name = rawManifest.serverInfo?.name || rawManifest.name || 'staticmcp-bridge';
        const version = rawManifest.serverInfo?.version || rawManifest.version || '1.0.0';
        return {
            name,
            version,
            description: rawManifest.serverInfo?.description || rawManifest.description || 'StaticMCP Bridge Server',
            tools: rawManifest.capabilities?.tools || rawManifest.tools,
            resources: rawManifest.capabilities?.resources || rawManifest.resources
        };
    }
    catch (error) {
        return {
            name: 'staticmcp-bridge',
            version: '1.0.0',
            description: 'StaticMCP Bridge Server'
        };
    }
}
async function discoverTools(sourcePath) {
    try {
        if (sourcePath.startsWith('http')) {
            return [];
        }
        const toolsDir = joinPath(sourcePath, 'tools');
        const toolDirs = await readDir(toolsDir);
        const tools = [];
        for (const toolName of toolDirs) {
            const validName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
            let inputSchema = { type: 'object', properties: {} };
            try {
                const schemaPath = joinPath(toolsDir, toolName, '_schema.json');
                const schemaContent = await readFile(schemaPath);
                const schema = JSON.parse(schemaContent);
                inputSchema = schema.inputSchema || inputSchema;
            }
            catch { }
            tools.push({
                name: validName,
                description: `StaticMCP tool: ${toolName}`,
                inputSchema
            });
        }
        return tools;
    }
    catch {
        return [];
    }
}
async function discoverToolsFromManifest(manifest) {
    if (!manifest.tools || !Array.isArray(manifest.tools))
        return [];
    const tools = [];
    for (const toolInfo of manifest.tools) {
        if (typeof toolInfo === 'object' && toolInfo.name) {
            const validName = toolInfo.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
            const tool = {
                name: validName,
                description: toolInfo.description || `StaticMCP tool: ${toolInfo.name}`,
                inputSchema: SchemaConverter.jsonSchemaToMcpInputSchema(toolInfo.inputSchema) || {}
            };
            tools.push(tool);
        }
    }
    return tools;
}
async function discoverResourcesFromManifest(manifest) {
    if (!manifest.resources || !Array.isArray(manifest.resources))
        return [];
    const resources = [];
    for (const resourceInfo of manifest.resources) {
        if (typeof resourceInfo === 'object' && (resourceInfo.uri || resourceInfo.name)) {
            resources.push({
                uri: resourceInfo.uri || `file://${resourceInfo.name}`,
                name: resourceInfo.name || resourceInfo.uri,
                description: resourceInfo.description || `StaticMCP resource: ${resourceInfo.name || resourceInfo.uri}`,
                mimeType: resourceInfo.mimeType || 'text/plain'
            });
        }
    }
    return resources;
}
async function discoverResources(sourcePath) {
    try {
        if (isRemoteUrl || sourcePath.startsWith('http')) {
            return [];
        }
        const resourcesDir = joinPath(sourcePath, 'resources');
        const files = await readDir(resourcesDir);
        const resources = [];
        for (const file of files) {
            if (file.endsWith('.json')) {
                const resourceName = file.replace('.json', '');
                resources.push({
                    uri: `file://${resourceName}`,
                    name: resourceName,
                    description: `StaticMCP resource: ${resourceName}`,
                    mimeType: 'text/plain'
                });
            }
        }
        return resources;
    }
    catch {
        return [];
    }
}
async function readStaticResource(sourcePath, uri) {
    const filename = uri.replace('file://', '');
    const resourcePath = joinPath(sourcePath, 'resources', `${filename}.json`);
    const content = await readFile(resourcePath);
    return JSON.parse(content);
}
async function executeStaticTool(sourcePath, name, arguments_) {
    let toolPath = joinPath(sourcePath, 'tools', name);
    const sortedArgs = Object.entries(arguments_ || {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [key, value] of sortedArgs) {
        toolPath = joinPath(toolPath, String(value));
    }
    toolPath = `${toolPath}.json`;
    const content = await readFile(toolPath);
    return JSON.parse(content);
}
async function createServer(sourcePath) {
    const manifest = await loadManifest(sourcePath);
    const server = new McpServer({
        name: manifest.name,
        version: manifest.version,
    }, {
        capabilities: {
            logging: {},
            resources: {},
            tools: {}
        }
    });
    const isRemote = sourcePath.startsWith('http');
    const tools = isRemote
        ? await discoverToolsFromManifest(manifest)
        : await discoverTools(sourcePath);
    for (const tool of tools) {
        server.registerTool(tool.name, {
            title: tool.description || `StaticMCP tool: ${tool.name}`,
            description: tool.description || `StaticMCP tool: ${tool.name}`,
            inputSchema: tool.inputSchema || {}
        }, async (arguments_) => {
            const result = await executeStaticTool(sourcePath, tool.name, arguments_);
            return result;
        });
    }
    const resources = isRemote
        ? await discoverResourcesFromManifest(manifest)
        : await discoverResources(sourcePath);
    for (const resource of resources) {
        server.registerResource(resource.name, resource.uri, {
            title: resource.name || resource.uri,
            description: resource.description || `StaticMCP resource: ${resource.name}`,
            mimeType: resource.mimeType || 'text/plain'
        }, async (uri) => {
            try {
                const result = await readStaticResource(sourcePath, uri.toString());
                return result;
            }
            catch (error) {
                throw new Error(`Failed to read resource: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
    }
    return server;
}
const app = express();
app.use(express.json());
app.use(cors({
    origin: '*',
    exposedHeaders: ['Mcp-Session-Id']
}));
const transports = {};
app.get('/', (req, res) => {
    const endpoint = isHostedMode ? '/mcp?url=<staticmcp-url>' : '/mcp';
    const example = isHostedMode
        ? 'https://bridge.staticmcp.com/mcp?url=https://staticmcp.com/mcp'
        : `http://localhost:${PORT}/mcp`;
    res.type('text/plain').send(`StaticMCP Bridge Server

${isHostedMode ? 'Hosted Mode - Specify StaticMCP URL as query parameter' : `CLI Mode - Serving: ${staticSourcePath}`}

Usage:
  MCP Endpoint: ${endpoint}
  Protocol: Streamable HTTP (2025-03-26)
  
To connect with MCP Inspector:
  npx @modelcontextprotocol/inspector ${example}

${isHostedMode ? 'URL Parameter: ?url=<staticmcp-site-url>' : `Static source: ${staticSourcePath}`}

File structure expected:
  mcp.json              - Optional manifest
  tools/                - Tool responses
    toolname/
      arg1.json         - Pre-generated responses
      arg1/arg2.json    - Multi-argument responses
  resources/            - Resource files
    filename.json       - Resource content
`);
});
async function handleMcpRequest(req, res, sourcePath) {
    try {
        const sessionId = req.headers['mcp-session-id'];
        let transport;
        if (sessionId && transports[sessionId]) {
            transport = transports[sessionId];
        }
        else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
            const eventStore = new InMemoryEventStore();
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                eventStore,
                onsessioninitialized: (sessionId) => {
                    transports[sessionId] = transport;
                }
            });
            transport.onclose = () => {
                const sid = transport.sessionId;
                if (sid && transports[sid]) {
                    delete transports[sid];
                }
            };
            const server = await createServer(sourcePath);
            await server.connect(transport);
        }
        else {
            res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: 'Bad Request: No valid session ID provided or invalid initialization request',
                },
                id: null,
            });
            return;
        }
        await transport.handleRequest(req, res, req.body);
    }
    catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: 'Internal server error',
                },
                id: null,
            });
        }
    }
}
if (isHostedMode) {
    app.all('/mcp', async (req, res) => {
        const urlParam = req.query.url;
        if (!urlParam) {
            res.status(400).json({
                error: 'Missing required URL parameter',
                usage: 'GET /mcp?url=https://staticmcp.com/mcp'
            });
            return;
        }
        try {
            new URL(urlParam);
        }
        catch {
            res.status(400).json({
                error: 'Invalid URL parameter',
                provided: urlParam
            });
            return;
        }
        await handleMcpRequest(req, res, urlParam);
    });
}
else {
    app.all('/mcp', async (req, res) => {
        const sourcePath = isRemoteUrl ? staticSourcePath : path.resolve(staticSourcePath);
        await handleMcpRequest(req, res, sourcePath);
    });
}
const PORT = process.env.PORT || 3000;
if (isHostedMode) {
    app.listen(PORT, () => {
        console.log(`StaticMCP Hosted Bridge listening on port ${PORT}`);
        console.log(`Usage: GET /mcp?url=<staticmcp-url>`);
    });
}
else {
    const validateAndStart = async () => {
        try {
            if (isRemoteUrl) {
                const manifestExists = await pathExists(joinPath(staticSourcePath, 'mcp.json'));
                if (!manifestExists) {
                    console.warn('Warning: mcp.json not found at remote URL, using defaults');
                }
            }
            else {
                await fs.access(path.resolve(staticSourcePath));
            }
            const manifest = await loadManifest(isRemoteUrl ? staticSourcePath : path.resolve(staticSourcePath));
            const tools = await discoverTools(isRemoteUrl ? staticSourcePath : path.resolve(staticSourcePath));
            const resources = await discoverResources(isRemoteUrl ? staticSourcePath : path.resolve(staticSourcePath));
            app.listen(PORT, () => {
                console.log(`StaticMCP Bridge server listening on port ${PORT}`);
                console.log(`Serving from: ${isRemoteUrl ? staticSourcePath : path.resolve(staticSourcePath)}`);
                console.log(`Available tools: ${tools.map(t => t.name).join(', ') || 'none'}`);
                console.log(`Available resources: ${resources.length} resources`);
                console.log(`MCP Endpoint: http://localhost:${PORT}/mcp`);
            });
        }
        catch (error) {
            console.error(`Error: StaticMCP source not accessible: ${staticSourcePath}`);
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
        }
    };
    validateAndStart();
}
process.on('SIGINT', async () => {
    console.log('Shutting down StaticMCP Bridge server...');
    for (const sessionId in transports) {
        try {
            await transports[sessionId].close();
            delete transports[sessionId];
        }
        catch (error) {
            console.error(`Error closing transport for session ${sessionId}:`, error);
        }
    }
    process.exit(0);
});
//# sourceMappingURL=bridge.js.map