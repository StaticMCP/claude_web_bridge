import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import {
  readFile,
  readDir,
  pathExists,
  joinPath,
  loadManifest,
  discoverTools,
  discoverToolsFromManifest,
  discoverResourcesFromManifest,
  discoverResources,
  readStaticResource,
  executeStaticTool,
  normalizePathSegment,
  encodeFilename,
  sanitizeToolName,
  parseConfig,
  createServer,
  createExpressApp,
  setupHomeRoute,
  TransportManager,
  setupMcpRoutes,
  validateSourcePath,
  startServer,
  McpManifest,
  StaticTool,
  StaticResource,
  BridgeConfig
} from '../src/bridge';

vi.mock('fs/promises');
vi.mock('path');
vi.mock('express');
vi.mock('@modelcontextprotocol/sdk/server/mcp.js');
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js');

describe('Bridge Core Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readFile', () => {
    it('should read local files', async () => {
      const mockContent = 'file content';
      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await readFile('/path/to/file.txt');
      expect(result).toBe(mockContent);
      expect(fs.readFile).toHaveBeenCalledWith('/path/to/file.txt', 'utf-8');
    });

    it('should fetch remote files', async () => {
      const mockContent = 'remote content';
      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(mockContent)
      };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await readFile('https://example.com/file.txt');
      expect(result).toBe(mockContent);
      expect(fetch).toHaveBeenCalledWith('https://example.com/file.txt');
    });

    it('should throw error for failed HTTP requests', async () => {
      const mockResponse = { ok: false, status: 404 };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      await expect(readFile('https://example.com/notfound.txt'))
        .rejects.toThrow('HTTP 404');
    });
  });

  describe('readDir', () => {
    it('should read local directories', async () => {
      const mockEntries = [
        { name: 'file1.json', isFile: () => true },
        { name: 'file2.json', isFile: () => true }
      ];
      vi.mocked(fs.readdir).mockResolvedValue(mockEntries as any);

      const result = await readDir('/path/to/dir', false);
      expect(result).toEqual(['file1.json', 'file2.json']);
      expect(fs.readdir).toHaveBeenCalledWith('/path/to/dir', { withFileTypes: true });
    });

    it('should throw error for remote URLs', async () => {
      await expect(readDir('https://example.com', true))
        .rejects.toThrow('Directory listing not supported for remote URLs');
    });
  });

  describe('pathExists', () => {
    it('should check local file existence', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result = await pathExists('/path/to/file.txt');
      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith('/path/to/file.txt');
    });

    it('should return false for non-existent local files', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await pathExists('/nonexistent/file.txt');
      expect(result).toBe(false);
    });

    it('should check remote URL existence', async () => {
      const mockResponse = { ok: true };
      vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);

      const result = await pathExists('https://example.com/file.txt');
      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith('https://example.com/file.txt', { method: 'HEAD' });
    });

    it('should return false for failed remote checks', async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'));

      const result = await pathExists('https://example.com/file.txt');
      expect(result).toBe(false);
    });
  });

  describe('joinPath', () => {
    it('should join local paths', () => {
      vi.mocked(path.join).mockReturnValue('/base/segment1/segment2');

      const result = joinPath('/base', 'segment1', 'segment2');
      expect(result).toBe('/base/segment1/segment2');
      expect(path.join).toHaveBeenCalledWith('/base', 'segment1', 'segment2');
    });

    it('should join URL paths', () => {
      const result = joinPath('https://example.com', 'api', 'v1', 'data');
      expect(result).toBe('https://example.com/api/v1/data');
    });

    it('should handle base URL with trailing slash', () => {
      const result = joinPath('https://example.com/', 'api', 'v1');
      expect(result).toBe('https://example.com/api/v1');
    });
  });

  describe('loadManifest', () => {
    it('should load valid manifest', async () => {
      const mockManifest = {
        serverInfo: {
          name: 'test-server',
          version: '2.0.0',
          description: 'Test server'
        },
        capabilities: {
          tools: [{ name: 'test-tool' }],
          resources: [{ name: 'test-resource' }]
        }
      };
      
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockManifest));
      vi.mocked(path.join).mockReturnValue('/source/mcp.json');

      const result = await loadManifest('/source');
      expect(result).toEqual({
        name: 'test-server',
        version: '2.0.0',
        description: 'Test server',
        tools: [{ name: 'test-tool' }],
        resources: [{ name: 'test-resource' }]
      });
    });

    it('should return default manifest on error', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      const result = await loadManifest('/nonexistent');
      expect(result).toEqual({
        name: 'staticmcp-bridge',
        version: '1.0.0',
        description: 'StaticMCP Bridge Server'
      });
    });

    it('should handle manifest with different structure', async () => {
      const mockManifest = {
        name: 'direct-name',
        version: '3.0.0',
        tools: [{ name: 'direct-tool' }]
      };
      
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockManifest));
      vi.mocked(path.join).mockReturnValue('/source/mcp.json');

      const result = await loadManifest('/source');
      expect(result.name).toBe('direct-name');
      expect(result.version).toBe('3.0.0');
      expect(result.tools).toEqual([{ name: 'direct-tool' }]);
    });
  });

  describe('sanitizeToolName', () => {
    it('should remove invalid characters', () => {
      expect(sanitizeToolName('tool@name#with$special*chars')).toBe('tool_name_with_special_chars');
    });

    it('should truncate long names', () => {
      const longName = 'a'.repeat(100);
      const result = sanitizeToolName(longName);
      expect(result.length).toBe(64);
    });

    it('should preserve valid characters', () => {
      expect(sanitizeToolName('valid-tool_name123')).toBe('valid-tool_name123');
    });
  });

  describe('discoverTools', () => {
    it('should return empty array for remote URLs', async () => {
      const result = await discoverTools('https://example.com', true);
      expect(result).toEqual([]);
    });

    it('should discover local tools', async () => {
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'tool1', isFile: () => false },
        { name: 'tool2', isFile: () => false }
      ] as any);
      
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce('{"inputSchema": {"type": "object", "properties": {"param": {"type": "string"}}}}')
        .mockRejectedValueOnce(new Error('No schema'));

      const result = await discoverTools('/source', false);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('tool1');
      expect(result[1].name).toBe('tool2');
    });

    it('should handle directory read errors', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Access denied'));

      const result = await discoverTools('/source', false);
      expect(result).toEqual([]);
    });
  });

  describe('discoverToolsFromManifest', () => {
    it('should extract tools from manifest', async () => {
      const manifest: McpManifest = {
        name: 'test',
        version: '1.0.0',
        tools: [
          {
            name: 'test-tool',
            description: 'A test tool',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'invalid@tool',
            inputSchema: { type: 'string' }
          }
        ]
      };

      const result = await discoverToolsFromManifest(manifest);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('test-tool');
      expect(result[1].name).toBe('invalid_tool');
    });

    it('should handle missing tools array', async () => {
      const manifest: McpManifest = {
        name: 'test',
        version: '1.0.0'
      };

      const result = await discoverToolsFromManifest(manifest);
      expect(result).toEqual([]);
    });

    it('should skip invalid tool entries', async () => {
      const manifest: McpManifest = {
        name: 'test',
        version: '1.0.0',
        tools: [
          { name: 'valid-tool', inputSchema: {} },
          'invalid-entry' as any,
          { description: 'no name' } as any
        ] as StaticTool[]
      };

      const result = await discoverToolsFromManifest(manifest);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('valid-tool');
    });
  });

  describe('discoverResourcesFromManifest', () => {
    it('should extract resources from manifest', async () => {
      const manifest: McpManifest = {
        name: 'test',
        version: '1.0.0',
        resources: [
          {
            uri: 'file://test-resource',
            name: 'test-resource',
            description: 'A test resource',
            mimeType: 'application/json'
          },
          {
            name: 'name-only-resource'
          }
        ] as StaticResource[]
      };

      const result = await discoverResourcesFromManifest(manifest);
      expect(result).toHaveLength(2);
      expect(result[0].uri).toBe('file://test-resource');
      expect(result[1].uri).toBe('file://name-only-resource');
    });

    it('should handle missing resources array', async () => {
      const manifest: McpManifest = {
        name: 'test',
        version: '1.0.0'
      };

      const result = await discoverResourcesFromManifest(manifest);
      expect(result).toEqual([]);
    });
  });

  describe('discoverResources', () => {
    it('should return empty array for remote URLs', async () => {
      const result = await discoverResources('https://example.com', true);
      expect(result).toEqual([]);
    });

    it('should discover local resources', async () => {
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'resource1.json', isFile: () => true },
        { name: 'resource2.json', isFile: () => true },
        { name: 'not-json.txt', isFile: () => true }
      ] as any);

      const result = await discoverResources('/source', false);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('resource1');
      expect(result[1].name).toBe('resource2');
    });

    it('should handle directory read errors', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Access denied'));

      const result = await discoverResources('/source', false);
      expect(result).toEqual([]);
    });
  });

  describe('readStaticResource', () => {
    it('should read and parse resource file', async () => {
      const mockData = { key: 'value', data: [1, 2, 3] };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      const result = await readStaticResource('/source', 'file://test-resource');
      expect(result).toEqual(mockData);
      expect(fs.readFile).toHaveBeenCalledWith('/source/resources/test-resource.json', 'utf-8');
    });

    it('should handle JSON parse errors', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('invalid json');
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      await expect(readStaticResource('/source', 'file://test-resource'))
        .rejects.toThrow();
    });
  });

  describe('executeStaticTool', () => {
    it('should execute tool with no arguments', async () => {
      const mockResponse = { result: 'success', data: 'test' };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockResponse));
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      const result = await executeStaticTool('/source', 'test-tool', {});
      expect(result).toEqual(mockResponse);
      expect(fs.readFile).toHaveBeenCalledWith('/source/tools/test-tool.json', 'utf-8');
    });

    it('should execute tool with sorted arguments', async () => {
      const mockResponse = { result: 'with-args' };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockResponse));
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      const args = { param2: 'value2', param1: 'value1', param3: 'value3' };
      await executeStaticTool('/source', 'test-tool', args);
      expect(fs.readFile).toHaveBeenCalledWith('/source/tools/test-tool/value1/value2/value3.json', 'utf-8');
    });

    it('should handle complex argument values', async () => {
      const mockResponse = { result: 'complex' };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockResponse));
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      const args = { 
        number: 42, 
        boolean: true, 
        string: 'test value',
        null_val: null
      };
      await executeStaticTool('/source', 'test-tool', args);
      
      expect(fs.readFile).toHaveBeenCalledWith('/source/tools/test-tool/true/null/42/test_value.json', 'utf-8');
    });
  });

  describe('normalizePathSegment', () => {
    it('should trim whitespace from segments', () => {
      expect(normalizePathSegment('  hello world  ')).toBe('hello world');
    });

    it('should normalize multiple spaces to single space', () => {
      expect(normalizePathSegment('hello    world')).toBe('hello world');
    });

    it('should handle mixed whitespace', () => {
      expect(normalizePathSegment('  hello   \t  world  ')).toBe('hello world');
    });
  });

  describe('encodeFilename', () => {
    it('should handle basic encoding rules', () => {
      expect(encodeFilename('Hello World')).toBe('hello_world');
      expect(encodeFilename('COVID-19 pandemic')).toBe('covid-19_pandemic');
      expect(encodeFilename('King George III')).toBe('king_george_iii');
    });

    it('should remove accents and normalize unicode', () => {
      expect(encodeFilename('François Mitterrand')).toBe('francois_mitterrand');
      expect(encodeFilename('José María Aznar')).toBe('jose_maria_aznar');
    });

    it('should replace invalid characters with underscores', () => {
      expect(encodeFilename('Hello@World!')).toBe('hello_world_');
      expect(encodeFilename('Test & Development')).toBe('test___development');
    });

    it('should preserve forward slashes for directory nesting', () => {
      expect(encodeFilename('docs/standard')).toBe('docs/standard');
      expect(encodeFilename('api/v1/users')).toBe('api/v1/users');
      expect(encodeFilename('path/to/resource')).toBe('path/to/resource');
    });

    it('should handle long filenames with hash', () => {
      const longTitle = 'A'.repeat(220);
      const encoded = encodeFilename(longTitle);
      expect(encoded.length).toBe(200);
      expect(encoded.includes('_')).toBe(true);
      expect(encoded.substring(183, 184)).toBe('_');
    });

    it('should produce consistent hashes for same input', () => {
      const title = 'Very Long Title That Exceeds Limit';
      const encoded1 = encodeFilename(title);
      const encoded2 = encodeFilename(title);
      expect(encoded1).toBe(encoded2);
    });
  });

  describe('executeStaticTool with filename encoding', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should encode user input to find files', async () => {
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('{"result": "success"}');
      
      const result = await executeStaticTool('/source', 'test-tool', { arg: 'Hello World' });
      
      expect(result).toEqual({ result: 'success' });
      expect(fs.readFile).toHaveBeenCalledWith('/source/tools/test-tool/hello_world.json', 'utf-8');
    });

    it('should encode accented characters', async () => {
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('{"result": "found_encoded"}');
      
      const result = await executeStaticTool('/source', 'test-tool', { arg: 'François Mitterrand' });
      
      expect(result).toEqual({ result: 'found_encoded' });
      expect(fs.readFile).toHaveBeenCalledWith('/source/tools/test-tool/francois_mitterrand.json', 'utf-8');
    });

    it('should encode complex titles with special characters', async () => {
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('{"result": "found_complex"}');
      
      const result = await executeStaticTool('/source', 'test-tool', { arg: 'José María & COVID-19!' });
      
      expect(result).toEqual({ result: 'found_complex' });
      expect(fs.readFile).toHaveBeenCalledWith('/source/tools/test-tool/jose_maria___covid-19_.json', 'utf-8');
    });

    it('should fallback to encoded filename when no variations exist', async () => {
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readFile).mockResolvedValue('{"result": "fallback"}');
      
      const result = await executeStaticTool('/source', 'test-tool', { arg: 'Non-existent Title!' });
      
      expect(result).toEqual({ result: 'fallback' });
      expect(fs.readFile).toHaveBeenCalledWith('/source/tools/test-tool/non-existent_title_.json', 'utf-8');
    });
  });

  describe('parseConfig', () => {
    const originalArgv = process.argv;
    const originalEnv = process.env;

    afterEach(() => {
      process.argv = originalArgv;
      process.env = originalEnv;
    });

    it('should parse hosted mode configuration', () => {
      process.argv = ['node', 'bridge.js'];
      process.env = { PORT: '4000' };

      const config = parseConfig();
      expect(config.isHostedMode).toBe(true);
      expect(config.staticSourcePath).toBeUndefined();
      expect(config.port).toBe(4000);
    });

    it('should parse CLI mode with local path', () => {
      process.argv = ['node', 'bridge.js', '/path/to/source'];
      process.env = {};

      const config = parseConfig();
      expect(config.isHostedMode).toBe(false);
      expect(config.staticSourcePath).toBe('/path/to/source');
      expect(config.isRemoteUrl).toBe(false);
      expect(config.port).toBe(3000);
    });

    it('should parse CLI mode with remote URL', () => {
      process.argv = ['node', 'bridge.js', 'https://example.com/mcp'];

      const config = parseConfig();
      expect(config.isHostedMode).toBe(false);
      expect(config.staticSourcePath).toBe('https://example.com/mcp');
      expect(config.isRemoteUrl).toBe(true);
    });

    it('should handle invalid PORT environment variable', () => {
      process.argv = ['node', 'bridge.js'];
      process.env = { PORT: 'invalid' };

      const config = parseConfig();
      expect(config.port).toBe(NaN);
    });
  });

  describe('createExpressApp', () => {
    it('should create express app with middleware', () => {
      const mockApp = {
        use: vi.fn(),
        get: vi.fn(),
        all: vi.fn(),
        listen: vi.fn()
      };
      const mockExpress = vi.fn(() => mockApp);
      mockExpress["json"] = vi.fn();
      
      vi.mocked(express).mockReturnValue(mockApp as any);
      (express as any).json = mockExpress["json"];

      const app = createExpressApp();
      
      expect(express).toHaveBeenCalled();
      expect(mockApp.use).toHaveBeenCalledTimes(2);
    });
  });

  describe('setupHomeRoute', () => {
    it('should setup home route for hosted mode', () => {
      const mockApp = {
        get: vi.fn(),
        use: vi.fn(),
        all: vi.fn(),
        listen: vi.fn()
      };
      
      const config: BridgeConfig = {
        isHostedMode: true,
        isRemoteUrl: false,
        port: 3000
      };

      setupHomeRoute(mockApp as any, config);
      
      expect(mockApp.get).toHaveBeenCalledWith('/', expect.any(Function));
      
      const handler = mockApp.get.mock.calls[0][1];
      const mockReq = {} as any;
      const mockRes = {
        type: vi.fn().mockReturnThis(),
        send: vi.fn()
      } as any;
      
      handler(mockReq, mockRes);
      expect(mockRes.type).toHaveBeenCalledWith('text/plain');
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('Hosted Mode'));
    });

    it('should setup home route for CLI mode', () => {
      const mockApp = {
        get: vi.fn(),
        use: vi.fn(),
        all: vi.fn(),
        listen: vi.fn()
      };
      
      const config: BridgeConfig = {
        isHostedMode: false,
        isRemoteUrl: false,
        staticSourcePath: '/local/path',
        port: 3000
      };

      setupHomeRoute(mockApp as any, config);
      
      const handler = mockApp.get.mock.calls[0][1];
      const mockReq = {} as any;
      const mockRes = {
        type: vi.fn().mockReturnThis(),
        send: vi.fn()
      } as any;
      
      handler(mockReq, mockRes);
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('CLI Mode'));
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('/local/path'));
    });
  });
});

