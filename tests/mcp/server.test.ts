import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import type { ReviewStore } from '../../src/shared/types.js';

const PROJECT_ROOT = join(import.meta.dirname, '../..');
const SERVER_PATH = join(PROJECT_ROOT, 'dist/mcp/server.js');
const TEST_DIR = join(tmpdir(), 'air-mcp-integration-' + Date.now());

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Spawn the MCP server and provide helpers for JSON-RPC communication.
 */
function createMcpClient(storagePath: string) {
  let proc: ChildProcess;
  let buffer = '';
  let messageResolvers: Array<(msg: JsonRpcResponse) => void> = [];
  let messageQueue: JsonRpcResponse[] = [];
  let requestId = 0;

  return {
    start() {
      proc = spawn('node', [SERVER_PATH, '--storage', storagePath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: PROJECT_ROOT,
      });

      proc.stdout!.setEncoding('utf-8');
      proc.stdout!.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop()!; // Keep incomplete line in buffer
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as JsonRpcResponse;
            if (messageResolvers.length > 0) {
              messageResolvers.shift()!(msg);
            } else {
              messageQueue.push(msg);
            }
          } catch {
            // Ignore non-JSON lines (e.g. shebang)
          }
        }
      });
    },

    send(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
      const id = ++requestId;
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      proc.stdin!.write(msg + '\n');

      return new Promise<JsonRpcResponse>((resolve) => {
        if (messageQueue.length > 0) {
          resolve(messageQueue.shift()!);
        } else {
          messageResolvers.push(resolve);
        }
      });
    },

    notify(method: string, params?: Record<string, unknown>) {
      const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
      proc.stdin!.write(msg + '\n');
    },

    async initialize(): Promise<JsonRpcResponse> {
      const response = await this.send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });
      this.notify('notifications/initialized');
      return response;
    },

    async callTool(name: string, args: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
      return this.send('tools/call', { name, arguments: args });
    },

    async stop() {
      if (proc && !proc.killed) {
        proc.kill();
        await new Promise<void>((resolve) => proc.on('close', resolve));
      }
    },
  };
}

function writeStore(path: string, store: ReviewStore) {
  writeFileSync(path, JSON.stringify(store, null, 2));
}

