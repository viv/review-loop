/**
 * Review panel — slide-in sidebar.
 *
 * Two tabs: "This Page" and "All Pages".
 * Shows annotations with click-to-scroll, page notes with CRUD,
 * and export/clear-all actions.
 */

import { api } from '../api.js';
import { writeCache, readCache } from '../cache.js';
import { showToast } from './toast.js';
import { computeWordDiff, renderDiff } from './diff.js';
import type { Annotation, TextAnnotation, PageNote, ReviewStore, AgentReply, AnnotationStatus } from '../types.js';
import { isTextAnnotation, getAnnotationStatus } from '../types.js';
import type { OrphanState } from '../orphan-tracker.js';
import type { ReviewMediator } from '../mediator.js';

export interface PanelElements {
  container: HTMLDivElement;
  thisPageTab: HTMLButtonElement;
  allPagesTab: HTMLButtonElement;
  content: HTMLDivElement;
  addNoteBtn: HTMLButtonElement;
  mediator: ReviewMediator;
}

export interface PanelCallbacks {
  onAnnotationClick: (annotationId: string, pageUrl: string) => void;
  onAnnotationDelete: (annotationId: string) => Promise<void>;
  onAnnotationStatusChange: (annotationId: string, status: AnnotationStatus, replyMessage?: string) => Promise<void>;
  getOrphanState: (annotationId: string, pageUrl: string, status: AnnotationStatus) => OrphanState;
  onRefreshBadge: () => Promise<void>;
  onExport: () => Promise<void>;
}

type ActiveTab = 'this-page' | 'all-pages';

/**
 * Create the panel and append to shadow root.
 */
