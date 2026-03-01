/** All CSS for the Shadow DOM UI — template literal strings for injection */

/**
 * Centralised z-index constants.
 * Exported so JS-created elements (inspector overlay, toast) can reference them.
 */
export const Z_INDEX = {
  panel: 9999,
  fab: 10000,
  popup: 10001,
  inspector: 10002,
  toast: 10003,
  tooltip: 10002,
} as const;

export const HOST_STYLES = /* css */ `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #e5e5e5;
    box-sizing: border-box;
  }

  :host *, :host *::before, :host *::after {
    box-sizing: border-box;
  }
`;

export const FAB_STYLES = /* css */ `
  .air-fab {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #D97706;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: ${Z_INDEX.fab};
    transition: transform 0.2s ease, background 0.2s ease;
    padding: 0;
  }

  .air-fab:hover {
    transform: scale(1.08);
    background: #B45309;
  }

  .air-fab:active {
    transform: scale(0.95);
  }

  .air-fab svg {
    width: 24px;
    height: 24px;
    fill: white;
    transition: transform 0.2s ease;
  }

  .air-fab--open svg {
    transform: rotate(45deg);
  }

  .air-fab__badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 20px;
    height: 20px;
    border-radius: 10px;
    background: #EF4444;
    color: white;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 5px;
    line-height: 1;
  }

  .air-fab__badge--hidden {
    display: none;
  }
`;

export const PANEL_STYLES = /* css */ `
  .air-panel {
    position: fixed;
    top: 0;
    right: 0;
    width: 380px;
    height: 100vh;
    background: #1a1a1a;
    border-left: 1px solid #333;
    z-index: ${Z_INDEX.panel};
    transform: translateX(100%);
    visibility: hidden;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.3s;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .air-panel--open {
    transform: translateX(0);
    visibility: visible;
  }

  @media (max-width: 480px) {
    .air-panel {
      width: 100%;
    }
  }

  .air-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .air-panel__title {
    font-size: 16px;
    font-weight: 600;
    color: #f5f5f5;
    margin: 0;
  }

  .air-panel__actions {
    display: flex;
    gap: 8px;
  }

  .air-panel__btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid #444;
    background: #2a2a2a;
    color: #e5e5e5;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .air-panel__btn:hover {
    background: #3a3a3a;
  }

  .air-panel__btn--export {
    border-color: #D97706;
    color: #FCD34D;
  }

  .air-panel__btn--export:hover {
    background: #78350F;
  }

  .air-panel__btn--danger {
    border-color: #7f1d1d;
    color: #fca5a5;
  }

  .air-panel__btn--danger:hover {
    background: #450a0a;
  }

  .air-panel__tabs {
    display: flex;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
  }

  .air-panel__tab {
    flex: 1;
    padding: 10px 16px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #999;
    font-size: 13px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .air-panel__tab--active {
    color: #D97706;
    border-bottom-color: #D97706;
  }

  .air-panel__content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .air-panel__empty {
    text-align: center;
    color: #666;
    padding: 40px 16px;
    font-size: 13px;
  }

  .air-panel__empty-arrow {
    display: inline-block;
    font-size: 28px;
    color: #D97706;
    margin-bottom: 8px;
    animation: air-nudge 1.5s ease-in-out infinite;
  }

  @keyframes air-nudge {
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(-8px); }
  }

  .air-annotation-item {
    padding: 12px;
    margin-bottom: 8px;
    background: #242424;
    border-radius: 8px;
    border: 1px solid #333;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .air-annotation-item:hover {
    border-color: #D97706;
  }

  .air-annotation-item__text {
    font-size: 13px;
    color: #FCD34D;
    margin-bottom: 4px;
    font-style: italic;
  }

  .air-annotation-item__note {
    font-size: 13px;
    color: #ccc;
  }

  .air-annotation-item--addressed {
    opacity: 0.85;
    border-left: 3px solid #94A3B8;
  }

  .air-annotation-item__addressed-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    color: #94A3B8;
    margin-bottom: 4px;
  }

  .air-annotation-item__addressed-time {
    font-size: 11px;
    color: #888;
    font-weight: 400;
  }

  .air-popup__btn--accept {
    background: #166534;
    color: #86EFAC;
  }

  .air-popup__btn--accept:hover {
    background: #15803d;
  }

  .air-annotation-item__reply {
    margin-top: 8px;
    padding: 8px;
    border-radius: 0 4px 4px 0;
    font-size: 12px;
    color: #ccc;
  }

  .air-annotation-item__reply--agent {
    background: #1a1a2a;
    border-left: 3px solid #60A5FA;
  }

  .air-annotation-item__reply--reviewer {
    background: #1a2a1a;
    border-left: 3px solid #22C55E;
  }

  .air-annotation-item__reply-prefix {
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 2px;
  }

  .air-annotation-item__reply-prefix--agent {
    color: #60A5FA;
  }

  .air-annotation-item__reply-prefix--reviewer {
    color: #22C55E;
  }

  .air-annotation-item__reply-time {
    font-size: 10px;
    color: #888;
    font-weight: 400;
    margin-left: 8px;
  }

  .air-annotation-item--in-progress {
    opacity: 0.85;
    border-left: 3px solid #F472B6;
  }

  .air-annotation-item__in-progress-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    color: #F472B6;
    margin-bottom: 4px;
  }

  .air-annotation-item__in-progress-time {
    font-size: 11px;
    color: #888;
    font-weight: 400;
  }

  .air-annotation-item--checking {
    opacity: 0.85;
    border-left: 3px solid #D97706;
  }

  .air-annotation-item__checking {
    font-size: 11px;
    color: #D97706;
    margin-top: 4px;
  }

  .air-annotation-item--orphan {
    opacity: 0.7;
    border-left: 3px solid #F87171;
  }

  .air-annotation-item__orphan {
    font-size: 11px;
    color: #F87171;
    margin-top: 4px;
  }

  .air-page-group__title {
    font-size: 14px;
    font-weight: 600;
    color: #D97706;
    margin: 16px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #333;
  }

  .air-page-group__title:first-child {
    margin-top: 0;
  }

  .air-panel__shortcuts {
    padding: 10px 16px;
    border-top: 1px solid #333;
    font-size: 11px;
    color: #666;
    line-height: 1.6;
    flex-shrink: 0;
  }

  .air-panel__shortcuts kbd {
    font-family: inherit;
    font-size: 10px;
    color: #999;
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 3px;
    padding: 1px 4px;
  }
`;

