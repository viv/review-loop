/**
 * Highlight injection and removal.
 *
 * Wraps selected text in <mark> elements in the light DOM with inline styles.
 * Supports cross-element selections (multiple marks with same data-air-id).
 */

import type { AnnotationStatus } from './types.js';

export const HIGHLIGHT_ATTR = 'data-air-id';

const HIGHLIGHT_STYLE = 'background-color: rgba(217,119,6,0.3); border-radius: 2px; cursor: pointer;';
const IN_PROGRESS_HIGHLIGHT_STYLE = 'background-color: rgba(244,114,182,0.2); border-radius: 2px; cursor: pointer;';
const ADDRESSED_HIGHLIGHT_STYLE = 'background-color: rgba(148,163,184,0.2); border-radius: 2px; cursor: pointer;';

/**
 * Apply a highlight to a Range by wrapping text nodes in <mark> elements.
 * For cross-element ranges, creates multiple marks all sharing the same ID.
 */
export function applyHighlight(range: Range, id: string, status: AnnotationStatus = 'open'): void {
  // Collect all text nodes within the range
  const textNodes = getTextNodesInRange(range);

  if (textNodes.length === 0) return;

  // For single text node, use surroundContents for simplicity
  if (textNodes.length === 1 &&
      range.startContainer === range.endContainer &&
      range.startContainer.nodeType === Node.TEXT_NODE) {
    const mark = createMark(id, status);
    range.surroundContents(mark);
    return;
  }

  // For cross-element or multi-node ranges, wrap each text node segment
  for (const { node, startOffset, endOffset } of textNodes) {
    const text = node.textContent ?? '';
    if (startOffset >= endOffset || startOffset >= text.length) continue;

    // Split the text node to isolate the highlighted portion
    const workNode = startOffset > 0 ? node.splitText(startOffset) : node;
    const actualEnd = endOffset - startOffset;

    if (actualEnd < (workNode.textContent?.length ?? 0)) {
      workNode.splitText(actualEnd);
    }

    // Wrap the isolated portion
    const mark = createMark(id, status);
    workNode.parentNode?.insertBefore(mark, workNode);
    mark.appendChild(workNode);
  }
}

/**
 * Remove all highlight marks for a given annotation ID.
 * Restores the original text content and normalises adjacent text nodes.
 */
export function removeHighlight(id: string): void {
  const marks = getHighlightMarks(id);

  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;

    // Move all children out of the mark
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }

    parent.removeChild(mark);
    parent.normalize();
  }
}

/**
 * Get all <mark> elements for a given annotation ID.
 */
export function getHighlightMarks(id: string): Element[] {
  return Array.from(document.querySelectorAll(`mark[${HIGHLIGHT_ATTR}="${CSS.escape(id)}"]`));
}

/**
 * Add a pulse animation to a highlight (used when scrolling to it from the panel).
 * Preserves the current status colour by saving and restoring the original background.
 */
export function pulseHighlight(id: string): void {
  const marks = getHighlightMarks(id);
  for (const mark of marks) {
    const el = mark as HTMLElement;
    const origBg = el.style.backgroundColor;
    el.setAttribute('data-air-pulse', '');
    el.style.transition = 'background-color 0.3s ease';
    el.style.backgroundColor = 'rgba(217,119,6,0.6)';
    setTimeout(() => {
      el.style.backgroundColor = origBg;
    }, 600);
    setTimeout(() => {
      el.style.transition = '';
      el.removeAttribute('data-air-pulse');
    }, 900);
  }
}

// --- Element Highlights ---

export const ELEMENT_HIGHLIGHT_ATTR = 'data-air-element-id';

/**
 * Apply a visual highlight to an element (dashed amber outline).
 */
export function applyElementHighlight(element: Element, id: string, status: AnnotationStatus = 'open'): void {
  const el = element as HTMLElement;
  el.setAttribute(ELEMENT_HIGHLIGHT_ATTR, id);
  if (status === 'addressed') {
    el.style.outline = '2px dashed rgba(148,163,184,0.5)';
  } else if (status === 'in_progress') {
    el.style.outline = '2px dashed rgba(244,114,182,0.5)';
  } else {
    el.style.outline = '2px dashed rgba(217,119,6,0.8)';
  }
  el.style.outlineOffset = '2px';
  el.style.cursor = 'pointer';
}

/**
 * Remove the visual highlight from an annotated element.
 */
