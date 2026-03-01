/**
 * Selection annotation popup.
 *
 * Appears near text selection with a textarea for notes.
 * Supports create mode (save/cancel), edit mode (save/cancel/delete),
 * in_progress mode (read-only, cancel), and addressed mode (accept/reopen/cancel).
 */

import type { AgentReply } from '../types.js';

export interface PopupCallbacks {
  onSave: (note: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export interface InProgressCallbacks {
  onCancel: () => void;
}

export interface AddressedCallbacks {
  onAccept: () => void;
  onReopen: (message?: string) => void;
  onCancel: () => void;
}

export interface PopupElements {
  container: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  selectedTextPreview: HTMLDivElement;
}

const MAX_PREVIEW_LENGTH = 100;

/** Tracks the element that was focused before the popup was shown */
let previouslyFocusedElement: HTMLElement | null = null;

/**
 * Create the popup container and append to the shadow root.
 * The popup starts hidden — call showPopup() to display it.
 */
export function createPopup(shadowRoot: ShadowRoot): PopupElements {
  const container = document.createElement('div');
  container.className = 'air-popup';
  container.setAttribute('data-air-el', 'popup');
  container.setAttribute('data-air-state', 'hidden');
  container.setAttribute('role', 'dialog');
  container.setAttribute('aria-modal', 'true');
  container.setAttribute('aria-label', 'Add annotation');

  // Focus trap: Tab cycles through focusable elements within the popup
  container.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>('textarea, button'),
    );
    if (focusable.length === 0) return;

    const root = container.getRootNode() as ShadowRoot;
    const active = root.activeElement;
    const currentIndex = focusable.indexOf(active as HTMLElement);

    if (e.shiftKey) {
      if (currentIndex <= 0) {
        e.preventDefault();
        focusable[focusable.length - 1].focus();
      }
    } else {
      if (currentIndex === focusable.length - 1) {
        e.preventDefault();
        focusable[0].focus();
      }
    }
  });

  const selectedTextPreview = document.createElement('div');
  selectedTextPreview.className = 'air-popup__selected';
  container.appendChild(selectedTextPreview);

  const textarea = document.createElement('textarea');
  textarea.className = 'air-popup__textarea';
  textarea.setAttribute('data-air-el', 'popup-textarea');
  textarea.placeholder = 'Add a note (optional)…';
  container.appendChild(textarea);

  const footer = document.createElement('div');
  footer.className = 'air-popup__footer';
  container.appendChild(footer);

  shadowRoot.appendChild(container);

  return { container, textarea, selectedTextPreview };
}

/**
 * Show the popup near a selection rect in create mode.
 */
export function showPopup(
  popup: PopupElements,
  selectedText: string,
  rect: DOMRect,
  callbacks: PopupCallbacks,
): void {
  previouslyFocusedElement = document.activeElement as HTMLElement | null;
  const { container, textarea, selectedTextPreview } = popup;

  // Set preview text
  const truncated = selectedText.length > MAX_PREVIEW_LENGTH
    ? `"${selectedText.slice(0, MAX_PREVIEW_LENGTH)}…"`
    : `"${selectedText}"`;
  selectedTextPreview.textContent = truncated;

  // Position near the selection
  positionPopup(container, rect);

  // Clear and set up textarea
  textarea.value = '';

  // Rebuild footer buttons
  rebuildFooter(container, textarea, callbacks);

  // Show
  container.classList.add('air-popup--visible');
  container.setAttribute('data-air-state', 'visible');

  // Focus textarea after a tick (let the popup render first)
  requestAnimationFrame(() => textarea.focus());
}

/**
 * Show the popup in edit mode with existing note pre-filled.
 */
export function showEditPopup(
  popup: PopupElements,
  selectedText: string,
  existingNote: string,
  rect: DOMRect,
  callbacks: PopupCallbacks,
): void {
  previouslyFocusedElement = document.activeElement as HTMLElement | null;
  const { container, textarea, selectedTextPreview } = popup;

  // Set preview text
  const truncated = selectedText.length > MAX_PREVIEW_LENGTH
    ? `"${selectedText.slice(0, MAX_PREVIEW_LENGTH)}…"`
    : `"${selectedText}"`;
  selectedTextPreview.textContent = truncated;

  // Position
  positionPopup(container, rect);

  // Pre-fill textarea
  textarea.value = existingNote;

  // Rebuild footer with delete button
  rebuildFooter(container, textarea, callbacks);

  // Show
  container.classList.add('air-popup--visible');
  container.setAttribute('data-air-state', 'visible');
  requestAnimationFrame(() => textarea.focus());
}