function readStore(path: string): ReviewStore {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function makeTestStore(): ReviewStore {
  return {
    version: 1,
    annotations: [
      {
        id: 'ann-1',
        type: 'text',
        pageUrl: '/',
        pageTitle: 'Home',
        selectedText: 'Hello world',
        note: 'Fix this typo',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'Hello world', contextBefore: '', contextAfter: '' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'ann-2',
        type: 'text',
        pageUrl: '/about',
        pageTitle: 'About',
        selectedText: 'Our company',
        note: 'Needs updating',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'Our company', contextBefore: '', contextAfter: '' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    pageNotes: [
      {
        id: 'pn-1',
        pageUrl: '/',
        pageTitle: 'Home',
        note: 'General page feedback',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

describe('MCP server integration', () => {
  let storagePath: string;
  let client: ReturnType<typeof createMcpClient>;

  beforeAll(() => {
    // Ensure the built server exists
    if (!existsSync(SERVER_PATH)) {
      throw new Error(`Built server not found at ${SERVER_PATH}. Run "npm run build" first.`);
    }
  });

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    storagePath = join(TEST_DIR, `store-${Date.now()}.json`);
    writeStore(storagePath, makeTestStore());
    client = createMcpClient(storagePath);
    client.start();
  });

  afterEach(async () => {
    await client.stop();
    if (existsSync(storagePath)) unlinkSync(storagePath);
  });

  it('initializes and lists tools', async () => {
    const initResponse = await client.initialize();
    expect(initResponse.result).toBeDefined();

    const toolsResponse = await client.send('tools/list');
    const tools = (toolsResponse.result as { tools: Array<{ name: string }> }).tools;
    const toolNames = tools.map(t => t.name);

    expect(toolNames).toContain('list_annotations');
    expect(toolNames).toContain('list_page_notes');
    expect(toolNames).toContain('get_annotation');
    expect(toolNames).toContain('get_export');
    expect(toolNames).toContain('address_annotation');
    expect(toolNames).toContain('add_agent_reply');
    expect(toolNames).toContain('set_in_progress');
  });

  it('list_annotations returns all annotations', async () => {
    await client.initialize();

    const response = await client.callTool('list_annotations');
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const annotations = JSON.parse(result.content[0].text);

    expect(annotations).toHaveLength(2);
    expect(annotations[0].id).toBe('ann-1');
    expect(annotations[1].id).toBe('ann-2');
  });

  it('list_annotations filters by pageUrl', async () => {
    await client.initialize();

    const response = await client.callTool('list_annotations', { pageUrl: '/about' });
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const annotations = JSON.parse(result.content[0].text);

    expect(annotations).toHaveLength(1);
    expect(annotations[0].id).toBe('ann-2');
  });

  it('get_annotation returns a single annotation', async () => {
    await client.initialize();

    const response = await client.callTool('get_annotation', { id: 'ann-1' });
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const annotation = JSON.parse(result.content[0].text);

    expect(annotation.id).toBe('ann-1');
    expect(annotation.note).toBe('Fix this typo');
  });

  it('get_annotation returns error for invalid ID', async () => {
    await client.initialize();

    const response = await client.callTool('get_annotation', { id: 'nonexistent' });
    const result = response.result as { content: Array<{ type: string; text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('address_annotation defaults to addressed status', async () => {
    await client.initialize();

    const response = await client.callTool('address_annotation', { id: 'ann-1' });
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const annotation = JSON.parse(result.content[0].text);

    expect(annotation.status).toBe('addressed');
    expect(annotation.addressedAt).toBeDefined();

    // Verify persisted to disk
    const store = readStore(storagePath);
    expect(store.annotations[0].status).toBe('addressed');
    expect(store.annotations[0].addressedAt).toBeDefined();
  });

  it('add_agent_reply persists to disk', async () => {
    await client.initialize();

    const response = await client.callTool('add_agent_reply', { id: 'ann-2', message: 'Fixed the copy' });
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const annotation = JSON.parse(result.content[0].text);

    expect(annotation.replies).toHaveLength(1);
    expect(annotation.replies[0].message).toBe('Fixed the copy');

    // Verify persisted to disk
    const store = readStore(storagePath);
    expect(store.annotations[1].replies).toHaveLength(1);
  });

  it('get_export returns markdown', async () => {
    await client.initialize();

    const response = await client.callTool('get_export');
    const result = response.result as { content: Array<{ type: string; text: string }> };

    expect(result.content[0].text).toContain('# Review Loop');
    expect(result.content[0].text).toContain('Hello world');
    expect(result.content[0].text).toContain('Fix this typo');
  });

  it('handles missing required params with error', async () => {
    await client.initialize();

    // get_annotation requires 'id' — omit it
    const response = await client.callTool('get_annotation', {});

    // MCP SDK may return a JSON-RPC error or a tool-level isError result
    const hasJsonRpcError = response.error !== undefined;
    const result = response.result as { isError?: boolean; content?: Array<{ text: string }> } | undefined;
    const hasToolError = result?.isError === true;
    expect(hasJsonRpcError || hasToolError).toBe(true);
  });
});

describe('MCP server end-to-end workflow', () => {
  let storagePath: string;
  let client: ReturnType<typeof createMcpClient>;

  beforeAll(() => {
    if (!existsSync(SERVER_PATH)) {
      throw new Error(`Built server not found at ${SERVER_PATH}. Run "npm run build" first.`);
    }
  });

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    storagePath = join(TEST_DIR, `workflow-${Date.now()}.json`);
    writeStore(storagePath, makeTestStore());
    client = createMcpClient(storagePath);
    client.start();
  });

  afterEach(async () => {
    await client.stop();
    if (existsSync(storagePath)) unlinkSync(storagePath);
  });

  it('list → resolve → reply → export shows complete workflow', async () => {
    await client.initialize();

    // Step 1: List annotations to see what needs attention
    const listResponse = await client.callTool('list_annotations');
    const listResult = listResponse.result as { content: Array<{ type: string; text: string }> };
    const annotations = JSON.parse(listResult.content[0].text);
    expect(annotations).toHaveLength(2);

    // Step 2: Address the first annotation (default behaviour)
    const addressResponse = await client.callTool('address_annotation', { id: 'ann-1' });
    const addressResult = addressResponse.result as { content: Array<{ type: string; text: string }> };
    const addressed = JSON.parse(addressResult.content[0].text);
    expect(addressed.status).toBe('addressed');
    expect(addressed.addressedAt).toBeDefined();

    // Step 3: Add a reply to the second annotation
    const replyResponse = await client.callTool('add_agent_reply', {
      id: 'ann-2',
      message: 'Updated company description to reflect current information',
    });
    const replyResult = replyResponse.result as { content: Array<{ type: string; text: string }> };
    const replied = JSON.parse(replyResult.content[0].text);
    expect(replied.replies).toHaveLength(1);

    // Step 4: Get export — should include resolved status and reply
    const exportResponse = await client.callTool('get_export');
    const exportResult = exportResponse.result as { content: Array<{ type: string; text: string }> };
    const markdown = exportResult.content[0].text;

    expect(markdown).toContain('[Addressed]');
    expect(markdown).toContain('Updated company description');

    // Step 5: Verify the JSON file reflects all changes
    const store = readStore(storagePath);
    expect(store.annotations[0].status).toBe('addressed');
    expect(store.annotations[0].addressedAt).toBeDefined();
    expect(store.annotations[1].replies).toHaveLength(1);
    expect(store.annotations[1].replies![0].message).toContain('Updated company description');
  });
});