export function createPanel(
  shadowRoot: ShadowRoot,
  callbacks: PanelCallbacks,
  mediator: ReviewMediator,
): PanelElements {
  const container = document.createElement('div');
  container.className = 'air-panel';
  container.setAttribute('data-air-el', 'panel');
  container.setAttribute('data-air-state', 'closed');
  container.setAttribute('role', 'complementary');
  container.setAttribute('aria-label', 'Review Loop Panel');

  // Header
  const header = document.createElement('div');
  header.className = 'air-panel__header';

  const title = document.createElement('h2');
  title.className = 'air-panel__title';
  title.textContent = 'Review Loop';
  header.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'air-panel__actions';

  const addNoteBtn = document.createElement('button');
  addNoteBtn.className = 'air-panel__btn';
  addNoteBtn.setAttribute('data-air-el', 'page-note-add');
  addNoteBtn.textContent = '+ Note';
  addNoteBtn.title = 'Add page note';
  actions.appendChild(addNoteBtn);

  const exportBtn = document.createElement('button');
  exportBtn.className = 'air-panel__btn air-panel__btn--export';
  exportBtn.setAttribute('data-air-el', 'export');
  exportBtn.textContent = 'Copy All';
  exportBtn.title = 'Copy all annotations to clipboard as Markdown';
  exportBtn.addEventListener('click', () => callbacks.onExport());
  actions.appendChild(exportBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'air-panel__btn air-panel__btn--danger';
  clearBtn.setAttribute('data-air-el', 'clear-all');
  clearBtn.textContent = 'Clear All';
  actions.appendChild(clearBtn);
  setupClearAll(clearBtn, callbacks, mediator);

  header.appendChild(actions);
  container.appendChild(header);

  // Tabs
  const tabs = document.createElement('div');
  tabs.className = 'air-panel__tabs';
  tabs.setAttribute('role', 'tablist');

  const thisPageTab = document.createElement('button');
  thisPageTab.className = 'air-panel__tab air-panel__tab--active';
  thisPageTab.setAttribute('data-air-el', 'tab-this-page');
  thisPageTab.setAttribute('role', 'tab');
  thisPageTab.setAttribute('aria-selected', 'true');
  thisPageTab.id = 'air-tab-this-page';
  thisPageTab.textContent = 'This Page (0)';
  tabs.appendChild(thisPageTab);

  const allPagesTab = document.createElement('button');
  allPagesTab.className = 'air-panel__tab';
  allPagesTab.setAttribute('data-air-el', 'tab-all-pages');
  allPagesTab.setAttribute('role', 'tab');
  allPagesTab.setAttribute('aria-selected', 'false');
  allPagesTab.id = 'air-tab-all-pages';
  allPagesTab.textContent = 'All Pages (0)';
  tabs.appendChild(allPagesTab);

  container.appendChild(tabs);

  // Content area
  const content = document.createElement('div');
  content.className = 'air-panel__content';
  content.setAttribute('data-air-el', 'panel-content');
  content.setAttribute('role', 'tabpanel');
  content.setAttribute('aria-labelledby', 'air-tab-this-page');
  content.setAttribute('aria-live', 'polite');
  container.appendChild(content);

  // Keyboard shortcuts help footer
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const mod = isMac ? '\u2318' : 'Ctrl';
  const shortcutsFooter = document.createElement('div');
  shortcutsFooter.className = 'air-panel__shortcuts';
  shortcutsFooter.setAttribute('data-air-el', 'shortcuts-help');
  shortcutsFooter.innerHTML = [
    `<kbd>${mod}+Shift+.</kbd> Toggle panel`,
    `<kbd>Esc</kbd> Close`,
    `<kbd>Alt+hover</kbd> Inspect`,
  ].join(' &middot; ');
  container.appendChild(shortcutsFooter);

  shadowRoot.appendChild(container);

  // State
  let activeTab: ActiveTab = 'this-page';

  thisPageTab.addEventListener('click', () => {
    activeTab = 'this-page';
    thisPageTab.classList.add('air-panel__tab--active');
    thisPageTab.setAttribute('aria-selected', 'true');
    allPagesTab.classList.remove('air-panel__tab--active');
    allPagesTab.setAttribute('aria-selected', 'false');
    content.setAttribute('aria-labelledby', 'air-tab-this-page');
    refreshPanel(content, activeTab, callbacks, mediator);
  });

  allPagesTab.addEventListener('click', () => {
    activeTab = 'all-pages';
    allPagesTab.classList.add('air-panel__tab--active');
    allPagesTab.setAttribute('aria-selected', 'true');
    thisPageTab.classList.remove('air-panel__tab--active');
    thisPageTab.setAttribute('aria-selected', 'false');
    content.setAttribute('aria-labelledby', 'air-tab-all-pages');
    refreshPanel(content, activeTab, callbacks, mediator);
  });

  // Add page note handler
  addNoteBtn.addEventListener('click', () => {
    showAddNoteForm(content, callbacks, mediator);
  });

  const elements: PanelElements = { container, thisPageTab, allPagesTab, content, addNoteBtn, mediator };

  // Wire up mediator so other modules can trigger a panel refresh
  mediator.refreshPanel = async () => {
    try {
      const store = await api.getStore();
      refreshPanel(content, activeTab, callbacks, mediator, store);
      updateTabCounts(thisPageTab, allPagesTab, store);
    } catch {
      // Fall back to independent fetches
      refreshPanel(content, activeTab, callbacks, mediator);
      updateTabCounts(thisPageTab, allPagesTab);
    }
  };

  return elements;
}

/**
 * Toggle the panel open/closed.
 */
export function togglePanel(panel: PanelElements): boolean {
  const isOpen = panel.container.classList.toggle('air-panel--open');
  panel.container.setAttribute('data-air-state', isOpen ? 'open' : 'closed');
  if (isOpen) {
    panel.mediator.refreshPanel();
  }
  return isOpen;
}

/**
 * Check if panel is open.
 */
export function isPanelOpen(panel: PanelElements): boolean {
  return panel.container.classList.contains('air-panel--open');
}

/**
 * Close the panel.
 */
export function closePanel(panel: PanelElements): void {
  panel.container.classList.remove('air-panel--open');
  panel.container.setAttribute('data-air-state', 'closed');
}

// --- Internal ---

async function refreshPanel(
  content: HTMLDivElement,
  activeTab: ActiveTab,
  callbacks: PanelCallbacks,
  mediator: ReviewMediator,
  prefetchedStore?: ReviewStore,
): Promise<void> {
  while (content.firstChild) content.removeChild(content.firstChild);

  try {
    // "All Pages" must always fetch from the server — the cache only holds
    // the current page's annotations (written by restoreHighlights).
    const store = prefetchedStore
      ?? (activeTab === 'all-pages'
        ? await api.getStore()
        : (readCache() ?? await api.getStore()));
    if (activeTab === 'this-page') {
      renderThisPage(content, store, callbacks, mediator);
    } else {
      renderAllPages(content, store, callbacks, mediator);
    }
  } catch {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'air-panel__empty';
    errorDiv.textContent = 'Failed to load annotations. Is the dev server running?';
    content.appendChild(errorDiv);
    const root = content.getRootNode() as ShadowRoot;
    showToast(root, 'Failed to load annotations');
  }
}

function renderThisPage(
  content: HTMLDivElement,
  store: ReviewStore,
  callbacks: PanelCallbacks,
  mediator: ReviewMediator,
): void {
  const currentPage = window.location.pathname;
  const pageAnnotations = store.annotations.filter(a => a.pageUrl === currentPage);
  const pageNotes = store.pageNotes.filter(n => n.pageUrl === currentPage);

  // Page notes section
  if (pageNotes.length > 0) {
    const notesHeader = document.createElement('div');
    notesHeader.className = 'air-page-group__title';
    notesHeader.textContent = 'Page Notes';
    content.appendChild(notesHeader);

    for (const note of pageNotes) {
      content.appendChild(createPageNoteItem(note, callbacks, mediator));
    }
  }

  // Annotations section
  if (pageAnnotations.length > 0) {
    const annotationsHeader = document.createElement('div');
    annotationsHeader.className = 'air-page-group__title';
    annotationsHeader.textContent = 'Annotations';
    content.appendChild(annotationsHeader);

    for (const annotation of pageAnnotations) {
      content.appendChild(createAnnotationItem(annotation, callbacks));
    }
  }

  if (pageAnnotations.length === 0 && pageNotes.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'air-panel__empty';

    const arrow = document.createElement('span');
    arrow.className = 'air-panel__empty-arrow';
    arrow.setAttribute('data-air-el', 'empty-arrow');
    arrow.textContent = '\u2190';
    emptyDiv.appendChild(arrow);

    emptyDiv.appendChild(document.createElement('br'));
    emptyDiv.appendChild(document.createTextNode('No annotations on this page yet.'));
    emptyDiv.appendChild(document.createElement('br'));
    emptyDiv.appendChild(document.createTextNode('Select text or Alt+click elements to get started.'));

    content.appendChild(emptyDiv);
  }
}

function renderAllPages(
  content: HTMLDivElement,
  store: ReviewStore,
  callbacks: PanelCallbacks,
  mediator: ReviewMediator,
): void {
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
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'air-panel__empty';
    emptyDiv.textContent = 'No annotations across any pages.';
    content.appendChild(emptyDiv);
    return;
  }

  for (const [url, page] of pages) {
    const pageTitle = document.createElement('div');
    pageTitle.className = 'air-page-group__title';
    pageTitle.textContent = `${url}${page.title ? ` — ${page.title}` : ''}`;
    content.appendChild(pageTitle);

    for (const note of page.notes) {
      content.appendChild(createPageNoteItem(note, callbacks, mediator));
    }

    for (const annotation of page.annotations) {
      content.appendChild(createAnnotationItem(annotation, callbacks));
    }
  }
}