/**
 * Show the popup near an element in create mode (for element annotations).
 * Shows element description without quotes.
 */
export function showElementPopup(
  popup: PopupElements,
  description: string,
  rect: DOMRect,
  callbacks: PopupCallbacks,
): void {
  previouslyFocusedElement = document.activeElement as HTMLElement | null;
  const { container, textarea, selectedTextPreview } = popup;

  const truncated = description.length > MAX_PREVIEW_LENGTH
    ? description.slice(0, MAX_PREVIEW_LENGTH) + '…'
    : description;
  selectedTextPreview.textContent = truncated;

  positionPopup(container, rect);
  textarea.value = '';
  rebuildFooter(container, textarea, callbacks);

  container.classList.add('air-popup--visible');
  container.setAttribute('data-air-state', 'visible');
  requestAnimationFrame(() => textarea.focus());
}

/**
 * Show the popup in edit mode for element annotations.
 */
export function showEditElementPopup(
  popup: PopupElements,
  description: string,
  existingNote: string,
  rect: DOMRect,
  callbacks: PopupCallbacks,
): void {
  previouslyFocusedElement = document.activeElement as HTMLElement | null;
  const { container, textarea, selectedTextPreview } = popup;

  const truncated = description.length > MAX_PREVIEW_LENGTH
    ? description.slice(0, MAX_PREVIEW_LENGTH) + '…'
    : description;
  selectedTextPreview.textContent = truncated;

  positionPopup(container, rect);
  textarea.value = existingNote;
  rebuildFooter(container, textarea, callbacks);

  container.classList.add('air-popup--visible');
  container.setAttribute('data-air-state', 'visible');
  requestAnimationFrame(() => textarea.focus());
}

/**
 * Show the popup in read-only mode for an in_progress annotation.
 * Displays the note as static text, an "Agent working…" badge, optional latest reply,
 * and a Cancel button only.
 */
export function showInProgressPopup(
  popup: PopupElements,
  previewText: string,
  note: string,
  rect: DOMRect,
  callbacks: InProgressCallbacks,
  latestReply?: AgentReply,
): void {
  previouslyFocusedElement = document.activeElement as HTMLElement | null;
  const { container, textarea, selectedTextPreview } = popup;

  // Set preview text (already formatted by caller — may have quotes or not)
  const truncated = previewText.length > MAX_PREVIEW_LENGTH
    ? previewText.slice(0, MAX_PREVIEW_LENGTH) + '…'
    : previewText;
  selectedTextPreview.textContent = truncated;

  positionPopup(container, rect);

  // Hide textarea, show read-only body
  textarea.style.display = 'none';
  rebuildReadOnlyBody(container, note, '⏳ Agent working…', 'in-progress', latestReply);

  // Footer: Cancel only
  rebuildInProgressFooter(container, callbacks.onCancel);

  container.classList.add('air-popup--visible');
  container.setAttribute('data-air-state', 'visible');
}

/**
 * Show the popup in read-only mode for an addressed annotation.
 * Displays the note as static text, an "Addressed" badge, optional latest reply,
 * and Accept/Reopen/Cancel buttons. Reopen shows an inline form.
 */
export function showAddressedPopup(
  popup: PopupElements,
  previewText: string,
  note: string,
  rect: DOMRect,
  callbacks: AddressedCallbacks,
  latestReply?: AgentReply,
): void {
  previouslyFocusedElement = document.activeElement as HTMLElement | null;
  const { container, textarea, selectedTextPreview } = popup;

  const truncated = previewText.length > MAX_PREVIEW_LENGTH
    ? previewText.slice(0, MAX_PREVIEW_LENGTH) + '…'
    : previewText;
  selectedTextPreview.textContent = truncated;

  positionPopup(container, rect);

  // Hide textarea, show read-only body
  textarea.style.display = 'none';
  rebuildReadOnlyBody(container, note, '🔧 Addressed', 'addressed', latestReply);

  // Footer: Accept, Reopen, Cancel
  rebuildAddressedFooter(container, callbacks);

  container.classList.add('air-popup--visible');
  container.setAttribute('data-air-state', 'visible');
}

