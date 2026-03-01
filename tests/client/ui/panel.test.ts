import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPanel } from '../../../src/client/ui/panel.js';
import type { PanelCallbacks } from '../../../src/client/ui/panel.js';
import type { ReviewMediator } from '../../../src/client/mediator.js';
import type { ReviewStore } from '../../../src/client/types.js';
import { api } from '../../../src/client/api.js';

// Mock the api module to prevent real fetch calls during panel creation
vi.mock('../../../src/client/api.js', () => ({
  api: {
    getStore: vi.fn().mockResolvedValue({ version: 1, annotations: [], pageNotes: [] }),
    deleteAnnotation: vi.fn(),
    deletePageNote: vi.fn(),
  },
}));

vi.mock('../../../src/client/cache.js', () => ({
  readCache: vi.fn().mockReturnValue(null),
  writeCache: vi.fn(),
}));

describe('createPanel — export button', () => {
  let shadowRoot: ShadowRoot;
  let callbacks: PanelCallbacks;
  let mediator: ReviewMediator;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    callbacks = {
      onAnnotationClick: vi.fn(),
      onAnnotationDelete: vi.fn().mockResolvedValue(undefined),
      onAnnotationStatusChange: vi.fn().mockResolvedValue(undefined),
      getOrphanState: vi.fn().mockReturnValue('anchored'),
      onRefreshBadge: vi.fn().mockResolvedValue(undefined),
      onExport: vi.fn().mockResolvedValue(undefined),
    };

    mediator = {
      refreshPanel: vi.fn(),
      restoreHighlights: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('renders an export button with data-air-el="export"', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const exportBtn = shadowRoot.querySelector('[data-air-el="export"]');
    expect(exportBtn).not.toBeNull();
    expect(exportBtn!.tagName.toLowerCase()).toBe('button');
  });

  it('export button has "Copy All" text', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const exportBtn = shadowRoot.querySelector('[data-air-el="export"]');
    expect(exportBtn!.textContent).toBe('Copy All');
  });

  it('export button has descriptive title attribute', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const exportBtn = shadowRoot.querySelector('[data-air-el="export"]');
    expect(exportBtn!.getAttribute('title')).toBe('Copy all annotations to clipboard as Markdown');
  });

  it('export button has accent class', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const exportBtn = shadowRoot.querySelector('[data-air-el="export"]');
    expect(exportBtn!.classList.contains('air-panel__btn--export')).toBe(true);
  });

  it('calls onExport callback when clicked', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const exportBtn = shadowRoot.querySelector('[data-air-el="export"]') as HTMLButtonElement;
    exportBtn.click();

    expect(callbacks.onExport).toHaveBeenCalledOnce();
  });

  it('renders buttons in order: + Note, Copy All, Clear All', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const actions = shadowRoot.querySelector('.air-panel__actions');
    const buttons = actions!.querySelectorAll('button');

    expect(buttons[0].textContent).toBe('+ Note');
    expect(buttons[1].textContent).toBe('Copy All');
    expect(buttons[2].textContent).toBe('Clear All');
  });
});

describe('createPanel — addressed annotations and agent replies', () => {
  let shadowRoot: ShadowRoot;
  let callbacks: PanelCallbacks;
  let mediator: ReviewMediator;

  function makeTextAnnotation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ann-1', type: 'text' as const, pageUrl: '/', pageTitle: 'Home',
      selectedText: 'hello world', note: 'fix this',
      range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'hello world', contextBefore: '', contextAfter: '' },
      createdAt: '2026-02-22T09:00:00Z', updatedAt: '2026-02-22T09:00:00Z',
      ...overrides,
    };
  }

  function makeElementAnnotation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ann-2', type: 'element' as const, pageUrl: '/', pageTitle: 'Home',
      note: 'fix element',
      elementSelector: { cssSelector: 'div.hero', xpath: '', description: 'Hero section', tagName: 'div', attributes: {}, outerHtmlPreview: '<div class="hero">' },
      createdAt: '2026-02-22T09:00:00Z', updatedAt: '2026-02-22T09:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    callbacks = {
      onAnnotationClick: vi.fn(),
      onAnnotationDelete: vi.fn().mockResolvedValue(undefined),
      onAnnotationStatusChange: vi.fn().mockResolvedValue(undefined),
      getOrphanState: vi.fn().mockReturnValue('anchored'),
      onRefreshBadge: vi.fn().mockResolvedValue(undefined),
      onExport: vi.fn().mockResolvedValue(undefined),
    };

    mediator = {
      refreshPanel: vi.fn(),
      restoreHighlights: vi.fn().mockResolvedValue(undefined),
    };
  });

  async function renderWithStore(store: ReviewStore) {
    vi.mocked(api.getStore).mockResolvedValue(store);
    const panel = createPanel(shadowRoot, callbacks, mediator);
    // mediator.refreshPanel is wired up by createPanel — call it
    await mediator.refreshPanel();
    return panel;
  }

  it('displays agent reply with Agent: prefix', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({
        replies: [{ message: 'Fixed the typo', createdAt: '2026-02-22T10:30:00Z' }],
      })],
      pageNotes: [],
    });

    const reply = shadowRoot.querySelector('[data-air-el="agent-reply"]');
    expect(reply).not.toBeNull();
    expect(reply!.textContent).toContain('Agent:');
    expect(reply!.textContent).toContain('Fixed the typo');
  });

  it('displays multiple agent replies in order', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({
        replies: [
          { message: 'First fix', createdAt: '2026-02-22T10:00:00Z' },
          { message: 'Second fix', createdAt: '2026-02-22T11:00:00Z' },
        ],
      })],
      pageNotes: [],
    });

    const replies = shadowRoot.querySelectorAll('[data-air-el="agent-reply"]');
    expect(replies.length).toBe(2);
    expect(replies[0].textContent).toContain('First fix');
    expect(replies[1].textContent).toContain('Second fix');
  });

  it('does not render replies section when no replies exist', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const reply = shadowRoot.querySelector('[data-air-el="agent-reply"]');
    expect(reply).toBeNull();
  });

});