function createAnnotationItem(annotation: Annotation, callbacks: PanelCallbacks): HTMLDivElement {
  if (isTextAnnotation(annotation)) {
    return createTextAnnotationItem(annotation, callbacks);
  }
  return createElementAnnotationItem(annotation, callbacks);
}

function createTextAnnotationItem(annotation: TextAnnotation, callbacks: PanelCallbacks): HTMLDivElement {
  const item = document.createElement('div');
  const status = getAnnotationStatus(annotation);
  const orphanState = callbacks.getOrphanState(annotation.id, annotation.pageUrl, status);
  const classes = ['air-annotation-item'];
  if (status === 'addressed') classes.push('air-annotation-item--addressed');
  if (status === 'in_progress') classes.push('air-annotation-item--in-progress');
  if (orphanState === 'orphaned') classes.push('air-annotation-item--orphan');
  if (orphanState === 'checking') classes.push('air-annotation-item--checking');
  item.className = classes.join(' ');
  item.setAttribute('data-air-el', 'annotation-item');

  if (status !== 'open') {
    const badgeRow = document.createElement('div');
    badgeRow.style.cssText = 'display: flex; align-items: center;';
    badgeRow.appendChild(createStatusBadge(status, annotation.inProgressAt, annotation.addressedAt));

    if (status === 'addressed' && annotation.replacedText) {
      const toggle = document.createElement('button');
      toggle.className = 'air-diff-toggle';
      toggle.setAttribute('data-air-el', 'diff-toggle');
      toggle.textContent = '▶ Diff';
      badgeRow.appendChild(toggle);
    }

    item.appendChild(badgeRow);
  }

  const text = document.createElement('div');
  text.className = 'air-annotation-item__text';
  if (annotation.replacedText) {
    // Show original text struck-through, then replacement text
    const original = document.createElement('span');
    original.style.textDecoration = 'line-through';
    original.style.opacity = '0.6';
    const truncatedOriginal = annotation.selectedText.length > 80
      ? annotation.selectedText.slice(0, 80) + '…'
      : annotation.selectedText;
    original.textContent = `"${truncatedOriginal}"`;
    text.appendChild(original);

    const arrow = document.createElement('span');
    arrow.textContent = ' → ';
    text.appendChild(arrow);

    const replacement = document.createElement('span');
    const truncatedReplacement = annotation.replacedText.length > 80
      ? annotation.replacedText.slice(0, 80) + '…'
      : annotation.replacedText;
    replacement.textContent = `"${truncatedReplacement}"`;
    text.appendChild(replacement);
  } else {
    const truncated = annotation.selectedText.length > 80
      ? annotation.selectedText.slice(0, 80) + '…'
      : annotation.selectedText;
    text.textContent = `"${truncated}"`;
  }
  item.appendChild(text);

  // Collapsible word-level diff container (addressed annotations with replacedText only)
  if (status === 'addressed' && annotation.replacedText) {
    const diffContainer = document.createElement('div');
    diffContainer.className = 'air-diff-container';
    diffContainer.setAttribute('data-air-el', 'diff-container');
    diffContainer.style.display = 'none';
    item.appendChild(diffContainer);

    // Wire up the toggle button
    const toggle = item.querySelector('[data-air-el="diff-toggle"]') as HTMLButtonElement;
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = diffContainer.style.display !== 'none';
      if (isVisible) {
        diffContainer.style.display = 'none';
        toggle.textContent = '▶ Diff';
      } else {
        // Populate diff on first open
        if (diffContainer.children.length === 0) {
          const segments = computeWordDiff(annotation.selectedText, annotation.replacedText!);
          diffContainer.appendChild(renderDiff(segments));
        }
        diffContainer.style.display = 'block';
        toggle.textContent = '▼ Diff';
      }
    });
  }

  if (annotation.note) {
    const note = document.createElement('div');
    note.className = 'air-annotation-item__note';
    note.textContent = annotation.note;
    item.appendChild(note);
  }

  if (annotation.replies && annotation.replies.length > 0) {
    for (const reply of annotation.replies) {
      item.appendChild(createReplyBlock(reply));
    }
  }

  if (orphanState === 'orphaned') {
    const orphanIndicator = document.createElement('div');
    orphanIndicator.className = 'air-annotation-item__orphan';
    orphanIndicator.textContent = 'Could not locate on page';
    item.appendChild(orphanIndicator);
  } else if (orphanState === 'checking') {
    const checkingIndicator = document.createElement('div');
    checkingIndicator.className = 'air-annotation-item__checking';
    checkingIndicator.setAttribute('data-air-el', 'checking-indicator');
    checkingIndicator.textContent = 'Checking…';
    item.appendChild(checkingIndicator);
  }

  // Hide action buttons for in_progress annotations — only the agent or reviewer can transition out
  if (status !== 'in_progress') {
    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 8px; margin-top: 8px;';

    appendStatusActions(actions, annotation.id, status, callbacks, item);

    if (status === 'open') {
      const deleteBtn = createDeleteButton(annotation.id, callbacks);
      actions.appendChild(deleteBtn);
    }

    item.appendChild(actions);
  }

  item.setAttribute('tabindex', '0');
  item.addEventListener('click', () => {
    callbacks.onAnnotationClick(annotation.id, annotation.pageUrl);
  });
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      callbacks.onAnnotationClick(annotation.id, annotation.pageUrl);
    }
  });

  return item;
}

