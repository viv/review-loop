import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
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

  it('initializes and lists only the three simplified tools', async () => {
    const initResponse = await client.initialize();
    expect(initResponse.result).toBeDefined();

    const toolsResponse = await client.send('tools/list');
    const tools = (toolsResponse.result as { tools: Array<{ name: string }> }).tools;
    const toolNames = tools.map(t => t.name);

    expect(toolNames).toContain('list_annotations');
    expect(toolNames).toContain('start_work');
    expect(toolNames).toContain('finish_work');
    expect(toolNames).toHaveLength(3);

    // Verify removed tools are not present
    expect(toolNames).not.toContain('list_page_notes');
    expect(toolNames).not.toContain('get_annotation');
    expect(toolNames).not.toContain('get_export');
    expect(toolNames).not.toContain('address_annotation');
    expect(toolNames).not.toContain('add_agent_reply');
    expect(toolNames).not.toContain('update_annotation_target');
    expect(toolNames).not.toContain('set_in_progress');
  });

  it('list_annotations returns annotations and page notes', async () => {
    await client.initialize();

    const response = await client.callTool('list_annotations');
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const data = JSON.parse(result.content[0].text);

    expect(data.annotations).toHaveLength(2);
    expect(data.annotations[0].id).toBe('ann-1');
    expect(data.annotations[1].id).toBe('ann-2');
    expect(data.pageNotes).toHaveLength(1);
    expect(data.pageNotes[0].id).toBe('pn-1');
  });

  it('list_annotations filters by pageUrl', async () => {
    await client.initialize();

    const response = await client.callTool('list_annotations', { pageUrl: '/about' });
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const data = JSON.parse(result.content[0].text);

    expect(data.annotations).toHaveLength(1);
    expect(data.annotations[0].id).toBe('ann-2');
    expect(data.pageNotes).toHaveLength(0);
  });

  it('list_annotations filters by status', async () => {
    // Set one annotation to addressed
    const store = makeTestStore();
    store.annotations[0].status = 'addressed';
    store.annotations[0].addressedAt = '2026-01-15T00:00:00.000Z';
    writeStore(storagePath, store);

    await client.initialize();

    const response = await client.callTool('list_annotations', { status: 'open' });
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const data = JSON.parse(result.content[0].text);

    // Only the non-addressed annotation should be returned
    expect(data.annotations).toHaveLength(1);
    expect(data.annotations[0].id).toBe('ann-2');
  });

  it('start_work returns annotation detail and sets in_progress', async () => {
    await client.initialize();

    const response = await client.callTool('start_work', { id: 'ann-1' });
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const annotation = JSON.parse(result.content[0].text);

    expect(annotation.id).toBe('ann-1');
    expect(annotation.note).toBe('Fix this typo');
    expect(annotation.status).toBe('in_progress');
    expect(annotation.inProgressAt).toBeDefined();

    // Verify persisted to disk
    const store = readStore(storagePath);
    expect(store.annotations[0].status).toBe('in_progress');
  });

  it('start_work returns error for invalid ID', async () => {
    await client.initialize();

    const response = await client.callTool('start_work', { id: 'nonexistent' });
    const result = response.result as { content: Array<{ type: string; text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('finish_work marks addressed and adds reply', async () => {
    await client.initialize();

    // Must call start_work first — finish_work requires in_progress status
    await client.callTool('start_work', { id: 'ann-1' });

    const response = await client.callTool('finish_work', {
      id: 'ann-1',
      anchorText: 'Hello World',
      message: 'Capitalised the W in World',
    });
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const annotation = JSON.parse(result.content[0].text);

    expect(annotation.status).toBe('addressed');
    expect(annotation.addressedAt).toBeDefined();
    expect(annotation.replacedText).toBe('Hello World');
    expect(annotation.replies).toHaveLength(1);
    expect(annotation.replies[0].message).toBe('Capitalised the W in World');

    // Verify persisted to disk
    const store = readStore(storagePath);
    expect(store.annotations[0].status).toBe('addressed');
    expect(store.annotations[0].replies).toHaveLength(1);
  });

  it('finish_work rejects when start_work not called first', async () => {
    await client.initialize();

    const response = await client.callTool('finish_work', { id: 'ann-2' });
    const result = response.result as { content: Array<{ type: string; text: string }>; isError: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('start_work');
  });

  it('finish_work works with only required params', async () => {
    await client.initialize();

    // Must call start_work first
    await client.callTool('start_work', { id: 'ann-2' });

    const response = await client.callTool('finish_work', { id: 'ann-2' });
    const result = response.result as { content: Array<{ type: string; text: string }> };
    const annotation = JSON.parse(result.content[0].text);

    expect(annotation.status).toBe('addressed');
    expect(annotation.addressedAt).toBeDefined();
  });

  it('handles missing required params with error', async () => {
    await client.initialize();

    // start_work requires 'id' — omit it
    const response = await client.callTool('start_work', {});

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

  it('list → start → finish shows complete workflow', async () => {
    await client.initialize();

    // Step 1: List annotations to see what needs attention
    const listResponse = await client.callTool('list_annotations');
    const listResult = listResponse.result as { content: Array<{ type: string; text: string }> };
    const data = JSON.parse(listResult.content[0].text);
    expect(data.annotations).toHaveLength(2);
    expect(data.pageNotes).toHaveLength(1);

    // Step 2: Start work on the first annotation
    const startResponse = await client.callTool('start_work', { id: 'ann-1' });
    const startResult = startResponse.result as { content: Array<{ type: string; text: string }> };
    const started = JSON.parse(startResult.content[0].text);
    expect(started.status).toBe('in_progress');
    expect(started.inProgressAt).toBeDefined();

    // Step 3: Finish work with anchor text and message
    const finishResponse = await client.callTool('finish_work', {
      id: 'ann-1',
      anchorText: 'Hello World',
      message: 'Capitalised the W in World',
    });
    const finishResult = finishResponse.result as { content: Array<{ type: string; text: string }> };
    const finished = JSON.parse(finishResult.content[0].text);
    expect(finished.status).toBe('addressed');
    expect(finished.addressedAt).toBeDefined();
    expect(finished.replacedText).toBe('Hello World');
    expect(finished.replies).toHaveLength(1);
    expect(finished.replies[0].message).toBe('Capitalised the W in World');

    // Step 4: Verify the JSON file reflects all changes
    const store = readStore(storagePath);
    expect(store.annotations[0].status).toBe('addressed');
    expect(store.annotations[0].addressedAt).toBeDefined();
    if (store.annotations[0].type === 'text') {
      expect(store.annotations[0].replacedText).toBe('Hello World');
    }
    expect(store.annotations[0].replies).toHaveLength(1);
    expect(store.annotations[0].replies![0].message).toContain('Capitalised');

    // Step 5: List again with status filter — should only show open annotations
    const listOpenResponse = await client.callTool('list_annotations', { status: 'open' });
    const listOpenResult = listOpenResponse.result as { content: Array<{ type: string; text: string }> };
    const openData = JSON.parse(listOpenResult.content[0].text);
    expect(openData.annotations).toHaveLength(1);
    expect(openData.annotations[0].id).toBe('ann-2');
  });
});