describe('annotation item — delete button', () => {
  let shadowRoot: ShadowRoot;
  let callbacks: PanelCallbacks;
  let mediator: ReviewMediator;

  function makeTextAnnotation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ann-1', type: 'text' as const, pageUrl: '/', pageTitle: 'Home',
      selectedText: 'hello world', note: 'fix this',
      range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'hello world', contextBefore: '', contextAfter: '' },
      createdAt: '2026-02-22T09:00:00Z', updatedAt: '2026-02-22T09:00:00Z',
      ...overrides,
    };
  }

  function makeElementAnnotation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ann-2', type: 'element' as const, pageUrl: '/', pageTitle: 'Home',
      note: 'fix element',
      elementSelector: { cssSelector: 'div.hero', xpath: '', description: 'Hero section', tagName: 'div', attributes: {}, outerHtmlPreview: '<div class="hero">' },
      createdAt: '2026-02-22T09:00:00Z', updatedAt: '2026-02-22T09:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    callbacks = {
      onAnnotationClick: vi.fn(),
      onAnnotationDelete: vi.fn().mockResolvedValue(undefined),
      onAnnotationStatusChange: vi.fn().mockResolvedValue(undefined),
      getOrphanState: vi.fn().mockReturnValue('anchored'),
      onRefreshBadge: vi.fn().mockResolvedValue(undefined),
      onExport: vi.fn().mockResolvedValue(undefined),
    };

    mediator = {
      refreshPanel: vi.fn(),
      restoreHighlights: vi.fn().mockResolvedValue(undefined),
    };
  });

  async function renderWithStore(store: ReviewStore) {
    vi.mocked(api.getStore).mockResolvedValue(store);
    createPanel(shadowRoot, callbacks, mediator);
    await mediator.refreshPanel();
  }

  it('renders delete button on text annotation item', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const deleteBtn = shadowRoot.querySelector('[data-air-el="annotation-delete"]');
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn!.tagName.toLowerCase()).toBe('button');
    expect(deleteBtn!.textContent).toBe('Delete');
  });

  it('renders delete button on element annotation item', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeElementAnnotation()],
      pageNotes: [],
    });

    const deleteBtn = shadowRoot.querySelector('[data-air-el="annotation-delete"]');
    expect(deleteBtn).not.toBeNull();
    expect(deleteBtn!.textContent).toBe('Delete');
  });

  it('first click shows "Sure?" confirmation instead of deleting', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ id: 'delete-me' })],
      pageNotes: [],
    });

    const deleteBtn = shadowRoot.querySelector('[data-air-el="annotation-delete"]') as HTMLButtonElement;
    deleteBtn.click();

    expect(deleteBtn.textContent).toBe('Sure?');
    expect(deleteBtn.getAttribute('data-air-state')).toBe('confirming');
    expect(callbacks.onAnnotationDelete).not.toHaveBeenCalled();
  });

  it('second click within 3s calls onAnnotationDelete', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ id: 'delete-me' })],
      pageNotes: [],
    });

    const deleteBtn = shadowRoot.querySelector('[data-air-el="annotation-delete"]') as HTMLButtonElement;
    deleteBtn.click(); // First click — confirm
    deleteBtn.click(); // Second click — execute

    expect(callbacks.onAnnotationDelete).toHaveBeenCalledWith('delete-me');
  });

  it('reverts to "Delete" after 3 seconds without second click', async () => {
    vi.useFakeTimers();

    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ id: 'timeout-test' })],
      pageNotes: [],
    });

    const deleteBtn = shadowRoot.querySelector('[data-air-el="annotation-delete"]') as HTMLButtonElement;
    deleteBtn.click(); // First click — confirm

    expect(deleteBtn.textContent).toBe('Sure?');

    vi.advanceTimersByTime(3000);

    expect(deleteBtn.textContent).toBe('Delete');
    expect(deleteBtn.hasAttribute('data-air-state')).toBe(false);
    expect(callbacks.onAnnotationDelete).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('resets to "Delete" after second click executes', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ id: 'reset-test' })],
      pageNotes: [],
    });

    const deleteBtn = shadowRoot.querySelector('[data-air-el="annotation-delete"]') as HTMLButtonElement;
    deleteBtn.click(); // First click
    deleteBtn.click(); // Second click

    expect(deleteBtn.textContent).toBe('Delete');
    expect(deleteBtn.hasAttribute('data-air-state')).toBe(false);
  });

  it('does not trigger onAnnotationClick when delete is clicked', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const deleteBtn = shadowRoot.querySelector('[data-air-el="annotation-delete"]') as HTMLButtonElement;
    deleteBtn.click();

    expect(callbacks.onAnnotationClick).not.toHaveBeenCalled();
  });
});

