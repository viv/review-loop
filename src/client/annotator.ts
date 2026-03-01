/**
 * Core annotation orchestrator.
 *
 * Coordinates text selection detection, element annotation (Alt+click),
 * inspector overlay, popup display, highlight injection, and API persistence.
 * This is the central "controller" that ties together selection.ts,
 * element-selector.ts, highlights.ts, popup.ts, and api.ts.
 */

import { serializeRange, deserializeRange, findRangeByContext, findRangeByContextSeam } from './selection.js';
import {
  applyHighlight,
  removeHighlight,
  getHighlightMarks,
  HIGHLIGHT_ATTR,
  applyElementHighlight,
  removeElementHighlight,
  removeAllElementHighlights,
  ELEMENT_HIGHLIGHT_ATTR,
} from './highlights.js';
import {
  createPopup,
  showPopup,
  showEditPopup,
  showElementPopup,
  showEditElementPopup,
  showInProgressPopup,
  showAddressedPopup,
  hidePopup,
  isPopupVisible,
  type PopupElements,
} from './ui/popup.js';
import { buildElementSelector, resolveElement } from './element-selector.js';
import { api } from './api.js';
import { writeCache, readCache } from './cache.js';
import { updateBadge } from './ui/fab.js';
import { showToast } from './ui/toast.js';
import { Z_INDEX } from './styles.js';
import { isTextAnnotation, isElementAnnotation, getAnnotationStatus } from './types.js';
import type { SerializedRange, ElementSelector } from './types.js';
import type { ReviewMediator } from './mediator.js';

export interface AnnotatorDeps {
  shadowRoot: ShadowRoot;
  badge: HTMLSpanElement;
  mediator: ReviewMediator;
}

/** State captured from an active popup, serialisable to sessionStorage. */
export interface PendingPopupState {
  type: 'text' | 'element';
  note: string;
  selectedText?: string;
  serializedRange?: SerializedRange;
  elementSelector?: ElementSelector;
}

export interface AnnotatorInstance {
  /** Restore highlights from stored annotations for the current page */
  restoreHighlights: () => Promise<void>;
  /** Clean up event listeners */
  destroy: () => void;
  /** Popup elements for external hide/visibility checks */
  popup: PopupElements;
  /** Capture the current popup state for persistence across reloads */
  getPendingState: () => PendingPopupState | null;
  /** Restore a previously captured popup state. Returns true on success. */
  restorePendingState: (state: PendingPopupState) => boolean;
}

/**
 * Initialise the annotator — sets up selection detection, element annotation,
 * inspector overlay, popup, and highlight management.
 */
