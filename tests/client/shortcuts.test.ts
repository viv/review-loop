import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerShortcuts, unregisterShortcuts, type ShortcutHandlers } from '../../src/client/shortcuts.js';

describe('registerShortcuts', () => {
  let handlers: ShortcutHandlers;

  beforeEach(() => {
    handlers = {
      togglePanel: vi.fn(),
      closeActive: vi.fn().mockReturnValue(false),
    };
  });

  afterEach(() => {
    unregisterShortcuts();
  });

  it('calls togglePanel on Cmd+Shift+. (Mac)', () => {
    registerShortcuts(handlers);

    const event = new KeyboardEvent('keydown', {
      key: '.',
      shiftKey: true,
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(handlers.togglePanel).toHaveBeenCalledOnce();
  });

  it('calls togglePanel on Ctrl+Shift+. (non-Mac)', () => {
    registerShortcuts(handlers);

    const event = new KeyboardEvent('keydown', {
      key: '.',
      shiftKey: true,
      ctrlKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(handlers.togglePanel).toHaveBeenCalledOnce();
  });

  it('calls closeActive on Escape', () => {
    registerShortcuts(handlers);

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(handlers.closeActive).toHaveBeenCalledOnce();
  });

  it('does NOT fire when focus is in an input element', () => {
    registerShortcuts(handlers);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: '.',
      shiftKey: true,
      metaKey: true,
      bubbles: true,
    });
    input.dispatchEvent(event);

    expect(handlers.togglePanel).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('does NOT fire when focus is in a textarea', () => {
    registerShortcuts(handlers);

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const event = new KeyboardEvent('keydown', {
      key: '.',
      shiftKey: true,
      metaKey: true,
      bubbles: true,
    });
    textarea.dispatchEvent(event);

    expect(handlers.togglePanel).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it('Escape still fires in an input (for dismissing popup/panel)', () => {
    registerShortcuts(handlers);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    });
    // Escape on document should still fire even if input is focused
    document.dispatchEvent(event);

    expect(handlers.closeActive).toHaveBeenCalledOnce();
    document.body.removeChild(input);
  });

  it('Escape calls stopPropagation and preventDefault when closeActive returns true', () => {
    vi.mocked(handlers.closeActive).mockReturnValue(true);
    registerShortcuts(handlers);

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const stopSpy = vi.spyOn(event, 'stopPropagation');
    const preventSpy = vi.spyOn(event, 'preventDefault');

    document.dispatchEvent(event);

    expect(handlers.closeActive).toHaveBeenCalledOnce();
    expect(stopSpy).toHaveBeenCalledOnce();
    expect(preventSpy).toHaveBeenCalledOnce();
  });

  it('Escape does NOT call stopPropagation when closeActive returns false', () => {
    vi.mocked(handlers.closeActive).mockReturnValue(false);
    registerShortcuts(handlers);

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const stopSpy = vi.spyOn(event, 'stopPropagation');
    const preventSpy = vi.spyOn(event, 'preventDefault');

    document.dispatchEvent(event);

    expect(handlers.closeActive).toHaveBeenCalledOnce();
    expect(stopSpy).not.toHaveBeenCalled();
    expect(preventSpy).not.toHaveBeenCalled();
  });
});