function createElementAnnotationItem(annotation: Annotation & { type: 'element' }, callbacks: PanelCallbacks): HTMLDivElement {
  const item = document.createElement('div');
  const status = getAnnotationStatus(annotation);
  const orphanState = callbacks.getOrphanState(annotation.id, annotation.pageUrl, status);
  const classes = ['air-annotation-item'];
  if (status === 'addressed') classes.push('air-annotation-item--addressed');
  if (status === 'in_progress') classes.push('air-annotation-item--in-progress');
  if (orphanState === 'orphaned') classes.push('air-annotation-item--orphan');
  if (orphanState === 'checking') classes.push('air-annotation-item--checking');
  item.className = classes.join(' ');
  item.setAttribute('data-air-el', 'element-annotation-item');

  if (status !== 'open') {
    item.appendChild(createStatusBadge(status, annotation.inProgressAt, annotation.addressedAt));
  }

  const desc = document.createElement('div');
  desc.className = 'air-annotation-item__text';
  desc.textContent = annotation.elementSelector.description;
  item.appendChild(desc);

  if (annotation.note) {
    const note = document.createElement('div');
    note.className = 'air-annotation-item__note';
    note.textContent = annotation.note;
    item.appendChild(note);
  }

  if (annotation.replies && annotation.replies.length > 0) {
    for (const reply of annotation.replies) {
      item.appendChild(createReplyBlock(reply));
    }
  }

  if (orphanState === 'orphaned') {
    const orphanIndicator = document.createElement('div');
    orphanIndicator.className = 'air-annotation-item__orphan';
    orphanIndicator.textContent = 'Could not locate on page';
    item.appendChild(orphanIndicator);
  } else if (orphanState === 'checking') {
    const checkingIndicator = document.createElement('div');
    checkingIndicator.className = 'air-annotation-item__checking';
    checkingIndicator.setAttribute('data-air-el', 'checking-indicator');
    checkingIndicator.textContent = 'Checking…';
    item.appendChild(checkingIndicator);
  }

  // Hide action buttons for in_progress annotations
  if (status !== 'in_progress') {
    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 8px; margin-top: 8px;';

    appendStatusActions(actions, annotation.id, status, callbacks, item);

    if (status === 'open') {
      const deleteBtn = createDeleteButton(annotation.id, callbacks);
      actions.appendChild(deleteBtn);
    }

    item.appendChild(actions);
  }

  item.setAttribute('tabindex', '0');
  item.addEventListener('click', () => {
    callbacks.onAnnotationClick(annotation.id, annotation.pageUrl);
  });
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      callbacks.onAnnotationClick(annotation.id, annotation.pageUrl);
    }
  });

  return item;
}