describe('TransportManager', () => {
  let transportManager: TransportManager;
  
  beforeEach(() => {
    transportManager = new TransportManager();
  });

  describe('handleMcpRequest', () => {
    it('should handle request with existing session', async () => {
      const mockTransport = {
        handleRequest: vi.fn()
      };
      
      (transportManager as any).transports['existing-session'] = mockTransport;      
      const mockReq = {
        headers: { 'mcp-session-id': 'existing-session' },
        method: 'POST',
        body: {}
      } as any;
      
      const mockRes = {} as any;
      await transportManager.handleMcpRequest(mockReq, mockRes, '/source', false);
      expect(mockTransport.handleRequest).toHaveBeenCalledWith(mockReq, mockRes, {});
    });

    it('should return error for invalid request', async () => {
      const mockReq = {
        headers: {},
        method: 'GET',
        body: {}
      } as any;
      
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;
      
      await transportManager.handleMcpRequest(mockReq, mockRes, '/source', false);
      
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided or invalid initialization request',
        },
        id: null,
      });
    });

    it('should handle missing session ID for non-initialization request', async () => {
      const mockReq = {
        headers: {},
        method: 'POST',
        body: { jsonrpc: '2.0', method: 'some-method', id: 1 }
      } as any;
      
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        headersSent: false
      } as any;
      
      await transportManager.handleMcpRequest(mockReq, mockRes, '/source', false);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided or invalid initialization request',
        },
        id: null,
      });
    });

    it('should handle transport errors and return 500', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockRejectedValue(new Error('Transport failed'))
      };

      (transportManager as any).transports['error-session'] = mockTransport;
      const mockReq = {
        headers: { 'mcp-session-id': 'error-session' },
        method: 'POST',
        body: {}
      } as any;
      
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        headersSent: false
      } as any;
      
      await transportManager.handleMcpRequest(mockReq, mockRes, '/source', false);
      
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    });

    it('should not send response if headers already sent', async () => {
      const mockTransport = {
        handleRequest: vi.fn().mockRejectedValue(new Error('Transport failed'))
      };
      
      (transportManager as any).transports['error-session'] = mockTransport;
      
      const mockReq = {
        headers: { 'mcp-session-id': 'error-session' },
        method: 'POST',
        body: {}
      } as any;
      
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        headersSent: true
      } as any;

      await transportManager.handleMcpRequest(mockReq, mockRes, '/source', false);
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });
  });

  describe('closeAllTransports', () => {
    it('should close all transports', async () => {
      const mockTransport1 = { close: vi.fn() };
      const mockTransport2 = { close: vi.fn() };
      
      (transportManager as any).transports = {
        'session1': mockTransport1,
        'session2': mockTransport2
      };
      
      await transportManager.closeAllTransports();
      
      expect(mockTransport1.close).toHaveBeenCalled();
      expect(mockTransport2.close).toHaveBeenCalled();
      expect((transportManager as any).transports).toEqual({});
    });

    it('should handle transport close errors', async () => {
      const mockTransport = {
        close: vi.fn().mockRejectedValue(new Error('Close failed'))
      };
      
      (transportManager as any).transports = { 'session1': mockTransport };
      await transportManager.closeAllTransports();
      expect(mockTransport.close).toHaveBeenCalled();      
    });
  });
});

