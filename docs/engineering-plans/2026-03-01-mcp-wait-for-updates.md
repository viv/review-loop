---
generated_by: Claude Opus 4.6
generation_date: 2026-03-01
model_version: claude-opus-4-6
purpose: implementation_plan
status: draft
human_reviewer: matthewvivian
tags: [mcp, polling, wait, file-watcher, agent-workflow]
---

# `wait_for_updates` MCP Tool

## Problem

After an agent addresses all open annotations, it has no way to know if the reviewer adds new feedback. The user has to manually prompt the agent (e.g. "check review-loop"). The tool description polling workaround (PR #60) helps agents loop through existing annotations, but doesn't solve the "wait for new work" problem.

## Proposal

A 4th MCP tool called `wait_for_updates` that blocks (holds the MCP response) until either:

1. The annotation store changes on disk (reviewer added/reopened something) — returns open annotations immediately
2. A timeout expires (default 60s, max 300s) — returns a "no changes" message

This is long-polling via MCP: the agent calls the tool, the server watches `inline-review.json` with `fs.watch`, and the response is held until something happens. No wasted polling turns, no growing context window.

## Agent Workflow

```
list_annotations → start_work → (edit code) → finish_work
       ↑              ↓
       └──── (repeat until no open annotations)
                      ↓
              wait_for_updates ← (blocks here)
                      ↓
              (reviewer adds feedback)
                      ↓
              list_annotations → start_work → ...
```

## Design

### Handler: `src/mcp/tools/wait-for-updates.ts`

Follows the existing handler + register pattern. Register signature adds `storagePath` (needed for `fs.watch`):

```typescript
export function register(server: McpServer, storage: ReviewStorage, storagePath: string): void
```

### Core Logic

1. **Fingerprint** the current store: `count:latestUpdatedAt` (matches existing REST API pattern from `GET /version`)
2. **`fs.watch`** on the storage file (or parent directory if file doesn't exist yet)
3. **Debounce** (150ms) to collapse multiple events from atomic writes (temp file + rename)
4. On each debounced event, re-read via `storage.read()` and compare fingerprints
5. If fingerprint changed → resolve with open annotations + page notes
6. If timeout expires → resolve with timeout message
7. Clean up watcher + timers on resolve (guaranteed via `settled` flag)

### Response Schema

**Change detected:**
```json
{
  "status": "changed",
  "message": "The annotation store was updated. 2 open annotation(s) found.",
  "openAnnotations": [...],
  "pageNotes": [...]
}
```

**Timeout:**
```json
{
  "status": "timeout",
  "message": "No changes detected after 60 seconds. Call wait_for_updates again to continue waiting, or call list_annotations to check the current state."
}
```

### Tool Description

```
Wait for the reviewer to add or update annotations. Blocks until the annotation store
changes or the timeout expires. Call this after you have addressed all open annotations
and want to wait for new feedback from the reviewer. Returns open annotations when
changes are detected, or a timeout message. This is the idle/wait step of the agent
workflow: list_annotations → start_work → (edit code) → finish_work → (repeat until
no open annotations) → wait_for_updates → (reviewer adds feedback) → list_annotations → ...
```

### Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | number (optional) | 60 | Max seconds to wait (1–300) |

## Implementation Details

### File watching strategy

- Use Node.js built-in `fs.watch` (no new dependencies)
- If file doesn't exist, watch parent directory; filter by `hasChanged` callback
- Debounce at 150ms — atomic writes (temp + rename) cause multiple events
- `fs.watch` errors resolve as timeout (graceful degradation)
- Each tool call creates an independent watcher (no shared state)

### Fingerprint comparison

Avoids false positives from no-op writes:

```typescript
function computeFingerprint(store: ReviewStore): string {
  const count = store.annotations.length + store.pageNotes.length;
  let latest = '';
  for (const a of store.annotations) {
    if (a.updatedAt > latest) latest = a.updatedAt;
  }
  for (const n of store.pageNotes) {
    if (n.updatedAt > latest) latest = n.updatedAt;
  }
  return `${count}:${latest}`;
}
```

### Changes to existing files

| File | Change |
|------|--------|
| `src/mcp/server.ts` | Import + register (pass `storagePath` from line 17) |
| `src/mcp/tools/finish-work.ts` | Description: add "call `wait_for_updates`" guidance |
| `src/mcp/tools/list-annotations.ts` | Description: add "call `wait_for_updates`" guidance |
| `tests/mcp/server.test.ts` | Tool count 3→4, integration tests |
| `CLAUDE.md` | Add tool to MCP table |

### New files

| File | Purpose |
|------|---------|
| `src/mcp/tools/wait-for-updates.ts` | Handler, `waitForFileChange`, `computeFingerprint`, register |
| `tests/mcp/tools/wait-for-updates.test.ts` | Unit tests |

## Test Strategy

### Unit tests (`tests/mcp/tools/wait-for-updates.test.ts`)

1. Returns `status: "timeout"` when no changes (timeout: 1s)
2. Detects new annotation written externally → `status: "changed"`
3. Ignores no-op writes (same fingerprint) → times out
4. Handles file not existing initially → detects creation
5. Returns only open annotations (not addressed) on change
6. Includes page notes in response
7. Clamps timeout to max 300s

### Integration tests (`tests/mcp/server.test.ts`)

1. Tool appears in `tools/list` (count = 4)
2. Timeout case via JSON-RPC
3. Change detection via JSON-RPC + external file write

## Relationship to MCP Resource Subscriptions

This is a complementary approach to the resource subscription plan (`docs/engineering-plans/2026-02-28-mcp-resource-subscriptions.md`):

| Aspect | `wait_for_updates` tool | Resource subscriptions |
|--------|------------------------|----------------------|
| Push model | No — agent must call tool | Yes — server pushes to client |
| Client support | Works today (all MCP clients) | Waiting on client support |
| Scope | Single blocking call | Continuous for session lifetime |
| Dependency | None | `fs.watch` module + resource registration |

Both can coexist. `wait_for_updates` works today; resource subscriptions are the ideal long-term solution when clients support them.

## Open Questions

- Is 60s a good default timeout? Too short and agents retry frequently; too long and the agent appears unresponsive.
- Should the tool support a `status` filter (e.g. only wake on new `open` annotations)?
- MCP client timeout behaviour: do Claude Code / Cursor have tool call timeouts that might kill a 60s+ blocking call?
