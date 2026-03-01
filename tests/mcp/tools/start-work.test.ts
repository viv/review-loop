import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { ReviewStorage } from '../../../src/server/storage.js';
import { createEmptyStore } from '../../../src/shared/types.js';
import type { ReviewStore } from '../../../src/shared/types.js';
import { startWorkHandler } from '../../../src/mcp/tools/start-work.js';
import { makeTextAnnotation, makeElementAnnotation } from '../helpers/fixtures.js';

const TEST_DIR = join(tmpdir(), 'air-mcp-start-work-' + Date.now());
const TEST_FILE = join(TEST_DIR, 'store.json');

describe('start_work handler', () => {
  let storage: ReviewStorage;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
    storage = new ReviewStorage(TEST_FILE);
  });

  afterEach(() => {
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  });

  it('returns full annotation detail', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'hello world', 'fix this')],
    };
    await storage.write(store);

    const result = await startWorkHandler(storage, { id: 'ann1' });

    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe('ann1');
    expect(data.selectedText).toBe('hello world');
    expect(data.note).toBe('fix this');
    expect(data.range).toBeDefined();
  });

  it('sets status to in_progress', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    const result = await startWorkHandler(storage, { id: 'ann1' });

    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('in_progress');
  });

  it('sets inProgressAt timestamp', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    const result = await startWorkHandler(storage, { id: 'ann1' });

    const data = JSON.parse(result.content[0].text);
    expect(data.inProgressAt).toBeDefined();
    expect(new Date(data.inProgressAt).toISOString()).toBe(data.inProgressAt);
  });

  it('updates updatedAt timestamp', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    const result = await startWorkHandler(storage, { id: 'ann1' });

    const data = JSON.parse(result.content[0].text);
    expect(data.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('persists the status change to the JSON file', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    await startWorkHandler(storage, { id: 'ann1' });

    const persisted = await storage.read();
    expect(persisted.annotations[0].status).toBe('in_progress');
    expect(persisted.annotations[0].inProgressAt).toBeDefined();
  });

  it('returns error for non-existent ID', async () => {
    const result = await startWorkHandler(storage, { id: 'nonexistent' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('works with element annotations', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeElementAnnotation('el1', '/', 'fix this element')],
    };
    await storage.write(store);

    const result = await startWorkHandler(storage, { id: 'el1' });

    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe('el1');
    expect(data.type).toBe('element');
    expect(data.status).toBe('in_progress');
    expect(data.elementSelector).toBeDefined();
  });

  it('finds annotation among multiple', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [
        makeTextAnnotation('first', '/', 'one', 'note1'),
        makeTextAnnotation('second', '/about', 'two', 'note2'),
        makeTextAnnotation('third', '/contact', 'three', 'note3'),
      ],
    };
    await storage.write(store);

    const result = await startWorkHandler(storage, { id: 'second' });

    const data = JSON.parse(result.content[0].text);
    expect(data.id).toBe('second');
    expect(data.pageUrl).toBe('/about');
    expect(data.status).toBe('in_progress');
  });
});