describe('setupMcpRoutes', () => {
  let mockApp: any;
  let mockTransportManager: any;

  beforeEach(() => {
    mockApp = {
      all: vi.fn(),
      use: vi.fn(),
      get: vi.fn(),
      listen: vi.fn()
    };
    mockTransportManager = {
      handleMcpRequest: vi.fn()
    };
  });

  it('should setup hosted mode routes', () => {
    const config: BridgeConfig = {
      isHostedMode: true,
      isRemoteUrl: false,
      port: 3000
    };

    setupMcpRoutes(mockApp, config, mockTransportManager);
    
    expect(mockApp.all).toHaveBeenCalledWith('/mcp', expect.any(Function));
  });

  it('should handle hosted mode URL validation', async () => {
    const config: BridgeConfig = {
      isHostedMode: true,
      isRemoteUrl: false,
      port: 3000
    };

    setupMcpRoutes(mockApp, config, mockTransportManager);
    
    const handler = mockApp.all.mock.calls[0][1];
    const mockReq1 = { query: {} } as any;
    const mockRes1 = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    } as any;
    
    await handler(mockReq1, mockRes1);
    expect(mockRes1.status).toHaveBeenCalledWith(400);
    const mockReq2 = { query: { url: 'invalid-url' } } as any;
    const mockRes2 = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    } as any;
    
    await handler(mockReq2, mockRes2);
    expect(mockRes2.status).toHaveBeenCalledWith(400);
    const mockReq3 = { query: { url: 'https://example.com' } } as any;
    const mockRes3 = {} as any;
    
    await handler(mockReq3, mockRes3);
    expect(mockTransportManager.handleMcpRequest).toHaveBeenCalledWith(
      mockReq3, mockRes3, 'https://example.com', true
    );
  });

  it('should setup CLI mode routes', () => {
    const config: BridgeConfig = {
      isHostedMode: false,
      isRemoteUrl: false,
      staticSourcePath: '/local/path',
      port: 3000
    };

    vi.mocked(path.resolve).mockReturnValue('/resolved/path');
    setupMcpRoutes(mockApp, config, mockTransportManager);
    expect(mockApp.all).toHaveBeenCalledWith('/mcp', expect.any(Function));
    const handler = mockApp.all.mock.calls[0][1];
    const mockReq = {} as any;
    const mockRes = {} as any;
    
    handler(mockReq, mockRes);
    expect(mockTransportManager.handleMcpRequest).toHaveBeenCalledWith(
      mockReq, mockRes, '/resolved/path', false
    );
  });
});

