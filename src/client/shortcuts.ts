/**
 * Keyboard shortcut registration.
 *
 * Shortcuts:
 * - Cmd/Ctrl + Shift + .   → Toggle panel
 * - Escape                  → Close panel / dismiss popup
 *
 * Escape uses capture phase to take precedence over site handlers,
 * but only stops propagation when we actually handle it (panel/popup open).
 *
 * All shortcuts except Escape are suppressed when focus is in an input or textarea.
 */

export interface ShortcutHandlers {
  togglePanel: () => void;
  /** Returns true if something was closed (popup or panel), false otherwise. */
  closeActive: () => boolean;
}

let activeHandler: ((e: KeyboardEvent) => void) | null = null;

export function registerShortcuts(handlers: ShortcutHandlers): void {
  if (activeHandler) {
    unregisterShortcuts();
  }

  activeHandler = (e: KeyboardEvent) => {
    const isModified = e.metaKey || e.ctrlKey;
    const isInInput = isInputFocused();

    // Escape — always fire (even in inputs), but only on capture phase.
    // Only stop propagation when we actually close something.
    if (e.key === 'Escape') {
      const handled = handlers.closeActive();
      if (handled) {
        e.stopPropagation();
        e.preventDefault();
      }
      return;
    }

    // All other shortcuts require modifier and no input focus
    if (!isModified || !e.shiftKey || isInInput) return;

    switch (e.key) {
      case '.':
      case '>': // Shift+. produces > on some layouts
        e.preventDefault();
        handlers.togglePanel();
        break;
    }
  };

  // Use capture phase for Escape precedence
  document.addEventListener('keydown', activeHandler, true);
}

export function unregisterShortcuts(): void {
  if (activeHandler) {
    document.removeEventListener('keydown', activeHandler, true);
    activeHandler = null;
  }
}

function isInputFocused(): boolean {
  let el: Element | null = document.activeElement;
  if (!el) return false;

  // Traverse into shadow roots to find the actual focused element
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }

  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
}