export const POPUP_STYLES = /* css */ `
  .air-popup {
    position: fixed;
    z-index: ${Z_INDEX.popup};
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    width: 300px;
    display: none;
  }

  .air-popup--visible {
    display: block;
  }

  .air-popup__selected {
    font-size: 12px;
    color: #FCD34D;
    font-style: italic;
    margin-bottom: 8px;
    max-height: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .air-popup__textarea {
    width: 100%;
    min-height: 80px;
    background: #242424;
    border: 1px solid #444;
    border-radius: 6px;
    color: #e5e5e5;
    padding: 8px;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    outline: none;
  }

  .air-popup__textarea:focus {
    border-color: #D97706;
  }

  .air-popup__footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  .air-popup__btn {
    padding: 6px 14px;
    border-radius: 6px;
    border: none;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .air-popup__btn--save {
    background: #D97706;
    color: white;
  }

  .air-popup__btn--save:hover {
    background: #B45309;
  }

  .air-popup__btn--cancel {
    background: #333;
    color: #ccc;
  }

  .air-popup__btn--cancel:hover {
    background: #444;
  }

  .air-popup__btn--delete {
    background: #7f1d1d;
    color: #fca5a5;
    margin-right: auto;
  }

  .air-popup__btn--delete:hover {
    background: #991b1b;
  }
`;

export const TOAST_STYLES = /* css */ `
  .air-toast {
    position: fixed;
    bottom: 80px;
    right: 24px;
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 10px 16px;
    color: #e5e5e5;
    font-size: 13px;
    z-index: ${Z_INDEX.toast};
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.2s, transform 0.2s;
    pointer-events: none;
  }

  .air-toast--visible {
    opacity: 1;
    transform: translateY(0);
  }
`;

export const TOOLTIP_STYLES = /* css */ `
  .air-tooltip {
    position: fixed;
    bottom: 80px;
    right: 24px;
    background: #1a1a1a;
    border: 1px solid #D97706;
    border-radius: 8px;
    padding: 10px 16px;
    color: #e5e5e5;
    font-size: 13px;
    z-index: ${Z_INDEX.tooltip};
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    opacity: 1;
    transform: translateY(0);
    transition: opacity 0.3s, transform 0.3s;
    pointer-events: auto;
    max-width: 240px;
  }

  .air-tooltip--hidden {
    opacity: 0;
    transform: translateY(10px);
    pointer-events: none;
  }
`;

export const REDUCED_MOTION_STYLES = /* css */ `
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

/** Combine all styles for the shadow root stylesheet */
export function getAllStyles(): string {
  return [HOST_STYLES, FAB_STYLES, PANEL_STYLES, POPUP_STYLES, TOAST_STYLES, TOOLTIP_STYLES, REDUCED_MOTION_STYLES].join('\n');
}
