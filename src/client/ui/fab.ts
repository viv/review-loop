/** SVG path data for the clipboard/notes icon */
const CLIPBOARD_PATH = 'M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 16H5V5h2v3h10V5h2v14z';

/** SVG path data for the close/plus icon (rotated 45 via CSS to become X) */
const PLUS_PATH = 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element from path data */
function createSvgIcon(pathData: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathData);
  svg.appendChild(path);
  return svg;
}

/** Swap the icon inside a container, preserving other children */
function setIcon(container: HTMLElement, pathData: string): void {
  const oldSvg = container.querySelector('svg');
  if (oldSvg) oldSvg.remove();
  container.insertBefore(createSvgIcon(pathData), container.firstChild);
}

export interface FabElements {
  button: HTMLButtonElement;
  badge: HTMLSpanElement;
}

/**
 * Creates the FAB (Floating Action Button) and appends it to the shadow root.
 * Returns references to the button and badge for external control.
 */
export function createFab(shadowRoot: ShadowRoot, onToggle: () => void): FabElements {
  const button = document.createElement('button');
  button.className = 'air-fab';
  button.setAttribute('aria-label', 'Toggle inline review panel');
  button.setAttribute('title', 'Inline Review');
  button.setAttribute('data-air-el', 'fab');
  button.setAttribute('data-air-state', 'closed');
  button.appendChild(createSvgIcon(CLIPBOARD_PATH));

  const badge = document.createElement('span');
  badge.className = 'air-fab__badge air-fab__badge--hidden';
  badge.setAttribute('data-air-el', 'badge');
  badge.textContent = '0';
  button.appendChild(badge);

  button.addEventListener('click', () => {
    const wasOpen = button.getAttribute('data-air-state') === 'open';
    const isOpen = !wasOpen;
    setIcon(button, isOpen ? PLUS_PATH : CLIPBOARD_PATH);
    button.classList.toggle('air-fab--open', isOpen);
    button.setAttribute('data-air-state', isOpen ? 'open' : 'closed');
    if (isOpen) {
      badge.classList.add('air-fab__badge--hidden');
    } else {
      const count = parseInt(badge.textContent ?? '0', 10);
      badge.classList.toggle('air-fab__badge--hidden', count === 0);
    }
    onToggle();
  });

  shadowRoot.appendChild(button);

  return { button, badge };
}

/** Reset the FAB to its closed visual state (used when panel is closed externally). */
export function resetFab(fab: FabElements): void {
  setIcon(fab.button, CLIPBOARD_PATH);
  fab.button.classList.remove('air-fab--open');
  fab.button.setAttribute('data-air-state', 'closed');
  // Restore badge visibility now that the panel count is no longer shown
  const count = parseInt(fab.badge.textContent ?? '0', 10);
  fab.badge.classList.toggle('air-fab__badge--hidden', count === 0);
}

/** Set the FAB to its open visual state (used when panel is opened externally). */
export function openFab(fab: FabElements): void {
  setIcon(fab.button, PLUS_PATH);
  fab.button.classList.add('air-fab--open');
  fab.button.setAttribute('data-air-state', 'open');
  // Hide badge — count is visible in the panel tabs
  fab.badge.classList.add('air-fab__badge--hidden');
}

/** Update the badge count on the FAB and its aria-label */
export function updateBadge(badge: HTMLSpanElement, count: number): void {
  badge.textContent = String(count);
  const button = badge.parentElement;
  const isOpen = button?.getAttribute('data-air-state') === 'open';
  badge.classList.toggle('air-fab__badge--hidden', count === 0 || isOpen);

  // Update the parent button's aria-label to include the count
  if (button) {
    button.setAttribute('aria-label',
      count > 0
        ? `Toggle inline review (${count} annotation${count === 1 ? '' : 's'})`
        : 'Toggle inline review panel',
    );
  }
}
