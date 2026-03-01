import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createPopup,
  showPopup,
  showEditPopup,
  showInProgressPopup,
  showAddressedPopup,
  hidePopup,
  isPopupVisible,
} from '../../../src/client/ui/popup.js';
import type { PopupCallbacks, PopupElements } from '../../../src/client/ui/popup.js';

describe('popup — positioning', () => {
  let shadowRoot: ShadowRoot;
  let popup: PopupElements;
  let callbacks: PopupCallbacks;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    popup = createPopup(shadowRoot);
    callbacks = { onSave: vi.fn(), onCancel: vi.fn() };
  });

  it('positions above the selection by default', () => {
    // Rect in the middle of the viewport — plenty of room above
    const rect = new DOMRect(200, 400, 100, 20);

    showPopup(popup, 'selected text', rect, callbacks);

    const top = parseFloat(popup.container.style.top);
    // Should be above the selection rect (top - margin)
    expect(top).toBeLessThan(rect.top);
  });

  it('falls back to below when not enough room above', () => {
    // Rect near the top of the viewport — not enough room above
    const rect = new DOMRect(200, 50, 100, 20);

    showPopup(popup, 'selected text', rect, callbacks);

    const top = parseFloat(popup.container.style.top);
    // Should be below the selection rect (rect.bottom + margin)
    expect(top).toBeGreaterThan(rect.top);
  });

  it('constrains left position to stay within viewport', () => {
    // Rect near the right edge
    const rect = new DOMRect(window.innerWidth - 10, 400, 5, 20);

    showPopup(popup, 'selected text', rect, callbacks);

    const left = parseFloat(popup.container.style.left);
    // Should not exceed viewport bounds
    expect(left).toBeLessThan(window.innerWidth);
    expect(left).toBeGreaterThanOrEqual(8); // MARGIN
  });

  it('constrains popup left of open panel', () => {
    // Simulate an open panel in the shadow root
    const panelEl = document.createElement('div');
    panelEl.setAttribute('data-air-el', 'panel');
    panelEl.setAttribute('data-air-state', 'open');
    // In happy-dom, offsetLeft may not be computed from CSS layout,
    // so we set it explicitly via style and use a known viewport width.
    Object.defineProperty(panelEl, 'offsetLeft', { value: 400, configurable: true });
    shadowRoot.appendChild(panelEl);

    // Rect positioned where the popup would overlap the panel
    const rect = new DOMRect(350, 400, 100, 20);

    showPopup(popup, 'selected text', rect, callbacks);

    const left = parseFloat(popup.container.style.left);
    // Popup right edge (left + 300) must not exceed panelEl.offsetLeft - 8
    expect(left + 300).toBeLessThanOrEqual(400 - 8 + 1); // +1 for float tolerance
  });
});

describe('popup — show and hide', () => {
  let shadowRoot: ShadowRoot;
  let popup: PopupElements;
  let callbacks: PopupCallbacks;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    popup = createPopup(shadowRoot);
    callbacks = { onSave: vi.fn(), onCancel: vi.fn() };
  });

  it('showPopup makes popup visible', () => {
    const rect = new DOMRect(200, 400, 100, 20);

    showPopup(popup, 'hello', rect, callbacks);

    expect(isPopupVisible(popup)).toBe(true);
    expect(popup.container.getAttribute('data-air-state')).toBe('visible');
  });

  it('showPopup sets selected text preview with quotes', () => {
    const rect = new DOMRect(200, 400, 100, 20);

    showPopup(popup, 'hello world', rect, callbacks);

    expect(popup.selectedTextPreview.textContent).toBe('"hello world"');
  });

  it('showPopup truncates long selected text', () => {
    const rect = new DOMRect(200, 400, 100, 20);
    const longText = 'A'.repeat(150);

    showPopup(popup, longText, rect, callbacks);

    expect(popup.selectedTextPreview.textContent!.length).toBeLessThan(150);
    expect(popup.selectedTextPreview.textContent).toContain('…');
  });

  it('showPopup clears textarea', () => {
    const rect = new DOMRect(200, 400, 100, 20);
    popup.textarea.value = 'old content';

    showPopup(popup, 'hello', rect, callbacks);

    expect(popup.textarea.value).toBe('');
  });

  it('hidePopup clears textarea and hides element', () => {
    const rect = new DOMRect(200, 400, 100, 20);
    showPopup(popup, 'hello', rect, callbacks);
    popup.textarea.value = 'some note';

    hidePopup(popup);

    expect(isPopupVisible(popup)).toBe(false);
    expect(popup.textarea.value).toBe('');
    expect(popup.container.getAttribute('data-air-state')).toBe('hidden');
  });
});