describe('annotation item — orphan indicator', () => {
  let shadowRoot: ShadowRoot;
  let callbacks: PanelCallbacks;
  let mediator: ReviewMediator;

  function makeTextAnnotation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ann-1', type: 'text' as const, pageUrl: '/', pageTitle: 'Home',
      selectedText: 'hello world', note: 'fix this',
      range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'hello world', contextBefore: '', contextAfter: '' },
      createdAt: '2026-02-22T09:00:00Z', updatedAt: '2026-02-22T09:00:00Z',
      ...overrides,
    };
  }

  function makeElementAnnotation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ann-2', type: 'element' as const, pageUrl: '/', pageTitle: 'Home',
      note: 'fix element',
      elementSelector: { cssSelector: 'div.hero', xpath: '', description: 'Hero section', tagName: 'div', attributes: {}, outerHtmlPreview: '<div class="hero">' },
      createdAt: '2026-02-22T09:00:00Z', updatedAt: '2026-02-22T09:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    callbacks = {
      onAnnotationClick: vi.fn(),
      onAnnotationDelete: vi.fn().mockResolvedValue(undefined),
      onAnnotationStatusChange: vi.fn().mockResolvedValue(undefined),
      getOrphanState: vi.fn().mockReturnValue('anchored'),
      onRefreshBadge: vi.fn().mockResolvedValue(undefined),
      onExport: vi.fn().mockResolvedValue(undefined),
    };

    mediator = {
      refreshPanel: vi.fn(),
      restoreHighlights: vi.fn().mockResolvedValue(undefined),
    };
  });

  async function renderWithStore(store: ReviewStore) {
    vi.mocked(api.getStore).mockResolvedValue(store);
    createPanel(shadowRoot, callbacks, mediator);
    await mediator.refreshPanel();
  }

  it('shows orphan indicator when getOrphanState returns orphaned', async () => {
    vi.mocked(callbacks.getOrphanState).mockReturnValue('orphaned');

    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const orphanIndicator = shadowRoot.querySelector('.air-annotation-item__orphan');
    expect(orphanIndicator).not.toBeNull();
    expect(orphanIndicator!.textContent).toBe('Could not locate on page');
  });

  it('does not show orphan indicator when getOrphanState returns anchored', async () => {
    vi.mocked(callbacks.getOrphanState).mockReturnValue('anchored');

    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const orphanIndicator = shadowRoot.querySelector('.air-annotation-item__orphan');
    expect(orphanIndicator).toBeNull();
  });

  it('shows checking indicator when getOrphanState returns checking', async () => {
    vi.mocked(callbacks.getOrphanState).mockReturnValue('checking');

    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const checkingIndicator = shadowRoot.querySelector('[data-air-el="checking-indicator"]');
    expect(checkingIndicator).not.toBeNull();
    expect(checkingIndicator!.textContent).toBe('Checking…');
  });

  it('adds orphan modifier class when annotation is orphaned', async () => {
    vi.mocked(callbacks.getOrphanState).mockReturnValue('orphaned');

    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const item = shadowRoot.querySelector('[data-air-el="annotation-item"]');
    expect(item!.classList.contains('air-annotation-item--orphan')).toBe(true);
  });

  it('adds checking modifier class when orphan state is checking', async () => {
    vi.mocked(callbacks.getOrphanState).mockReturnValue('checking');

    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const item = shadowRoot.querySelector('[data-air-el="annotation-item"]');
    expect(item!.classList.contains('air-annotation-item--checking')).toBe(true);
  });

  it('does not add orphan modifier class when annotation is anchored', async () => {
    vi.mocked(callbacks.getOrphanState).mockReturnValue('anchored');

    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const item = shadowRoot.querySelector('[data-air-el="annotation-item"]');
    expect(item!.classList.contains('air-annotation-item--orphan')).toBe(false);
  });

  it('shows orphan indicator on element annotation when orphaned', async () => {
    vi.mocked(callbacks.getOrphanState).mockReturnValue('orphaned');

    await renderWithStore({
      version: 1,
      annotations: [makeElementAnnotation()],
      pageNotes: [],
    });

    const orphanIndicator = shadowRoot.querySelector('.air-annotation-item__orphan');
    expect(orphanIndicator).not.toBeNull();

    const item = shadowRoot.querySelector('[data-air-el="element-annotation-item"]');
    expect(item!.classList.contains('air-annotation-item--orphan')).toBe(true);
  });

  it('calls getOrphanState with annotation id, pageUrl and status', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ id: 'check-me' })],
      pageNotes: [],
    });

    expect(callbacks.getOrphanState).toHaveBeenCalledWith('check-me', '/', 'open');
  });
});