export function createAnnotator(deps: AnnotatorDeps): AnnotatorInstance {
  const { shadowRoot, badge, mediator } = deps;
  const popup: PopupElements = createPopup(shadowRoot);

  // Track current selection for creating new text annotations
  let currentRange: Range | null = null;

  // Inspector mode state (Alt+hover)
  let inspectorActive = false;
  let inspectedElement: Element | null = null;
  let inspectorOverlay: HTMLDivElement | null = null;
  let inspectorLabel: HTMLDivElement | null = null;

  // Track element target for element annotation save flow
  let currentElementTarget: Element | null = null;

  // Track scroll position when popup was shown (for scroll-threshold dismissal)
  let popupScrollY: number | null = null;

  // Grace period: don't dismiss the popup within this window of it being shown.
  // Avoids race between deferred focus (requestAnimationFrame) and scroll events.
  const POPUP_GRACE_MS = 400;
  let popupShownAt = 0;

  // Track annotations that have been re-anchored this session to avoid redundant PATCHes
  const reanchoredIds = new Set<string>();

  // --- Text Selection Detection ---

  function onMouseUp(e: MouseEvent): void {
    // Alt+click is handled by onClickCapture — skip here
    if (e.altKey) return;

    // Ignore clicks inside the Shadow DOM host
    const host = shadowRoot.host;
    if (host.contains(e.target as Node) || e.target === host) return;

    // Check if user clicked on an existing text highlight
    const target = e.target as HTMLElement;
    if (target.tagName === 'MARK' && target.hasAttribute(HIGHLIGHT_ATTR)) {
      handleHighlightClick(target);
      return;
    }

    // Check if user clicked on an annotated element (element highlight)
    const annotatedEl = findAnnotatedAncestor(target);
    if (annotatedEl) {
      handleElementHighlightClick(annotatedEl);
      return;
    }

    // Check for text selection
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const text = range.toString().trim();

    // Ignore whitespace-only selections
    if (!text) return;

    // Ignore selections inside the Shadow DOM
    // Note: host.contains() doesn't see into the shadow root — need both checks
    if (host.contains(range.commonAncestorContainer) ||
        shadowRoot.contains(range.commonAncestorContainer)) return;

    currentRange = range.cloneRange();
    popupScrollY = window.scrollY;
    popupShownAt = Date.now();

    const rect = range.getBoundingClientRect();
    showPopup(popup, text, rect, {
      onSave: (note) => handleSave(note),
      onCancel: () => {
        hidePopup(popup);
        currentRange = null;
        selection.removeAllRanges();
      },
    });
  }

  function onScroll(): void {
    if (isPopupVisible(popup) && popupScrollY !== null) {
      if (Math.abs(window.scrollY - popupScrollY) > 50) {
        // Don't dismiss if textarea has unsaved content
        if (popup.textarea.value.trim()) return;
        // Don't dismiss if user is actively interacting with the popup
        if (popup.container.contains(shadowRoot.activeElement)) return;
        // Don't dismiss during grace period after popup was shown.
        // Focus is set via requestAnimationFrame so scroll events can
        // race ahead of the focus call, making the activeElement check
        // unreliable in the first few hundred milliseconds.
        if (Date.now() - popupShownAt < POPUP_GRACE_MS) return;
        hidePopup(popup);
        currentRange = null;
        currentElementTarget = null;
        popupScrollY = null;
      }
    }
  }

  // --- Inspector Mode (Alt+hover) ---

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Alt') return;
    inspectorActive = true;
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.key !== 'Alt') return;
    inspectorActive = false;
    inspectedElement = null;
    destroyInspector();
  }

  function onMouseMove(e: MouseEvent): void {
    if (!inspectorActive) return;

    const target = e.target as Element;
    const host = shadowRoot.host;

    // Don't inspect the shadow DOM host or its contents
    if (target === host || host.contains(target)) {
      if (inspectedElement) {
        inspectedElement = null;
        destroyInspector();
      }
      return;
    }

    // Don't inspect body/html
    if (target === document.body || target === document.documentElement) {
      if (inspectedElement) {
        inspectedElement = null;
        destroyInspector();
      }
      return;
    }

    // Don't inspect the inspector overlay itself
    if (inspectorOverlay?.contains(target)) return;

    // Same element — no update needed
    if (target === inspectedElement) return;

    inspectedElement = target;
    updateInspector(target);
  }

  function createInspectorElements(): void {
    inspectorOverlay = document.createElement('div');
    inspectorOverlay.setAttribute('data-air-el', 'inspector-overlay');
    inspectorOverlay.style.cssText = [
      'position: fixed',
      'pointer-events: none',
      'background: rgba(66, 133, 244, 0.15)',
      'border: 2px solid rgba(66, 133, 244, 0.6)',
      'border-radius: 2px',
      `z-index: ${Z_INDEX.inspector}`,
      'transition: all 0.1s ease',
    ].join('; ');

    inspectorLabel = document.createElement('div');
    inspectorLabel.setAttribute('data-air-el', 'inspector-label');
    inspectorLabel.style.cssText = [
      'position: absolute',
      'top: -22px',
      'left: -2px',
      'background: rgba(66, 133, 244, 0.9)',
      'color: white',
      'font-size: 11px',
      'font-family: monospace',
      'padding: 1px 6px',
      'border-radius: 2px 2px 0 0',
      'white-space: nowrap',
      'pointer-events: none',
      'max-width: 400px',
      'overflow: hidden',
      'text-overflow: ellipsis',
    ].join('; ');

    inspectorOverlay.appendChild(inspectorLabel);
    document.body.appendChild(inspectorOverlay);
  }

  function updateInspector(element: Element): void {
    if (!inspectorOverlay) createInspectorElements();

    const rect = element.getBoundingClientRect();
    inspectorOverlay!.style.top = `${rect.top}px`;
    inspectorOverlay!.style.left = `${rect.left}px`;
    inspectorOverlay!.style.width = `${rect.width}px`;
    inspectorOverlay!.style.height = `${rect.height}px`;

    // Generate label text
    const tag = element.tagName.toLowerCase();
    let label = tag;
    if (element.id) {
      label = `${tag}#${element.id}`;
    } else if (element.classList.length > 0) {
      label = `${tag}.${element.classList[0]}`;
    }
    inspectorLabel!.textContent = label;
  }

  function destroyInspector(): void {
    if (inspectorOverlay) {
      inspectorOverlay.remove();
      inspectorOverlay = null;
      inspectorLabel = null;
    }
  }

  // --- Alt+Click (Element Annotation) ---

  function onClickCapture(e: MouseEvent): void {
    if (!e.altKey) return;

    // Prevent default (e.g. macOS Alt+click downloads links)
    e.preventDefault();
    e.stopPropagation();

    // Ignore if popup is already visible
    if (isPopupVisible(popup)) return;

    const target = e.target as Element;
    const host = shadowRoot.host;

    // Ignore clicks on shadow DOM host
    if (target === host || host.contains(target)) return;

    // Ignore clicks on body/html
    if (target === document.body || target === document.documentElement) return;

    // Clean up inspector
    inspectorActive = false;
    inspectedElement = null;
    destroyInspector();

    // Store element target for save flow
    currentElementTarget = target;
    popupScrollY = window.scrollY;
    popupShownAt = Date.now();

    // Build element description for popup
    const selector = buildElementSelector(target);
    const rect = target.getBoundingClientRect();

    showElementPopup(popup, selector.description, rect, {
      onSave: (note) => handleElementSave(note),
      onCancel: () => {
        hidePopup(popup);
        currentElementTarget = null;
      },
    });
  }

  // --- Save New Text Annotation ---

  async function handleSave(note: string): Promise<void> {
    if (!currentRange) return;

    // Capture range locally before any async work
    const range = currentRange;
    currentRange = null;

    const selectedText = range.toString();
    const serialized = serializeRange(range);

    hidePopup(popup);

    try {
      const annotation = await api.createAnnotation({
        type: 'text',
        pageUrl: window.location.pathname,
        pageTitle: document.title,
        selectedText,
        note,
        range: serialized,
      });

      applyHighlight(range, annotation.id);

      if (getHighlightMarks(annotation.id).length === 0) {
        const fallbackRange = findRangeByContext(
          serialized.selectedText,
          serialized.contextBefore,
          serialized.contextAfter,
        );
        if (fallbackRange) {
          applyHighlight(fallbackRange, annotation.id);
        }
      }

      await refreshCacheAndBadge();
    } catch (err) {
      console.error('[review-loop] Failed to save annotation:', err);
      showToast(shadowRoot, 'Failed to save annotation');
    }

    window.getSelection()?.removeAllRanges();
  }

  // --- Save New Element Annotation ---

  async function handleElementSave(note: string): Promise<void> {
    if (!currentElementTarget) return;

    const element = currentElementTarget;
    currentElementTarget = null;

    const elementSelector = buildElementSelector(element);

    hidePopup(popup);

    try {
      const annotation = await api.createAnnotation({
        type: 'element',
        pageUrl: window.location.pathname,
        pageTitle: document.title,
        note,
        elementSelector,
      });

      applyElementHighlight(element, annotation.id);
      await refreshCacheAndBadge();
    } catch (err) {
      console.error('[review-loop] Failed to save element annotation:', err);
      showToast(shadowRoot, 'Failed to save annotation');
    }
  }

  // --- Edit Existing Text Annotation ---

  async function handleHighlightClick(mark: HTMLElement): Promise<void> {
    const annotationId = mark.getAttribute(HIGHLIGHT_ATTR);
    if (!annotationId) return;

    // Fetch current annotation data
    const store = readCache() ?? await api.getStore(window.location.pathname);
    const annotation = store.annotations.find(a => a.id === annotationId);
    if (!annotation || !isTextAnnotation(annotation)) return;

    popupScrollY = window.scrollY;
    popupShownAt = Date.now();
    const rect = mark.getBoundingClientRect();
    const status = getAnnotationStatus(annotation);
    const previewText = `"${annotation.selectedText}"`;
    const latestReply = annotation.replies?.length ? annotation.replies[annotation.replies.length - 1] : undefined;

    if (status === 'in_progress') {
      showInProgressPopup(popup, previewText, annotation.note, rect, {
        onCancel: () => hidePopup(popup),
      }, latestReply);
    } else if (status === 'addressed') {
      showAddressedPopup(popup, previewText, annotation.note, rect, {
        onAccept: async () => {
          hidePopup(popup);
          try {
            await api.deleteAnnotation(annotationId);
            removeHighlight(annotationId);
            await refreshCacheAndBadge();
          } catch (err) {
            console.error('[review-loop] Failed to accept annotation:', err);
            showToast(shadowRoot, 'Failed to accept annotation');
          }
        },
        onReopen: async (message?: string) => {
          hidePopup(popup);
          try {
            await api.updateAnnotation(annotationId, { status: 'open' });
            if (message) {
              await api.updateAnnotation(annotationId, { reply: { message, role: 'reviewer' } } as Partial<import('./types.js').Annotation>);
            }
            await restoreHighlights();
          } catch (err) {
            console.error('[review-loop] Failed to reopen annotation:', err);
            showToast(shadowRoot, 'Failed to reopen annotation');
          }
        },
        onCancel: () => hidePopup(popup),
      }, latestReply);
    } else {
      // status === 'open'
      showEditPopup(popup, annotation.selectedText, annotation.note, rect, {
        onSave: async (newNote) => {
          hidePopup(popup);
          try {
            await api.updateAnnotation(annotationId, { note: newNote });
            await refreshCacheAndBadge();
          } catch (err) {
            console.error('[review-loop] Failed to update annotation:', err);
            showToast(shadowRoot, 'Failed to update annotation');
          }
        },
        onCancel: () => hidePopup(popup),
        onDelete: async () => {
          hidePopup(popup);
          try {
            await api.deleteAnnotation(annotationId);
            removeHighlight(annotationId);
            await refreshCacheAndBadge();
          } catch (err) {
            console.error('[review-loop] Failed to delete annotation:', err);
            showToast(shadowRoot, 'Failed to delete annotation');
          }
        },
      });
    }
  }

  // --- Edit Existing Element Annotation ---

  async function handleElementHighlightClick(element: HTMLElement): Promise<void> {
    const annotationId = element.getAttribute(ELEMENT_HIGHLIGHT_ATTR);
    if (!annotationId) return;

    const store = readCache() ?? await api.getStore(window.location.pathname);
    const annotation = store.annotations.find(a => a.id === annotationId);
    if (!annotation || !isElementAnnotation(annotation)) return;

    popupScrollY = window.scrollY;
    popupShownAt = Date.now();
    const rect = element.getBoundingClientRect();
    const status = getAnnotationStatus(annotation);
    const description = annotation.elementSelector.description;
    const latestReply = annotation.replies?.length ? annotation.replies[annotation.replies.length - 1] : undefined;

    if (status === 'in_progress') {
      showInProgressPopup(popup, description, annotation.note, rect, {
        onCancel: () => hidePopup(popup),
      }, latestReply);
    } else if (status === 'addressed') {
      showAddressedPopup(popup, description, annotation.note, rect, {
        onAccept: async () => {
          hidePopup(popup);
          try {
            await api.deleteAnnotation(annotationId);
            removeElementHighlight(annotationId);
            await refreshCacheAndBadge();
          } catch (err) {
            console.error('[review-loop] Failed to accept element annotation:', err);
            showToast(shadowRoot, 'Failed to accept annotation');
          }
        },
        onReopen: async (message?: string) => {
          hidePopup(popup);
          try {
            await api.updateAnnotation(annotationId, { status: 'open' });
            if (message) {
              await api.updateAnnotation(annotationId, { reply: { message, role: 'reviewer' } } as Partial<import('./types.js').Annotation>);
            }
            await restoreHighlights();
          } catch (err) {
            console.error('[review-loop] Failed to reopen element annotation:', err);
            showToast(shadowRoot, 'Failed to reopen annotation');
          }
        },
        onCancel: () => hidePopup(popup),
      }, latestReply);
    } else {
      // status === 'open'
      showEditElementPopup(popup, description, annotation.note, rect, {
        onSave: async (newNote) => {
          hidePopup(popup);
          try {
            await api.updateAnnotation(annotationId, { note: newNote });
            await refreshCacheAndBadge();
          } catch (err) {
            console.error('[review-loop] Failed to update element annotation:', err);
            showToast(shadowRoot, 'Failed to update annotation');
          }
        },
        onCancel: () => hidePopup(popup),
        onDelete: async () => {
          hidePopup(popup);
          removeElementHighlight(annotationId);
          try {
            await api.deleteAnnotation(annotationId);
            await refreshCacheAndBadge();
          } catch (err) {
            console.error('[review-loop] Failed to delete element annotation:', err);
            showToast(shadowRoot, 'Failed to delete annotation');
          }
        },
      });
    }
  }

  // --- Helpers ---

  /**
   * Walk up from an element to find the closest ancestor with
   * a data-air-element-id attribute (annotated element).
   */
  function findAnnotatedAncestor(el: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = el;
    while (current && current !== document.body && current !== document.documentElement) {
      if (current.hasAttribute(ELEMENT_HIGHLIGHT_ATTR)) return current;
      current = current.parentElement;
    }
    return null;
  }

  // --- Restore Highlights ---

  async function restoreHighlights(): Promise<void> {
    // Remove existing text highlights
    const existingMarks = document.querySelectorAll(`mark[${HIGHLIGHT_ATTR}]`);
    for (const mark of existingMarks) {
      const id = mark.getAttribute(HIGHLIGHT_ATTR)!;
      removeHighlight(id);
    }

    // Remove existing element highlights
    removeAllElementHighlights();

    try {
      const store = await api.getStore(window.location.pathname);
      writeCache(store);

      const pageAnnotations = store.annotations.filter(
        a => a.pageUrl === window.location.pathname,
      );

      // Restore text highlights
      const textAnnotations = pageAnnotations.filter(isTextAnnotation);
      for (const annotation of textAnnotations) {
        const status = getAnnotationStatus(annotation);
        let needsReanchor = false;

        // Tier 1: Try XPath + offset
        let range = deserializeRange(annotation.range);

        // Tier 2: Fall back to context matching with original text
        if (!range) {
          range = findRangeByContext(
            annotation.range.selectedText,
            annotation.range.contextBefore,
            annotation.range.contextAfter,
          );
        }

        // Tier 2.5: Try context matching with replacement text
        if (!range && annotation.replacedText) {
          range = findRangeByContext(
            annotation.replacedText,
            annotation.range.contextBefore,
            annotation.range.contextAfter,
          );
          if (range) needsReanchor = true;
        }

        // Tier 3: Context-seam — find where contextBefore and contextAfter
        // meet, even if the annotated text has been completely rewritten
        if (!range) {
          range = findRangeByContextSeam(
            annotation.range.contextBefore,
            annotation.range.contextAfter,
          );
          if (range) needsReanchor = true;
        }

        // Tier 4: Orphaned — no highlight, visible only in panel
        if (range) {
          applyHighlight(range, annotation.id, status);

          // Re-anchor: update stored range data so future restores use Tier 1
          if (needsReanchor && !reanchoredIds.has(annotation.id)) {
            reanchoredIds.add(annotation.id);
            const freshRange = serializeRange(range);
            api.reanchorAnnotation(
              annotation.id,
              freshRange,
              !!annotation.replacedText,
            ).catch(err => {
              console.error('[review-loop] Failed to re-anchor annotation:', err);
            });
          }
        }
      }

      // Restore element highlights
      const elementAnnotations = pageAnnotations.filter(isElementAnnotation);
      for (const annotation of elementAnnotations) {
        const element = resolveElement(annotation.elementSelector);
        if (element) {
          applyElementHighlight(element, annotation.id, getAnnotationStatus(annotation));
        }
      }

      // Update badge with current page count
      updateBadge(badge, pageAnnotations.length);
    } catch (err) {
      console.error('[review-loop] Failed to restore highlights:', err);
      showToast(shadowRoot, 'Failed to load annotations');
      // Try cache fallback
      const cached = readCache();
      if (cached) {
        const pageCount = cached.annotations.filter(
          a => a.pageUrl === window.location.pathname,
        ).length;
        updateBadge(badge, pageCount);
      }
    }
  }

  // --- Popup State Persistence ---

  function getPendingState(): PendingPopupState | null {
    if (!isPopupVisible(popup)) return null;

    if (currentRange) {
      return {
        type: 'text',
        note: popup.textarea.value,
        selectedText: currentRange.toString(),
        serializedRange: serializeRange(currentRange),
      };
    }

    if (currentElementTarget) {
      return {
        type: 'element',
        note: popup.textarea.value,
        elementSelector: buildElementSelector(currentElementTarget),
      };
    }

    return null;
  }

  function restorePendingState(state: PendingPopupState): boolean {
    if (state.type === 'text' && state.serializedRange) {
      // Tier 1: XPath + offset
      let range = deserializeRange(state.serializedRange);

      // Tier 2: context matching
      if (!range) {
        range = findRangeByContext(
          state.serializedRange.selectedText,
          state.serializedRange.contextBefore,
          state.serializedRange.contextAfter,
        );
      }

      if (!range) {
        const msg = state.note
          ? `Could not restore selection. Your note: ${state.note}`
          : 'Could not restore selection after reload';
        showToast(shadowRoot, msg, 6000);
        return false;
      }

      currentRange = range;
      popupScrollY = window.scrollY;
      popupShownAt = Date.now();

      const rect = range.getBoundingClientRect();
      showPopup(popup, state.selectedText ?? range.toString(), rect, {
        onSave: (note) => handleSave(note),
        onCancel: () => {
          hidePopup(popup);
          currentRange = null;
          window.getSelection()?.removeAllRanges();
        },
      });
      popup.textarea.value = state.note;
      return true;
    }

    if (state.type === 'element' && state.elementSelector) {
      const element = resolveElement(state.elementSelector);

      if (!element) {
        const msg = state.note
          ? `Could not restore element. Your note: ${state.note}`
          : 'Could not restore element after reload';
        showToast(shadowRoot, msg, 6000);
        return false;
      }

      currentElementTarget = element;
      popupScrollY = window.scrollY;
      popupShownAt = Date.now();

      const rect = element.getBoundingClientRect();
      showElementPopup(popup, state.elementSelector.description, rect, {
        onSave: (note) => handleElementSave(note),
        onCancel: () => {
          hidePopup(popup);
          currentElementTarget = null;
        },
      });
      popup.textarea.value = state.note;
      return true;
    }

    return false;
  }

  // Wire up mediator so the panel can trigger highlight restoration
  mediator.restoreHighlights = restoreHighlights;

  // --- Badge Refresh ---

  async function refreshCacheAndBadge(): Promise<void> {
    try {
      const store = await api.getStore(window.location.pathname);
      writeCache(store);
      const pageCount = store.annotations.filter(
        a => a.pageUrl === window.location.pathname,
      ).length;
      updateBadge(badge, pageCount);
    } catch {
      // Ignore — badge stays at last known count
    }
  }

  // --- Event Listeners ---

  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('click', onClickCapture, true); // Capture phase

  // --- Cleanup ---

  function destroy(): void {
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('scroll', onScroll);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('click', onClickCapture, true);
    destroyInspector();
  }

  return { restoreHighlights, destroy, popup, getPendingState, restorePendingState };
}