describe('popup — edit mode', () => {
  let shadowRoot: ShadowRoot;
  let popup: PopupElements;
  let callbacks: PopupCallbacks;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    popup = createPopup(shadowRoot);
    callbacks = { onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn() };
  });

  it('showEditPopup pre-fills textarea with existing note', () => {
    const rect = new DOMRect(200, 400, 100, 20);

    showEditPopup(popup, 'selected text', 'existing note content', rect, callbacks);

    expect(popup.textarea.value).toBe('existing note content');
  });

  it('showEditPopup makes popup visible', () => {
    const rect = new DOMRect(200, 400, 100, 20);

    showEditPopup(popup, 'selected text', 'note', rect, callbacks);

    expect(isPopupVisible(popup)).toBe(true);
  });
});

describe('popup — footer buttons', () => {
  let shadowRoot: ShadowRoot;
  let popup: PopupElements;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    popup = createPopup(shadowRoot);
  });

  it('creates Cancel and Save buttons in new mode (no delete)', () => {
    const callbacks: PopupCallbacks = { onSave: vi.fn(), onCancel: vi.fn() };
    const rect = new DOMRect(200, 400, 100, 20);

    showPopup(popup, 'hello', rect, callbacks);

    const buttons = popup.container.querySelectorAll('.air-popup__footer button');
    const buttonTexts = Array.from(buttons).map(b => b.textContent);

    expect(buttonTexts).toContain('Cancel');
    expect(buttonTexts).toContain('Save');
    expect(buttonTexts).not.toContain('Delete');
  });

  it('creates Delete, Cancel, and Save buttons in edit mode', () => {
    const callbacks: PopupCallbacks = { onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn() };
    const rect = new DOMRect(200, 400, 100, 20);

    showEditPopup(popup, 'hello', 'existing', rect, callbacks);

    const buttons = popup.container.querySelectorAll('.air-popup__footer button');
    const buttonTexts = Array.from(buttons).map(b => b.textContent);

    expect(buttonTexts).toContain('Delete');
    expect(buttonTexts).toContain('Cancel');
    expect(buttonTexts).toContain('Save');
  });

  it('Save button passes textarea value to onSave callback', () => {
    const onSave = vi.fn();
    const callbacks: PopupCallbacks = { onSave, onCancel: vi.fn() };
    const rect = new DOMRect(200, 400, 100, 20);

    showPopup(popup, 'hello', rect, callbacks);
    popup.textarea.value = 'my note';

    const saveBtn = popup.container.querySelector('[data-air-el="popup-save"]') as HTMLButtonElement;
    saveBtn.click();

    expect(onSave).toHaveBeenCalledWith('my note');
  });

  it('Cancel button calls onCancel callback', () => {
    const onCancel = vi.fn();
    const callbacks: PopupCallbacks = { onSave: vi.fn(), onCancel };
    const rect = new DOMRect(200, 400, 100, 20);

    showPopup(popup, 'hello', rect, callbacks);

    const cancelBtn = popup.container.querySelector('[data-air-el="popup-cancel"]') as HTMLButtonElement;
    cancelBtn.click();

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('Delete button calls onDelete callback', () => {
    const onDelete = vi.fn();
    const callbacks: PopupCallbacks = { onSave: vi.fn(), onCancel: vi.fn(), onDelete };
    const rect = new DOMRect(200, 400, 100, 20);

    showEditPopup(popup, 'hello', 'existing', rect, callbacks);

    const deleteBtn = popup.container.querySelector('[data-air-el="popup-delete"]') as HTMLButtonElement;
    deleteBtn.click();

    expect(onDelete).toHaveBeenCalledOnce();
  });
});

describe('popup — ARIA attributes', () => {
  let shadowRoot: ShadowRoot;
  let popup: PopupElements;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    popup = createPopup(shadowRoot);
  });

  it('has role="dialog" and aria-modal="true"', () => {
    expect(popup.container.getAttribute('role')).toBe('dialog');
    expect(popup.container.getAttribute('aria-modal')).toBe('true');
  });

  it('has aria-label for accessibility', () => {
    expect(popup.container.getAttribute('aria-label')).toBe('Add annotation');
  });
});