describe('createPanel — single fetch per refresh', () => {
  let shadowRoot: ShadowRoot;
  let callbacks: PanelCallbacks;
  let mediator: ReviewMediator;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    callbacks = {
      onAnnotationClick: vi.fn(),
      onAnnotationDelete: vi.fn().mockResolvedValue(undefined),
      onAnnotationStatusChange: vi.fn().mockResolvedValue(undefined),
      getOrphanState: vi.fn().mockReturnValue('anchored'),
      onRefreshBadge: vi.fn().mockResolvedValue(undefined),
      onExport: vi.fn().mockResolvedValue(undefined),
    };

    mediator = {
      refreshPanel: vi.fn(),
      restoreHighlights: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(api.getStore).mockClear();
  });

  it('mediator.refreshPanel calls api.getStore only once', async () => {
    const store: ReviewStore = { version: 1, annotations: [], pageNotes: [] };
    vi.mocked(api.getStore).mockResolvedValue(store);

    createPanel(shadowRoot, callbacks, mediator);
    await mediator.refreshPanel();

    expect(api.getStore).toHaveBeenCalledTimes(1);
  });

  it('mediator.refreshPanel passes fetched store to both content and tab counts', async () => {
    const store: ReviewStore = {
      version: 1,
      annotations: [{
        id: 'a1', type: 'text' as const, pageUrl: '/', pageTitle: 'Home',
        selectedText: 'hello', note: 'note',
        range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'hello', contextBefore: '', contextAfter: '' },
        createdAt: '2026-02-22T09:00:00Z', updatedAt: '2026-02-22T09:00:00Z',
      }],
      pageNotes: [],
    };
    vi.mocked(api.getStore).mockResolvedValue(store);

    createPanel(shadowRoot, callbacks, mediator);
    await mediator.refreshPanel();

    // Only one fetch despite needing data for both content and tab counts
    expect(api.getStore).toHaveBeenCalledTimes(1);

    // Verify tab counts were updated (This Page should show 1)
    const thisPageTab = shadowRoot.querySelector('[data-air-el="tab-this-page"]');
    expect(thisPageTab!.textContent).toBe('This Page (1)');
  });
});

describe('createPanel — shortcuts help footer', () => {
  let shadowRoot: ShadowRoot;
  let callbacks: PanelCallbacks;
  let mediator: ReviewMediator;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    callbacks = {
      onAnnotationClick: vi.fn(),
      onAnnotationDelete: vi.fn().mockResolvedValue(undefined),
      onAnnotationStatusChange: vi.fn().mockResolvedValue(undefined),
      getOrphanState: vi.fn().mockReturnValue('anchored'),
      onRefreshBadge: vi.fn().mockResolvedValue(undefined),
      onExport: vi.fn().mockResolvedValue(undefined),
    };

    mediator = {
      refreshPanel: vi.fn(),
      restoreHighlights: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('renders a shortcuts help footer with data-air-el', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const footer = shadowRoot.querySelector('[data-air-el="shortcuts-help"]');
    expect(footer).not.toBeNull();
    expect(footer!.classList.contains('air-panel__shortcuts')).toBe(true);
  });

  it('shortcuts help mentions key shortcuts', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const footer = shadowRoot.querySelector('[data-air-el="shortcuts-help"]');
    const text = footer!.textContent!;
    expect(text).toContain('Toggle panel');
    expect(text).toContain('Close');
    expect(text).toContain('Inspect');
  });
});