function createPageNoteItem(note: PageNote, callbacks: PanelCallbacks, mediator: ReviewMediator): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'air-annotation-item';
  item.setAttribute('data-air-el', 'page-note-item');

  const noteText = document.createElement('div');
  noteText.className = 'air-annotation-item__note';
  noteText.textContent = note.note;
  item.appendChild(noteText);

  // Inline edit/delete actions
  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px; margin-top: 8px;';

  const editBtn = document.createElement('button');
  editBtn.className = 'air-popup__btn air-popup__btn--cancel';
  editBtn.setAttribute('data-air-el', 'page-note-edit');
  editBtn.textContent = 'Edit';
  editBtn.style.fontSize = '11px';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showEditNoteForm(item, note, callbacks, mediator);
  });
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'air-popup__btn air-popup__btn--delete';
  deleteBtn.setAttribute('data-air-el', 'page-note-delete');
  deleteBtn.textContent = 'Delete';
  deleteBtn.style.fontSize = '11px';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await api.deletePageNote(note.id);
      await callbacks.onRefreshBadge();
      mediator.refreshPanel();
    } catch (err) {
      console.error('[review-loop] Failed to delete page note:', err);
      const root = item.getRootNode() as ShadowRoot;
      showToast(root, 'Failed to delete page note');
    }
  });
  actions.appendChild(deleteBtn);

  item.appendChild(actions);

  return item;
}