describe('validateSourcePath', () => {
  it('should skip validation for hosted mode', async () => {
    const config: BridgeConfig = {
      isHostedMode: true,
      isRemoteUrl: false,
      port: 3000
    };

    await expect(validateSourcePath(config)).resolves.toBeUndefined();
  });

  it('should validate remote URL', async () => {
    const config: BridgeConfig = {
      isHostedMode: false,
      isRemoteUrl: true,
      staticSourcePath: 'https://example.com',
      port: 3000
    };

    const mockResponse = { ok: false };
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any);
    await validateSourcePath(config);
  });

  it('should validate local path', async () => {
    const config: BridgeConfig = {
      isHostedMode: false,
      isRemoteUrl: false,
      staticSourcePath: '/local/path',
      port: 3000
    };

    vi.mocked(path.resolve).mockReturnValue('/resolved/path');
    vi.mocked(fs.access).mockResolvedValue(undefined);

    await expect(validateSourcePath(config)).resolves.toBeUndefined();
    expect(fs.access).toHaveBeenCalledWith('/resolved/path');
  });

  it('should exit on validation failure', async () => {
    const config: BridgeConfig = {
      isHostedMode: false,
      isRemoteUrl: false,
      staticSourcePath: '/invalid/path',
      port: 3000
    };
    
    vi.mocked(path.resolve).mockReturnValue('/resolved/invalid/path');
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    
    try {
      await validateSourcePath(config);
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect(error.message).toBe('process.exit called');
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe('Integration Tests', () => {
  it('should create a complete server setup', async () => {
    const config: BridgeConfig = {
      isHostedMode: true,
      isRemoteUrl: false,
      port: 3000
    };

    const mockApp = {
      use: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
      listen: vi.fn()
    };
    
    vi.mocked(express).mockReturnValue(mockApp as any);
    (express as any).json = vi.fn();

    const result = await startServer(config);    
    expect(result.app).toBeDefined();
    expect(result.transportManager).toBeInstanceOf(TransportManager);
    expect(mockApp.use).toHaveBeenCalled();
    expect(mockApp.get).toHaveBeenCalled();
    expect(mockApp.all).toHaveBeenCalled();
  });

  it('should handle CLI mode server setup with validation', async () => {
    const config: BridgeConfig = {
      isHostedMode: false,
      isRemoteUrl: false,
      staticSourcePath: '/test/path',
      port: 3000
    };

    vi.mocked(path.resolve).mockReturnValue('/resolved/test/path');
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('{"name":"test"}');
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

    const mockApp = {
      use: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
      listen: vi.fn()
    };
    
    vi.mocked(express).mockReturnValue(mockApp as any);
    (express as any).json = vi.fn();

    const result = await startServer(config);
    expect(result.app).toBeDefined();
    expect(result.transportManager).toBeInstanceOf(TransportManager);
    expect(fs.access).toHaveBeenCalledWith('/resolved/test/path');
  });
});