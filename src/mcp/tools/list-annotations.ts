import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReviewStorage } from '../../server/storage.js';
import type { ToolResult } from '../types.js';
import { getAnnotationStatus } from '../../shared/types.js';
import type { AnnotationStatus } from '../../shared/types.js';

export async function listAnnotationsHandler(
  storage: ReviewStorage,
  params: { pageUrl?: string; status?: AnnotationStatus },
): Promise<ToolResult> {
  const store = await storage.read();

  let annotations = params.pageUrl
    ? store.annotations.filter(a => a.pageUrl === params.pageUrl)
    : store.annotations;

  if (params.status) {
    annotations = annotations.filter(a => getAnnotationStatus(a) === params.status);
  }

  const pageNotes = params.pageUrl
    ? store.pageNotes.filter(n => n.pageUrl === params.pageUrl)
    : store.pageNotes;

  return {
    content: [{ type: 'text', text: JSON.stringify({ annotations, pageNotes }, null, 2) }],
  };
}

export function register(server: McpServer, storage: ReviewStorage): void {
  server.tool(
    'list_annotations',
    'List all review feedback — text annotations, element annotations, and page notes — in a single call. Returns structured JSON with all fields (IDs, status, selectors, text ranges). Call this at the start of your session and after each finish_work call to check for new or reopened annotations from the reviewer. This is step 1 of the agent workflow: list_annotations → start_work → (edit code) → finish_work. IMPORTANT: Do not edit source files based on this listing alone — call start_work on each annotation before making any changes.',
    {
      pageUrl: z.string().optional().describe('Filter by page URL path (e.g. "/about")'),
      status: z.enum(['open', 'in_progress', 'addressed']).optional().describe('Filter annotations by lifecycle status'),
    },
    async (params) => listAnnotationsHandler(storage, params),
  );
}