function showAddNoteForm(content: HTMLDivElement, callbacks: PanelCallbacks, mediator: ReviewMediator): void {
  // Insert a form at the top of the content area
  const existing = content.querySelector('.air-note-form');
  if (existing) {
    existing.remove();
    return; // Toggle off
  }

  const form = createNoteForm('', async (noteText) => {
    if (!noteText.trim()) {
      form.remove();
      return;
    }

    try {
      await api.createPageNote({
        pageUrl: window.location.pathname,
        pageTitle: document.title,
        note: noteText.trim(),
      });
      form.remove();
      await callbacks.onRefreshBadge();
      mediator.refreshPanel();
    } catch (err) {
      console.error('[review-loop] Failed to create page note:', err);
      const root = content.getRootNode() as ShadowRoot;
      showToast(root, 'Failed to save page note');
    }
  }, () => {
    form.remove();
  });

  content.insertBefore(form, content.firstChild);
  form.querySelector('textarea')?.focus();
}

function showEditNoteForm(
  item: HTMLDivElement,
  note: PageNote,
  callbacks: PanelCallbacks,
  mediator: ReviewMediator,
): void {
  const form = createNoteForm(note.note, async (noteText) => {
    if (!noteText.trim()) return;

    try {
      await api.updatePageNote(note.id, { note: noteText.trim() });
      await callbacks.onRefreshBadge();
      mediator.refreshPanel();
    } catch (err) {
      console.error('[review-loop] Failed to update page note:', err);
      const root = item.getRootNode() as ShadowRoot;
      showToast(root, 'Failed to update page note');
    }
  }, () => {
    // Cancel — just restore the item
    mediator.refreshPanel();
  });

  while (item.firstChild) item.removeChild(item.firstChild);
  item.appendChild(form);
  form.querySelector('textarea')?.focus();
}

function createNoteForm(
  initialValue: string,
  onSave: (value: string) => void,
  onCancel: () => void,
): HTMLDivElement {
  const form = document.createElement('div');
  form.className = 'air-note-form';
  form.style.cssText = 'padding: 8px; margin-bottom: 8px;';

  const textarea = document.createElement('textarea');
  textarea.className = 'air-popup__textarea';
  textarea.setAttribute('data-air-el', 'page-note-textarea');
  textarea.value = initialValue;
  textarea.placeholder = 'Add a page-level note…';
  textarea.style.minHeight = '60px';
  form.appendChild(textarea);

  const footer = document.createElement('div');
  footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'air-popup__btn air-popup__btn--cancel';
  cancelBtn.setAttribute('data-air-el', 'page-note-cancel');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', onCancel);
  footer.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'air-popup__btn air-popup__btn--save';
  saveBtn.setAttribute('data-air-el', 'page-note-save');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => onSave(textarea.value));
  footer.appendChild(saveBtn);

  form.appendChild(footer);
  return form;
}

