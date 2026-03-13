import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReviewStorage } from '../../server/storage.js';
import type { ToolResult, ErrorResult } from '../types.js';
import { isTextAnnotation, getAnnotationStatus } from '../../shared/types.js';

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

      const currentStatus = getAnnotationStatus(annotation);
      if (currentStatus !== 'in_progress') {
        throw new Error(
          `Annotation "${params.id}" has status "${currentStatus}" — you must call start_work before finish_work. ` +
          `This signals to the reviewer that you are working on it and prevents orphan warnings in the browser UI.`
        );
      }

      const now = new Date().toISOString();

      // Set addressed status
      annotation.status = 'addressed';
      annotation.addressedAt = now;
      annotation.updatedAt = now;

      // Update anchor text (maps to replacedText in storage)
      // Required for text annotations so reviewers can see what changed via inline diff
      if (isTextAnnotation(annotation) && params.anchorText === undefined) {
        throw new Error(
          `anchorText is required for text annotations — provide the new text that replaced "${annotation.selectedText}" ` +
          `so reviewers can see an inline diff of what changed.`
        );
      }
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
    'Finish working on an annotation. Marks it as "addressed", optionally updates the anchor text (so the browser UI can re-locate it), and optionally adds an agent reply explaining what was done. Requires start_work to have been called first (will reject otherwise). This is step 3 of the agent workflow: list_annotations → start_work → (edit code) → finish_work. After calling this, call list_annotations(status: "open") to check for remaining or newly reopened annotations.',
    {
      id: z.string().min(1).describe('The annotation ID to mark as finished'),
      anchorText: z.string().optional().describe('The new text that replaced the original annotated text. REQUIRED for text annotations — enables inline diff preview so reviewers can see exactly what changed. Not applicable to element annotations.'),
      message: z.string().optional().describe('A reply message explaining what action was taken. Visible to reviewers in the panel UI.'),
    },
    async (params) => finishWorkHandler(storage, params),
  );
}