describe('createPanel — replacedText rendering', () => {
  let shadowRoot: ShadowRoot;
  let callbacks: PanelCallbacks;
  let mediator: ReviewMediator;

  function makeTextAnnotation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ann-1', type: 'text' as const, pageUrl: '/', pageTitle: 'Home',
      selectedText: 'original text', note: 'fix this',
      range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'original text', contextBefore: '', contextAfter: '' },
      createdAt: '2026-02-22T09:00:00Z', updatedAt: '2026-02-22T09:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    callbacks = {
      onAnnotationClick: vi.fn(),
      onAnnotationDelete: vi.fn().mockResolvedValue(undefined),
      onAnnotationStatusChange: vi.fn().mockResolvedValue(undefined),
      getOrphanState: vi.fn().mockReturnValue('anchored'),
      onRefreshBadge: vi.fn().mockResolvedValue(undefined),
      onExport: vi.fn().mockResolvedValue(undefined),
    };

    mediator = {
      refreshPanel: vi.fn(),
      restoreHighlights: vi.fn().mockResolvedValue(undefined),
    };
  });

  async function renderWithStore(store: ReviewStore) {
    vi.mocked(api.getStore).mockResolvedValue(store);
    createPanel(shadowRoot, callbacks, mediator);
    await mediator.refreshPanel();
  }

  it('shows struck-through original text when replacedText is present', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ replacedText: 'replacement text' })],
      pageNotes: [],
    });

    const textDiv = shadowRoot.querySelector('.air-annotation-item__text');
    expect(textDiv).not.toBeNull();

    const strikeSpan = textDiv!.querySelector('span[style*="line-through"]');
    expect(strikeSpan).not.toBeNull();
    expect(strikeSpan!.textContent).toContain('original text');
  });

  it('shows arrow separator → between original and replacement when replacedText is present', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ replacedText: 'replacement text' })],
      pageNotes: [],
    });

    const textDiv = shadowRoot.querySelector('.air-annotation-item__text');
    expect(textDiv!.textContent).toContain('→');
  });

  it('shows replacement text after the arrow when replacedText is present', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ replacedText: 'replacement text' })],
      pageNotes: [],
    });

    const textDiv = shadowRoot.querySelector('.air-annotation-item__text');
    const spans = textDiv!.querySelectorAll('span');
    // Last span holds the replacement text (no line-through)
    const replacementSpan = spans[spans.length - 1];
    expect(replacementSpan.textContent).toContain('replacement text');
    expect(replacementSpan.style.textDecoration).not.toBe('line-through');
  });

  it('renders plain quoted text without line-through when replacedText is absent', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const textDiv = shadowRoot.querySelector('.air-annotation-item__text');
    expect(textDiv).not.toBeNull();

    // No struck-through span
    const strikeSpan = textDiv!.querySelector('span[style*="line-through"]');
    expect(strikeSpan).toBeNull();

    // Plain text content contains the original text
    expect(textDiv!.textContent).toContain('original text');

    // No arrow
    expect(textDiv!.textContent).not.toContain('→');
  });
});