/** Two-click delete: first click shows "Sure?", second click within 3s executes delete. */
function createDeleteButton(annotationId: string, callbacks: PanelCallbacks): HTMLButtonElement {
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'air-popup__btn air-popup__btn--delete';
  deleteBtn.setAttribute('data-air-el', 'annotation-delete');
  deleteBtn.textContent = 'Delete';
  deleteBtn.style.fontSize = '11px';

  let confirming = false;
  let resetTimeout: ReturnType<typeof setTimeout> | null = null;

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    if (!confirming) {
      confirming = true;
      deleteBtn.textContent = 'Sure?';
      deleteBtn.setAttribute('data-air-state', 'confirming');

      resetTimeout = setTimeout(() => {
        confirming = false;
        deleteBtn.textContent = 'Delete';
        deleteBtn.removeAttribute('data-air-state');
      }, 3000);
      return;
    }

    // Second click — execute delete
    if (resetTimeout) clearTimeout(resetTimeout);
    confirming = false;
    deleteBtn.textContent = 'Delete';
    deleteBtn.removeAttribute('data-air-state');
    callbacks.onAnnotationDelete(annotationId);
  });

  return deleteBtn;
}

/** Add Accept/Reopen buttons based on current annotation status. */
function appendStatusActions(
  container: HTMLElement,
  annotationId: string,
  status: AnnotationStatus,
  callbacks: PanelCallbacks,
  item: HTMLElement,
): void {
  if (status === 'addressed') {
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'air-popup__btn air-popup__btn--accept';
    acceptBtn.setAttribute('data-air-el', 'annotation-accept');
    acceptBtn.textContent = 'Accept';
    acceptBtn.style.fontSize = '11px';
    acceptBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onAnnotationDelete(annotationId);
    });
    container.appendChild(acceptBtn);
  }

  if (status === 'addressed') {
    const reopenBtn = document.createElement('button');
    reopenBtn.className = 'air-popup__btn air-popup__btn--cancel';
    reopenBtn.setAttribute('data-air-el', 'annotation-reopen');
    reopenBtn.textContent = 'Reopen';
    reopenBtn.style.fontSize = '11px';
    reopenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showReopenForm(item, annotationId, callbacks);
    });
    container.appendChild(reopenBtn);
  }
}

/** Show inline form for adding a follow-up note when reopening an annotation. */
function showReopenForm(
  item: HTMLElement,
  annotationId: string,
  callbacks: PanelCallbacks,
): void {
  // Don't show multiple forms
  if (item.querySelector('.air-reopen-form')) return;

  const form = document.createElement('div');
  form.className = 'air-reopen-form';
  form.setAttribute('data-air-el', 'reopen-form');
  form.style.cssText = 'padding: 8px 0; margin-top: 8px;';

  const textarea = document.createElement('textarea');
  textarea.className = 'air-popup__textarea';
  textarea.setAttribute('data-air-el', 'reopen-textarea');
  textarea.placeholder = 'Add a follow-up note (optional)…';
  textarea.style.minHeight = '60px';
  form.appendChild(textarea);

  const footer = document.createElement('div');
  footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'air-popup__btn air-popup__btn--cancel';
  cancelBtn.setAttribute('data-air-el', 'reopen-cancel');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    form.remove();
  });
  footer.appendChild(cancelBtn);

  const reopenBtn = document.createElement('button');
  reopenBtn.className = 'air-popup__btn air-popup__btn--save';
  reopenBtn.setAttribute('data-air-el', 'reopen-submit');
  reopenBtn.textContent = 'Reopen';
  reopenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const message = textarea.value.trim();
    callbacks.onAnnotationStatusChange(annotationId, 'open', message || undefined);
    form.remove();
  });
  footer.appendChild(reopenBtn);

  form.appendChild(footer);

  // Prevent clicks and keystrokes inside the form from triggering the item's handlers
  form.addEventListener('click', (e) => e.stopPropagation());
  form.addEventListener('keydown', (e) => e.stopPropagation());

  item.appendChild(form);
  textarea.focus();
}

