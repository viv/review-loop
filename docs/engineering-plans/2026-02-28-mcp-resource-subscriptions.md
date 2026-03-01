---
generated_by: Claude Opus 4.6
generation_date: 2026-02-28
model_version: claude-opus-4-6
purpose: implementation_plan
status: draft
human_reviewer: matthewvivian
tags: [mcp, resources, subscriptions, notifications, push, future-proofing]
---

# MCP Resource Subscriptions for Annotations

## Problem

When an AI agent monitors annotations via MCP, it must poll `list_annotations` repeatedly because there is no push mechanism. This wastes agent turns, burns context window, and creates latency between a reviewer adding an annotation and the agent noticing it.

The MCP spec (2025-11-25) defines a resource subscription protocol (`resources/subscribe` + `notifications/resources/updated`) that solves this — but major MCP clients (Claude Code, Cursor) don't support it yet. There is an open feature request on Claude Code ([anthropics/claude-code#7252](https://github.com/anthropics/claude-code/issues/7252)).

## Goal

Expose annotations as MCP **resources** with full subscription support, so that:

1. **Today:** Agents can read annotations via `resources/read` as an alternative to the existing tools
2. **Future:** When clients support `resources/subscribe`, the server automatically pushes `notifications/resources/updated` whenever the annotation store changes — no polling needed

The existing tools remain unchanged. Resources are additive.

## Architecture

```
┌─────────────────────────────────────────────────┐
│ Browser (reviewer adds annotation)              │
│   POST /__inline-review/api/annotations         │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ Dev Server Middleware                            │
│   storage.mutate() → writes inline-review.json  │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ MCP Server (stdio)                              │
│                                                 │
│  Resources:                                     │
│    annotations://all        (all annotations)   │
│    annotations://open       (open only)         │
│    annotations://page/{url} (filtered by page)  │
│                                                 │
│  File watcher on inline-review.json             │
│    → on change, emit notifications/resources/   │
│      updated for all subscribed URIs            │
│                                                 │
│  Tools: (unchanged, still the primary API)      │
│    list_annotations, start_work, finish_work    │
└─────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ MCP Client (Claude Code, Cursor, etc.)          │
│                                                 │
│  Today: reads resources on demand               │
│  Future: subscribes → gets pushed notifications │
│          → re-reads resource → acts on changes  │
└─────────────────────────────────────────────────┘
```

### Why file watching?

The MCP server and the dev server middleware are separate processes sharing `inline-review.json`. The MCP server cannot hook into the middleware's HTTP routes directly. Watching the file for changes is the simplest way to detect when a reviewer adds or modifies an annotation from the browser.

## Implementation

### Session 1: Expose annotations as MCP resources

**Goal:** Register static and templated resources on the MCP server so clients can read annotation data via `resources/read`.

#### 1.1 Register resource: `annotations://all`

Static resource returning all annotations (same data as `list_annotations` tool).

```typescript
// src/mcp/resources/annotations.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ReviewStorage } from '../../server/storage.js';

export function registerAnnotationResources(
  server: McpServer,
  storage: ReviewStorage,
) {
  server.registerResource(
    'all-annotations',
    'annotations://all',
    {
      title: 'All Annotations',
      description: 'All review annotations across all pages',
      mimeType: 'application/json',
    },
    async (uri) => {
      const store = await storage.read();
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(store.annotations),
        }],
      };
    },
  );
}
```

#### 1.2 Register resource: `annotations://open`

Static resource returning only open (unaddressed) annotations — the most useful resource for agents monitoring for new work.

#### 1.3 Register templated resource: `annotations://page/{url}`

Templated resource filtered by page URL, using `ResourceTemplate`.