describe('createPanel — ARIA semantics', () => {
  let shadowRoot: ShadowRoot;
  let callbacks: PanelCallbacks;
  let mediator: ReviewMediator;

  function makeTextAnnotation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ann-1', type: 'text' as const, pageUrl: '/', pageTitle: 'Home',
      selectedText: 'hello world', note: 'fix this',
      range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'hello world', contextBefore: '', contextAfter: '' },
      createdAt: '2026-02-22T09:00:00Z', updatedAt: '2026-02-22T09:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    callbacks = {
      onAnnotationClick: vi.fn(),
      onAnnotationDelete: vi.fn().mockResolvedValue(undefined),
      onAnnotationStatusChange: vi.fn().mockResolvedValue(undefined),
      getOrphanState: vi.fn().mockReturnValue('anchored'),
      onRefreshBadge: vi.fn().mockResolvedValue(undefined),
      onExport: vi.fn().mockResolvedValue(undefined),
    };

    mediator = {
      refreshPanel: vi.fn(),
      restoreHighlights: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('panel container has role="complementary" and aria-label', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const panel = shadowRoot.querySelector('[data-air-el="panel"]');
    expect(panel!.getAttribute('role')).toBe('complementary');
    expect(panel!.getAttribute('aria-label')).toBe('Review Loop Panel');
  });

  it('tabs container has role="tablist"', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const tablist = shadowRoot.querySelector('.air-panel__tabs');
    expect(tablist!.getAttribute('role')).toBe('tablist');
  });

  it('tab buttons have role="tab" and aria-selected', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const thisPageTab = shadowRoot.querySelector('[data-air-el="tab-this-page"]');
    const allPagesTab = shadowRoot.querySelector('[data-air-el="tab-all-pages"]');

    expect(thisPageTab!.getAttribute('role')).toBe('tab');
    expect(thisPageTab!.getAttribute('aria-selected')).toBe('true');

    expect(allPagesTab!.getAttribute('role')).toBe('tab');
    expect(allPagesTab!.getAttribute('aria-selected')).toBe('false');
  });

  it('clicking all pages tab updates aria-selected', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const thisPageTab = shadowRoot.querySelector('[data-air-el="tab-this-page"]') as HTMLButtonElement;
    const allPagesTab = shadowRoot.querySelector('[data-air-el="tab-all-pages"]') as HTMLButtonElement;

    allPagesTab.click();

    expect(allPagesTab.getAttribute('aria-selected')).toBe('true');
    expect(thisPageTab.getAttribute('aria-selected')).toBe('false');
  });

  it('content area has role="tabpanel" and aria-labelledby', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const content = shadowRoot.querySelector('[data-air-el="panel-content"]');
    expect(content!.getAttribute('role')).toBe('tabpanel');
    expect(content!.getAttribute('aria-labelledby')).toBe('air-tab-this-page');
  });

  it('switching tabs updates aria-labelledby on content', () => {
    createPanel(shadowRoot, callbacks, mediator);

    const allPagesTab = shadowRoot.querySelector('[data-air-el="tab-all-pages"]') as HTMLButtonElement;
    const content = shadowRoot.querySelector('[data-air-el="panel-content"]');

    allPagesTab.click();

    expect(content!.getAttribute('aria-labelledby')).toBe('air-tab-all-pages');
  });

  it('annotation items have tabindex="0" for keyboard navigation', async () => {
    vi.mocked(api.getStore).mockResolvedValue({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });
    createPanel(shadowRoot, callbacks, mediator);
    await mediator.refreshPanel();

    const item = shadowRoot.querySelector('[data-air-el="annotation-item"]');
    expect(item!.getAttribute('tabindex')).toBe('0');
  });

  it('annotation items respond to Enter key', async () => {
    vi.mocked(api.getStore).mockResolvedValue({
      version: 1,
      annotations: [makeTextAnnotation({ id: 'kbd-test' })],
      pageNotes: [],
    });
    createPanel(shadowRoot, callbacks, mediator);
    await mediator.refreshPanel();

    const item = shadowRoot.querySelector('[data-air-el="annotation-item"]') as HTMLElement;
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(callbacks.onAnnotationClick).toHaveBeenCalledWith('kbd-test', '/');
  });

  it('annotation items respond to Space key', async () => {
    vi.mocked(api.getStore).mockResolvedValue({
      version: 1,
      annotations: [makeTextAnnotation({ id: 'space-test' })],
      pageNotes: [],
    });
    createPanel(shadowRoot, callbacks, mediator);
    await mediator.refreshPanel();

    const item = shadowRoot.querySelector('[data-air-el="annotation-item"]') as HTMLElement;
    item.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    expect(callbacks.onAnnotationClick).toHaveBeenCalledWith('space-test', '/');
  });
});

