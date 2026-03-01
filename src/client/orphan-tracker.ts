/**
 * Tracks orphan state for annotations with a grace period.
 *
 * When an agent edits source code, Vite hot-reloads the page and the
 * annotation temporarily loses its DOM anchor. Rather than immediately
 * showing "Could not locate on page", we wait a grace period to give
 * the store poller time to pick up the agent's finish_work call.
 *
 * Annotations with status 'in_progress' never time out — they stay in
 * 'checking' state until the agent addresses them or the reviewer acts.
 */

import type { AnnotationStatus } from './types.js';

export type OrphanState = 'anchored' | 'orphaned' | 'checking';

/** Default grace period in milliseconds */
const GRACE_PERIOD_MS = 15_000;

export class OrphanTracker {
  /** Map of annotation ID → timestamp when it was first seen as unanchored */
  private orphanedSince = new Map<string, number>();
  /** Set of annotation IDs that have been seen as DOM-anchored at least once */
  private everAnchored = new Set<string>();
  private gracePeriodMs: number;

  constructor(gracePeriodMs = GRACE_PERIOD_MS) {
    this.gracePeriodMs = gracePeriodMs;
  }

  /**
   * Determine the orphan state of an annotation.
   *
   * The grace period only applies to annotations that were previously anchored
   * and then lost their DOM highlight (e.g. after a Vite hot-reload). Annotations
   * that have never been located go straight to 'orphaned' — no point showing
   * "Checking…" for text that was never on the page.
   *
   * @param id - Annotation ID
   * @param pageUrl - The page the annotation belongs to
   * @param isDomAnchored - Whether the annotation has a live DOM highlight
   * @param status - The annotation's current status
   */
  getOrphanState(
    id: string,
    pageUrl: string,
    isDomAnchored: boolean,
    status: AnnotationStatus,
  ): OrphanState {
    // If the DOM highlight exists, the annotation is anchored — clear any orphan tracking
    if (isDomAnchored) {
      this.orphanedSince.delete(id);
      this.everAnchored.add(id);
      return 'anchored';
    }

    // in_progress annotations are always 'checking' — never hard orphan
    if (status === 'in_progress') {
      return 'checking';
    }

    // Never been anchored — go straight to orphaned (no grace period on initial load)
    if (!this.everAnchored.has(id)) {
      return 'orphaned';
    }

    // Was previously anchored — apply grace period
    if (!this.orphanedSince.has(id)) {
      this.orphanedSince.set(id, Date.now());
    }

    const elapsed = Date.now() - this.orphanedSince.get(id)!;
    if (elapsed < this.gracePeriodMs) {
      return 'checking';
    }

    return 'orphaned';
  }

  /**
   * Clear all orphan timestamps. Call this when the store changes externally
   * (e.g. after an agent resolves annotations) so that re-restored annotations
   * get a fresh grace window. Does not clear the everAnchored history — we need
   * to remember which annotations were previously located.
   */
  onStoreChanged(): void {
    this.orphanedSince.clear();
  }
}
