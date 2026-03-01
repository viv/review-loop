import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFab, updateBadge, openFab, resetFab } from '../../../src/client/ui/fab.js';

describe('createFab', () => {
  let shadowRoot: ShadowRoot;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });
  });

  it('appends a button to the shadow root', () => {
    const onToggle = vi.fn();
    createFab(shadowRoot, onToggle);

    const button = shadowRoot.querySelector('button');
    expect(button).not.toBeNull();
    expect(button!.className).toBe('air-fab');
  });

  it('has aria-label for accessibility', () => {
    const { button } = createFab(shadowRoot, vi.fn());
    expect(button.getAttribute('aria-label')).toBe('Toggle inline review panel');
  });

  it('has title attribute', () => {
    const { button } = createFab(shadowRoot, vi.fn());
    expect(button.getAttribute('title')).toBe('Inline Review');
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    const { button } = createFab(shadowRoot, onToggle);

    button.click();

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('toggles open class on click', () => {
    const { button } = createFab(shadowRoot, vi.fn());

    button.click();
    expect(button.classList.contains('air-fab--open')).toBe(true);

    button.click();
    expect(button.classList.contains('air-fab--open')).toBe(false);
  });

  it('contains a badge element', () => {
    const { badge } = createFab(shadowRoot, vi.fn());
    expect(badge).not.toBeNull();
    expect(badge.className).toContain('air-fab__badge');
  });

  it('hides badge on click-to-open when count > 0', () => {
    const fab = createFab(shadowRoot, vi.fn());
    updateBadge(fab.badge, 3);
    expect(fab.badge.classList.contains('air-fab__badge--hidden')).toBe(false);

    fab.button.click(); // open

    expect(fab.badge.classList.contains('air-fab__badge--hidden')).toBe(true);
  });

  it('restores badge on click-to-close when count > 0', () => {
    const fab = createFab(shadowRoot, vi.fn());
    updateBadge(fab.badge, 3);
    fab.button.click(); // open → badge hidden

    fab.button.click(); // close

    expect(fab.badge.classList.contains('air-fab__badge--hidden')).toBe(false);
  });
});

describe('openFab', () => {
  let shadowRoot: ShadowRoot;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });
  });

  it('sets FAB to open visual state', () => {
    const fab = createFab(shadowRoot, vi.fn());
    expect(fab.button.getAttribute('data-air-state')).toBe('closed');

    openFab(fab);

    expect(fab.button.classList.contains('air-fab--open')).toBe(true);
    expect(fab.button.getAttribute('data-air-state')).toBe('open');
  });

  it('hides the badge when opening, even if count > 0', () => {
    const fab = createFab(shadowRoot, vi.fn());
    updateBadge(fab.badge, 5);
    expect(fab.badge.classList.contains('air-fab__badge--hidden')).toBe(false);

    openFab(fab);

    expect(fab.badge.classList.contains('air-fab__badge--hidden')).toBe(true);
  });
});

describe('resetFab', () => {
  let shadowRoot: ShadowRoot;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: 'open' });
  });

  it('resets FAB to closed visual state', () => {
    const fab = createFab(shadowRoot, vi.fn());
    openFab(fab);
    expect(fab.button.getAttribute('data-air-state')).toBe('open');

    resetFab(fab);

    expect(fab.button.classList.contains('air-fab--open')).toBe(false);
    expect(fab.button.getAttribute('data-air-state')).toBe('closed');
  });

  it('restores badge visibility on close when count > 0', () => {
    const fab = createFab(shadowRoot, vi.fn());
    updateBadge(fab.badge, 5);
    openFab(fab);
    expect(fab.badge.classList.contains('air-fab__badge--hidden')).toBe(true);

    resetFab(fab);

    expect(fab.badge.classList.contains('air-fab__badge--hidden')).toBe(false);
  });

  it('keeps badge hidden on close when count is 0', () => {
    const fab = createFab(shadowRoot, vi.fn());
    openFab(fab);

    resetFab(fab);

    expect(fab.badge.classList.contains('air-fab__badge--hidden')).toBe(true);
  });
});

describe('updateBadge', () => {
  function createBadgeWithParent(open = false): HTMLSpanElement {
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Toggle inline review panel');
    if (open) button.setAttribute('data-air-state', 'open');
    const badge = document.createElement('span');
    badge.className = 'air-fab__badge air-fab__badge--hidden';
    button.appendChild(badge);
    return badge;
  }

  it('shows the count when > 0', () => {
    const badge = createBadgeWithParent();

    updateBadge(badge, 5);

    expect(badge.textContent).toBe('5');
    expect(badge.classList.contains('air-fab__badge--hidden')).toBe(false);
  });

  it('hides when count is 0', () => {
    const badge = createBadgeWithParent();
    badge.className = 'air-fab__badge';

    updateBadge(badge, 0);

    expect(badge.textContent).toBe('0');
    expect(badge.classList.contains('air-fab__badge--hidden')).toBe(true);
  });

  it('updates parent button aria-label with count', () => {
    const badge = createBadgeWithParent();

    updateBadge(badge, 3);

    expect(badge.parentElement!.getAttribute('aria-label')).toBe('Toggle inline review (3 annotations)');
  });

  it('uses singular "annotation" for count of 1', () => {
    const badge = createBadgeWithParent();

    updateBadge(badge, 1);

    expect(badge.parentElement!.getAttribute('aria-label')).toBe('Toggle inline review (1 annotation)');
  });

  it('resets parent button aria-label when count is 0', () => {
    const badge = createBadgeWithParent();

    updateBadge(badge, 0);

    expect(badge.parentElement!.getAttribute('aria-label')).toBe('Toggle inline review panel');
  });

  it('keeps badge hidden when FAB is open, even with count > 0', () => {
    const badge = createBadgeWithParent(true);

    updateBadge(badge, 5);

    expect(badge.classList.contains('air-fab__badge--hidden')).toBe(true);
  });
});