describe('createPanel — status lifecycle buttons', () => {
  let shadowRoot: ShadowRoot;
  let callbacks: PanelCallbacks;
  let mediator: ReviewMediator;

  function makeTextAnnotation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ann-1', type: 'text' as const, pageUrl: '/', pageTitle: 'Home',
      selectedText: 'hello world', note: 'fix this',
      range: { startXPath: '', startOffset: 0, endXPath: '', endOffset: 0, selectedText: 'hello world', contextBefore: '', contextAfter: '' },
      createdAt: '2026-02-22T09:00:00Z', updatedAt: '2026-02-22T09:00:00Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });

    callbacks = {
      onAnnotationClick: vi.fn(),
      onAnnotationDelete: vi.fn().mockResolvedValue(undefined),
      onAnnotationStatusChange: vi.fn().mockResolvedValue(undefined),
      getOrphanState: vi.fn().mockReturnValue('anchored'),
      onRefreshBadge: vi.fn().mockResolvedValue(undefined),
      onExport: vi.fn().mockResolvedValue(undefined),
    };

    mediator = {
      refreshPanel: vi.fn(),
      restoreHighlights: vi.fn().mockResolvedValue(undefined),
    };
  });

  async function renderWithStore(store: ReviewStore) {
    vi.mocked(api.getStore).mockResolvedValue(store);
    createPanel(shadowRoot, callbacks, mediator);
    await mediator.refreshPanel();
  }

  it('shows addressed badge for addressed annotation', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ status: 'addressed', addressedAt: '2026-02-22T10:00:00Z' })],
      pageNotes: [],
    });

    const badge = shadowRoot.querySelector('[data-air-el="addressed-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('Addressed');
  });

  it('shows addressed class for addressed annotation', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ status: 'addressed', addressedAt: '2026-02-22T10:00:00Z' })],
      pageNotes: [],
    });

    const item = shadowRoot.querySelector('[data-air-el="annotation-item"]');
    expect(item!.classList.contains('air-annotation-item--addressed')).toBe(true);
  });

  it('shows Accept button on addressed annotation', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ status: 'addressed', addressedAt: '2026-02-22T10:00:00Z' })],
      pageNotes: [],
    });

    const acceptBtn = shadowRoot.querySelector('[data-air-el="annotation-accept"]');
    expect(acceptBtn).not.toBeNull();
    expect(acceptBtn!.tagName.toLowerCase()).toBe('button');
  });

  it('does not show Accept button on open annotation', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const acceptBtn = shadowRoot.querySelector('[data-air-el="annotation-accept"]');
    expect(acceptBtn).toBeNull();
  });

  it('shows Reopen button on addressed annotation', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ status: 'addressed', addressedAt: '2026-02-22T10:00:00Z' })],
      pageNotes: [],
    });

    const reopenBtn = shadowRoot.querySelector('[data-air-el="annotation-reopen"]');
    expect(reopenBtn).not.toBeNull();
    expect(reopenBtn!.tagName.toLowerCase()).toBe('button');
  });

  it('does not show Reopen button on open annotation', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const reopenBtn = shadowRoot.querySelector('[data-air-el="annotation-reopen"]');
    expect(reopenBtn).toBeNull();
  });

  it('Accept button calls onAnnotationDelete to remove annotation', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ id: 'accept-me', status: 'addressed', addressedAt: '2026-02-22T10:00:00Z' })],
      pageNotes: [],
    });

    const acceptBtn = shadowRoot.querySelector('[data-air-el="annotation-accept"]') as HTMLButtonElement;
    acceptBtn.click();

    expect(callbacks.onAnnotationDelete).toHaveBeenCalledWith('accept-me');
    expect(callbacks.onAnnotationStatusChange).not.toHaveBeenCalled();
  });

  it('hides Delete button when Accept button is shown (addressed status)', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ status: 'addressed', addressedAt: '2026-02-22T10:00:00Z' })],
      pageNotes: [],
    });

    const deleteBtn = shadowRoot.querySelector('[data-air-el="annotation-delete"]');
    expect(deleteBtn).toBeNull();
  });

  it('shows Delete button only on open annotations', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation()],
      pageNotes: [],
    });

    const deleteBtn = shadowRoot.querySelector('[data-air-el="annotation-delete"]');
    expect(deleteBtn).not.toBeNull();

    const acceptBtn = shadowRoot.querySelector('[data-air-el="annotation-accept"]');
    expect(acceptBtn).toBeNull();

    const reopenBtn = shadowRoot.querySelector('[data-air-el="annotation-reopen"]');
    expect(reopenBtn).toBeNull();
  });

  it('Reopen button shows inline form instead of immediately reopening', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ id: 'reopen-me', status: 'addressed', addressedAt: '2026-02-22T10:00:00Z' })],
      pageNotes: [],
    });

    const reopenBtn = shadowRoot.querySelector('[data-air-el="annotation-reopen"]') as HTMLButtonElement;
    reopenBtn.click();

    // Should NOT have called onAnnotationStatusChange yet
    expect(callbacks.onAnnotationStatusChange).not.toHaveBeenCalled();

    // Should show the reopen form
    const form = shadowRoot.querySelector('[data-air-el="reopen-form"]');
    expect(form).not.toBeNull();

    const textarea = shadowRoot.querySelector('[data-air-el="reopen-textarea"]');
    expect(textarea).not.toBeNull();
  });

  it('Reopen form submit calls onAnnotationStatusChange with open and no reply when empty', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ id: 'reopen-me', status: 'addressed', addressedAt: '2026-02-22T10:00:00Z' })],
      pageNotes: [],
    });

    const reopenBtn = shadowRoot.querySelector('[data-air-el="annotation-reopen"]') as HTMLButtonElement;
    reopenBtn.click();

    const submitBtn = shadowRoot.querySelector('[data-air-el="reopen-submit"]') as HTMLButtonElement;
    submitBtn.click();

    expect(callbacks.onAnnotationStatusChange).toHaveBeenCalledWith('reopen-me', 'open', undefined);
  });

  it('Reopen form submit includes reply message when provided', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ id: 'reopen-me', status: 'addressed', addressedAt: '2026-02-22T10:00:00Z' })],
      pageNotes: [],
    });

    const reopenBtn = shadowRoot.querySelector('[data-air-el="annotation-reopen"]') as HTMLButtonElement;
    reopenBtn.click();

    const textarea = shadowRoot.querySelector('[data-air-el="reopen-textarea"]') as HTMLTextAreaElement;
    textarea.value = 'Actually I meant remove the comma too';

    const submitBtn = shadowRoot.querySelector('[data-air-el="reopen-submit"]') as HTMLButtonElement;
    submitBtn.click();

    expect(callbacks.onAnnotationStatusChange).toHaveBeenCalledWith('reopen-me', 'open', 'Actually I meant remove the comma too');
  });

  it('Reopen form cancel removes form without calling callback', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ status: 'addressed', addressedAt: '2026-02-22T10:00:00Z' })],
      pageNotes: [],
    });

    const reopenBtn = shadowRoot.querySelector('[data-air-el="annotation-reopen"]') as HTMLButtonElement;
    reopenBtn.click();

    expect(shadowRoot.querySelector('[data-air-el="reopen-form"]')).not.toBeNull();

    const cancelBtn = shadowRoot.querySelector('[data-air-el="reopen-cancel"]') as HTMLButtonElement;
    cancelBtn.click();

    expect(shadowRoot.querySelector('[data-air-el="reopen-form"]')).toBeNull();
    expect(callbacks.onAnnotationStatusChange).not.toHaveBeenCalled();
  });

  it('Reopen form submit removes the form from DOM', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ status: 'addressed', addressedAt: '2026-02-22T10:00:00Z' })],
      pageNotes: [],
    });

    const reopenBtn = shadowRoot.querySelector('[data-air-el="annotation-reopen"]') as HTMLButtonElement;
    reopenBtn.click();
    expect(shadowRoot.querySelector('[data-air-el="reopen-form"]')).not.toBeNull();

    const submitBtn = shadowRoot.querySelector('[data-air-el="reopen-submit"]') as HTMLButtonElement;
    submitBtn.click();

    expect(shadowRoot.querySelector('[data-air-el="reopen-form"]')).toBeNull();
  });

  it('displays reviewer reply with Reviewer: prefix', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({
        replies: [{ message: 'Please try again', createdAt: '2026-02-22T10:30:00Z', role: 'reviewer' }],
      })],
      pageNotes: [],
    });

    const reply = shadowRoot.querySelector('[data-air-el="reviewer-reply"]');
    expect(reply).not.toBeNull();
    expect(reply!.textContent).toContain('Reviewer:');
    expect(reply!.textContent).toContain('Please try again');
  });

  it('displays agent reply with Agent: prefix (backward compat)', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({
        replies: [{ message: 'Fixed it', createdAt: '2026-02-22T10:30:00Z' }],
      })],
      pageNotes: [],
    });

    const reply = shadowRoot.querySelector('[data-air-el="agent-reply"]');
    expect(reply).not.toBeNull();
    expect(reply!.textContent).toContain('Agent:');
    expect(reply!.textContent).toContain('Fixed it');
  });

  it('displays mixed agent and reviewer replies in order', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({
        replies: [
          { message: 'Fixed the typo', createdAt: '2026-02-22T10:00:00Z', role: 'agent' },
          { message: 'Not quite right', createdAt: '2026-02-22T11:00:00Z', role: 'reviewer' },
        ],
      })],
      pageNotes: [],
    });

    const agentReply = shadowRoot.querySelector('[data-air-el="agent-reply"]');
    const reviewerReply = shadowRoot.querySelector('[data-air-el="reviewer-reply"]');
    expect(agentReply).not.toBeNull();
    expect(reviewerReply).not.toBeNull();
    expect(agentReply!.textContent).toContain('Fixed the typo');
    expect(reviewerReply!.textContent).toContain('Not quite right');
  });

  it('shows in-progress badge for in_progress annotation', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ status: 'in_progress', inProgressAt: '2026-02-28T10:00:00Z' })],
      pageNotes: [],
    });

    const badge = shadowRoot.querySelector('[data-air-el="in-progress-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('Agent working');
  });

  it('adds in-progress class for in_progress annotation', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ status: 'in_progress', inProgressAt: '2026-02-28T10:00:00Z' })],
      pageNotes: [],
    });

    const item = shadowRoot.querySelector('[data-air-el="annotation-item"]');
    expect(item!.classList.contains('air-annotation-item--in-progress')).toBe(true);
  });

  it('hides action buttons for in_progress annotation', async () => {
    await renderWithStore({
      version: 1,
      annotations: [makeTextAnnotation({ status: 'in_progress', inProgressAt: '2026-02-28T10:00:00Z' })],
      pageNotes: [],
    });

    const deleteBtn = shadowRoot.querySelector('[data-air-el="annotation-delete"]');
    const acceptBtn = shadowRoot.querySelector('[data-air-el="annotation-accept"]');
    const reopenBtn = shadowRoot.querySelector('[data-air-el="annotation-reopen"]');
    expect(deleteBtn).toBeNull();
    expect(acceptBtn).toBeNull();
    expect(reopenBtn).toBeNull();
  });
});
