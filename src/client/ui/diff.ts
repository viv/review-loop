/**
 * Word-level diff for comparing annotation text.
 * Uses LCS (longest common subsequence) to produce readable diffs.
 */

export interface DiffSegment {
  kind: 'equal' | 'added' | 'removed';
  text: string;
}

/**
 * Split text into words, preserving whitespace as part of the preceding word.
 * E.g. "the quick fox" → ["the ", "quick ", "fox"]
 */
function tokenise(text: string): string[] {
  if (text === '') return [];
  return text.match(/\S+\s*/g) || [];
}

/**
 * Compute LCS table for two token arrays.
 * Returns a 2D array where lcs[i][j] = length of LCS of a[0..i-1] and b[0..j-1].
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const table: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

/**
 * Backtrack through the LCS table to produce diff segments.
 */
function backtrack(table: number[][], a: string[], b: string[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let i = a.length;
  let j = b.length;

  // Collect segments in reverse, then reverse at the end
  const reversed: DiffSegment[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      reversed.push({ kind: 'equal', text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      reversed.push({ kind: 'added', text: b[j - 1] });
      j--;
    } else {
      reversed.push({ kind: 'removed', text: a[i - 1] });
      i--;
    }
  }

  reversed.reverse();

  // Merge adjacent segments of the same kind
  for (const seg of reversed) {
    const last = segments[segments.length - 1];
    if (last && last.kind === seg.kind) {
      last.text += seg.text;
    } else {
      segments.push({ ...seg });
    }
  }

  return segments;
}

/**
 * Compute a word-level diff between two strings.
 * Returns an array of segments marking text as equal, added, or removed.
 */
export function computeWordDiff(oldText: string, newText: string): DiffSegment[] {
  if (oldText === newText) {
    return oldText === '' ? [] : [{ kind: 'equal', text: oldText }];
  }

  if (oldText === '') {
    return [{ kind: 'added', text: newText }];
  }

  if (newText === '') {
    return [{ kind: 'removed', text: oldText }];
  }

  const oldTokens = tokenise(oldText);
  const newTokens = tokenise(newText);
  const table = lcsTable(oldTokens, newTokens);

  return backtrack(table, oldTokens, newTokens);
}

/**
 * Render diff segments into a container span with styled child spans.
 */
export function renderDiff(segments: DiffSegment[]): HTMLSpanElement {
  const container = document.createElement('span');

  for (const segment of segments) {
    const span = document.createElement('span');
    span.textContent = segment.text;

    if (segment.kind === 'removed') {
      span.className = 'air-diff-removed';
    } else if (segment.kind === 'added') {
      span.className = 'air-diff-added';
    }

    container.appendChild(span);
  }

  return container;
}
