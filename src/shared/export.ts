import type { ReviewStore, Annotation, PageNote } from './types.js';
import { isTextAnnotation, isElementAnnotation, getAnnotationStatus } from './types.js';

/**
 * Generate markdown export from a ReviewStore.
 *
 * Shared between the REST API middleware, the MCP server, and the client
 * (which re-exports this via src/client/export.ts).
 */
export function generateExport(store: ReviewStore): string {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines: string[] = [
    '# Review Loop — Copy Annotations',
    `Exported: ${now}`,
    '',
  ];

  // Group by page URL
  const pages = new Map<string, { title: string; annotations: Annotation[]; notes: PageNote[] }>();

  for (const a of store.annotations) {
    if (!pages.has(a.pageUrl)) {
      pages.set(a.pageUrl, { title: a.pageTitle, annotations: [], notes: [] });
    }
    pages.get(a.pageUrl)!.annotations.push(a);
  }

  for (const n of store.pageNotes) {
    if (!pages.has(n.pageUrl)) {
      pages.set(n.pageUrl, { title: n.pageTitle, annotations: [], notes: [] });
    }
    pages.get(n.pageUrl)!.notes.push(n);
  }

  if (pages.size === 0) {
    lines.push('No annotations or notes yet.');
    return lines.join('\n');
  }

  for (const [url, page] of pages) {
    lines.push('---', '');
    lines.push(`## ${url}${page.title ? ` — ${page.title}` : ''}`);
    lines.push('');

    if (page.notes.length > 0) {
      lines.push('### Page Notes');
      for (const n of page.notes) {
        lines.push(`- ${n.note}`);
      }
      lines.push('');
    }

    const textAnnotations = page.annotations.filter(isTextAnnotation);
    const elementAnnotations = page.annotations.filter(isElementAnnotation);

    if (textAnnotations.length > 0) {
      lines.push('### Text Annotations');
      let i = 1;
      for (const a of textAnnotations) {
        const status = getAnnotationStatus(a);
        const statusLabel = status === 'addressed' ? ' 🔧 [Addressed]'
          : status === 'in_progress' ? ' ⏳ [In Progress]'
          : '';
        lines.push(`${i}. **"${a.selectedText}"**${statusLabel}`);
        if (a.note) {
          lines.push(`   > ${a.note}`);
        }
        if (a.replies && a.replies.length > 0) {
          for (const reply of a.replies) {
            const prefix = reply.role === 'reviewer' ? 'Reviewer' : 'Agent';
            lines.push(`   > **${prefix}:** ${reply.message}`);
          }
        }
        lines.push('');
        i++;
      }
    }

    if (elementAnnotations.length > 0) {
      lines.push('### Element Annotations');
      let i = 1;
      for (const a of elementAnnotations) {
        const safeSelector = a.elementSelector.cssSelector.replace(/`/g, '\\`');
        const safePreview = a.elementSelector.outerHtmlPreview.replace(/`/g, '\\`');
        const status = getAnnotationStatus(a);
        const statusLabel = status === 'addressed' ? ' 🔧 [Addressed]'
          : status === 'in_progress' ? ' ⏳ [In Progress]'
          : '';
        lines.push(`${i}. **\`${safeSelector}\`** (\`${safePreview}\`)${statusLabel}`);
        if (a.note) {
          lines.push(`   > ${a.note}`);
        }
        if (a.replies && a.replies.length > 0) {
          for (const reply of a.replies) {
            const prefix = reply.role === 'reviewer' ? 'Reviewer' : 'Agent';
            lines.push(`   > **${prefix}:** ${reply.message}`);
          }
        }
        lines.push('');
        i++;
      }
    }
  }

  return lines.join('\n');
}
