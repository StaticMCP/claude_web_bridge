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
const isTestMode = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
function logError(message, error) {
    if (!isTestMode) {
        console.error(message, error);
    }
}
function logWarn(message) {
    if (!isTestMode) {
        console.warn(message);
    }
}
function logInfo(message) {
    if (!isTestMode) {
        console.log(message);
    }
}
export async function readFile(filePath) {
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
export async function readDir(dirPath, isRemoteUrl) {
    if (isRemoteUrl) {
        throw new Error('Directory listing not supported for remote URLs');
    }
    else {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries.map(entry => entry.name);
    }
}
export async function pathExists(filePath) {
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
export function joinPath(basePath, ...segments) {
    if (basePath.startsWith('http')) {
        const baseUrl = basePath.endsWith('/') ? basePath : basePath + '/';
        return new URL(segments.join('/'), baseUrl).href;
    }
    else {
        return path.join(basePath, ...segments);
    }
}
export async function loadManifest(sourcePath) {
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
export async function discoverTools(sourcePath, isRemoteUrl) {
    try {
        if (isRemoteUrl) {
            return [];
        }
        const toolsDir = joinPath(sourcePath, 'tools');
        const toolDirs = await readDir(toolsDir, isRemoteUrl);
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
export async function discoverToolsFromManifest(manifest) {
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
export async function discoverResourcesFromManifest(manifest) {
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
export async function discoverResources(sourcePath, isRemoteUrl) {
    try {
        if (isRemoteUrl || sourcePath.startsWith('http')) {
            return [];
        }
        const resourcesDir = joinPath(sourcePath, 'resources');
        const files = await readDir(resourcesDir, isRemoteUrl);
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
export async function readStaticResource(sourcePath, uri) {
    const filename = uri.replace('file://', '');
    const resourcePath = joinPath(sourcePath, 'resources', `${filename}.json`);
    const content = await readFile(resourcePath);
    return JSON.parse(content);
}
export async function executeStaticTool(sourcePath, name, arguments_) {
    let toolPath = joinPath(sourcePath, 'tools', name);
    const sortedArgs = Object.entries(arguments_ || {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [key, value] of sortedArgs) {
        toolPath = joinPath(toolPath, String(value));
    }
    toolPath = `${toolPath}.json`;
    const content = await readFile(toolPath);
    return JSON.parse(content);
}
export function sanitizeToolName(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
}
export function parseConfig() {
    const staticSourcePath = process.argv[2];
    const isHostedMode = !staticSourcePath;
    const isRemoteUrl = staticSourcePath?.startsWith('http://') || staticSourcePath?.startsWith('https://');
    const port = parseInt(process.env.PORT || '3000', 10);
    return {
        staticSourcePath,
        isHostedMode,
        isRemoteUrl,
        port
    };
}
export async function createServer(sourcePath, isRemoteUrl) {
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
    const tools = isRemoteUrl
        ? await discoverToolsFromManifest(manifest)
        : await discoverTools(sourcePath, isRemoteUrl);
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
    const resources = isRemoteUrl
        ? await discoverResourcesFromManifest(manifest)
        : await discoverResources(sourcePath, isRemoteUrl);
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
export function createExpressApp() {
    const app = express();
    app.use(express.json());
    app.use(cors({
        origin: '*',
        exposedHeaders: ['Mcp-Session-Id']
    }));
    return app;
}
export function setupHomeRoute(app, config) {
    app.get('/', (req, res) => {
        const endpoint = config.isHostedMode ? '/mcp?url=<staticmcp-url>' : '/mcp';
        const example = config.isHostedMode
            ? 'https://bridge.staticmcp.com/mcp?url=https://staticmcp.com/mcp'
            : `http://localhost:${config.port}/mcp`;
        res.type('text/plain').send(`StaticMCP Bridge Server

${config.isHostedMode ? 'Hosted Mode - Specify StaticMCP URL as query parameter' : `CLI Mode - Serving: ${config.staticSourcePath}`}

Usage:
  MCP Endpoint: ${endpoint}
  Protocol: Streamable HTTP (2025-03-26)
  
To connect with MCP Inspector:
  npx @modelcontextprotocol/inspector ${example}

${config.isHostedMode ? 'URL Parameter: ?url=<staticmcp-site-url>' : `Static source: ${config.staticSourcePath}`}

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
}
export class TransportManager {
    transports = {};
    async handleMcpRequest(req, res, sourcePath, isRemoteUrl) {
        try {
            const sessionId = req.headers['mcp-session-id'];
            let transport;
            if (sessionId && this.transports[sessionId]) {
                transport = this.transports[sessionId];
            }
            else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
                const eventStore = new InMemoryEventStore();
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    eventStore,
                    onsessioninitialized: (sessionId) => {
                        this.transports[sessionId] = transport;
                    }
                });
                transport.onclose = () => {
                    const sid = transport.sessionId;
                    if (sid && this.transports[sid]) {
                        delete this.transports[sid];
                    }
                };
                const server = await createServer(sourcePath, isRemoteUrl);
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
            logError('Error handling MCP request:', error);
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
    async closeAllTransports() {
        for (const sessionId in this.transports) {
            try {
                await this.transports[sessionId].close();
                delete this.transports[sessionId];
            }
            catch (error) {
                logError(`Error closing transport for session ${sessionId}:`, error);
            }
        }
    }
}
export function setupMcpRoutes(app, config, transportManager) {
    if (config.isHostedMode) {
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
            await transportManager.handleMcpRequest(req, res, urlParam, true);
        });
    }
    else {
        app.all('/mcp', async (req, res) => {
            const sourcePath = config.isRemoteUrl ? config.staticSourcePath : path.resolve(config.staticSourcePath);
            await transportManager.handleMcpRequest(req, res, sourcePath, config.isRemoteUrl);
        });
    }
}
export async function validateSourcePath(config) {
    if (config.isHostedMode)
        return;
    try {
        if (config.isRemoteUrl) {
            const manifestExists = await pathExists(joinPath(config.staticSourcePath, 'mcp.json'));
            if (!manifestExists) {
                logWarn('Warning: mcp.json not found at remote URL, using defaults');
            }
        }
        else {
            await fs.access(path.resolve(config.staticSourcePath));
        }
    }
    catch (error) {
        logError(`Error: StaticMCP source not accessible: ${config.staticSourcePath}`);
        logError(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
export async function startServer(config) {
    const app = createExpressApp();
    const transportManager = new TransportManager();
    setupHomeRoute(app, config);
    setupMcpRoutes(app, config, transportManager);
    if (!config.isHostedMode) {
        await validateSourcePath(config);
        const sourcePath = config.isRemoteUrl ? config.staticSourcePath : path.resolve(config.staticSourcePath);
        const manifest = await loadManifest(sourcePath);
        const tools = await discoverTools(sourcePath, config.isRemoteUrl);
        const resources = await discoverResources(sourcePath, config.isRemoteUrl);
        logInfo(`StaticMCP Bridge server starting on port ${config.port}`);
        logInfo(`Serving from: ${sourcePath}`);
        logInfo(`Available tools: ${tools.map(t => t.name).join(', ') || 'none'}`);
        logInfo(`Available resources: ${resources.length} resources`);
        logInfo(`MCP Endpoint: http://localhost:${config.port}/mcp`);
    }
    else {
        logInfo(`StaticMCP Hosted Bridge starting on port ${config.port}`);
        logInfo(`Usage: GET /mcp?url=<staticmcp-url>`);
    }
    return { app, transportManager };
}
export async function main() {
    const config = parseConfig();
    if (!config.isHostedMode) {
        const resolvedPath = config.isRemoteUrl ? config.staticSourcePath : path.resolve(config.staticSourcePath);
        logInfo(`StaticMCP Bridge starting with ${config.isRemoteUrl ? 'URL' : 'folder'}: ${resolvedPath}`);
    }
    const { app, transportManager } = await startServer(config);
    app.listen(config.port);
    process.on('SIGINT', async () => {
        logInfo('Shutting down StaticMCP Bridge server...');
        await transportManager.closeAllTransports();
        process.exit(0);
    });
}
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
//# sourceMappingURL=bridge.js.map