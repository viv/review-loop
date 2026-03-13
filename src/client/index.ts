/**
 * Client entry point — bootstraps the inline review overlay.
 *
 * Creates Shadow DOM host, FAB, panel, annotator, keyboard shortcuts,
 * and loads existing annotations. Idempotent — safe to call multiple times.
 */
import { createHost } from './ui/host.js';
import { createFab, updateBadge, resetFab, openFab, type FabElements } from './ui/fab.js';
import { createPanel, togglePanel, closePanel, isPanelOpen, type PanelElements } from './ui/panel.js';
import { createAnnotator, type AnnotatorInstance, type PendingPopupState } from './annotator.js';
import type { ReviewMediator } from './mediator.js';
import { isPopupVisible, hidePopup } from './ui/popup.js';
import { registerShortcuts } from './shortcuts.js';
import { exportToClipboard } from './export.js';
import { showToast } from './ui/toast.js';
import { api } from './api.js';
import { writeCache } from './cache.js';
import { pulseHighlight, getHighlightMarks, pulseElementHighlight, getElementByAnnotationId, removeHighlight, removeElementHighlight } from './highlights.js';
import { createStorePoller } from './store-poller.js';
import { OrphanTracker } from './orphan-tracker.js';

const SCROLL_TO_KEY = 'air-scroll-to';
const PANEL_STATE_KEY = 'air-panel-state';
const PENDING_POPUP_KEY = 'air-pending-popup';

/** Scroll to and pulse an annotation highlight on the current page. */
function scrollToAnnotation(id: string): void {
  // Try text highlight first
  const marks = getHighlightMarks(id);
  if (marks.length > 0) {
    marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    pulseHighlight(id);
    return;
  }
  // Try element highlight
  const element = getElementByAnnotationId(id);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    pulseElementHighlight(id);
  }
}

// Idempotency guard
const INIT_FLAG = '__review_loop_init';

declare global {
  /** Package version injected at build time by tsup define */
  const __REVIEW_LOOP_VERSION__: string;
  interface Window {
    [INIT_FLAG]?: boolean;
  }
}