```typescript
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

server.registerResource(
  'page-annotations',
  new ResourceTemplate('annotations://page/{url}', {
    list: async () => {
      // List all unique page URLs as available resources
      const store = await storage.read();
      const pages = [...new Set(store.annotations.map(a => a.pageUrl))];
      return {
        resources: pages.map(page => ({
          uri: `annotations://page/${encodeURIComponent(page)}`,
          name: `Annotations for ${page}`,
          mimeType: 'application/json',
        })),
      };
    },
  }),
  {
    title: 'Page Annotations',
    description: 'Annotations filtered by page URL',
    mimeType: 'application/json',
  },
  async (uri, { url }) => {
    const store = await storage.read();
    const decoded = decodeURIComponent(url as string);
    const filtered = store.annotations.filter(a => a.pageUrl === decoded);
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(filtered),
      }],
    };
  },
);
```

#### 1.4 Wire into server.ts

```typescript
import { registerAnnotationResources } from './resources/annotations.js';

// In main():
registerAnnotationResources(server, storage);
```

#### 1.5 Tests

- Unit tests for each resource read callback
- Verify `annotations://open` filters correctly
- Verify `annotations://page/{url}` template lists and reads correctly
- Verify empty store returns empty arrays

**Exit criteria:** `resources/list` returns the new resources; `resources/read` returns correct JSON for each URI.

---

### Session 2: File watcher + subscription notifications

**Goal:** Watch `inline-review.json` for changes and emit `notifications/resources/updated` for any subscribed resource URIs.

#### 2.1 File watcher

Use `fs.watch` (or `chokidar` if cross-platform robustness is needed) to detect changes to the storage file.

```typescript
// src/mcp/file-watcher.ts
import { watch, type FSWatcher } from 'node:fs';

export function watchStorageFile(
  filePath: string,
  onChange: () => void,
): FSWatcher {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return watch(filePath, () => {
    // Debounce — atomic writes cause multiple events
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onChange, 100);
  });
}
```

#### 2.2 Emit resource updated notifications

When the file changes, send `notifications/resources/updated` for known resource URIs via the low-level server:

```typescript
// In server.ts, after connecting transport:
const lowLevelServer = server.server;

watchStorageFile(storagePath, async () => {
  // Notify for all static resource URIs
  // The SDK/spec says: only send if client previously subscribed.
  // But we can safely call sendResourceUpdated — the SDK handles
  // the subscription check internally, or worst case the client
  // ignores notifications it didn't subscribe to.
  try {
    await lowLevelServer.sendResourceUpdated({ uri: 'annotations://all' });
    await lowLevelServer.sendResourceUpdated({ uri: 'annotations://open' });
  } catch {
    // Client may not support subscriptions — safe to ignore
  }
});
```

#### 2.3 Declare subscription capability

Ensure the server advertises `subscribe: true` in its resource capabilities. The `@modelcontextprotocol/sdk` should handle this automatically when resources are registered, but verify and set explicitly if needed:

```typescript
const server = new McpServer({
  name: 'review-loop-mcp',
  version: '0.2.0',
  capabilities: {
    resources: {
      subscribe: true,
    },
  },
});
```

> **Note:** Check SDK behaviour here — the high-level `McpServer` may auto-declare capabilities based on registered resources. If `subscribe: true` needs to be set via the low-level `Server` constructor instead, adjust accordingly.

#### 2.4 Clean shutdown

Ensure the file watcher is closed when the MCP server disconnects:

```typescript
const watcher = watchStorageFile(storagePath, onChange);

// Clean up on process exit
process.on('SIGINT', () => { watcher.close(); process.exit(0); });
process.on('SIGTERM', () => { watcher.close(); process.exit(0); });
```

#### 2.5 Tests

- Unit test: file watcher debounces rapid writes into single callback
- Unit test: `sendResourceUpdated` is called with correct URIs on file change
- Integration test: modify `inline-review.json` externally, verify notification sent
- Test: notification errors are caught and don't crash the server

**Exit criteria:** Changing `inline-review.json` (e.g. from browser creating an annotation) triggers `notifications/resources/updated` on the MCP transport. Clients that support subscriptions will automatically re-read the resource.

---

### Session 3: Page-specific subscription notifications (stretch)

**Goal:** When the store changes, diff to determine which pages were affected and send targeted `notifications/resources/updated` for `annotations://page/{url}` URIs.

#### 3.1 Store diffing

Keep a snapshot of the previous store state. On file change, compare to identify which page URLs have new or changed annotations.

