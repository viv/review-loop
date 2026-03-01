import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReviewStorage } from '../../server/storage.js';
import type { ToolResult, ErrorResult } from '../types.js';

export async function startWorkHandler(
  storage: ReviewStorage,
  params: { id: string },
): Promise<ToolResult | ErrorResult> {
  try {
    const store = await storage.mutate(s => {
      const annotation = s.annotations.find(a => a.id === params.id);
      if (!annotation) {
        throw new Error(`Annotation with ID "${params.id}" not found`);
      }

      const now = new Date().toISOString();
      annotation.status = 'in_progress';
      annotation.inProgressAt = now;
      annotation.updatedAt = now;
      return s;
    });

    const annotation = store.annotations.find(a => a.id === params.id);
    return {
      content: [{ type: 'text', text: JSON.stringify(annotation, null, 2) }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: (err as Error).message }],
    };
  }
}

export function register(server: McpServer, storage: ReviewStorage): void {
  server.tool(
    'start_work',
    'Start working on an annotation. Returns the full annotation detail and atomically sets its status to "in_progress" so the browser UI shows a working indicator instead of an orphan warning during code edits. This is step 2 of the agent workflow: list_annotations → start_work → finish_work.',
    {
      id: z.string().min(1).describe('The annotation ID to start working on'),
    },
    async (params) => startWorkHandler(storage, params),
  );
}