describe('popup — in_progress mode', () => {
  let shadowRoot: ShadowRoot;
  let popup: PopupElements;
  const rect = new DOMRect(200, 400, 100, 20);

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });
    popup = createPopup(shadowRoot);
  });

  it('renders read-only note text, not a textarea', () => {
    showInProgressPopup(popup, '"some selected text"', 'Fix the typo here', rect, {
      onCancel: vi.fn(),
    });

    // Textarea should be hidden (display: none)
    expect(popup.textarea.style.display).toBe('none');

    // Read-only note should be present
    const noteEl = popup.container.querySelector('[data-air-el="popup-note"]');
    expect(noteEl).not.toBeNull();
    expect(noteEl!.textContent).toBe('Fix the typo here');
  });

  it('shows in_progress status badge', () => {
    showInProgressPopup(popup, '"text"', 'A note', rect, {
      onCancel: vi.fn(),
    });

    const badge = popup.container.querySelector('[data-air-el="popup-status-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('Agent working');
  });

  it('shows Cancel button only (no Save, no Delete)', () => {
    showInProgressPopup(popup, '"text"', 'A note', rect, {
      onCancel: vi.fn(),
    });

    const buttons = popup.container.querySelectorAll('.air-popup__footer button');
    const buttonTexts = Array.from(buttons).map(b => b.textContent);

    expect(buttonTexts).toContain('Cancel');
    expect(buttonTexts).not.toContain('Save');
    expect(buttonTexts).not.toContain('Delete');
  });

  it('Cancel button calls onCancel', () => {
    const onCancel = vi.fn();
    showInProgressPopup(popup, '"text"', 'A note', rect, { onCancel });

    const cancelBtn = popup.container.querySelector('[data-air-el="popup-cancel"]') as HTMLButtonElement;
    cancelBtn.click();

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows latest agent reply when provided', () => {
    showInProgressPopup(popup, '"text"', 'A note', rect, {
      onCancel: vi.fn(),
    }, { message: 'Working on it now', createdAt: '2026-03-01T12:00:00Z', role: 'agent' });

    const reply = popup.container.querySelector('[data-air-el="popup-reply"]');
    expect(reply).not.toBeNull();
    expect(reply!.textContent).toContain('Working on it now');
  });

  it('does not show reply block when no reply provided', () => {
    showInProgressPopup(popup, '"text"', 'A note', rect, {
      onCancel: vi.fn(),
    });

    const reply = popup.container.querySelector('[data-air-el="popup-reply"]');
    expect(reply).toBeNull();
  });

  it('makes popup visible', () => {
    showInProgressPopup(popup, '"text"', 'A note', rect, {
      onCancel: vi.fn(),
    });

    expect(isPopupVisible(popup)).toBe(true);
  });
});

