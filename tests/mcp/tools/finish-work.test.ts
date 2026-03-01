import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { ReviewStorage } from '../../../src/server/storage.js';
import { createEmptyStore } from '../../../src/shared/types.js';
import type { ReviewStore } from '../../../src/shared/types.js';
import { finishWorkHandler } from '../../../src/mcp/tools/finish-work.js';
import { makeTextAnnotation, makeElementAnnotation } from '../helpers/fixtures.js';

const TEST_DIR = join(tmpdir(), 'air-mcp-finish-work-' + Date.now());
const TEST_FILE = join(TEST_DIR, 'store.json');

describe('finish_work handler', () => {
  let storage: ReviewStorage;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
    storage = new ReviewStorage(TEST_FILE);
  });

  afterEach(() => {
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  });

  // ── Basic addressed behaviour ──────────────────────────────────────

  it('marks annotation as addressed', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'ann1' });

    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('addressed');
  });

  it('sets addressedAt timestamp', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'ann1' });

    const data = JSON.parse(result.content[0].text);
    expect(data.addressedAt).toBeDefined();
    expect(new Date(data.addressedAt).toISOString()).toBe(data.addressedAt);
  });

  it('updates updatedAt timestamp', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'ann1' });

    const data = JSON.parse(result.content[0].text);
    expect(data.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('persists the status change to the JSON file', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    await finishWorkHandler(storage, { id: 'ann1' });

    const persisted = await storage.read();
    expect(persisted.annotations[0].status).toBe('addressed');
    expect(persisted.annotations[0].addressedAt).toBeDefined();
  });

  // ── anchorText parameter ───────────────────────────────────────────

  it('sets replacedText when anchorText is provided on text annotation', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'old text', 'fix this')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'ann1', anchorText: 'new text' });

    const data = JSON.parse(result.content[0].text);
    expect(data.replacedText).toBe('new text');
    expect(data.status).toBe('addressed');
  });

  it('returns error when anchorText is used on element annotation', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeElementAnnotation('el1', '/', 'fix element')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'el1', anchorText: 'some text' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not a text annotation');
  });

  it('returns error when anchorText is empty', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'ann1', anchorText: '  ' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('anchorText must not be empty');
  });

  it('persists anchorText as replacedText in the JSON file', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'old text', 'fix this')],
    };
    await storage.write(store);

    await finishWorkHandler(storage, { id: 'ann1', anchorText: 'new text' });

    const persisted = await storage.read();
    const annotation = persisted.annotations[0];
    expect(annotation.type).toBe('text');
    if (annotation.type === 'text') {
      expect(annotation.replacedText).toBe('new text');
    }
  });

  // ── message parameter ──────────────────────────────────────────────

  it('adds agent reply when message is provided', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'ann1', message: 'Fixed the typo' });

    const data = JSON.parse(result.content[0].text);
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0].message).toBe('Fixed the typo');
    expect(data.replies[0].role).toBe('agent');
  });

  it('appends to existing replies', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [{
        ...makeTextAnnotation('ann1', '/', 'fix this'),
        replies: [{ message: 'Earlier reply', createdAt: '2026-01-01T00:00:00.000Z' }],
      }],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'ann1', message: 'Second reply' });

    const data = JSON.parse(result.content[0].text);
    expect(data.replies).toHaveLength(2);
    expect(data.replies[0].message).toBe('Earlier reply');
    expect(data.replies[1].message).toBe('Second reply');
  });

  it('returns error when message is empty', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'ann1', message: '  ' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('message must not be empty');
  });

  it('persists the reply to the JSON file', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    await finishWorkHandler(storage, { id: 'ann1', message: 'Done' });

    const persisted = await storage.read();
    expect(persisted.annotations[0].replies).toHaveLength(1);
    expect(persisted.annotations[0].replies![0].message).toBe('Done');
  });

  // ── Combined parameters ────────────────────────────────────────────

  it('handles anchorText and message together', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'old text', 'fix this')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, {
      id: 'ann1',
      anchorText: 'new text',
      message: 'Replaced the text',
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('addressed');
    expect(data.replacedText).toBe('new text');
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0].message).toBe('Replaced the text');
  });

  it('works with no optional parameters', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'ann1' });

    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('addressed');
    expect(data.replacedText).toBeUndefined();
    expect(data.replies).toBeUndefined();
  });

  // ── Error cases ────────────────────────────────────────────────────

  it('returns error for non-existent ID', async () => {
    const result = await finishWorkHandler(storage, { id: 'nonexistent' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('works with element annotations (no anchorText)', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeElementAnnotation('el1', '/', 'fix element')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'el1', message: 'Fixed it' });

    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('addressed');
    expect(data.replies).toHaveLength(1);
    expect(data.replies[0].message).toBe('Fixed it');
  });

  it('sets reply createdAt to a valid ISO 8601 timestamp', async () => {
    const store: ReviewStore = {
      ...createEmptyStore(),
      annotations: [makeTextAnnotation('ann1', '/', 'fix this')],
    };
    await storage.write(store);

    const result = await finishWorkHandler(storage, { id: 'ann1', message: 'Done' });

    const data = JSON.parse(result.content[0].text);
    const createdAt = data.replies[0].createdAt;
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
  });
});
