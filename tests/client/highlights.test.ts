import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  applyHighlight,
  removeHighlight,
  getHighlightMarks,
  pulseHighlight,
  applyElementHighlight,
  removeElementHighlight,
  pulseElementHighlight,
  HIGHLIGHT_ATTR,
  ELEMENT_HIGHLIGHT_ATTR,
} from '../../src/client/highlights.js';

describe('applyHighlight', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('wraps a text range in a <mark> element', () => {
    document.body.innerHTML = '<p>The quick brown fox</p>';
    const textNode = document.querySelector('p')!.firstChild!;

    const range = document.createRange();
    range.setStart(textNode, 10);
    range.setEnd(textNode, 15);

    applyHighlight(range, 'test-id-1');

    const marks = document.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('brown');
  });

  it('sets data-air-id attribute on the mark', () => {
    document.body.innerHTML = '<p>Hello world</p>';
    const textNode = document.querySelector('p')!.firstChild!;

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);

    applyHighlight(range, 'abc-123');

    const mark = document.querySelector('mark')!;
    expect(mark.getAttribute(HIGHLIGHT_ATTR)).toBe('abc-123');
  });

  it('applies inline styles for background and cursor', () => {
    document.body.innerHTML = '<p>Hello world</p>';
    const textNode = document.querySelector('p')!.firstChild!;

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);

    applyHighlight(range, 'id-1');

    const mark = document.querySelector('mark')!;
    expect(mark.style.backgroundColor).toBeTruthy();
    expect(mark.style.borderRadius).toBeTruthy();
    expect(mark.style.cursor).toBe('pointer');
  });

  it('preserves surrounding text content', () => {
    document.body.innerHTML = '<p>The quick brown fox</p>';
    const textNode = document.querySelector('p')!.firstChild!;

    const range = document.createRange();
    range.setStart(textNode, 10);
    range.setEnd(textNode, 15);

    applyHighlight(range, 'id-1');

    const p = document.querySelector('p')!;
    expect(p.textContent).toBe('The quick brown fox');
  });

  it('handles cross-element selection with multiple marks', () => {
    document.body.innerHTML = '<p>Start text <strong>bold text</strong> end text</p>';
    const startText = document.querySelector('p')!.firstChild!;
    const boldText = document.querySelector('strong')!.firstChild!;

    const range = document.createRange();
    range.setStart(startText, 6);
    range.setEnd(boldText, 4);

    applyHighlight(range, 'cross-id');

    const marks = document.querySelectorAll('mark');
    // Should have marks with the same ID
    expect(marks.length).toBeGreaterThanOrEqual(1);
    for (const mark of marks) {
      expect(mark.getAttribute(HIGHLIGHT_ATTR)).toBe('cross-id');
    }
  });

  it('does not introduce extra whitespace', () => {
    document.body.innerHTML = '<p>Hello world</p>';
    const textNode = document.querySelector('p')!.firstChild!;

    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);

    applyHighlight(range, 'id-1');

    const p = document.querySelector('p')!;
    // Text content should be exactly preserved
    expect(p.textContent).toBe('Hello world');
    // No extra whitespace nodes
    expect(p.innerHTML).not.toMatch(/\s{2,}/);
  });
});

describe('removeHighlight', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('removes a mark and restores the original text', () => {
    document.body.innerHTML = '<p>The quick <mark data-air-id="id-1" style="background-color: rgba(217,119,6,0.3); border-radius: 2px; cursor: pointer;">brown</mark> fox</p>';

    removeHighlight('id-1');

    expect(document.querySelectorAll('mark').length).toBe(0);
    expect(document.querySelector('p')!.textContent).toBe('The quick brown fox');
  });

  it('removes multiple marks with the same ID (cross-element)', () => {
    document.body.innerHTML = `
      <p><mark data-air-id="id-1" style="">first</mark> middle <mark data-air-id="id-1" style="">second</mark></p>
    `;

    removeHighlight('id-1');

    expect(document.querySelectorAll('mark').length).toBe(0);
  });

  it('does not remove marks with different IDs', () => {
    document.body.innerHTML = `
      <p><mark data-air-id="id-1" style="">first</mark> <mark data-air-id="id-2" style="">second</mark></p>
    `;

    removeHighlight('id-1');

    expect(document.querySelectorAll('mark').length).toBe(1);
    expect(document.querySelector('mark')!.getAttribute(HIGHLIGHT_ATTR)).toBe('id-2');
  });

  it('normalises text nodes after removal', () => {
    document.body.innerHTML = '<p>before <mark data-air-id="id-1" style="">middle</mark> after</p>';

    removeHighlight('id-1');

    const p = document.querySelector('p')!;
    // After normalise(), adjacent text nodes should merge
    p.normalize();
    expect(p.childNodes.length).toBe(1);
    expect(p.textContent).toBe('before middle after');
  });
});

