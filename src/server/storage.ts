import { readFile, writeFile, rename } from 'node:fs/promises';
import type { ReviewStore, Annotation } from '../types.js';
import { createEmptyStore } from '../types.js';

/**
 * Simple JSON file storage with atomic writes.
 *
 * Uses a write queue to prevent concurrent writes from corrupting the file.
 * Reads are always from disk (no in-memory cache) so the file can be
 * edited externally and changes are picked up immediately.
 */
export class ReviewStorage {
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async read(): Promise<ReviewStore> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as ReviewStore;

      // Basic shape validation
      if (data.version !== 1 || !Array.isArray(data.annotations) || !Array.isArray(data.pageNotes)) {
        return createEmptyStore();
      }

      // Migration: annotations without a `type` field are legacy text annotations
      // Also validate required fields and filter out corrupt entries
      data.annotations = (data.annotations as unknown[])
        .map((raw) => {
          const a = raw as Record<string, unknown>;
          if (!a.type) {
            return { ...a, type: 'text' } as Record<string, unknown>;
          }
          return a as Record<string, unknown>;
        })
        .filter((a) => {
          if (typeof a.id === 'string' && typeof a.pageUrl === 'string' && typeof a.note === 'string') {
            return true;
          }
          console.warn(
            `[review-loop] Filtering invalid annotation (missing id, pageUrl, or note):`,
            JSON.stringify(a),
          );
          return false;
        }) as unknown as Annotation[];

      return data;
    } catch (err) {
      // ENOENT is expected when the file doesn't exist yet
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return createEmptyStore();
      }
      // Parse errors or other I/O failures — warn so data loss is debuggable
      console.warn(
        `[review-loop] Failed to read ${this.filePath}: ${err instanceof Error ? err.message : err}`,
      );
      return createEmptyStore();
    }
  }

  async write(store: ReviewStore): Promise<void> {
    // Queue writes to prevent concurrent file corruption
    let error: unknown;
    this.writeQueue = this.writeQueue
      .then(async () => {
        const json = JSON.stringify(store, null, 2) + '\n';
        const tmpPath = this.filePath + '.tmp';
        await writeFile(tmpPath, json, 'utf-8');
        await rename(tmpPath, this.filePath);
      })
      .catch((err) => {
        error = err;
      });
    await this.writeQueue;
    if (error !== undefined) throw error;
  }

  /**
   * Atomically read-modify-write the store.
   *
   * Serialises with the write queue so that concurrent mutations
   * are applied sequentially — no lost updates. If `fn` throws,
   * the store is not written and the error propagates.
   */
  async mutate(fn: (store: ReviewStore) => ReviewStore | Promise<ReviewStore>): Promise<ReviewStore> {
    let result!: ReviewStore;
    let error: unknown;

    this.writeQueue = this.writeQueue
      .then(async () => {
        const store = await this.read();
        const modified = await fn(store);
        const json = JSON.stringify(modified, null, 2) + '\n';
        const tmpPath = this.filePath + '.tmp';
        await writeFile(tmpPath, json, 'utf-8');
        await rename(tmpPath, this.filePath);
        result = modified;
      })
      .catch((err) => {
        error = err;
      });

    await this.writeQueue;
    if (error !== undefined) throw error;
    return result;
  }
}
