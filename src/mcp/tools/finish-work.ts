import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReviewStorage } from '../../server/storage.js';
import type { ToolResult, ErrorResult } from '../types.js';
import { isTextAnnotation } from '../../shared/types.js';

export async function finishWorkHandler(
  storage: ReviewStorage,
  params: { id: string; anchorText?: string; message?: string },
): Promise<ToolResult | ErrorResult> {
  if (params.anchorText !== undefined && !params.anchorText.trim()) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'anchorText must not be empty' }],
    };
  }

  if (params.message !== undefined && !params.message.trim()) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'message must not be empty' }],
    };
  }

  try {
    const store = await storage.mutate(s => {
      const annotation = s.annotations.find(a => a.id === params.id);
      if (!annotation) {
        throw new Error(`Annotation with ID "${params.id}" not found`);
      }

      const now = new Date().toISOString();

      // Set addressed status
      annotation.status = 'addressed';
      annotation.addressedAt = now;
      annotation.updatedAt = now;

      // Optionally update anchor text (maps to replacedText in storage)
      if (params.anchorText !== undefined) {
        if (!isTextAnnotation(annotation)) {
          throw new Error(`Annotation "${params.id}" is not a text annotation — anchorText only applies to text annotations`);
        }
        annotation.replacedText = params.anchorText;
      }

      // Optionally add agent reply
      if (params.message !== undefined) {
        if (!annotation.replies) {
          annotation.replies = [];
        }
        annotation.replies.push({ message: params.message, createdAt: now, role: 'agent' });
      }

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
    'finish_work',
    'Finish working on an annotation. Marks it as "addressed", optionally updates the anchor text (so the browser UI can re-locate it), and optionally adds an agent reply explaining what was done. This is step 3 of the agent workflow: list_annotations → start_work → finish_work.',
    {
      id: z.string().min(1).describe('The annotation ID to mark as finished'),
      anchorText: z.string().optional().describe('The new text that replaced the original annotated text (text annotations only). Enables the browser UI to re-locate the annotation after the text has changed.'),
      message: z.string().optional().describe('A reply message explaining what action was taken. Visible to reviewers in the panel UI.'),
    },
    async (params) => finishWorkHandler(storage, params),
  );
}