describe('getHighlightMarks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns all marks for a given ID', () => {
    document.body.innerHTML = `
      <p><mark data-air-id="id-1" style="">one</mark> <mark data-air-id="id-1" style="">two</mark></p>
      <p><mark data-air-id="id-2" style="">three</mark></p>
    `;

    const marks = getHighlightMarks('id-1');
    expect(marks.length).toBe(2);
  });

  it('returns empty array when no marks match', () => {
    document.body.innerHTML = '<p>No marks here</p>';
    const marks = getHighlightMarks('nonexistent');
    expect(marks.length).toBe(0);
  });
});

describe('pulseHighlight', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets data-air-pulse attribute on the mark', () => {
    document.body.innerHTML = '<p><mark data-air-id="id-1" style="background-color: rgba(217,119,6,0.3); border-radius: 2px; cursor: pointer;">hello</mark></p>';

    pulseHighlight('id-1');

    const mark = document.querySelector('mark')!;
    expect(mark.hasAttribute('data-air-pulse')).toBe(true);
  });

  it('changes background to brighter orange during pulse', () => {
    document.body.innerHTML = '<p><mark data-air-id="id-1" style="background-color: rgba(217,119,6,0.3); border-radius: 2px; cursor: pointer;">hello</mark></p>';

    pulseHighlight('id-1');

    const mark = document.querySelector('mark') as HTMLElement;
    // happy-dom normalises rgba with spaces
    expect(mark.style.backgroundColor).toBe('rgba(217, 119, 6, 0.6)');
  });

  it('restores original background after 600ms', () => {
    document.body.innerHTML = '<p><mark data-air-id="id-1" style="background-color: rgba(217,119,6,0.3); border-radius: 2px; cursor: pointer;">hello</mark></p>';

    pulseHighlight('id-1');
    vi.advanceTimersByTime(600);

    const mark = document.querySelector('mark') as HTMLElement;
    expect(mark.style.backgroundColor).toBe('rgba(217, 119, 6, 0.3)');
  });

  it('restores in_progress background after 600ms', () => {
    document.body.innerHTML = '<p><mark data-air-id="id-1" style="background-color: rgba(244,114,182,0.2); border-radius: 2px; cursor: pointer;">hello</mark></p>';

    pulseHighlight('id-1');

    const mark = document.querySelector('mark') as HTMLElement;
    // During pulse, background is brighter
    expect(mark.style.backgroundColor).toBe('rgba(217, 119, 6, 0.6)');

    vi.advanceTimersByTime(600);
    // After pulse, original in_progress colour is restored
    expect(mark.style.backgroundColor).toBe('rgba(244, 114, 182, 0.2)');
  });

  it('restores addressed background after 600ms', () => {
    document.body.innerHTML = '<p><mark data-air-id="id-1" style="background-color: rgba(148,163,184,0.2); border-radius: 2px; cursor: pointer;">hello</mark></p>';

    pulseHighlight('id-1');
    vi.advanceTimersByTime(600);

    const mark = document.querySelector('mark') as HTMLElement;
    expect(mark.style.backgroundColor).toBe('rgba(148, 163, 184, 0.2)');
  });

  it('removes data-air-pulse and transition after 900ms', () => {
    document.body.innerHTML = '<p><mark data-air-id="id-1" style="background-color: rgba(217,119,6,0.3); border-radius: 2px; cursor: pointer;">hello</mark></p>';

    pulseHighlight('id-1');
    vi.advanceTimersByTime(900);

    const mark = document.querySelector('mark') as HTMLElement;
    expect(mark.hasAttribute('data-air-pulse')).toBe(false);
    expect(mark.style.transition).toBe('');
  });
});

