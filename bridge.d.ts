import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export interface McpManifest {
    name: string;
    version: string;
    description?: string;
    tools?: StaticTool[];
    resources?: StaticResource[];
}
export interface StaticResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}
export interface StaticTool {
    name: string;
    description?: string;
    inputSchema: any;
}
export interface BridgeConfig {
    staticSourcePath?: string;
    isHostedMode: boolean;
    isRemoteUrl: boolean;
    port: number;
}
export declare function readFile(filePath: string): Promise<string>;
export declare function readDir(dirPath: string, isRemoteUrl: boolean): Promise<string[]>;
export declare function pathExists(filePath: string): Promise<boolean>;
export declare function joinPath(basePath: string, ...segments: string[]): string;
export declare function loadManifest(sourcePath: string): Promise<McpManifest>;
export declare function discoverTools(sourcePath: string, isRemoteUrl: boolean): Promise<StaticTool[]>;
export declare function discoverToolsFromManifest(manifest: McpManifest): Promise<StaticTool[]>;
export declare function discoverResourcesFromManifest(manifest: McpManifest): Promise<StaticResource[]>;
export declare function discoverResources(sourcePath: string, isRemoteUrl: boolean): Promise<StaticResource[]>;
export declare function readStaticResource(sourcePath: string, uri: string): Promise<any>;
export declare function executeStaticTool(sourcePath: string, name: string, arguments_: any): Promise<any>;
export declare function normalizePathSegment(segment: string): string;
export declare function encodeFilename(title: string): string;
export declare function findBestMatchPath(basePath: string, segment: string): Promise<string>;
export declare function sanitizeToolName(name: string): string;
export declare function parseConfig(): BridgeConfig;
export declare function createServer(sourcePath: string, isRemoteUrl: boolean): Promise<McpServer>;
export declare function createExpressApp(): express.Application;
export declare function setupHomeRoute(app: express.Application, config: BridgeConfig): void;
export declare class TransportManager {
    private transports;
    handleMcpRequest(req: Request, res: Response, sourcePath: string, isRemoteUrl: boolean): Promise<void>;
    closeAllTransports(): Promise<void>;
}
export declare function setupMcpRoutes(app: express.Application, config: BridgeConfig, transportManager: TransportManager): void;
export declare function validateSourcePath(config: BridgeConfig): Promise<void>;
export declare function startServer(config: BridgeConfig): Promise<{
    app: express.Application;
    transportManager: TransportManager;
}>;
export declare function main(): Promise<void>;
//# sourceMappingURL=bridge.d.ts.map