describe('popup — addressed mode', () => {
  let shadowRoot: ShadowRoot;
  let popup: PopupElements;
  const rect = new DOMRect(200, 400, 100, 20);

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });
    popup = createPopup(shadowRoot);
  });

  it('renders read-only note text, not a textarea', () => {
    showAddressedPopup(popup, '"some text"', 'Change this colour', rect, {
      onAccept: vi.fn(),
      onReopen: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(popup.textarea.style.display).toBe('none');

    const noteEl = popup.container.querySelector('[data-air-el="popup-note"]');
    expect(noteEl).not.toBeNull();
    expect(noteEl!.textContent).toBe('Change this colour');
  });

  it('shows addressed status badge', () => {
    showAddressedPopup(popup, '"text"', 'A note', rect, {
      onAccept: vi.fn(),
      onReopen: vi.fn(),
      onCancel: vi.fn(),
    });

    const badge = popup.container.querySelector('[data-air-el="popup-status-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('Addressed');
  });

  it('shows Accept, Reopen, and Cancel buttons (no Save, no Delete)', () => {
    showAddressedPopup(popup, '"text"', 'A note', rect, {
      onAccept: vi.fn(),
      onReopen: vi.fn(),
      onCancel: vi.fn(),
    });

    const buttons = popup.container.querySelectorAll('.air-popup__footer button');
    const buttonTexts = Array.from(buttons).map(b => b.textContent);

    expect(buttonTexts).toContain('Accept');
    expect(buttonTexts).toContain('Reopen');
    expect(buttonTexts).toContain('Cancel');
    expect(buttonTexts).not.toContain('Save');
    expect(buttonTexts).not.toContain('Delete');
  });

  it('Accept button calls onAccept', () => {
    const onAccept = vi.fn();
    showAddressedPopup(popup, '"text"', 'A note', rect, {
      onAccept,
      onReopen: vi.fn(),
      onCancel: vi.fn(),
    });

    const acceptBtn = popup.container.querySelector('[data-air-el="popup-accept"]') as HTMLButtonElement;
    acceptBtn.click();

    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('Reopen button shows inline reopen form', () => {
    showAddressedPopup(popup, '"text"', 'A note', rect, {
      onAccept: vi.fn(),
      onReopen: vi.fn(),
      onCancel: vi.fn(),
    });

    const reopenBtn = popup.container.querySelector('[data-air-el="popup-reopen"]') as HTMLButtonElement;
    reopenBtn.click();

    const form = popup.container.querySelector('[data-air-el="popup-reopen-form"]');
    expect(form).not.toBeNull();

    const textarea = form!.querySelector('[data-air-el="popup-reopen-textarea"]');
    expect(textarea).not.toBeNull();
  });

  it('Reopen form submit calls onReopen with message', () => {
    const onReopen = vi.fn();
    showAddressedPopup(popup, '"text"', 'A note', rect, {
      onAccept: vi.fn(),
      onReopen,
      onCancel: vi.fn(),
    });

    // Open the reopen form
    const reopenBtn = popup.container.querySelector('[data-air-el="popup-reopen"]') as HTMLButtonElement;
    reopenBtn.click();

    // Type a message and submit
    const textarea = popup.container.querySelector('[data-air-el="popup-reopen-textarea"]') as HTMLTextAreaElement;
    textarea.value = 'Not quite right, please adjust';

    const submitBtn = popup.container.querySelector('[data-air-el="popup-reopen-submit"]') as HTMLButtonElement;
    submitBtn.click();

    expect(onReopen).toHaveBeenCalledWith('Not quite right, please adjust');
  });

  it('Reopen form submit calls onReopen with undefined when message is empty', () => {
    const onReopen = vi.fn();
    showAddressedPopup(popup, '"text"', 'A note', rect, {
      onAccept: vi.fn(),
      onReopen,
      onCancel: vi.fn(),
    });

    const reopenBtn = popup.container.querySelector('[data-air-el="popup-reopen"]') as HTMLButtonElement;
    reopenBtn.click();

    const submitBtn = popup.container.querySelector('[data-air-el="popup-reopen-submit"]') as HTMLButtonElement;
    submitBtn.click();

    expect(onReopen).toHaveBeenCalledWith(undefined);
  });

  it('Reopen form cancel removes the form', () => {
    showAddressedPopup(popup, '"text"', 'A note', rect, {
      onAccept: vi.fn(),
      onReopen: vi.fn(),
      onCancel: vi.fn(),
    });

    const reopenBtn = popup.container.querySelector('[data-air-el="popup-reopen"]') as HTMLButtonElement;
    reopenBtn.click();

    expect(popup.container.querySelector('[data-air-el="popup-reopen-form"]')).not.toBeNull();

    const cancelFormBtn = popup.container.querySelector('[data-air-el="popup-reopen-cancel"]') as HTMLButtonElement;
    cancelFormBtn.click();

    expect(popup.container.querySelector('[data-air-el="popup-reopen-form"]')).toBeNull();
  });

  it('shows latest agent reply when provided', () => {
    showAddressedPopup(popup, '"text"', 'A note', rect, {
      onAccept: vi.fn(),
      onReopen: vi.fn(),
      onCancel: vi.fn(),
    }, { message: 'Changed colour to blue', createdAt: '2026-03-01T12:00:00Z', role: 'agent' });

    const reply = popup.container.querySelector('[data-air-el="popup-reply"]');
    expect(reply).not.toBeNull();
    expect(reply!.textContent).toContain('Changed colour to blue');
  });

  it('Cancel button calls onCancel', () => {
    const onCancel = vi.fn();
    showAddressedPopup(popup, '"text"', 'A note', rect, {
      onAccept: vi.fn(),
      onReopen: vi.fn(),
      onCancel,
    });

    const cancelBtn = popup.container.querySelector('[data-air-el="popup-cancel"]') as HTMLButtonElement;
    cancelBtn.click();

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('makes popup visible', () => {
    showAddressedPopup(popup, '"text"', 'A note', rect, {
      onAccept: vi.fn(),
      onReopen: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(isPopupVisible(popup)).toBe(true);
  });
});