```typescript
let previousFingerprint: Map<string, number> = new Map();

function getPageFingerprints(annotations: Annotation[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of annotations) {
    map.set(a.pageUrl, (map.get(a.pageUrl) ?? 0) + 1);
  }
  return map;
}
```

#### 3.2 Targeted notifications

Only notify for pages that actually changed:

```typescript
const current = getPageFingerprints(store.annotations);
for (const [pageUrl, count] of current) {
  if (previousFingerprint.get(pageUrl) !== count) {
    await lowLevelServer.sendResourceUpdated({
      uri: `annotations://page/${encodeURIComponent(pageUrl)}`,
    });
  }
}
previousFingerprint = current;
```

This is a refinement — session 2's blanket notifications work fine for most use cases. This session is only worth doing if agents commonly subscribe to page-specific resources.

**Exit criteria:** Only pages with actual changes trigger notifications.

---

## Current Workaround (Implemented)

While waiting for MCP client support for `resources/subscribe`, tool descriptions now embed polling guidance that creates a self-reinforcing agent workflow loop (PR #60, commits `0a1853c` and `1e52457`):

- **`list_annotations`**: "Call this at the start of your session and after each `finish_work` call"
- **`finish_work`**: "After calling this, call `list_annotations(status: 'open')` to check for remaining or newly reopened annotations"
- **`start_work`**: "You MUST call this BEFORE making any source code changes" (enforced server-side — `finish_work` rejects if not `in_progress`)

This means agents following tool descriptions will loop through: `list_annotations` → `start_work` → edit → `finish_work` → `list_annotations` → ... until no open annotations remain.

**Limitations**: Agents won't discover annotations added *after* they finish their loop. True push notifications via `resources/subscribe` remain the ideal solution for real-time awareness of new annotations.

## Key Design Decisions

1. **Resources are additive** — existing tools stay as the primary agent API. Resources provide a read-only alternative that unlocks the subscription pattern.

2. **File watching over IPC** — the MCP server and dev server are separate processes. File watching is the simplest, most portable coordination mechanism. The storage layer already uses atomic writes, so partial reads are not a concern.

3. **Debounced notifications** — atomic writes (temp file + rename) can trigger multiple `fs.watch` events. A 100ms debounce collapses them into one notification.

4. **Graceful degradation** — if `sendResourceUpdated` throws (client doesn't support subscriptions), we catch and ignore. The server works fine without any subscribers.

5. **No new dependencies for session 1-2** — `fs.watch` is built into Node.js. Only add `chokidar` if `fs.watch` proves unreliable on macOS (it sometimes is for renames).

6. **JSON resource format** — resources return `application/json` rather than markdown, because agents consuming them programmatically benefit from structured data.

## Client Support Status

| Client | `resources/read` | `resources/subscribe` | Notes |
|--------|:-:|:-:|-------|
| Claude Code | Yes | No | [#7252](https://github.com/anthropics/claude-code/issues/7252) open |
| Cursor | Partial | No | Resources support varies |
| VS Code (Copilot) | Unknown | Unknown | MCP support is recent |
| MCP Inspector | Yes | Yes | Good for testing |

When Claude Code implements subscription support, the server-side work from this plan will activate automatically — no further changes needed.

## Testing Strategy

- **Unit tests** for resource read callbacks (mock `ReviewStorage`)
- **Unit tests** for file watcher debounce behaviour
- **Unit tests** for `sendResourceUpdated` calls (mock low-level server)
- **Integration test** with MCP Inspector to verify end-to-end subscription flow
- **Manual test** with Claude Code to verify resources appear in `resources/list` (even if subscriptions don't work yet)

## Files to Create

- `src/mcp/resources/annotations.ts` — resource registration
- `src/mcp/file-watcher.ts` — file change detection
- `tests/mcp/resources/annotations.test.ts`
- `tests/mcp/file-watcher.test.ts`

## Files to Modify

- `src/mcp/server.ts` — import and wire resources + file watcher
- `CLAUDE.md` — document new resources in MCP schema section
