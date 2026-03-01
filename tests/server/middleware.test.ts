import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMiddleware } from '../../src/server/middleware.js';
import { ReviewStorage } from '../../src/server/storage.js';
import { createEmptyStore } from '../../src/types.js';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TEST_DIR = join(tmpdir(), 'air-mw-test-' + Date.now());
const TEST_FILE = join(TEST_DIR, 'mw-store.json');

/**
 * Create a minimal mock request.
 */
function mockRequest(method: string, url: string, body?: unknown): IncomingMessage {
  const chunks: Buffer[] = [];
  if (body) {
    chunks.push(Buffer.from(JSON.stringify(body)));
  }

  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    on(event: string, cb: (...args: any[]) => void) {
      if (event === 'data') {
        for (const chunk of chunks) cb(chunk);
      }
      if (event === 'end') cb();
      return req;
    },
  } as unknown as IncomingMessage;

  return req;
}

/**
 * Create a minimal mock response that captures the output.
 */
function mockResponse(): ServerResponse & { _status: number; _body: string; _headers: Record<string, string> } {
  let body = '';
  let status = 200;
  const headers: Record<string, string> = {};

  const res = {
    _status: status,
    _body: body,
    _headers: headers,
    writeHead(s: number, h?: Record<string, string>) {
      res._status = s;
      if (h) Object.assign(res._headers, h);
    },
    end(data?: string) {
      if (data) res._body = data;
    },
  } as any;

  return res;
}

