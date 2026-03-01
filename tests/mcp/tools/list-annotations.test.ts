import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { ReviewStorage } from '../../../src/server/storage.js';
import { createEmptyStore } from '../../../src/shared/types.js';
import type { ReviewStore } from '../../../src/shared/types.js';
import { listAnnotationsHandler } from '../../../src/mcp/tools/list-annotations.js';
import { makeTextAnnotation, makeElementAnnotation, makePageNote } from '../helpers/fixtures.js';

const TEST_DIR = join(tmpdir(), 'air-mcp-list-ann-' + Date.now());
const TEST_FILE = join(TEST_DIR, 'store.json');

describe('list_annotations handler', () => {
  let storage: ReviewStorage;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
    storage = new ReviewStorage(TEST_FILE);
  });

  afterEach(() => {
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  });

  it('returns empty arrays when store is empty', async () => {
    const result = await listAnnotationsHandler(storage, {});

    const data = JSON.parse(result.content[0].text);
    expect(data.annotations).toEqual([]);
    expect(data.pageNotes).toEqual([]);
  });

  it('returns all annotations and page notes when no filters', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [
        makeTextAnnotation('1', '/', 'hello', 'note1'),
        makeTextAnnotation('2', '/about', 'world', 'note2'),
      ],
      pageNotes: [
        makePageNote('pn1', '/', 'General feedback'),
        makePageNote('pn2', '/about', 'About page note'),
      ],
    };
    await storage.write(store);

    const result = await listAnnotationsHandler(storage, {});

    const data = JSON.parse(result.content[0].text);
    expect(data.annotations).toHaveLength(2);
    expect(data.pageNotes).toHaveLength(2);
  });

  it('filters annotations by pageUrl', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [
        makeTextAnnotation('1', '/', 'hello', 'note1'),
        makeTextAnnotation('2', '/about', 'world', 'note2'),
        makeTextAnnotation('3', '/about', 'foo', 'note3'),
      ],
      pageNotes: [
        makePageNote('pn1', '/', 'Home note'),
        makePageNote('pn2', '/about', 'About note'),
      ],
    };
    await storage.write(store);

    const result = await listAnnotationsHandler(storage, { pageUrl: '/about' });

    const data = JSON.parse(result.content[0].text);
    expect(data.annotations).toHaveLength(2);
    expect(data.annotations.every((a: any) => a.pageUrl === '/about')).toBe(true);
    expect(data.pageNotes).toHaveLength(1);
    expect(data.pageNotes[0].pageUrl).toBe('/about');
  });

  it('filters annotations by status', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [
        { ...makeTextAnnotation('1', '/', 'hello', 'open note'), status: 'open' },
        { ...makeTextAnnotation('2', '/', 'world', 'in progress note'), status: 'in_progress' },
        { ...makeTextAnnotation('3', '/', 'foo', 'addressed note'), status: 'addressed' },
      ],
    };
    await storage.write(store);

    const result = await listAnnotationsHandler(storage, { status: 'open' });

    const data = JSON.parse(result.content[0].text);
    expect(data.annotations).toHaveLength(1);
    expect(data.annotations[0].id).toBe('1');
  });

  it('filters by both pageUrl and status', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [
        { ...makeTextAnnotation('1', '/', 'a', 'note'), status: 'open' },
        { ...makeTextAnnotation('2', '/about', 'b', 'note'), status: 'open' },
        { ...makeTextAnnotation('3', '/about', 'c', 'note'), status: 'addressed' },
      ],
    };
    await storage.write(store);

    const result = await listAnnotationsHandler(storage, { pageUrl: '/about', status: 'open' });

    const data = JSON.parse(result.content[0].text);
    expect(data.annotations).toHaveLength(1);
    expect(data.annotations[0].id).toBe('2');
  });

  it('handles legacy annotations without status field', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [
        makeTextAnnotation('1', '/', 'hello', 'no status'),
      ],
    };
    await storage.write(store);

    // No status field defaults to 'open' via getAnnotationStatus
    const result = await listAnnotationsHandler(storage, { status: 'open' });

    const data = JSON.parse(result.content[0].text);
    expect(data.annotations).toHaveLength(1);
    expect(data.annotations[0].id).toBe('1');
  });

  it('status filter does not apply to page notes', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [
        { ...makeTextAnnotation('1', '/', 'a', 'note'), status: 'addressed' },
      ],
      pageNotes: [
        makePageNote('pn1', '/', 'Always returned'),
      ],
    };
    await storage.write(store);

    const result = await listAnnotationsHandler(storage, { status: 'open' });

    const data = JSON.parse(result.content[0].text);
    expect(data.annotations).toHaveLength(0);
    // Page notes are not filtered by status
    expect(data.pageNotes).toHaveLength(1);
  });

  it('returns empty arrays when pageUrl filter matches nothing', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('1', '/', 'hello', 'note1')],
      pageNotes: [makePageNote('pn1', '/', 'Home note')],
    };
    await storage.write(store);

    const result = await listAnnotationsHandler(storage, { pageUrl: '/nonexistent' });

    const data = JSON.parse(result.content[0].text);
    expect(data.annotations).toEqual([]);
    expect(data.pageNotes).toEqual([]);
  });

  it('includes element annotations alongside text annotations', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [
        makeTextAnnotation('1', '/', 'hello', 'text note'),
        makeElementAnnotation('2', '/', 'element note'),
      ],
    };
    await storage.write(store);

    const result = await listAnnotationsHandler(storage, {});

    const data = JSON.parse(result.content[0].text);
    expect(data.annotations).toHaveLength(2);
    expect(data.annotations[0].type).toBe('text');
    expect(data.annotations[1].type).toBe('element');
  });

  it('returns content as formatted JSON text', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('1', '/', 'hello', 'note1')],
    };
    await storage.write(store);

    const result = await listAnnotationsHandler(storage, {});

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    // Should be pretty-printed JSON
    expect(result.content[0].text).toContain('\n');
  });
});