/** Two-click clear: first click shows confirmation, second click deletes. */
function setupClearAll(clearBtn: HTMLButtonElement, callbacks: PanelCallbacks, mediator: ReviewMediator): void {
  let confirming = false;
  let resetTimeout: ReturnType<typeof setTimeout> | null = null;

  clearBtn.addEventListener('click', async () => {
    if (!confirming) {
      // First click — enter confirmation state
      confirming = true;
      clearBtn.textContent = 'Sure?';
      clearBtn.setAttribute('data-air-state', 'confirming');

      // Auto-reset after 3 seconds if user doesn't confirm
      resetTimeout = setTimeout(() => {
        confirming = false;
        clearBtn.textContent = 'Clear All';
        clearBtn.removeAttribute('data-air-state');
      }, 3000);
      return;
    }

    // Second click — actually clear
    if (resetTimeout) clearTimeout(resetTimeout);
    confirming = false;
    clearBtn.textContent = 'Clear All';
    clearBtn.removeAttribute('data-air-state');

    try {
      const store = await api.getStore();

      for (const a of store.annotations) {
        await api.deleteAnnotation(a.id);
      }
      for (const n of store.pageNotes) {
        await api.deletePageNote(n.id);
      }

      writeCache({ version: 1, annotations: [], pageNotes: [] });
      await callbacks.onRefreshBadge();

      // Clean up DOM highlights (text marks + element outlines)
      await mediator.restoreHighlights();

      // Refresh panel content
      mediator.refreshPanel();
    } catch (err) {
      console.error('[review-loop] Failed to clear all:', err);
      const root = clearBtn.getRootNode() as ShadowRoot;
      showToast(root, 'Failed to clear annotations');
    }
  });
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function createStatusBadge(status: AnnotationStatus, inProgressAt?: string, addressedAt?: string): HTMLDivElement {
  const badge = document.createElement('div');
  if (status === 'addressed') {
    badge.setAttribute('data-air-el', 'addressed-badge');
    badge.className = 'air-annotation-item__addressed-badge';
    badge.textContent = '\uD83D\uDD27 Addressed';
    if (addressedAt) {
      const time = document.createElement('span');
      time.className = 'air-annotation-item__addressed-time';
      time.textContent = formatTimestamp(addressedAt);
      badge.appendChild(time);
    }
  } else if (status === 'in_progress') {
    badge.setAttribute('data-air-el', 'in-progress-badge');
    badge.className = 'air-annotation-item__in-progress-badge';
    badge.textContent = '\u23F3 Agent working\u2026';
    if (inProgressAt) {
      const time = document.createElement('span');
      time.className = 'air-annotation-item__in-progress-time';
      time.textContent = formatTimestamp(inProgressAt);
      badge.appendChild(time);
    }
  }

  return badge;
}

function createReplyBlock(reply: AgentReply): HTMLDivElement {
  const isReviewer = reply.role === 'reviewer';
  const roleModifier = isReviewer ? 'reviewer' : 'agent';
  const block = document.createElement('div');
  block.className = `air-annotation-item__reply air-annotation-item__reply--${roleModifier}`;
  block.setAttribute('data-air-el', isReviewer ? 'reviewer-reply' : 'agent-reply');

  const prefix = document.createElement('div');
  prefix.className = `air-annotation-item__reply-prefix air-annotation-item__reply-prefix--${roleModifier}`;
  prefix.textContent = isReviewer ? '\uD83D\uDC64 Reviewer:' : '\uD83E\uDD16 Agent:';

  if (reply.createdAt) {
    const time = document.createElement('span');
    time.className = 'air-annotation-item__reply-time';
    time.textContent = formatTimestamp(reply.createdAt);
    prefix.appendChild(time);
  }

  block.appendChild(prefix);

  const message = document.createElement('div');
  message.textContent = reply.message;
  block.appendChild(message);

  return block;
}

async function updateTabCounts(
  thisPageTab: HTMLButtonElement,
  allPagesTab: HTMLButtonElement,
  prefetchedStore?: ReviewStore,
): Promise<void> {
  try {
    // Always fetch from server for accurate All Pages count
    const store = prefetchedStore ?? await api.getStore();
    const currentPage = window.location.pathname;
    const thisPageCount = store.annotations.filter(a => a.pageUrl === currentPage).length +
                          store.pageNotes.filter(n => n.pageUrl === currentPage).length;
    const allCount = store.annotations.length + store.pageNotes.length;

    thisPageTab.textContent = `This Page (${thisPageCount})`;
    allPagesTab.textContent = `All Pages (${allCount})`;
  } catch {
    // Ignore — counts stay stale
  }
}