export function removeElementHighlight(id: string): void {
  const el = document.querySelector(`[${ELEMENT_HIGHLIGHT_ATTR}="${CSS.escape(id)}"]`) as HTMLElement | null;
  if (!el) return;
  el.removeAttribute(ELEMENT_HIGHLIGHT_ATTR);
  el.removeAttribute('data-air-pulse');
  el.style.outline = '';
  el.style.outlineOffset = '';
  el.style.cursor = '';
  // Clear properties that may be set by a mid-flight pulse animation
  el.style.backgroundColor = '';
  el.style.boxShadow = '';
  el.style.transition = '';
}

/**
 * Add a pulse animation to an element highlight.
 * Uses a background flash and box-shadow (matching the text highlight pulse)
 * so the effect is clearly visible, not just a subtle outline change.
 * Preserves the current status colour by saving and restoring the original outline.
 */
export function pulseElementHighlight(id: string): void {
  const el = document.querySelector(`[${ELEMENT_HIGHLIGHT_ATTR}="${CSS.escape(id)}"]`) as HTMLElement | null;
  if (!el) return;
  el.setAttribute('data-air-pulse', '');

  // Save originals to restore after animation
  const origBg = el.style.backgroundColor;
  const origBoxShadow = el.style.boxShadow;
  const origOutlineColor = el.style.outlineColor;

  el.style.transition = 'background-color 0.3s ease, box-shadow 0.3s ease, outline-color 0.3s ease';
  el.style.outlineColor = 'rgba(217,119,6,1)';
  el.style.backgroundColor = 'rgba(217,119,6,0.15)';
  el.style.boxShadow = '0 0 0 4px rgba(217,119,6,0.3)';

  setTimeout(() => {
    el.style.outlineColor = origOutlineColor;
    el.style.backgroundColor = origBg;
    el.style.boxShadow = origBoxShadow;
  }, 600);
  setTimeout(() => {
    el.style.transition = '';
    el.removeAttribute('data-air-pulse');
  }, 900);
}

/**
 * Get the element with a specific annotation ID.
 */
export function getElementByAnnotationId(id: string): Element | null {
  return document.querySelector(`[${ELEMENT_HIGHLIGHT_ATTR}="${CSS.escape(id)}"]`);
}

/**
 * Remove all element highlights from the DOM.
 */
export function removeAllElementHighlights(): void {
  const elements = document.querySelectorAll(`[${ELEMENT_HIGHLIGHT_ATTR}]`);
  for (const el of elements) {
    const id = el.getAttribute(ELEMENT_HIGHLIGHT_ATTR)!;
    removeElementHighlight(id);
  }
}

// --- Helpers ---

function createMark(id: string, status: AnnotationStatus = 'open'): HTMLElement {
  const mark = document.createElement('mark');
  mark.setAttribute(HIGHLIGHT_ATTR, id);
  if (status === 'addressed') {
    mark.setAttribute('style', ADDRESSED_HIGHLIGHT_STYLE);
  } else if (status === 'in_progress') {
    mark.setAttribute('style', IN_PROGRESS_HIGHLIGHT_STYLE);
  } else {
    mark.setAttribute('style', HIGHLIGHT_STYLE);
  }
  return mark;
}

interface TextNodeSegment {
  node: Text;
  startOffset: number;
  endOffset: number;
}

/**
 * Collect all text nodes within a Range, along with the offsets within each node.
 *
 * Uses Range.intersectsNode for robust detection — avoids identity comparison
 * which can fail if the Range was cloned across async boundaries.
 */
function getTextNodesInRange(range: Range): TextNodeSegment[] {
  const segments: TextNodeSegment[] = [];

  // If range is within a single text node
  if (range.startContainer === range.endContainer &&
      range.startContainer.nodeType === Node.TEXT_NODE) {
    segments.push({
      node: range.startContainer as Text,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
    });
    return segments;
  }

  // Walk all text nodes under the common ancestor and test intersection
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
  );

  let node: Text | null;
  let foundFirst = false;

  while ((node = walker.nextNode() as Text | null)) {
    if (!range.intersectsNode(node)) {
      // Once we've found intersecting nodes and then stop intersecting, we're done
      if (foundFirst) break;
      continue;
    }

    foundFirst = true;
    const nodeLen = node.textContent?.length ?? 0;

    // Determine start offset: use range.startOffset only for the range's start container
    const startOffset = (node === range.startContainer) ? range.startOffset : 0;

    // Determine end offset: use range.endOffset only for the range's end container
    const endOffset = (node === range.endContainer) ? range.endOffset : nodeLen;

    if (startOffset < endOffset) {
      segments.push({ node, startOffset, endOffset });
    }
  }

  return segments;
}