describe('pulseElementHighlight', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets data-air-pulse attribute on the element', () => {
    document.body.innerHTML = '<div data-air-element-id="el-1" style="outline: 2px dashed rgba(217,119,6,0.8); outline-offset: 2px; cursor: pointer;">content</div>';

    pulseElementHighlight('el-1');

    const el = document.querySelector('[data-air-element-id="el-1"]')!;
    expect(el.hasAttribute('data-air-pulse')).toBe(true);
  });

  it('applies background flash during pulse', () => {
    document.body.innerHTML = '<div data-air-element-id="el-1" style="outline: 2px dashed rgba(217,119,6,0.8); outline-offset: 2px; cursor: pointer;">content</div>';

    pulseElementHighlight('el-1');

    const el = document.querySelector('[data-air-element-id="el-1"]') as HTMLElement;
    expect(el.style.backgroundColor).toBe('rgba(217, 119, 6, 0.15)');
  });

  it('applies box-shadow during pulse', () => {
    document.body.innerHTML = '<div data-air-element-id="el-1" style="outline: 2px dashed rgba(217,119,6,0.8); outline-offset: 2px; cursor: pointer;">content</div>';

    pulseElementHighlight('el-1');

    const el = document.querySelector('[data-air-element-id="el-1"]') as HTMLElement;
    expect(el.style.boxShadow).toBe('0 0 0 4px rgba(217,119,6,0.3)');
  });

  it('brightens outline color during pulse', () => {
    document.body.innerHTML = '<div data-air-element-id="el-1" style="outline: 2px dashed rgba(217,119,6,0.8); outline-offset: 2px; cursor: pointer;">content</div>';

    pulseElementHighlight('el-1');

    const el = document.querySelector('[data-air-element-id="el-1"]') as HTMLElement;
    expect(el.style.outlineColor).toBe('rgba(217, 119, 6, 1)');
  });

  it('restores original styles after 600ms', () => {
    document.body.innerHTML = '<div data-air-element-id="el-1" style="outline: 2px dashed rgba(217,119,6,0.8); outline-offset: 2px; cursor: pointer;">content</div>';

    pulseElementHighlight('el-1');
    vi.advanceTimersByTime(600);

    const el = document.querySelector('[data-air-element-id="el-1"]') as HTMLElement;
    expect(el.style.backgroundColor).toBe('');
    expect(el.style.boxShadow).toBe('');
    // Outline colour restored to its original value (decomposed from the outline shorthand)
    expect(el.style.outlineColor).toBe('rgba(217, 119, 6, 0.8)');
  });

  it('restores in_progress outline colour after 600ms', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    applyElementHighlight(el, 'el-ip', 'in_progress');

    pulseElementHighlight('el-ip');
    // During pulse, outline is bright amber
    expect(el.style.outlineColor).toBe('rgba(217, 119, 6, 1)');

    vi.advanceTimersByTime(600);
    // After pulse, original in_progress pink is restored
    expect(el.style.outline).toContain('rgba(244, 114, 182, 0.5)');
  });

  it('restores addressed outline colour after 600ms', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    applyElementHighlight(el, 'el-addr', 'addressed');

    pulseElementHighlight('el-addr');
    vi.advanceTimersByTime(600);

    // After pulse, original addressed silver is restored
    expect(el.style.outline).toContain('rgba(148, 163, 184, 0.5)');
  });

  it('removes data-air-pulse and transition after 900ms', () => {
    document.body.innerHTML = '<div data-air-element-id="el-1" style="outline: 2px dashed rgba(217,119,6,0.8); outline-offset: 2px; cursor: pointer;">content</div>';

    pulseElementHighlight('el-1');
    vi.advanceTimersByTime(900);

    const el = document.querySelector('[data-air-element-id="el-1"]') as HTMLElement;
    expect(el.hasAttribute('data-air-pulse')).toBe(false);
    expect(el.style.transition).toBe('');
  });

  it('does nothing when element does not exist', () => {
    document.body.innerHTML = '<p>No annotated elements</p>';

    // Should not throw
    expect(() => pulseElementHighlight('nonexistent')).not.toThrow();
  });

  it('preserves pre-existing background colour after pulse', () => {
    document.body.innerHTML = '<div data-air-element-id="el-1" style="outline: 2px dashed rgba(217,119,6,0.8); outline-offset: 2px; cursor: pointer; background-color: rgb(240, 240, 240);">content</div>';

    pulseElementHighlight('el-1');

    const el = document.querySelector('[data-air-element-id="el-1"]') as HTMLElement;
    // During pulse, background is overridden
    expect(el.style.backgroundColor).toBe('rgba(217, 119, 6, 0.15)');

    // After 600ms, original background is restored
    vi.advanceTimersByTime(600);
    expect(el.style.backgroundColor).toBe('rgb(240, 240, 240)');
  });
});

describe('removeElementHighlight — mid-pulse cleanup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears pulse styles when highlight is removed mid-animation', () => {
    document.body.innerHTML = '<div data-air-element-id="el-1" style="outline: 2px dashed rgba(217,119,6,0.8); outline-offset: 2px; cursor: pointer;">content</div>';

    // Start pulse
    pulseElementHighlight('el-1');
    const el = document.querySelector('div') as HTMLElement;

    // Verify pulse styles are active
    expect(el.style.backgroundColor).toBe('rgba(217, 119, 6, 0.15)');
    expect(el.style.boxShadow).toBe('0 0 0 4px rgba(217,119,6,0.3)');

    // Remove highlight mid-pulse (simulates user deleting annotation quickly)
    removeElementHighlight('el-1');

    // All styles should be cleared, including pulse properties
    expect(el.style.outline).toBe('');
    expect(el.style.outlineOffset).toBe('');
    expect(el.style.cursor).toBe('');
    expect(el.style.backgroundColor).toBe('');
    expect(el.style.boxShadow).toBe('');
    expect(el.style.transition).toBe('');
    expect(el.hasAttribute('data-air-pulse')).toBe(false);
    expect(el.hasAttribute('data-air-element-id')).toBe(false);
  });
});
