import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { ReviewMediator } from '../../src/client/mediator.js';
import type { ReviewStore, TextAnnotation, ElementAnnotation } from '../../src/shared/types.js';
import type { PopupElements } from '../../src/client/ui/popup.js';

// --- Module mocks (hoisted by vitest) ---

vi.mock('../../src/client/api.js', () => ({
  api: {
    getStore: vi.fn(),
    createAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    reanchorAnnotation: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock('../../src/client/ui/popup.js', () => ({
  createPopup: vi.fn(),
  showPopup: vi.fn(),
  showEditPopup: vi.fn(),
  showElementPopup: vi.fn(),
  showEditElementPopup: vi.fn(),
  hidePopup: vi.fn(),
  isPopupVisible: vi.fn(() => false),
  hasUnsavedText: vi.fn(() => false),
}));

vi.mock('../../src/client/highlights.js', () => ({
  HIGHLIGHT_ATTR: 'data-air-id',
  ELEMENT_HIGHLIGHT_ATTR: 'data-air-element-id',
  applyHighlight: vi.fn(),
  removeHighlight: vi.fn(),
  pulseHighlight: vi.fn(),
  getHighlightMarks: vi.fn(() => []),
  applyElementHighlight: vi.fn(),
  removeElementHighlight: vi.fn(),
  pulseElementHighlight: vi.fn(),
  getElementByAnnotationId: vi.fn(),
  removeAllElementHighlights: vi.fn(),
}));

vi.mock('../../src/client/cache.js', () => ({
  readCache: vi.fn(() => null),
  writeCache: vi.fn(),
}));

vi.mock('../../src/client/element-selector.js', () => ({
  buildElementSelector: vi.fn(() => ({
    cssSelector: 'div.target',
    xpath: '/html[1]/body[1]/div[1]',
    description: 'div.target',
    tagName: 'div',
    attributes: { class: 'target' },
    outerHtmlPreview: '<div class="target"></div>',
  })),
  resolveElement: vi.fn(),
}));

vi.mock('../../src/client/selection.js', () => ({
  serializeRange: vi.fn(() => ({
    startXPath: '/html[1]/body[1]/p[1]/text()[1]',
    startOffset: 0,
    endXPath: '/html[1]/body[1]/p[1]/text()[1]',
    endOffset: 5,
    selectedText: 'Hello',
    contextBefore: '',
    contextAfter: ' world',
  })),
  deserializeRange: vi.fn(),
  findRangeByContext: vi.fn(),
  findRangeByContextSeam: vi.fn(),
}));

vi.mock('../../src/client/ui/fab.js', () => ({
  updateBadge: vi.fn(),
  createFab: vi.fn(),
  resetFab: vi.fn(),
}));

vi.mock('../../src/client/ui/toast.js', () => ({
  showToast: vi.fn(),
}));

// --- Imports (after mock declarations) ---

import { createAnnotator, type AnnotatorInstance } from '../../src/client/annotator.js';
import { api } from '../../src/client/api.js';
import {
  createPopup,
  showPopup,
  showEditPopup,
  showElementPopup,
  showEditElementPopup,
  hidePopup,
  isPopupVisible,
  hasUnsavedText,
} from '../../src/client/ui/popup.js';
import {
  applyHighlight,
  removeHighlight,
  getHighlightMarks,
  applyElementHighlight,
  removeAllElementHighlights,
} from '../../src/client/highlights.js';
import { readCache, writeCache } from '../../src/client/cache.js';
import { buildElementSelector, resolveElement } from '../../src/client/element-selector.js';
import { serializeRange, deserializeRange, findRangeByContext, findRangeByContextSeam } from '../../src/client/selection.js';
import { updateBadge } from '../../src/client/ui/fab.js';
import { showToast } from '../../src/client/ui/toast.js';

// --- Helpers ---

function makeTextAnnotation(overrides: Partial<TextAnnotation> = {}): TextAnnotation {
  return {
    id: 'ann-1',
    type: 'text',
    pageUrl: window.location.pathname,
    pageTitle: 'Test',
    selectedText: 'Hello',
    note: 'test note',
    range: {
      startXPath: '/html[1]/body[1]/p[1]/text()[1]',
      startOffset: 0,
      endXPath: '/html[1]/body[1]/p[1]/text()[1]',
      endOffset: 5,
      selectedText: 'Hello',
      contextBefore: '',
      contextAfter: ' world',
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeElementAnnotation(overrides: Partial<ElementAnnotation> = {}): ElementAnnotation {
  return {
    id: 'el-ann-1',
    type: 'element',
    pageUrl: window.location.pathname,
    pageTitle: 'Test',
    note: 'element note',
    elementSelector: {
      cssSelector: 'div.target',
      xpath: '/html[1]/body[1]/div[1]',
      description: 'div.target',
      tagName: 'div',
      attributes: { class: 'target' },
      outerHtmlPreview: '<div class="target"></div>',
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeStore(
  annotations: (TextAnnotation | ElementAnnotation)[] = [],
  pageNotes: ReviewStore['pageNotes'] = [],
): ReviewStore {
  return { version: 1, annotations, pageNotes };
}

/** Mock window.getSelection() to return a selection containing the given range. */
function mockSelection(range: Range): () => void {
  const mockSel = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: vi.fn(() => range),
    removeAllRanges: vi.fn(),
  };
  const spy = vi.spyOn(window, 'getSelection').mockReturnValue(mockSel as unknown as Selection);
  return () => spy.mockRestore();
}

// --- Tests ---

describe('createAnnotator', () => {
  let host: HTMLDivElement;
  let shadowRoot: ShadowRoot;
  let badge: HTMLSpanElement;
  let mediator: ReviewMediator;
  let annotator: AnnotatorInstance;
  let mockPopup: PopupElements;
  let restoreSelection: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();

    host = document.createElement('div');
    host.setAttribute('data-air-el', 'host');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    badge = document.createElement('span');

    mediator = {
      refreshPanel: vi.fn().mockResolvedValue(undefined),
      restoreHighlights: vi.fn().mockResolvedValue(undefined),
    };

    mockPopup = {
      container: document.createElement('div'),
      textarea: document.createElement('textarea'),
      selectedTextPreview: document.createElement('div'),
    };
    (createPopup as Mock).mockReturnValue(mockPopup);
  });

  afterEach(() => {
    if (annotator) annotator.destroy();
    if (restoreSelection) {
      restoreSelection();
      restoreSelection = null;
    }
  });

  function initAnnotator(): AnnotatorInstance {
    annotator = createAnnotator({ shadowRoot, badge, mediator });
    return annotator;
  }

  // =========================================================
  // 1. Text Selection Flow
  // =========================================================

  describe('text selection flow', () => {
    it('shows popup on mouseup with valid text selection', () => {
      initAnnotator();

      const p = document.createElement('p');
      p.textContent = 'Hello world';
      document.body.appendChild(p);

      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.firstChild!, 5);

      restoreSelection = mockSelection(range);

      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      expect(showPopup).toHaveBeenCalledTimes(1);
      // Second arg is the trimmed selected text
      expect((showPopup as Mock).mock.calls[0][1]).toBe('Hello');
    });

    it('ignores mouseup with whitespace-only selection', () => {
      initAnnotator();

      const p = document.createElement('p');
      p.textContent = '     ';
      document.body.appendChild(p);

      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.firstChild!, 3);

      restoreSelection = mockSelection(range);

      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      expect(showPopup).not.toHaveBeenCalled();
    });

    it('ignores mouseup inside shadow DOM host', () => {
      initAnnotator();

      // Dispatch on the shadow host itself — should be ignored
      host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      expect(showPopup).not.toHaveBeenCalled();
    });

    it('ignores mouseup with altKey (reserved for element annotation)', () => {
      initAnnotator();

      const p = document.createElement('p');
      p.textContent = 'Hello world';
      document.body.appendChild(p);

      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.firstChild!, 5);

      restoreSelection = mockSelection(range);

      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, altKey: true }));

      expect(showPopup).not.toHaveBeenCalled();
    });
  });

  // =========================================================
  // 2. Element Annotation Flow
  // =========================================================

  describe('element annotation flow', () => {
    it('captures element selector on Alt+click and shows element popup', () => {
      initAnnotator();

      const target = document.createElement('div');
      target.className = 'target';
      document.body.appendChild(target);

      target.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        altKey: true,
      }));

      expect(buildElementSelector).toHaveBeenCalledWith(target);
      expect(showElementPopup).toHaveBeenCalledTimes(1);
      // Second arg is the element description
      expect((showElementPopup as Mock).mock.calls[0][1]).toBe('div.target');
    });

    it('ignores Alt+click on shadow DOM host', () => {
      initAnnotator();

      host.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        altKey: true,
      }));

      expect(buildElementSelector).not.toHaveBeenCalled();
      expect(showElementPopup).not.toHaveBeenCalled();
    });

    it('creates and removes inspector overlay on Alt key', () => {
      initAnnotator();

      const target = document.createElement('div');
      target.className = 'target';
      target.textContent = 'inspect me';
      document.body.appendChild(target);

      // Press Alt
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));

      // Move mouse over target
      target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

      // Overlay should exist in the light DOM
      expect(document.querySelector('[data-air-el="inspector-overlay"]')).not.toBeNull();
      expect(document.querySelector('[data-air-el="inspector-label"]')).not.toBeNull();

      // Release Alt
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', bubbles: true }));

      // Overlay should be removed
      expect(document.querySelector('[data-air-el="inspector-overlay"]')).toBeNull();
    });

    it('does not create inspector overlay when Alt is not pressed', () => {
      initAnnotator();

      const target = document.createElement('div');
      target.className = 'target';
      document.body.appendChild(target);

      target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

      expect(document.querySelector('[data-air-el="inspector-overlay"]')).toBeNull();
    });
  });

  // =========================================================
  // 3. Scroll Dismissal
  // =========================================================

  describe('scroll dismissal', () => {
    /**
     * Helper: trigger a text selection to set popupScrollY, then make
     * isPopupVisible return true so the scroll handler's guard passes.
     */
    function setupVisiblePopup(): void {
      const p = document.createElement('p');
      p.textContent = 'Hello world';
      document.body.appendChild(p);

      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.firstChild!, 5);

      restoreSelection = mockSelection(range);

      // Trigger selection → sets popupScrollY to current scrollY (0)
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      // Now make isPopupVisible return true for subsequent scroll checks
      (isPopupVisible as Mock).mockReturnValue(true);
    }

    /** Simulate scrolling past the 50px threshold */
    function scrollPast50(): void {
      Object.defineProperty(window, 'scrollY', {
        value: 100,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('scroll'));
    }

    afterEach(() => {
      // Reset scrollY to default
      Object.defineProperty(window, 'scrollY', {
        value: 0,
        writable: true,
        configurable: true,
      });
      (isPopupVisible as Mock).mockReturnValue(false);
    });

    it('does NOT dismiss popup when textarea is focused but empty', () => {
      initAnnotator();
      setupVisiblePopup();

      // Place textarea inside container and container inside shadowRoot
      // so shadowRoot.activeElement works correctly
      mockPopup.container.appendChild(mockPopup.textarea);
      shadowRoot.appendChild(mockPopup.container);

      mockPopup.textarea.value = '';
      mockPopup.textarea.focus();

      // Clear any hidePopup calls from setup
      (hidePopup as Mock).mockClear();

      scrollPast50();

      expect(hidePopup).not.toHaveBeenCalled();
    });

    it('does NOT dismiss popup when textarea has content', () => {
      vi.useFakeTimers();
      try {
        initAnnotator();
        setupVisiblePopup();

        (hasUnsavedText as Mock).mockReturnValue(true);
        vi.advanceTimersByTime(500);

        // Clear any hidePopup calls from setup
        (hidePopup as Mock).mockClear();

        scrollPast50();

        expect(hidePopup).not.toHaveBeenCalled();
      } finally {
        (hasUnsavedText as Mock).mockReturnValue(false);
        vi.useRealTimers();
      }
    });

    it('dismisses popup when no focus and no content after grace period', () => {
      vi.useFakeTimers();
      try {
        initAnnotator();
        setupVisiblePopup();

        mockPopup.textarea.value = '';
        // Ensure nothing in popup is focused — blur and don't re-focus
        mockPopup.textarea.blur();

        // Advance past the 400ms grace period
        vi.advanceTimersByTime(500);

        // Clear any hidePopup calls from setup
        (hidePopup as Mock).mockClear();

        scrollPast50();

        expect(hidePopup).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does NOT dismiss popup during grace period even without focus', () => {
      vi.useFakeTimers();
      try {
        initAnnotator();
        setupVisiblePopup();

        mockPopup.textarea.value = '';
        // Ensure nothing in popup is focused
        mockPopup.textarea.blur();

        // Still within the 400ms grace period
        vi.advanceTimersByTime(100);

        // Clear any hidePopup calls from setup
        (hidePopup as Mock).mockClear();

        scrollPast50();

        expect(hidePopup).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does NOT dismiss popup when a button inside popup is focused', () => {
      initAnnotator();
      setupVisiblePopup();

      // Add a button inside the popup container (like Save or Cancel)
      const button = document.createElement('button');
      mockPopup.container.appendChild(button);
      mockPopup.container.appendChild(mockPopup.textarea);
      shadowRoot.appendChild(mockPopup.container);

      mockPopup.textarea.value = '';
      button.focus();

      // Clear any hidePopup calls from setup
      (hidePopup as Mock).mockClear();

      scrollPast50();

      expect(hidePopup).not.toHaveBeenCalled();
    });
  });

  // =========================================================
  // 3b. Click-outside Dismissal
  // =========================================================

  describe('click-outside dismissal', () => {
    function setupVisiblePopup(): void {
      const p = document.createElement('p');
      p.textContent = 'Hello world';
      document.body.appendChild(p);

      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.firstChild!, 5);

      restoreSelection = mockSelection(range);

      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      (isPopupVisible as Mock).mockReturnValue(true);
    }

    afterEach(() => {
      (isPopupVisible as Mock).mockReturnValue(false);
      (hasUnsavedText as Mock).mockReturnValue(false);
    });

    it('dismisses popup on mousedown outside popup after grace period', () => {
      vi.useFakeTimers();
      try {
        initAnnotator();
        setupVisiblePopup();

        vi.advanceTimersByTime(500);
        (hidePopup as Mock).mockClear();

        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(hidePopup).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does NOT dismiss popup on mousedown outside during grace period', () => {
      vi.useFakeTimers();
      try {
        initAnnotator();
        setupVisiblePopup();

        vi.advanceTimersByTime(100);
        (hidePopup as Mock).mockClear();

        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(hidePopup).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does NOT dismiss popup when hasUnsavedText returns true', () => {
      vi.useFakeTimers();
      try {
        initAnnotator();
        setupVisiblePopup();

        (hasUnsavedText as Mock).mockReturnValue(true);
        vi.advanceTimersByTime(500);
        (hidePopup as Mock).mockClear();

        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(hidePopup).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does NOT dismiss popup on mousedown inside popup container', () => {
      vi.useFakeTimers();
      try {
        initAnnotator();
        setupVisiblePopup();

        vi.advanceTimersByTime(500);
        (hidePopup as Mock).mockClear();

        // Dispatch mousedown from within the popup container
        const innerEl = document.createElement('button');
        mockPopup.container.appendChild(innerEl);
        innerEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));

        expect(hidePopup).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // =========================================================
  // 4. Save Flows
  // =========================================================

  describe('save flows', () => {
    it('handleSave creates annotation via API and applies highlight', async () => {
      initAnnotator();

      const p = document.createElement('p');
      p.textContent = 'Hello world';
      document.body.appendChild(p);

      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.firstChild!, 5);

      restoreSelection = mockSelection(range);

      const newAnnotation = makeTextAnnotation({ id: 'new-1' });
      (api.createAnnotation as Mock).mockResolvedValue(newAnnotation);
      (api.getStore as Mock).mockResolvedValue(makeStore([newAnnotation]));

      // Trigger selection popup
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      expect(showPopup).toHaveBeenCalledTimes(1);

      // Invoke save callback (4th arg to showPopup)
      const callbacks = (showPopup as Mock).mock.calls[0][3];
      await callbacks.onSave('my note');

      expect(api.createAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'text',
          note: 'my note',
          selectedText: 'Hello',
        }),
      );
      expect(hidePopup).toHaveBeenCalled();
      expect(applyHighlight).toHaveBeenCalled();
      expect(writeCache).toHaveBeenCalled();
      expect(updateBadge).toHaveBeenCalled();
    });

    it('handleElementSave creates element annotation via API', async () => {
      initAnnotator();

      const target = document.createElement('div');
      target.className = 'target';
      document.body.appendChild(target);

      const newAnnotation = makeElementAnnotation({ id: 'el-new-1' });
      (api.createAnnotation as Mock).mockResolvedValue(newAnnotation);
      (api.getStore as Mock).mockResolvedValue(makeStore([newAnnotation]));

      // Alt+click to trigger element popup
      target.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        altKey: true,
      }));
      expect(showElementPopup).toHaveBeenCalledTimes(1);

      // Invoke save callback (4th arg to showElementPopup)
      const callbacks = (showElementPopup as Mock).mock.calls[0][3];
      await callbacks.onSave('element note');

      expect(api.createAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'element',
          note: 'element note',
        }),
      );
      expect(hidePopup).toHaveBeenCalled();
      expect(applyElementHighlight).toHaveBeenCalled();
      expect(writeCache).toHaveBeenCalled();
    });
  });

  // =========================================================
  // 5. Edit Flows
  // =========================================================

  describe('edit flows', () => {
    it('clicking text highlight shows edit popup with existing note', () => {
      initAnnotator();

      const mark = document.createElement('mark');
      mark.setAttribute('data-air-id', 'ann-1');
      mark.textContent = 'Hello';
      document.body.appendChild(mark);

      const annotation = makeTextAnnotation({ id: 'ann-1', note: 'existing note' });
      (readCache as Mock).mockReturnValue(makeStore([annotation]));

      mark.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      expect(showEditPopup).toHaveBeenCalledTimes(1);
      // Args: (popup, selectedText, existingNote, rect, callbacks)
      expect((showEditPopup as Mock).mock.calls[0][1]).toBe('Hello');
      expect((showEditPopup as Mock).mock.calls[0][2]).toBe('existing note');
    });

    it('saving edit updates annotation via API', async () => {
      initAnnotator();

      const mark = document.createElement('mark');
      mark.setAttribute('data-air-id', 'ann-1');
      mark.textContent = 'Hello';
      document.body.appendChild(mark);

      const annotation = makeTextAnnotation({ id: 'ann-1', note: 'old note' });
      (readCache as Mock).mockReturnValue(makeStore([annotation]));
      (api.updateAnnotation as Mock).mockResolvedValue({ ...annotation, note: 'new note' });
      (api.getStore as Mock).mockResolvedValue(makeStore([{ ...annotation, note: 'new note' }]));

      mark.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      // 5th arg (index 4) is the callbacks
      const callbacks = (showEditPopup as Mock).mock.calls[0][4];
      await callbacks.onSave('new note');

      expect(hidePopup).toHaveBeenCalled();
      expect(api.updateAnnotation).toHaveBeenCalledWith('ann-1', { note: 'new note' });
    });

    it('clicking element highlight shows edit element popup', () => {
      initAnnotator();

      const div = document.createElement('div');
      div.setAttribute('data-air-element-id', 'el-ann-1');
      document.body.appendChild(div);

      const annotation = makeElementAnnotation({ id: 'el-ann-1', note: 'element note' });
      (readCache as Mock).mockReturnValue(makeStore([annotation]));

      div.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      expect(showEditElementPopup).toHaveBeenCalledTimes(1);
      // Args: (popup, description, existingNote, rect, callbacks)
      expect((showEditElementPopup as Mock).mock.calls[0][2]).toBe('element note');
    });

    it('delete removes highlight and calls API', async () => {
      initAnnotator();

      const mark = document.createElement('mark');
      mark.setAttribute('data-air-id', 'ann-1');
      mark.textContent = 'Hello';
      document.body.appendChild(mark);

      const annotation = makeTextAnnotation({ id: 'ann-1' });
      (readCache as Mock).mockReturnValue(makeStore([annotation]));
      (api.deleteAnnotation as Mock).mockResolvedValue(undefined);
      (api.getStore as Mock).mockResolvedValue(makeStore([]));

      mark.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      const callbacks = (showEditPopup as Mock).mock.calls[0][4];
      await callbacks.onDelete();

      expect(hidePopup).toHaveBeenCalled();
      expect(api.deleteAnnotation).toHaveBeenCalledWith('ann-1');
      expect(removeHighlight).toHaveBeenCalledWith('ann-1');
    });
  });

  // =========================================================
  // 6. Restore Highlights
  // =========================================================

  describe('restoreHighlights', () => {
    it('applies highlights for all page annotations', async () => {
      initAnnotator();

      const ann1 = makeTextAnnotation({ id: 'ann-1' });
      const ann2 = makeTextAnnotation({ id: 'ann-2' });
      const store = makeStore([ann1, ann2]);
      (api.getStore as Mock).mockResolvedValue(store);

      const mockRange = document.createRange();
      (deserializeRange as Mock).mockReturnValue(mockRange);

      await annotator.restoreHighlights();

      expect(api.getStore).toHaveBeenCalled();
      expect(writeCache).toHaveBeenCalledWith(store);
      expect(applyHighlight).toHaveBeenCalledTimes(2);
      expect(updateBadge).toHaveBeenCalledWith(badge, 2);
    });

    it('falls back to context matching when XPath fails (Tier 2)', async () => {
      initAnnotator();

      const ann = makeTextAnnotation({ id: 'ann-1' });
      const store = makeStore([ann]);
      (api.getStore as Mock).mockResolvedValue(store);

      // Tier 1 fails
      (deserializeRange as Mock).mockReturnValue(null);

      // Tier 2 succeeds
      const fallbackRange = document.createRange();
      (findRangeByContext as Mock).mockReturnValue(fallbackRange);

      await annotator.restoreHighlights();

      expect(deserializeRange).toHaveBeenCalledWith(ann.range);
      expect(findRangeByContext).toHaveBeenCalledWith(
        ann.range.selectedText,
        ann.range.contextBefore,
        ann.range.contextAfter,
      );
      expect(applyHighlight).toHaveBeenCalledWith(fallbackRange, 'ann-1', 'open');
    });

    it('falls back to replacedText context matching when Tier 1 and Tier 2 fail (Tier 2.5)', async () => {
      initAnnotator();

      const ann = makeTextAnnotation({
        id: 'ann-1',
        selectedText: 'original text',
        replacedText: 'replacement text',
        range: {
          startXPath: '/html[1]/body[1]/p[1]/text()[1]',
          startOffset: 0,
          endXPath: '/html[1]/body[1]/p[1]/text()[1]',
          endOffset: 13,
          selectedText: 'original text',
          contextBefore: 'before ',
          contextAfter: ' after',
        },
      });
      const store = makeStore([ann]);
      (api.getStore as Mock).mockResolvedValue(store);

      // Tier 1 fails — XPath resolve returns null
      (deserializeRange as Mock).mockReturnValue(null);

      // Tier 2 fails — original text not found in page
      // Tier 2.5 succeeds — replacement text is present
      const tier25Range = document.createRange();
      (findRangeByContext as Mock)
        .mockReturnValueOnce(null)      // Tier 2: original text not found
        .mockReturnValueOnce(tier25Range); // Tier 2.5: replacement text found

      await annotator.restoreHighlights();

      // Tier 2 call uses original selectedText
      expect(findRangeByContext).toHaveBeenNthCalledWith(
        1,
        ann.range.selectedText,
        ann.range.contextBefore,
        ann.range.contextAfter,
      );

      // Tier 2.5 call uses replacedText
      expect(findRangeByContext).toHaveBeenNthCalledWith(
        2,
        ann.replacedText,
        ann.range.contextBefore,
        ann.range.contextAfter,
      );

      // Highlight applied using the Tier 2.5 range
      expect(applyHighlight).toHaveBeenCalledWith(tier25Range, 'ann-1', 'open');
    });

    it('leaves annotation as orphan when all tiers including Tier 2.5 fail', async () => {
      initAnnotator();

      const ann = makeTextAnnotation({
        id: 'ann-1',
        selectedText: 'original text',
        replacedText: 'replacement text',
      });
      const store = makeStore([ann]);
      (api.getStore as Mock).mockResolvedValue(store);

      // All tiers fail
      (deserializeRange as Mock).mockReturnValue(null);
      (findRangeByContext as Mock).mockReturnValue(null);

      await annotator.restoreHighlights();

      // No highlight applied — annotation is orphaned
      expect(applyHighlight).not.toHaveBeenCalled();
      expect(updateBadge).toHaveBeenCalledWith(badge, 1);
    });

    it('leaves annotation as orphan when Tier 1 and Tier 2 fail and no replacedText (Tier 3)', async () => {
      initAnnotator();

      const ann = makeTextAnnotation({ id: 'ann-1' });
      const store = makeStore([ann]);
      (api.getStore as Mock).mockResolvedValue(store);

      // Both tiers fail
      (deserializeRange as Mock).mockReturnValue(null);
      (findRangeByContext as Mock).mockReturnValue(null);

      await annotator.restoreHighlights();

      // No highlight applied — annotation is orphaned
      expect(applyHighlight).not.toHaveBeenCalled();
      // Badge still reflects the annotation count
      expect(updateBadge).toHaveBeenCalledWith(badge, 1);
    });

    it('restores element annotations via resolveElement', async () => {
      initAnnotator();

      const ann = makeElementAnnotation({ id: 'el-ann-1' });
      const store = makeStore([ann]);
      (api.getStore as Mock).mockResolvedValue(store);

      const target = document.createElement('div');
      (resolveElement as Mock).mockReturnValue(target);

      await annotator.restoreHighlights();

      expect(resolveElement).toHaveBeenCalledWith(ann.elementSelector);
      expect(applyElementHighlight).toHaveBeenCalledWith(target, 'el-ann-1', 'open');
    });

    it('removes existing highlights before restoring', async () => {
      initAnnotator();

      // Add an existing mark to the DOM
      const mark = document.createElement('mark');
      mark.setAttribute('data-air-id', 'old-1');
      document.body.appendChild(mark);

      (api.getStore as Mock).mockResolvedValue(makeStore([]));

      await annotator.restoreHighlights();

      expect(removeHighlight).toHaveBeenCalledWith('old-1');
      expect(removeAllElementHighlights).toHaveBeenCalled();
    });

    it('re-anchors annotation after Tier 2.5 match (replacedText)', async () => {
      initAnnotator();

      const ann = makeTextAnnotation({
        id: 'ann-1',
        selectedText: 'original text',
        replacedText: 'replacement text',
        range: {
          startXPath: '/html[1]/body[1]/p[1]/text()[1]',
          startOffset: 0,
          endXPath: '/html[1]/body[1]/p[1]/text()[1]',
          endOffset: 13,
          selectedText: 'original text',
          contextBefore: 'before ',
          contextAfter: ' after',
        },
      });
      const store = makeStore([ann]);
      (api.getStore as Mock).mockResolvedValue(store);

      // Tier 1 fails
      (deserializeRange as Mock).mockReturnValue(null);

      // Tier 2 fails, Tier 2.5 succeeds
      const tier25Range = document.createRange();
      (findRangeByContext as Mock)
        .mockReturnValueOnce(null)       // Tier 2
        .mockReturnValueOnce(tier25Range); // Tier 2.5

      const freshRange = {
        startXPath: '/html[1]/body[1]/p[1]/text()[1]',
        startOffset: 7,
        endXPath: '/html[1]/body[1]/p[1]/text()[1]',
        endOffset: 23,
        selectedText: 'replacement text',
        contextBefore: 'before ',
        contextAfter: ' after',
      };
      (serializeRange as Mock).mockReturnValue(freshRange);
      (api.reanchorAnnotation as Mock).mockResolvedValue({});

      await annotator.restoreHighlights();

      expect(serializeRange).toHaveBeenCalledWith(tier25Range);
      expect(api.reanchorAnnotation).toHaveBeenCalledWith('ann-1', freshRange, true);
    });

    it('re-anchors annotation after Tier 3 match (context seam)', async () => {
      initAnnotator();

      const ann = makeTextAnnotation({
        id: 'ann-1',
        selectedText: 'original text',
        range: {
          startXPath: '/html[1]/body[1]/p[1]/text()[1]',
          startOffset: 0,
          endXPath: '/html[1]/body[1]/p[1]/text()[1]',
          endOffset: 13,
          selectedText: 'original text',
          contextBefore: 'before ',
          contextAfter: ' after',
        },
      });
      const store = makeStore([ann]);
      (api.getStore as Mock).mockResolvedValue(store);

      // Tier 1, 2 fail — no replacedText so Tier 2.5 is skipped
      (deserializeRange as Mock).mockReturnValue(null);
      (findRangeByContext as Mock).mockReturnValue(null);

      // Tier 3 succeeds
      const tier3Range = document.createRange();
      (findRangeByContextSeam as Mock).mockReturnValue(tier3Range);

      const freshRange = {
        startXPath: '/html[1]/body[1]/p[1]/text()[1]',
        startOffset: 7,
        endXPath: '/html[1]/body[1]/p[1]/text()[1]',
        endOffset: 20,
        selectedText: 'rewritten text',
        contextBefore: 'before ',
        contextAfter: ' after',
      };
      (serializeRange as Mock).mockReturnValue(freshRange);
      (api.reanchorAnnotation as Mock).mockResolvedValue({});

      await annotator.restoreHighlights();

      expect(serializeRange).toHaveBeenCalledWith(tier3Range);
      // No replacedText on this annotation, so clearReplacedText should be false
      expect(api.reanchorAnnotation).toHaveBeenCalledWith('ann-1', freshRange, false);
    });

    it('does NOT re-anchor after Tier 1 match', async () => {
      initAnnotator();

      const ann = makeTextAnnotation({ id: 'ann-1' });
      const store = makeStore([ann]);
      (api.getStore as Mock).mockResolvedValue(store);

      // Tier 1 succeeds
      const tier1Range = document.createRange();
      (deserializeRange as Mock).mockReturnValue(tier1Range);

      await annotator.restoreHighlights();

      expect(applyHighlight).toHaveBeenCalledWith(tier1Range, 'ann-1', 'open');
      expect(api.reanchorAnnotation).not.toHaveBeenCalled();
    });

    it('does NOT re-anchor after Tier 2 match (original text found by context)', async () => {
      initAnnotator();

      const ann = makeTextAnnotation({ id: 'ann-1' });
      const store = makeStore([ann]);
      (api.getStore as Mock).mockResolvedValue(store);

      // Tier 1 fails
      (deserializeRange as Mock).mockReturnValue(null);

      // Tier 2 succeeds — original text found by context matching
      const tier2Range = document.createRange();
      (findRangeByContext as Mock).mockReturnValue(tier2Range);

      await annotator.restoreHighlights();

      expect(applyHighlight).toHaveBeenCalledWith(tier2Range, 'ann-1', 'open');
      // Tier 2 matches the original text so range data is still semantically valid
      expect(api.reanchorAnnotation).not.toHaveBeenCalled();
    });

    it('clears replacedText when re-anchoring annotation that has replacedText', async () => {
      initAnnotator();

      const ann = makeTextAnnotation({
        id: 'ann-1',
        replacedText: 'new text',
        range: {
          startXPath: '/html[1]/body[1]/p[1]/text()[1]',
          startOffset: 0,
          endXPath: '/html[1]/body[1]/p[1]/text()[1]',
          endOffset: 8,
          selectedText: 'old text',
          contextBefore: 'before ',
          contextAfter: ' after',
        },
      });
      const store = makeStore([ann]);
      (api.getStore as Mock).mockResolvedValue(store);

      (deserializeRange as Mock).mockReturnValue(null);
      const tier25Range = document.createRange();
      (findRangeByContext as Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(tier25Range);

      (serializeRange as Mock).mockReturnValue({ startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'new text', contextBefore: 'before ', contextAfter: ' after' });
      (api.reanchorAnnotation as Mock).mockResolvedValue({});

      await annotator.restoreHighlights();

      // clearReplacedText should be true since annotation has replacedText
      expect(api.reanchorAnnotation).toHaveBeenCalledWith(
        'ann-1',
        expect.any(Object),
        true,
      );
    });

    it('debounces re-anchoring — does not re-anchor same annotation twice', async () => {
      initAnnotator();

      const ann = makeTextAnnotation({
        id: 'ann-1',
        replacedText: 'new text',
        range: {
          startXPath: '/html[1]/body[1]/p[1]/text()[1]',
          startOffset: 0,
          endXPath: '/html[1]/body[1]/p[1]/text()[1]',
          endOffset: 8,
          selectedText: 'old text',
          contextBefore: 'before ',
          contextAfter: ' after',
        },
      });
      const store = makeStore([ann]);
      (api.getStore as Mock).mockResolvedValue(store);

      (deserializeRange as Mock).mockReturnValue(null);
      const tier25Range = document.createRange();
      (findRangeByContext as Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(tier25Range);

      (serializeRange as Mock).mockReturnValue({ startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'new text', contextBefore: '', contextAfter: '' });
      (api.reanchorAnnotation as Mock).mockResolvedValue({});

      // First restore
      await annotator.restoreHighlights();
      expect(api.reanchorAnnotation).toHaveBeenCalledTimes(1);

      // Reset mocks for second restore, but keep same mock behaviour
      vi.clearAllMocks();
      (api.getStore as Mock).mockResolvedValue(store);
      (deserializeRange as Mock).mockReturnValue(null);
      (findRangeByContext as Mock)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(tier25Range);
      (serializeRange as Mock).mockReturnValue({ startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'new text', contextBefore: '', contextAfter: '' });

      // Second restore — should NOT re-anchor again
      await annotator.restoreHighlights();
      expect(api.reanchorAnnotation).not.toHaveBeenCalled();
    });

    it('falls back to cache on API error', async () => {
      initAnnotator();

      (api.getStore as Mock).mockRejectedValue(new Error('network error'));
      (readCache as Mock).mockReturnValue(makeStore([
        makeTextAnnotation({ id: 'cached-1' }),
      ]));

      await annotator.restoreHighlights();

      // Badge updated from cached data
      expect(updateBadge).toHaveBeenCalledWith(badge, 1);
    });
  });

  // =========================================================
  // 7. Lifecycle
  // =========================================================

  describe('lifecycle', () => {
    it('destroy removes all event listeners', () => {
      initAnnotator();

      const p = document.createElement('p');
      p.textContent = 'Hello world';
      document.body.appendChild(p);

      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.firstChild!, 5);

      restoreSelection = mockSelection(range);

      // Destroy before dispatching events
      annotator.destroy();

      // mouseup should no longer trigger popup
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      expect(showPopup).not.toHaveBeenCalled();

      // Alt+click should no longer trigger element popup
      p.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
      expect(showElementPopup).not.toHaveBeenCalled();

      // mousedown should no longer trigger click-outside dismissal
      (isPopupVisible as Mock).mockReturnValue(true);
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(hidePopup).not.toHaveBeenCalled();
      (isPopupVisible as Mock).mockReturnValue(false);

      // keydown should no longer activate inspector
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
      p.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      expect(document.querySelector('[data-air-el="inspector-overlay"]')).toBeNull();
    });

    it('destroy cleans up inspector overlay if active', () => {
      initAnnotator();

      const target = document.createElement('div');
      target.className = 'target';
      document.body.appendChild(target);

      // Activate inspector
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', bubbles: true }));
      target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      expect(document.querySelector('[data-air-el="inspector-overlay"]')).not.toBeNull();

      // Destroy should remove it
      annotator.destroy();
      expect(document.querySelector('[data-air-el="inspector-overlay"]')).toBeNull();
    });

    it('wires mediator.restoreHighlights to the annotator instance', () => {
      initAnnotator();

      // The annotator should have assigned its restoreHighlights to the mediator
      expect(mediator.restoreHighlights).toBe(annotator.restoreHighlights);
    });
  });

  // =========================================================
  // 8. Popup State Persistence
  // =========================================================

  describe('popup state persistence', () => {
    describe('getPendingState', () => {
      it('returns null when no popup is active', () => {
        initAnnotator();

        (isPopupVisible as Mock).mockReturnValue(false);

        expect(annotator.getPendingState()).toBeNull();
      });

      it('returns correct state for text annotation popup', () => {
        initAnnotator();

        const p = document.createElement('p');
        p.textContent = 'Hello world';
        document.body.appendChild(p);

        const range = document.createRange();
        range.setStart(p.firstChild!, 0);
        range.setEnd(p.firstChild!, 5);

        restoreSelection = mockSelection(range);

        // Trigger selection → sets currentRange
        p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        // Now make popup visible
        (isPopupVisible as Mock).mockReturnValue(true);
        mockPopup.textarea.value = 'my draft note';

        const state = annotator.getPendingState();

        expect(state).not.toBeNull();
        expect(state!.type).toBe('text');
        expect(state!.note).toBe('my draft note');
        expect(state!.selectedText).toBe('Hello');
        expect(state!.serializedRange).toBeDefined();
        expect(serializeRange).toHaveBeenCalled();
      });

      it('returns correct state for element annotation popup', () => {
        initAnnotator();

        const target = document.createElement('div');
        target.className = 'target';
        document.body.appendChild(target);

        // Ensure popup reports hidden so onClickCapture doesn't bail early
        (isPopupVisible as Mock).mockReturnValue(false);

        // Alt+click to set currentElementTarget
        target.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          altKey: true,
        }));

        // Now make popup visible
        (isPopupVisible as Mock).mockReturnValue(true);
        mockPopup.textarea.value = 'element draft';

        const state = annotator.getPendingState();

        expect(state).not.toBeNull();
        expect(state!.type).toBe('element');
        expect(state!.note).toBe('element draft');
        expect(state!.elementSelector).toBeDefined();
        expect(state!.elementSelector!.cssSelector).toBe('div.target');
      });
    });

    describe('restorePendingState', () => {
      it('restores text popup with saved note', () => {
        initAnnotator();

        const mockRange = document.createRange();
        (deserializeRange as Mock).mockReturnValue(mockRange);

        const state = {
          type: 'text' as const,
          note: 'restored note',
          selectedText: 'Hello',
          serializedRange: {
            startXPath: '/html[1]/body[1]/p[1]/text()[1]',
            startOffset: 0,
            endXPath: '/html[1]/body[1]/p[1]/text()[1]',
            endOffset: 5,
            selectedText: 'Hello',
            contextBefore: '',
            contextAfter: ' world',
          },
        };

        const result = annotator.restorePendingState(state);

        expect(result).toBe(true);
        expect(showPopup).toHaveBeenCalledTimes(1);
        // Textarea value is set after showPopup
        expect(mockPopup.textarea.value).toBe('restored note');
      });

      it('restores text popup via context fallback when XPath fails', () => {
        initAnnotator();

        (deserializeRange as Mock).mockReturnValue(null);
        const fallbackRange = document.createRange();
        (findRangeByContext as Mock).mockReturnValue(fallbackRange);

        const state = {
          type: 'text' as const,
          note: 'restored note',
          selectedText: 'Hello',
          serializedRange: {
            startXPath: '/html[1]/body[1]/p[1]/text()[1]',
            startOffset: 0,
            endXPath: '/html[1]/body[1]/p[1]/text()[1]',
            endOffset: 5,
            selectedText: 'Hello',
            contextBefore: '',
            contextAfter: ' world',
          },
        };

        const result = annotator.restorePendingState(state);

        expect(result).toBe(true);
        expect(showPopup).toHaveBeenCalledTimes(1);
        expect(mockPopup.textarea.value).toBe('restored note');
      });

      it('restores element popup with saved note', () => {
        initAnnotator();

        const target = document.createElement('div');
        target.className = 'target';
        document.body.appendChild(target);
        (resolveElement as Mock).mockReturnValue(target);

        const state = {
          type: 'element' as const,
          note: 'element restored',
          elementSelector: {
            cssSelector: 'div.target',
            xpath: '/html[1]/body[1]/div[1]',
            description: 'div.target',
            tagName: 'div',
            attributes: { class: 'target' },
            outerHtmlPreview: '<div class="target"></div>',
          },
        };

        const result = annotator.restorePendingState(state);

        expect(result).toBe(true);
        expect(showElementPopup).toHaveBeenCalledTimes(1);
        expect(mockPopup.textarea.value).toBe('element restored');
      });

      it('returns false and shows toast when text range is unresolvable', () => {
        initAnnotator();

        (deserializeRange as Mock).mockReturnValue(null);
        (findRangeByContext as Mock).mockReturnValue(null);

        const state = {
          type: 'text' as const,
          note: 'lost note',
          selectedText: 'Hello',
          serializedRange: {
            startXPath: '/html[1]/body[1]/p[1]/text()[1]',
            startOffset: 0,
            endXPath: '/html[1]/body[1]/p[1]/text()[1]',
            endOffset: 5,
            selectedText: 'Hello',
            contextBefore: '',
            contextAfter: ' world',
          },
        };

        const result = annotator.restorePendingState(state);

        expect(result).toBe(false);
        expect(showPopup).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(
          shadowRoot,
          expect.stringContaining('lost note'),
          expect.any(Number),
        );
      });

      it('returns false and shows toast when element is unresolvable', () => {
        initAnnotator();

        (resolveElement as Mock).mockReturnValue(null);

        const state = {
          type: 'element' as const,
          note: 'lost element note',
          elementSelector: {
            cssSelector: 'div.gone',
            xpath: '/html[1]/body[1]/div[99]',
            description: 'div.gone',
            tagName: 'div',
            attributes: {},
            outerHtmlPreview: '<div class="gone"></div>',
          },
        };

        const result = annotator.restorePendingState(state);

        expect(result).toBe(false);
        expect(showElementPopup).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith(
          shadowRoot,
          expect.stringContaining('lost element note'),
          expect.any(Number),
        );
      });
    });
  });
});
