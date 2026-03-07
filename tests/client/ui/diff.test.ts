import { describe, it, expect } from 'vitest';
import { computeWordDiff, renderDiff } from '../../../src/client/ui/diff.js';
import type { DiffSegment } from '../../../src/client/ui/diff.js';

describe('computeWordDiff', () => {
  it('returns a single equal segment for identical strings', () => {
    const result = computeWordDiff('hello world', 'hello world');
    expect(result).toEqual([{ kind: 'equal', text: 'hello world' }]);
  });

  it('returns empty array for two empty strings', () => {
    const result = computeWordDiff('', '');
    expect(result).toEqual([]);
  });

  it('returns added segment when old is empty', () => {
    const result = computeWordDiff('', 'hello world');
    expect(result).toEqual([{ kind: 'added', text: 'hello world' }]);
  });

  it('returns removed segment when new is empty', () => {
    const result = computeWordDiff('hello world', '');
    expect(result).toEqual([{ kind: 'removed', text: 'hello world' }]);
  });

  it('detects a single word change', () => {
    const result = computeWordDiff('the quick brown fox', 'the slow brown fox');
    expect(result).toEqual([
      { kind: 'equal', text: 'the ' },
      { kind: 'removed', text: 'quick ' },
      { kind: 'added', text: 'slow ' },
      { kind: 'equal', text: 'brown fox' },
    ]);
  });

  it('detects an added word', () => {
    const result = computeWordDiff('hello world', 'hello beautiful world');
    expect(result).toEqual([
      { kind: 'equal', text: 'hello ' },
      { kind: 'added', text: 'beautiful ' },
      { kind: 'equal', text: 'world' },
    ]);
  });

  it('detects a removed word', () => {
    const result = computeWordDiff('hello beautiful world', 'hello world');
    expect(result).toEqual([
      { kind: 'equal', text: 'hello ' },
      { kind: 'removed', text: 'beautiful ' },
      { kind: 'equal', text: 'world' },
    ]);
  });

  it('handles completely different strings', () => {
    const result = computeWordDiff('foo bar', 'baz qux');
    expect(result).toEqual([
      { kind: 'removed', text: 'foo bar' },
      { kind: 'added', text: 'baz qux' },
    ]);
  });

  it('handles multi-word changes', () => {
    const result = computeWordDiff(
      'the quick brown fox jumps',
      'the lazy red fox leaps',
    );
    // "the" and "fox" are common
    expect(result).toEqual([
      { kind: 'equal', text: 'the ' },
      { kind: 'removed', text: 'quick brown ' },
      { kind: 'added', text: 'lazy red ' },
      { kind: 'equal', text: 'fox ' },
      { kind: 'removed', text: 'jumps' },
      { kind: 'added', text: 'leaps' },
    ]);
  });

  it('preserves word boundaries in output', () => {
    const result = computeWordDiff('a b c', 'a b c');
    expect(result).toEqual([{ kind: 'equal', text: 'a b c' }]);
    // Concatenated text should reconstruct the original
    const text = result.map((s) => s.text).join('');
    expect(text).toBe('a b c');
  });

  it('handles single word strings', () => {
    const result = computeWordDiff('hello', 'world');
    expect(result).toEqual([
      { kind: 'removed', text: 'hello' },
      { kind: 'added', text: 'world' },
    ]);
  });

  it('merges adjacent segments of the same kind', () => {
    // When all words differ, they should be merged into single removed/added segments
    const result = computeWordDiff('a b c', 'x y z');
    const kinds = result.map((s) => s.kind);
    // Should not have consecutive segments of the same kind
    for (let i = 1; i < kinds.length; i++) {
      expect(kinds[i]).not.toBe(kinds[i - 1]);
    }
  });
});

describe('renderDiff', () => {
  it('returns an HTMLSpanElement container', () => {
    const result = renderDiff([]);
    expect(result).toBeInstanceOf(HTMLSpanElement);
  });

  it('creates child spans for each segment', () => {
    const segments: DiffSegment[] = [
      { kind: 'equal', text: 'hello ' },
      { kind: 'removed', text: 'world' },
      { kind: 'added', text: 'there' },
    ];
    const container = renderDiff(segments);
    expect(container.children).toHaveLength(3);
  });

  it('equal segments have no special class', () => {
    const container = renderDiff([{ kind: 'equal', text: 'hello' }]);
    const span = container.children[0] as HTMLSpanElement;
    expect(span.textContent).toBe('hello');
    expect(span.className).toBe('');
  });

  it('removed segments have air-diff-removed class', () => {
    const container = renderDiff([{ kind: 'removed', text: 'old' }]);
    const span = container.children[0] as HTMLSpanElement;
    expect(span.textContent).toBe('old');
    expect(span.className).toBe('air-diff-removed');
  });

  it('added segments have air-diff-added class', () => {
    const container = renderDiff([{ kind: 'added', text: 'new' }]);
    const span = container.children[0] as HTMLSpanElement;
    expect(span.textContent).toBe('new');
    expect(span.className).toBe('air-diff-added');
  });

  it('text content matches segment text', () => {
    const segments: DiffSegment[] = [
      { kind: 'equal', text: 'the ' },
      { kind: 'removed', text: 'quick ' },
      { kind: 'added', text: 'slow ' },
      { kind: 'equal', text: 'fox' },
    ];
    const container = renderDiff(segments);
    const texts = Array.from(container.children).map((c) => c.textContent);
    expect(texts).toEqual(['the ', 'quick ', 'slow ', 'fox']);
  });

  it('renders empty segments array as empty container', () => {
    const container = renderDiff([]);
    expect(container.children).toHaveLength(0);
  });
});