/**
 * Hide the popup.
 */
export function hidePopup(popup: PopupElements): void {
  popup.container.classList.remove('air-popup--visible');
  popup.container.setAttribute('data-air-state', 'hidden');
  popup.textarea.value = '';

  // Clean up read-only elements added by status-aware modes
  popup.textarea.style.display = '';
  for (const el of popup.container.querySelectorAll('[data-air-el="popup-note"], [data-air-el="popup-status-badge"], [data-air-el="popup-reply"], [data-air-el="popup-reopen-form"]')) {
    el.remove();
  }

  // Return focus to the element that was focused before the popup opened
  if (previouslyFocusedElement && previouslyFocusedElement.isConnected) {
    previouslyFocusedElement.focus();
    previouslyFocusedElement = null;
  }
}

/**
 * Check if the popup is currently visible.
 */
export function isPopupVisible(popup: PopupElements): boolean {
  return popup.container.classList.contains('air-popup--visible');
}

// --- Helpers ---

function positionPopup(container: HTMLElement, rect: DOMRect): void {
  const POPUP_WIDTH = 300;
  const MARGIN = 8;

  // Try to position above the selection
  let top = rect.top - MARGIN;
  let left = rect.left + (rect.width / 2) - (POPUP_WIDTH / 2);

  // Determine right-edge boundary — if the panel is open, avoid it
  let rightBound = window.innerWidth - MARGIN;
  const root = container.getRootNode() as ShadowRoot;
  const panelEl = root.querySelector?.('[data-air-el="panel"][data-air-state="open"]') as HTMLElement | null;
  if (panelEl) {
    rightBound = Math.min(rightBound, panelEl.offsetLeft - MARGIN);
  }

  // Keep within viewport (and left of open panel)
  left = Math.max(MARGIN, Math.min(left, rightBound - POPUP_WIDTH));

  // If there's no room above, position below
  if (top < MARGIN + 200) {
    top = rect.bottom + MARGIN;
  }

  container.style.top = `${top}px`;
  container.style.left = `${left}px`;

  // Reset any transform the popup might position itself after content renders
  container.style.transform = top < rect.top ? 'translateY(-100%)' : '';
}

function rebuildFooter(
  container: HTMLElement,
  textarea: HTMLTextAreaElement,
  callbacks: PopupCallbacks,
): void {
  const footer = container.querySelector('.air-popup__footer')!;
  while (footer.firstChild) footer.removeChild(footer.firstChild);

  // Delete button (only in edit mode)
  if (callbacks.onDelete) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'air-popup__btn air-popup__btn--delete';
    deleteBtn.setAttribute('data-air-el', 'popup-delete');
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => callbacks.onDelete!());
    footer.appendChild(deleteBtn);
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'air-popup__btn air-popup__btn--cancel';
  cancelBtn.setAttribute('data-air-el', 'popup-cancel');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => callbacks.onCancel());
  footer.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'air-popup__btn air-popup__btn--save';
  saveBtn.setAttribute('data-air-el', 'popup-save');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => callbacks.onSave(textarea.value));
  footer.appendChild(saveBtn);
}

/**
 * Insert read-only note text, a status badge, and optional latest reply
 * into the popup body (between preview and footer). Removes any previous
 * read-only elements first.
 */
