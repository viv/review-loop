import { describe, it, expect } from 'vitest';
import { generateExport } from '../../src/client/export.js';
import type { ReviewStore } from '../../src/client/types.js';

function makeStore(overrides?: Partial<ReviewStore>): ReviewStore {
  return {
    version: 1,
    annotations: [],
    pageNotes: [],
    ...overrides,
  };
}

describe('generateExport', () => {
  it('returns empty message when store has no data', () => {
    const result = generateExport(makeStore());

    expect(result).toContain('# Review Loop');
    expect(result).toContain('No annotations or notes yet');
  });

  it('includes export date in ISO-like format', () => {
    const result = generateExport(makeStore());

    expect(result).toContain('Exported:');
    // Date should be YYYY-MM-DD HH:MM format
    expect(result).toMatch(/Exported: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it('groups annotations by page URL', () => {
    const store = makeStore({
      annotations: [
        {
          id: '1', type: 'text', pageUrl: '/', pageTitle: 'Home',
          selectedText: 'hello', note: 'note1',
          range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'hello', contextBefore: '', contextAfter: '' },
          createdAt: '', updatedAt: '',
        },
        {
          id: '2', type: 'text', pageUrl: '/about', pageTitle: 'About',
          selectedText: 'world', note: 'note2',
          range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'world', contextBefore: '', contextAfter: '' },
          createdAt: '', updatedAt: '',
        },
      ],
    });

    const result = generateExport(store);

    expect(result).toContain('## / — Home');
    expect(result).toContain('## /about — About');
  });

  it('renders selected text in bold quotes', () => {
    const store = makeStore({
      annotations: [{
        id: '1', type: 'text', pageUrl: '/', pageTitle: '',
        selectedText: 'important text', note: 'fix this',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
        createdAt: '', updatedAt: '',
      }],
    });

    const result = generateExport(store);

    expect(result).toContain('**"important text"**');
  });

  it('renders notes as blockquotes', () => {
    const store = makeStore({
      annotations: [{
        id: '1', type: 'text', pageUrl: '/', pageTitle: '',
        selectedText: 'text', note: 'This needs fixing',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
        createdAt: '', updatedAt: '',
      }],
    });

    const result = generateExport(store);

    expect(result).toContain('> This needs fixing');
  });

  it('numbers annotations within each page', () => {
    const store = makeStore({
      annotations: [
        { id: '1', type: 'text', pageUrl: '/', pageTitle: '', selectedText: 'first', note: '', range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' }, createdAt: '', updatedAt: '' },
        { id: '2', type: 'text', pageUrl: '/', pageTitle: '', selectedText: 'second', note: '', range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' }, createdAt: '', updatedAt: '' },
      ],
    });

    const result = generateExport(store);

    expect(result).toContain('1. **"first"**');
    expect(result).toContain('2. **"second"**');
  });

  it('includes page notes as bullet list', () => {
    const store = makeStore({
      pageNotes: [
        { id: '1', pageUrl: '/', pageTitle: 'Home', note: 'General feedback', createdAt: '', updatedAt: '' },
        { id: '2', pageUrl: '/', pageTitle: 'Home', note: 'Tone is off', createdAt: '', updatedAt: '' },
      ],
    });

    const result = generateExport(store);

    expect(result).toContain('### Page Notes');
    expect(result).toContain('- General feedback');
    expect(result).toContain('- Tone is off');
  });

  it('separates pages with horizontal rules', () => {
    const store = makeStore({
      annotations: [
        { id: '1', type: 'text', pageUrl: '/', pageTitle: '', selectedText: 'a', note: '', range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' }, createdAt: '', updatedAt: '' },
        { id: '2', type: 'text', pageUrl: '/about', pageTitle: '', selectedText: 'b', note: '', range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' }, createdAt: '', updatedAt: '' },
      ],
    });

    const result = generateExport(store);

    expect(result).toContain('---');
  });

  it('omits annotation note blockquote when note is empty', () => {
    const store = makeStore({
      annotations: [{
        id: '1', type: 'text', pageUrl: '/', pageTitle: '',
        selectedText: 'text', note: '',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
        createdAt: '', updatedAt: '',
      }],
    });

    const result = generateExport(store);

    expect(result).toContain('**"text"**');
    expect(result).not.toContain('> ');
  });

  it('maps legacy resolvedAt to addressed in export (backward compat)', () => {
    const store = makeStore({
      annotations: [{
        id: '1', type: 'text', pageUrl: '/', pageTitle: '',
        selectedText: 'fix this', note: 'needs work',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
        createdAt: '', updatedAt: '',
        resolvedAt: '2026-02-22T10:00:00Z',
      }],
    });

    const result = generateExport(store);

    expect(result).toContain('[Addressed]');
    expect(result).not.toContain('[Resolved]');
    expect(result).toContain('**"fix this"**');
  });

  it('does not show status label for open annotations', () => {
    const store = makeStore({
      annotations: [{
        id: '1', type: 'text', pageUrl: '/', pageTitle: '',
        selectedText: 'pending', note: '',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
        createdAt: '', updatedAt: '',
      }],
    });

    const result = generateExport(store);

    expect(result).not.toContain('[Resolved]');
    expect(result).not.toContain('[Addressed]');
  });

  it('shows agent replies as blockquotes with Agent: prefix', () => {
    const store = makeStore({
      annotations: [{
        id: '1', type: 'text', pageUrl: '/', pageTitle: '',
        selectedText: 'text', note: 'fix this',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
        createdAt: '', updatedAt: '',
        replies: [
          { message: 'Fixed the typo in header.ts', createdAt: '2026-02-22T10:00:00Z' },
        ],
      }],
    });

    const result = generateExport(store);

    expect(result).toContain('**Agent:** Fixed the typo in header.ts');
  });

  it('shows multiple agent replies in order', () => {
    const store = makeStore({
      annotations: [{
        id: '1', type: 'text', pageUrl: '/', pageTitle: '',
        selectedText: 'text', note: 'fix',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
        createdAt: '', updatedAt: '',
        replies: [
          { message: 'First reply', createdAt: '2026-02-22T10:00:00Z' },
          { message: 'Second reply', createdAt: '2026-02-22T11:00:00Z' },
        ],
      }],
    });

    const result = generateExport(store);

    expect(result).toContain('**Agent:** First reply');
    expect(result).toContain('**Agent:** Second reply');
    const firstIdx = result.indexOf('First reply');
    const secondIdx = result.indexOf('Second reply');
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it('maps legacy resolvedAt to addressed for element annotations (backward compat)', () => {
    const store = makeStore({
      annotations: [{
        id: '1', type: 'element', pageUrl: '/', pageTitle: '',
        note: 'fix this element',
        elementSelector: { cssSelector: 'div.hero', xpath: '', description: '', tagName: 'div', attributes: {}, outerHtmlPreview: '<div class="hero">' },
        createdAt: '', updatedAt: '',
        resolvedAt: '2026-02-22T10:00:00Z',
      }],
    });

    const result = generateExport(store);

    expect(result).toContain('[Addressed]');
    expect(result).not.toContain('[Resolved]');
    expect(result).toContain('div.hero');
  });
});