function init(): void {
  if (window[INIT_FLAG]) return;
  window[INIT_FLAG] = true;

  const shadowRoot = createHost();

  const refreshBadge = async () => {
    try {
      const store = await api.getStore(window.location.pathname);
      writeCache(store);
      const pageCount = store.annotations.filter(
        a => a.pageUrl === window.location.pathname,
      ).length;
      updateBadge(fab.badge, pageCount);
    } catch {
      // Ignore
    }
  };

  // Typed mediator — createPanel and createAnnotator wire up their
  // implementations; stubs here are replaced before first use.
  const mediator: ReviewMediator = {
    refreshPanel: async () => {},
    restoreHighlights: async () => {},
  };

  const orphanTracker = new OrphanTracker();

  // Tracks whether restoreHighlights() has run at least once.
  // Before highlights are restored, we can't know which annotations are
  // truly orphaned — reporting them as orphaned early causes false positives.
  let highlightsRestored = false;

  // Tracks whether a store change was detected while the popup was active.
  // While true, restoreHighlights() is deferred — DOM highlights are stale.
  let pendingStoreUpdate = false;

  // Panel
  const panel: PanelElements = createPanel(shadowRoot, {
    onAnnotationClick: (id, pageUrl) => {
      // Cross-page navigation: store target and panel state, then navigate
      if (pageUrl !== window.location.pathname) {
        sessionStorage.setItem(SCROLL_TO_KEY, id);
        sessionStorage.setItem(PANEL_STATE_KEY, 'all-pages');
        window.location.href = pageUrl;
        return;
      }

      scrollToAnnotation(id);
    },
    onAnnotationDelete: async (id) => {
      try {
        await api.deleteAnnotation(id);
        removeHighlight(id);
        removeElementHighlight(id);
        await refreshBadge();
        mediator.refreshPanel();
      } catch (err) {
        console.error('[review-loop] Failed to delete annotation:', err);
        showToast(shadowRoot, 'Failed to delete annotation');
      }
    },
    onAnnotationStatusChange: async (id, status, replyMessage?) => {
      try {
        const data: Record<string, unknown> = { status };
        if (replyMessage) {
          data.reply = { message: replyMessage };
        }
        await api.updateAnnotation(id, data as Partial<import('./types.js').Annotation>);
        await mediator.restoreHighlights();
        await refreshBadge();
        mediator.refreshPanel();
      } catch (err) {
        console.error('[review-loop] Failed to update annotation status:', err);
        showToast(shadowRoot, 'Failed to update status');
      }
    },
    getOrphanState: (id, pageUrl, status) => {
      if (pageUrl !== window.location.pathname) return 'anchored';
      // Before highlights have been restored, we can't distinguish truly
      // orphaned annotations from ones that simply haven't been located yet.
      // Return 'anchored' to avoid a flash of false "Could not locate" messages.
      if (!highlightsRestored) return 'anchored';
      // While a store update is deferred (popup active), DOM highlights are
      // stale — don't let orphan states change until restoreHighlights runs.
      if (pendingStoreUpdate) return 'anchored';
      const isDomAnchored = getHighlightMarks(id).length > 0 || !!getElementByAnnotationId(id);
      return orphanTracker.getOrphanState(id, pageUrl, isDomAnchored, status);
    },
    onRefreshBadge: refreshBadge,
    onExport: async () => {
      const store = await api.getStore();
      const success = await exportToClipboard(store);
      showToast(shadowRoot, success ? 'Copied to clipboard!' : 'Export failed — try again');
    },
  }, mediator);

  // FAB
  const fab: FabElements = createFab(shadowRoot, () => {
    const isOpen = togglePanel(panel);
    if (isOpen) {
      sessionStorage.setItem(PANEL_STATE_KEY, 'open');
      // Move focus to first focusable element in panel
      const firstFocusable = panel.container.querySelector<HTMLElement>('button, [tabindex="0"]');
      if (firstFocusable) firstFocusable.focus();
    } else {
      sessionStorage.removeItem(PANEL_STATE_KEY);
      fab.button.focus();
    }
  });

  // First-use tooltip
  const TOOLTIP_KEY = 'air-tooltip-dismissed';
  if (!localStorage.getItem(TOOLTIP_KEY)) {
    const tooltip = document.createElement('div');
    tooltip.className = 'air-tooltip';
    tooltip.setAttribute('data-air-el', 'first-use-tooltip');
    tooltip.id = 'air-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.textContent = 'Select text to annotate it, or Alt+click any element';
    fab.button.setAttribute('aria-describedby', 'air-tooltip');
    shadowRoot.appendChild(tooltip);

    let dismissed = false;
    const dismissTooltip = () => {
      if (dismissed) return;
      dismissed = true;
      tooltip.classList.add('air-tooltip--hidden');
      localStorage.setItem(TOOLTIP_KEY, '1');
      fab.button.removeAttribute('aria-describedby');
      // Remove from DOM after fade-out transition
      setTimeout(() => tooltip.remove(), 300);
    };

    // Auto-dismiss after 8 seconds
    setTimeout(dismissTooltip, 8000);

    // Dismiss on click anywhere
    document.addEventListener('click', dismissTooltip, { once: true });
    shadowRoot.addEventListener('click', dismissTooltip, { once: true });
  }

  // Annotator — selection, highlights, popup
  const annotator: AnnotatorInstance = createAnnotator({
    shadowRoot,
    badge: fab.badge,
    mediator,
  });

  // Keyboard shortcuts
  registerShortcuts({
    togglePanel: () => {
      const isOpen = togglePanel(panel);
      if (isOpen) {
        sessionStorage.setItem(PANEL_STATE_KEY, 'open');
        openFab(fab);
      } else {
        sessionStorage.removeItem(PANEL_STATE_KEY);
        resetFab(fab);
      }
    },
    closeActive: () => {
      // Popup takes precedence over panel
      if (isPopupVisible(annotator.popup)) {
        // Don't dismiss if textarea has unsaved content
        if (annotator.popup.textarea.value.trim()) return true;
        hidePopup(annotator.popup);
        return true;
      }
      if (isPanelOpen(panel)) {
        closePanel(panel);
        sessionStorage.removeItem(PANEL_STATE_KEY);
        resetFab(fab);
        fab.button.focus();
        return true;
      }
      return false;
    },
  });

  // Save pending popup state before page unload (e.g. Vite HMR full reload)
  window.addEventListener('beforeunload', () => {
    if (isPopupVisible(annotator.popup)) {
      const state = annotator.getPendingState();
      if (state) {
        sessionStorage.setItem(PENDING_POPUP_KEY, JSON.stringify(state));
      }
    }
  });

  // Restore panel state — survives page reloads and cross-page navigation.
  // The key persists until the user explicitly closes the panel.
  const pendingPanelState = sessionStorage.getItem(PANEL_STATE_KEY);
  if (pendingPanelState) {
    panel.container.classList.add('air-panel--open');
    panel.container.setAttribute('data-air-state', 'open');
    openFab(fab);
    if (pendingPanelState === 'all-pages') {
      panel.allPagesTab.click();
      // Reset to 'open' — the all-pages tab switch is a one-shot action
      sessionStorage.setItem(PANEL_STATE_KEY, 'open');
    } else {
      mediator.refreshPanel();
    }
  }

  // Restore highlights for the current page, then handle pending state
  annotator.restoreHighlights().then(() => {
    highlightsRestored = true;
    // Refresh panel after highlights so orphan states reflect DOM reality
    if (isPanelOpen(panel)) {
      mediator.refreshPanel();
    }
    const pendingId = sessionStorage.getItem(SCROLL_TO_KEY);
    if (pendingId) {
      sessionStorage.removeItem(SCROLL_TO_KEY);
      scrollToAnnotation(pendingId);
    }
    // Restore pending popup state (e.g. user was typing a note when Vite reloaded)
    const pendingPopup = sessionStorage.getItem(PENDING_POPUP_KEY);
    if (pendingPopup) {
      sessionStorage.removeItem(PENDING_POPUP_KEY);
      try {
        const state: PendingPopupState = JSON.parse(pendingPopup);
        annotator.restorePendingState(state);
      } catch {
        // Corrupt data — ignore
      }
    }
  });

  // Re-restore on Astro page transitions (also handles pending scroll-to)
  document.addEventListener('astro:page-load', () => {
    highlightsRestored = false;
    annotator.restoreHighlights().then(() => {
      highlightsRestored = true;
      if (isPanelOpen(panel)) {
        mediator.refreshPanel();
      }
      const pendingId = sessionStorage.getItem(SCROLL_TO_KEY);
      if (pendingId) {
        sessionStorage.removeItem(SCROLL_TO_KEY);
        scrollToAnnotation(pendingId);
      }
    });
  });

  // Poll for external store changes (e.g. MCP tool updates)
  const poller = createStorePoller({
    onStoreChanged: () => {
      if (isPopupVisible(annotator.popup)) {
        // Defer restoreHighlights (which strips/re-applies marks and
        // invalidates the live Range) but still refresh the panel so
        // status changes (e.g. in_progress → addressed) are visible.
        // Don't reset orphan tracker here — orphan states from the
        // initial restore are still valid until highlights are re-applied.
        pendingStoreUpdate = true;
        if (isPanelOpen(panel)) {
          mediator.refreshPanel();
        }
        return;
      }
      orphanTracker.onStoreChanged();
      annotator.restoreHighlights().then(() => {
        if (isPanelOpen(panel)) {
          mediator.refreshPanel();
        }
      });
    },
  });
  poller.start();

  // Flush deferred store update when popup is dismissed
  const popupObserver = new MutationObserver(() => {
    const state = annotator.popup.container.getAttribute('data-air-state');
    if (state === 'hidden' && pendingStoreUpdate) {
      pendingStoreUpdate = false;
      orphanTracker.onStoreChanged();
      annotator.restoreHighlights().then(() => {
        if (isPanelOpen(panel)) {
          mediator.refreshPanel();
        }
      });
    }
  });
  popupObserver.observe(annotator.popup.container, {
    attributes: true,
    attributeFilter: ['data-air-state'],
  });
}

// Bootstrap on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