function rebuildReadOnlyBody(
  container: HTMLElement,
  note: string,
  badgeText: string,
  badgeType: 'in-progress' | 'addressed',
  latestReply?: AgentReply,
): void {
  // Remove any previous read-only elements
  for (const el of container.querySelectorAll('[data-air-el="popup-note"], [data-air-el="popup-status-badge"], [data-air-el="popup-reply"]')) {
    el.remove();
  }

  const footer = container.querySelector('.air-popup__footer')!;

  // Status badge
  const badge = document.createElement('div');
  badge.setAttribute('data-air-el', 'popup-status-badge');
  badge.className = badgeType === 'addressed'
    ? 'air-annotation-item__addressed-badge'
    : 'air-annotation-item__in-progress-badge';
  badge.textContent = badgeText;
  container.insertBefore(badge, footer);

  // Read-only note
  const noteEl = document.createElement('div');
  noteEl.setAttribute('data-air-el', 'popup-note');
  noteEl.className = 'air-popup__note';
  noteEl.textContent = note;
  container.insertBefore(noteEl, footer);

  // Latest reply
  if (latestReply) {
    const isReviewer = latestReply.role === 'reviewer';
    const roleModifier = isReviewer ? 'reviewer' : 'agent';
    const replyBlock = document.createElement('div');
    replyBlock.setAttribute('data-air-el', 'popup-reply');
    replyBlock.className = `air-annotation-item__reply air-annotation-item__reply--${roleModifier}`;

    const prefix = document.createElement('div');
    prefix.className = `air-annotation-item__reply-prefix air-annotation-item__reply-prefix--${roleModifier}`;
    prefix.textContent = isReviewer ? '\uD83D\uDC64 Reviewer:' : '\uD83E\uDD16 Agent:';
    replyBlock.appendChild(prefix);

    const msg = document.createElement('div');
    msg.textContent = latestReply.message;
    replyBlock.appendChild(msg);

    container.insertBefore(replyBlock, footer);
  }
}

/** Footer with Cancel button only (for in_progress mode). */
function rebuildInProgressFooter(
  container: HTMLElement,
  onCancel: () => void,
): void {
  const footer = container.querySelector('.air-popup__footer')!;
  while (footer.firstChild) footer.removeChild(footer.firstChild);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'air-popup__btn air-popup__btn--cancel';
  cancelBtn.setAttribute('data-air-el', 'popup-cancel');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => onCancel());
  footer.appendChild(cancelBtn);
}

/** Footer with Accept, Reopen, Cancel buttons (for addressed mode). */
function rebuildAddressedFooter(
  container: HTMLElement,
  callbacks: AddressedCallbacks,
): void {
  const footer = container.querySelector('.air-popup__footer')!;
  while (footer.firstChild) footer.removeChild(footer.firstChild);

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'air-popup__btn air-popup__btn--accept';
  acceptBtn.setAttribute('data-air-el', 'popup-accept');
  acceptBtn.textContent = 'Accept';
  acceptBtn.addEventListener('click', () => callbacks.onAccept());
  footer.appendChild(acceptBtn);

  const reopenBtn = document.createElement('button');
  reopenBtn.className = 'air-popup__btn air-popup__btn--cancel';
  reopenBtn.setAttribute('data-air-el', 'popup-reopen');
  reopenBtn.textContent = 'Reopen';
  reopenBtn.addEventListener('click', () => showReopenForm(container, callbacks.onReopen));
  footer.appendChild(reopenBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'air-popup__btn air-popup__btn--cancel';
  cancelBtn.setAttribute('data-air-el', 'popup-cancel');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => callbacks.onCancel());
  footer.appendChild(cancelBtn);
}

/** Inline reopen form shown inside the popup when Reopen is clicked. */
function showReopenForm(
  container: HTMLElement,
  onReopen: (message?: string) => void,
): void {
  // Don't show multiple forms
  if (container.querySelector('[data-air-el="popup-reopen-form"]')) return;

  const form = document.createElement('div');
  form.className = 'air-reopen-form';
  form.setAttribute('data-air-el', 'popup-reopen-form');
  form.style.cssText = 'padding: 8px 0; margin-top: 8px;';

  const textarea = document.createElement('textarea');
  textarea.className = 'air-popup__textarea';
  textarea.setAttribute('data-air-el', 'popup-reopen-textarea');
  textarea.placeholder = 'Add a follow-up note (optional)…';
  textarea.style.minHeight = '60px';
  form.appendChild(textarea);

  const footer = document.createElement('div');
  footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'air-popup__btn air-popup__btn--cancel';
  cancelBtn.setAttribute('data-air-el', 'popup-reopen-cancel');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => form.remove());
  footer.appendChild(cancelBtn);

  const submitBtn = document.createElement('button');
  submitBtn.className = 'air-popup__btn air-popup__btn--save';
  submitBtn.setAttribute('data-air-el', 'popup-reopen-submit');
  submitBtn.textContent = 'Reopen';
  submitBtn.addEventListener('click', () => {
    const message = textarea.value.trim();
    onReopen(message || undefined);
    form.remove();
  });
  footer.appendChild(submitBtn);

  form.appendChild(footer);
  container.appendChild(form);
  textarea.focus();
}