describe('middleware', () => {
  let storage: ReviewStorage;
  let middleware: ReturnType<typeof createMiddleware>;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    if (existsSync(TEST_FILE)) {
      unlinkSync(TEST_FILE);
    }
    storage = new ReviewStorage(TEST_FILE);
    middleware = createMiddleware(storage);
  });

  afterEach(() => {
    if (existsSync(TEST_FILE)) {
      unlinkSync(TEST_FILE);
    }
  });

  it('passes through non-API requests', async () => {
    const req = mockRequest('GET', '/some-page');
    const res = mockResponse();
    let nextCalled = false;

    await middleware(req as any, res as any, () => { nextCalled = true; });

    expect(nextCalled).toBe(true);
  });

  describe('annotations CRUD', () => {
    it('GET /annotations returns empty store initially', async () => {
      const req = mockRequest('GET', '/__inline-review/api/annotations');
      const res = mockResponse();

      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(200);
      const data = JSON.parse(res._body);
      expect(data.annotations).toEqual([]);
    });

    it('POST /annotations creates and returns annotation with ID', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        pageTitle: 'Home',
        selectedText: 'hello world',
        note: 'test note',
        range: { startXPath: '/p[1]', startOffset: 0, endXPath: '/p[1]', endOffset: 11, selectedText: 'hello world', contextBefore: '', contextAfter: '' },
      });
      const res = mockResponse();

      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(201);
      const data = JSON.parse(res._body);
      expect(data.id).toBeTruthy();
      expect(data.selectedText).toBe('hello world');
      expect(data.note).toBe('test note');
      expect(data.createdAt).toBeTruthy();
    });

    it('POST /annotations sets explicit status: open on creation', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        pageTitle: 'Home',
        selectedText: 'hello world',
        note: 'test note',
        range: { startXPath: '/p[1]', startOffset: 0, endXPath: '/p[1]', endOffset: 11, selectedText: 'hello world', contextBefore: '', contextAfter: '' },
      });
      const res = mockResponse();

      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(201);
      const data = JSON.parse(res._body);
      expect(data.status).toBe('open');
    });

    it('PATCH /annotations/:id updates the annotation', async () => {
      // Create first
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        selectedText: 'test',
        note: 'original',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // Update
      const updateReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        note: 'updated note',
      });
      const updateRes = mockResponse();
      await middleware(updateReq as any, updateRes as any, () => {});

      expect(updateRes._status).toBe(200);
      const updated = JSON.parse(updateRes._body);
      expect(updated.note).toBe('updated note');
      expect(updated.id).toBe(created.id);
    });

    it('PATCH /annotations/:id returns 404 for unknown ID', async () => {
      const req = mockRequest('PATCH', '/__inline-review/api/annotations/nonexistent', { note: 'x' });
      const res = mockResponse();

      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(404);
    });

    it('DELETE /annotations/:id removes the annotation', async () => {
      // Create first
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        selectedText: 'delete me',
        note: '',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // Delete
      const deleteReq = mockRequest('DELETE', `/__inline-review/api/annotations/${created.id}`);
      const deleteRes = mockResponse();
      await middleware(deleteReq as any, deleteRes as any, () => {});

      expect(deleteRes._status).toBe(200);

      // Verify it's gone
      const getReq = mockRequest('GET', '/__inline-review/api/annotations');
      const getRes = mockResponse();
      await middleware(getReq as any, getRes as any, () => {});
      const data = JSON.parse(getRes._body);
      expect(data.annotations.length).toBe(0);
    });

    it('GET /annotations?page= filters by page URL', async () => {
      // Create annotations on different pages
      for (const pageUrl of ['/', '/about']) {
        const req = mockRequest('POST', '/__inline-review/api/annotations', {
          type: 'text',
          pageUrl,
          selectedText: `text on ${pageUrl}`,
          note: '',
          range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
        });
        const res = mockResponse();
        await middleware(req as any, res as any, () => {});
      }

      // Filter by page
      const req = mockRequest('GET', '/__inline-review/api/annotations?page=/about');
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      const data = JSON.parse(res._body);
      expect(data.annotations.length).toBe(1);
      expect(data.annotations[0].pageUrl).toBe('/about');
    });
  });

  describe('page notes CRUD', () => {
    it('POST /page-notes creates a page note', async () => {
      const req = mockRequest('POST', '/__inline-review/api/page-notes', {
        pageUrl: '/',
        pageTitle: 'Home',
        note: 'This page needs work',
      });
      const res = mockResponse();

      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(201);
      const data = JSON.parse(res._body);
      expect(data.id).toBeTruthy();
      expect(data.note).toBe('This page needs work');
    });

    it('DELETE /page-notes/:id removes the note', async () => {
      // Create
      const createReq = mockRequest('POST', '/__inline-review/api/page-notes', {
        pageUrl: '/',
        note: 'temp note',
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // Delete
      const deleteReq = mockRequest('DELETE', `/__inline-review/api/page-notes/${created.id}`);
      const deleteRes = mockResponse();
      await middleware(deleteReq as any, deleteRes as any, () => {});

      expect(deleteRes._status).toBe(200);
    });
  });

  describe('export', () => {
    it('returns markdown with annotations grouped by page', async () => {
      // Create annotations on two pages
      for (const [pageUrl, text] of [['/', 'home text'], ['/about', 'about text']] as const) {
        const req = mockRequest('POST', '/__inline-review/api/annotations', {
          type: 'text',
          pageUrl,
          pageTitle: pageUrl === '/' ? 'Home' : 'About',
          selectedText: text,
          note: `Note for ${text}`,
          range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: text, contextBefore: '', contextAfter: '' },
        });
        const res = mockResponse();
        await middleware(req as any, res as any, () => {});
      }

      const req = mockRequest('GET', '/__inline-review/api/export');
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(200);
      expect(res._headers['Content-Type']).toBe('text/markdown; charset=utf-8');
      expect(res._body).toContain('# Review Loop');
      expect(res._body).toContain('## /');
      expect(res._body).toContain('## /about');
      expect(res._body).toContain('**"home text"**');
      expect(res._body).toContain('> Note for home text');
    });

    it('returns empty message when no data exists', async () => {
      const req = mockRequest('GET', '/__inline-review/api/export');
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._body).toContain('No annotations or notes yet');
    });
  });

  describe('error handling', () => {
    it('returns 404 for unknown API routes', async () => {
      const req = mockRequest('GET', '/__inline-review/api/unknown');
      const res = mockResponse();

      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(404);
    });
  });

  describe('request body size limit', () => {
    it('rejects request bodies over 1 MB with 413', async () => {
      // Create a body larger than 1 MB (1_048_576 bytes)
      const oversizedPayload = 'x'.repeat(1_048_577);
      const chunks = [Buffer.from(oversizedPayload)];
      let destroyed = false;

      const req = {
        method: 'POST',
        url: '/__inline-review/api/annotations',
        headers: { 'content-type': 'application/json' },
        on(event: string, cb: (...args: any[]) => void) {
          if (event === 'data') {
            for (const chunk of chunks) cb(chunk);
          }
          if (event === 'end') cb();
          return req;
        },
        destroy() { destroyed = true; },
      } as unknown as IncomingMessage;

      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(413);
      expect(JSON.parse(res._body).error).toBe('Request body too large');
      expect(destroyed).toBe(true);
    });
  });

  describe('POST /annotations validation', () => {
    it('defaults missing type to text and creates annotation', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        pageUrl: '/',
        note: 'test',
        selectedText: 'hello',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(201);
      const data = JSON.parse(res._body);
      expect(data.type).toBe('text');
      expect(data.selectedText).toBe('hello');
      expect(data.note).toBe('test');
    });

    it('rejects missing type with element fields but no text fields', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        pageUrl: '/',
        note: 'test',
        elementSelector: { cssSelector: 'div', xpath: '/div', description: 'a div', tagName: 'div', attributes: {}, outerHtmlPreview: '<div></div>' },
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('"selectedText"');
    });

    it('rejects invalid type value with 400', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'invalid',
        pageUrl: '/',
        note: 'test',
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('"type"');
    });

    it('rejects missing pageUrl with 400', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        note: 'test',
        selectedText: 'hello',
        range: {},
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('"pageUrl"');
    });

    it('rejects missing note with 400', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        selectedText: 'hello',
        range: {},
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('"note"');
    });

    it('rejects text annotation without selectedText with 400', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        note: 'test',
        range: {},
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('"selectedText"');
    });

    it('rejects text annotation without range with 400', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        note: 'test',
        selectedText: 'hello',
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('"range"');
    });

    it('rejects text annotation with array range with 400', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        note: 'test',
        selectedText: 'hello',
        range: [1, 2, 3],
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('"range"');
    });

    it('rejects element annotation without elementSelector with 400', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'element',
        pageUrl: '/',
        note: 'test',
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('"elementSelector"');
    });

    it('accepts valid text annotation', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        note: 'test',
        selectedText: 'hello',
        range: { startXPath: '/p[1]', startOffset: 0, endXPath: '/p[1]', endOffset: 5, selectedText: 'hello', contextBefore: '', contextAfter: '' },
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(201);
    });

    it('accepts valid element annotation', async () => {
      const req = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'element',
        pageUrl: '/',
        note: 'test',
        elementSelector: { cssSelector: 'div', xpath: '//div', description: 'A div', tagName: 'div', attributes: {}, outerHtmlPreview: '<div></div>' },
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(201);
    });
  });

  describe('PATCH /annotations/:id replacedText', () => {
    it('updates replacedText on a text annotation', async () => {
      // Create a text annotation
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        selectedText: 'original text',
        note: 'some note',
        range: { startXPath: '/p[1]', startOffset: 0, endXPath: '/p[1]', endOffset: 13, selectedText: 'original text', contextBefore: '', contextAfter: '' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // PATCH with replacedText
      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        replacedText: 'replacement text',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.replacedText).toBe('replacement text');
      expect(patched.id).toBe(created.id);
    });

    it('ignores replacedText on an element annotation', async () => {
      // Create an element annotation
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'element',
        pageUrl: '/',
        note: 'element note',
        elementSelector: { cssSelector: 'div.hero', xpath: '//div[@class="hero"]', description: 'Hero div', tagName: 'div', attributes: {}, outerHtmlPreview: '<div class="hero"></div>' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // PATCH with replacedText — should be silently ignored
      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        replacedText: 'should not appear',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.replacedText).toBeUndefined();
    });

    it('rejects empty replacedText with 400', async () => {
      // Create a text annotation
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        selectedText: 'some text',
        note: 'a note',
        range: { startXPath: '/p[1]', startOffset: 0, endXPath: '/p[1]', endOffset: 9, selectedText: 'some text', contextBefore: '', contextAfter: '' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // PATCH with empty replacedText
      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        replacedText: '   ',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(400);
      const body = JSON.parse(patchRes._body);
      expect(body.error).toContain('replacedText must not be empty');
    });

    it('updates both note and replacedText on a text annotation', async () => {
      // Create a text annotation
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/about',
        selectedText: 'some text',
        note: 'original note',
        range: { startXPath: '/p[2]', startOffset: 0, endXPath: '/p[2]', endOffset: 9, selectedText: 'some text', contextBefore: '', contextAfter: '' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // PATCH with both fields
      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        note: 'updated note',
        replacedText: 'updated replacement',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.note).toBe('updated note');
      expect(patched.replacedText).toBe('updated replacement');
      expect(patched.id).toBe(created.id);
    });
  });

  describe('PATCH /annotations/:id range', () => {
    async function createTextAnnotation() {
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        selectedText: 'some text',
        note: 'original note',
        range: { startXPath: '/p[1]/text()[1]', startOffset: 0, endXPath: '/p[1]/text()[1]', endOffset: 9, selectedText: 'some text', contextBefore: 'before ', contextAfter: ' after' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      return JSON.parse(createRes._body);
    }

    it('updates range on a text annotation', async () => {
      const created = await createTextAnnotation();

      const newRange = {
        startXPath: '/p[1]/text()[1]',
        startOffset: 7,
        endXPath: '/p[1]/text()[1]',
        endOffset: 23,
        selectedText: 'replacement text',
        contextBefore: 'before ',
        contextAfter: ' after',
      };

      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        range: newRange,
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.range.startOffset).toBe(7);
      expect(patched.range.endOffset).toBe(23);
      expect(patched.range.selectedText).toBe('replacement text');
    });

    it('clears replacedText when null is sent', async () => {
      const created = await createTextAnnotation();

      // First set replacedText
      const setReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        replacedText: 'new text',
      });
      const setRes = mockResponse();
      await middleware(setReq as any, setRes as any, () => {});
      expect(JSON.parse(setRes._body).replacedText).toBe('new text');

      // Now clear it with null
      const clearReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        replacedText: null,
      });
      const clearRes = mockResponse();
      await middleware(clearReq as any, clearRes as any, () => {});

      expect(clearRes._status).toBe(200);
      const patched = JSON.parse(clearRes._body);
      expect(patched.replacedText).toBeUndefined();
    });

    it('updates range and clears replacedText together (re-anchor)', async () => {
      const created = await createTextAnnotation();

      // Set replacedText first
      const setReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        replacedText: 'new text',
      });
      const setRes = mockResponse();
      await middleware(setReq as any, setRes as any, () => {});

      // Re-anchor: update range and clear replacedText
      const newRange = {
        startXPath: '/p[1]/text()[1]',
        startOffset: 7,
        endXPath: '/p[1]/text()[1]',
        endOffset: 15,
        selectedText: 'new text',
        contextBefore: 'before ',
        contextAfter: ' after',
      };

      const reanchorReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        range: newRange,
        replacedText: null,
      });
      const reanchorRes = mockResponse();
      await middleware(reanchorReq as any, reanchorRes as any, () => {});

      expect(reanchorRes._status).toBe(200);
      const patched = JSON.parse(reanchorRes._body);
      expect(patched.range.selectedText).toBe('new text');
      expect(patched.replacedText).toBeUndefined();
    });

    it('rejects invalid range with 400', async () => {
      const created = await createTextAnnotation();

      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        range: 'not an object',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(400);
      expect(JSON.parse(patchRes._body).error).toContain('range must be an object');
    });

    it('ignores range on element annotations', async () => {
      // Create an element annotation
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'element',
        pageUrl: '/',
        note: 'element note',
        elementSelector: { cssSelector: 'div', xpath: '//div', description: 'A div', tagName: 'div', attributes: {}, outerHtmlPreview: '<div></div>' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // Attempt to set range — should be silently ignored
      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        range: { startXPath: '/p[1]', startOffset: 0, endXPath: '/p[1]', endOffset: 5, selectedText: 'test', contextBefore: '', contextAfter: '' },
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.range).toBeUndefined();
    });
  });

  describe('POST /page-notes validation', () => {
    it('rejects missing pageUrl with 400', async () => {
      const req = mockRequest('POST', '/__inline-review/api/page-notes', {
        note: 'test',
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('"pageUrl"');
    });

    it('rejects missing note with 400', async () => {
      const req = mockRequest('POST', '/__inline-review/api/page-notes', {
        pageUrl: '/',
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('"note"');
    });

    it('rejects non-string pageUrl with 400', async () => {
      const req = mockRequest('POST', '/__inline-review/api/page-notes', {
        pageUrl: 123,
        note: 'test',
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(400);
      expect(JSON.parse(res._body).error).toContain('"pageUrl"');
    });

    it('accepts valid page note', async () => {
      const req = mockRequest('POST', '/__inline-review/api/page-notes', {
        pageUrl: '/',
        note: 'This page needs work',
      });
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(201);
    });
  });

  describe('PATCH /annotations/:id status', () => {
    async function createTextAnnotation() {
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        selectedText: 'some text',
        note: 'original note',
        range: { startXPath: '/p[1]', startOffset: 0, endXPath: '/p[1]', endOffset: 9, selectedText: 'some text', contextBefore: '', contextAfter: '' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      return JSON.parse(createRes._body);
    }

    it('sets status to addressed and sets addressedAt timestamp', async () => {
      const created = await createTextAnnotation();

      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'addressed',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.status).toBe('addressed');
      expect(patched.addressedAt).toBeTruthy();
      expect(patched.resolvedAt).toBeUndefined();
    });

    it('rejects resolved as a status value with 400', async () => {
      const created = await createTextAnnotation();

      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'resolved',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(400);
      const body = JSON.parse(patchRes._body);
      expect(body.error).toContain('open');
      expect(body.error).toContain('addressed');
    });

    it('reopens annotation by setting status to open', async () => {
      const created = await createTextAnnotation();

      // First address it
      const addressReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'addressed',
      });
      const addressRes = mockResponse();
      await middleware(addressReq as any, addressRes as any, () => {});
      expect(addressRes._status).toBe(200);

      // Then reopen it
      const reopenReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'open',
      });
      const reopenRes = mockResponse();
      await middleware(reopenReq as any, reopenRes as any, () => {});

      expect(reopenRes._status).toBe(200);
      const patched = JSON.parse(reopenRes._body);
      expect(patched.status).toBe('open');
      expect(patched.resolvedAt).toBeUndefined();
      expect(patched.addressedAt).toBeUndefined();
    });

    it('sets status to in_progress and sets inProgressAt timestamp', async () => {
      const created = await createTextAnnotation();

      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'in_progress',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.status).toBe('in_progress');
      expect(patched.inProgressAt).toBeTruthy();
      expect(patched.addressedAt).toBeUndefined();
      expect(patched.resolvedAt).toBeUndefined();
    });

    it('clears inProgressAt when transitioning from in_progress to addressed', async () => {
      const created = await createTextAnnotation();

      // Set to in_progress first
      const ipReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'in_progress',
      });
      const ipRes = mockResponse();
      await middleware(ipReq as any, ipRes as any, () => {});
      expect(JSON.parse(ipRes._body).inProgressAt).toBeTruthy();

      // Then transition to addressed
      const addrReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'addressed',
      });
      const addrRes = mockResponse();
      await middleware(addrReq as any, addrRes as any, () => {});

      const patched = JSON.parse(addrRes._body);
      expect(patched.status).toBe('addressed');
      expect(patched.inProgressAt).toBeUndefined();
      expect(patched.addressedAt).toBeTruthy();
    });

    it('rejects invalid status with 400', async () => {
      const created = await createTextAnnotation();

      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'invalid',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(400);
      const body = JSON.parse(patchRes._body);
      expect(body.error).toContain('open');
      expect(body.error).toContain('in_progress');
      expect(body.error).toContain('addressed');
      expect(body.error).not.toContain('resolved');
    });

    it('updates status alongside note', async () => {
      const created = await createTextAnnotation();

      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'addressed',
        note: 'updated note',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.status).toBe('addressed');
      expect(patched.addressedAt).toBeTruthy();
      expect(patched.note).toBe('updated note');
    });
  });

  describe('PATCH /annotations/:id reply', () => {
    async function createTextAnnotation() {
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        selectedText: 'some text',
        note: 'original note',
        range: { startXPath: '/p[1]', startOffset: 0, endXPath: '/p[1]', endOffset: 9, selectedText: 'some text', contextBefore: '', contextAfter: '' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      return JSON.parse(createRes._body);
    }

    it('appends reviewer reply to replies array', async () => {
      const created = await createTextAnnotation();

      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        reply: { message: 'please fix the typo' },
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.replies).toHaveLength(1);
      expect(patched.replies[0].message).toBe('please fix the typo');
    });

    it('sets role to reviewer and createdAt timestamp', async () => {
      const created = await createTextAnnotation();

      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        reply: { message: 'reviewer feedback' },
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.replies[0].role).toBe('reviewer');
      expect(patched.replies[0].createdAt).toBeTruthy();
      // Verify createdAt is a valid ISO 8601 timestamp
      expect(new Date(patched.replies[0].createdAt).toISOString()).toBe(patched.replies[0].createdAt);
    });

    it('works alongside status change (reopen + reply)', async () => {
      const created = await createTextAnnotation();

      // First mark as addressed
      const addressReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'addressed',
      });
      const addressRes = mockResponse();
      await middleware(addressReq as any, addressRes as any, () => {});
      expect(addressRes._status).toBe(200);

      // Reopen with a reply explaining why
      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'open',
        reply: { message: 'try again like this' },
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.status).toBe('open');
      expect(patched.addressedAt).toBeUndefined();
      expect(patched.resolvedAt).toBeUndefined();
      expect(patched.replies).toHaveLength(1);
      expect(patched.replies[0].message).toBe('try again like this');
      expect(patched.replies[0].role).toBe('reviewer');
    });

    it('preserves existing agent replies when adding reviewer reply', async () => {
      const created = await createTextAnnotation();

      // Simulate an existing agent reply by writing directly to storage
      await storage.mutate(store => {
        const idx = store.annotations.findIndex(a => a.id === created.id);
        store.annotations[idx] = {
          ...store.annotations[idx],
          replies: [{ message: 'I fixed the typo', createdAt: new Date().toISOString(), role: 'agent' as const }],
        };
        return store;
      });

      // Add a reviewer reply via PATCH
      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        reply: { message: 'not quite, try again' },
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.replies).toHaveLength(2);
      expect(patched.replies[0].role).toBe('agent');
      expect(patched.replies[0].message).toBe('I fixed the typo');
      expect(patched.replies[1].role).toBe('reviewer');
      expect(patched.replies[1].message).toBe('not quite, try again');
    });

    it('rejects empty reply message with 400', async () => {
      const created = await createTextAnnotation();

      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        reply: { message: '   ' },
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(400);
      const body = JSON.parse(patchRes._body);
      expect(body.error).toContain('reply.message must be a non-empty string');
    });

    it('rejects reply with missing message field with 400', async () => {
      const created = await createTextAnnotation();

      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        reply: {},
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(400);
      const body = JSON.parse(patchRes._body);
      expect(body.error).toContain('reply.message must be a non-empty string');
    });
  });

  describe('PATCH field allowlist', () => {
    it('PATCH /annotations/:id only applies allowlisted fields', async () => {
      // Create an annotation
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/test',
        pageTitle: 'Test Page',
        selectedText: 'original text',
        note: 'original note',
        range: { startXPath: '/p[1]', startOffset: 0, endXPath: '/p[1]', endOffset: 5, selectedText: 'original text', contextBefore: '', contextAfter: '' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // PATCH with allowlisted field (note) and non-allowlisted fields (id, selectedText, pageUrl)
      const patchReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        note: 'updated note',
        id: 'evil-id',
        selectedText: 'injected text',
        pageUrl: '/injected',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.note).toBe('updated note');
      expect(patched.id).toBe(created.id); // ID must not change
      expect(patched.selectedText).toBe('original text'); // Must not be overwritten
      expect(patched.pageUrl).toBe('/test'); // Must not be overwritten
    });

    it('PATCH /page-notes/:id only applies allowlisted fields', async () => {
      // Create a page note
      const createReq = mockRequest('POST', '/__inline-review/api/page-notes', {
        pageUrl: '/test',
        pageTitle: 'Test Page',
        note: 'original note',
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // PATCH with allowlisted field (note) and non-allowlisted fields (id, pageUrl)
      const patchReq = mockRequest('PATCH', `/__inline-review/api/page-notes/${created.id}`, {
        note: 'updated note',
        id: 'evil-id',
        pageUrl: '/injected',
      });
      const patchRes = mockResponse();
      await middleware(patchReq as any, patchRes as any, () => {});

      expect(patchRes._status).toBe(200);
      const patched = JSON.parse(patchRes._body);
      expect(patched.note).toBe('updated note');
      expect(patched.id).toBe(created.id); // ID must not change
      expect(patched.pageUrl).toBe('/test'); // Must not be overwritten
    });
  });

  describe('GET /version', () => {
    it('returns fingerprint for empty store', async () => {
      const req = mockRequest('GET', '/__inline-review/api/version');
      const res = mockResponse();

      await middleware(req as any, res as any, () => {});

      expect(res._status).toBe(200);
      const data = JSON.parse(res._body);
      expect(data.fingerprint).toBe('0:');
    });

    it('returns fingerprint reflecting annotation count and latest timestamp', async () => {
      // Create two annotations
      for (const text of ['first', 'second']) {
        const req = mockRequest('POST', '/__inline-review/api/annotations', {
          type: 'text',
          pageUrl: '/',
          selectedText: text,
          note: '',
          range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
        });
        const res = mockResponse();
        await middleware(req as any, res as any, () => {});
      }

      const req = mockRequest('GET', '/__inline-review/api/version');
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      const data = JSON.parse(res._body);
      expect(data.fingerprint).toMatch(/^2:/);
      // Timestamp portion should be an ISO string
      const timestamp = data.fingerprint.split(':').slice(1).join(':');
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    it('fingerprint changes when an annotation is updated', async () => {
      // Create an annotation
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        selectedText: 'test',
        note: 'original',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // Get initial fingerprint
      const versionReq1 = mockRequest('GET', '/__inline-review/api/version');
      const versionRes1 = mockResponse();
      await middleware(versionReq1 as any, versionRes1 as any, () => {});
      const fp1 = JSON.parse(versionRes1._body).fingerprint;

      // Update the annotation (with a small delay to ensure different timestamp)
      await new Promise(r => setTimeout(r, 10));
      const updateReq = mockRequest('PATCH', `/__inline-review/api/annotations/${created.id}`, {
        status: 'addressed',
      });
      const updateRes = mockResponse();
      await middleware(updateReq as any, updateRes as any, () => {});

      // Get new fingerprint
      const versionReq2 = mockRequest('GET', '/__inline-review/api/version');
      const versionRes2 = mockResponse();
      await middleware(versionReq2 as any, versionRes2 as any, () => {});
      const fp2 = JSON.parse(versionRes2._body).fingerprint;

      expect(fp1).not.toBe(fp2);
    });

    it('fingerprint includes page notes in count', async () => {
      // Create an annotation
      const annotationReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        selectedText: 'test',
        note: '',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
      });
      const annotationRes = mockResponse();
      await middleware(annotationReq as any, annotationRes as any, () => {});

      // Create a page note
      const noteReq = mockRequest('POST', '/__inline-review/api/page-notes', {
        pageUrl: '/',
        note: 'a page note',
      });
      const noteRes = mockResponse();
      await middleware(noteReq as any, noteRes as any, () => {});

      const req = mockRequest('GET', '/__inline-review/api/version');
      const res = mockResponse();
      await middleware(req as any, res as any, () => {});

      const data = JSON.parse(res._body);
      expect(data.fingerprint).toMatch(/^2:/);
    });

    it('fingerprint changes when an annotation is deleted', async () => {
      // Create an annotation
      const createReq = mockRequest('POST', '/__inline-review/api/annotations', {
        type: 'text',
        pageUrl: '/',
        selectedText: 'delete me',
        note: '',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: '', contextBefore: '', contextAfter: '' },
      });
      const createRes = mockResponse();
      await middleware(createReq as any, createRes as any, () => {});
      const created = JSON.parse(createRes._body);

      // Get fingerprint with 1 annotation
      const versionReq1 = mockRequest('GET', '/__inline-review/api/version');
      const versionRes1 = mockResponse();
      await middleware(versionReq1 as any, versionRes1 as any, () => {});
      const fp1 = JSON.parse(versionRes1._body).fingerprint;

      // Delete the annotation
      const deleteReq = mockRequest('DELETE', `/__inline-review/api/annotations/${created.id}`);
      const deleteRes = mockResponse();
      await middleware(deleteReq as any, deleteRes as any, () => {});

      // Get fingerprint after deletion
      const versionReq2 = mockRequest('GET', '/__inline-review/api/version');
      const versionRes2 = mockResponse();
      await middleware(versionReq2 as any, versionRes2 as any, () => {});
      const fp2 = JSON.parse(versionRes2._body).fingerprint;

      expect(fp1).not.toBe(fp2);
      expect(fp2).toBe('0:');
    });
  });
});
