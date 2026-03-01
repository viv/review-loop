---
generated_by: Claude Opus 4.6
generation_date: 2026-03-01
model_version: claude-opus-4-6
purpose: developer_guide
status: active
human_reviewer: matthewvivian
tags: [mcp, agent-workflow, tools, integration, guide]
---

# MCP Server Guide

Comprehensive guide to using review-loop's MCP (Model Context Protocol) server. This is the primary integration path for coding agents — read review annotations, act on them, and mark them addressed, all without copy-paste or browser interaction.

## 1. Overview

The review-loop MCP server bridges human reviewers and AI coding agents. Human reviewers annotate a site in-browser during development; the MCP server gives coding agents structured access to those annotations so they can read feedback, make changes, and report back.

```
Human reviewer (browser)        AI coding agent (MCP)
────────────────────────        ─────────────────────
1. Browse site during dev
2. Select text / Alt+click
   elements, add notes
                         ──────►
                                3. list_annotations → see all feedback
                                4. start_work → claim annotation
                                5. Make source code changes
                                6. finish_work → mark addressed
                         ◄──────
7. See status + agent replies
8. Accept (delete) or Reopen
```

**Key characteristics:**

- **No dev server required** — the MCP server reads directly from `inline-review.json` on disk. The Astro/Vite dev server does not need to be running.
- **stdio transport** — runs as a child process with no HTTP ports, no CORS, no authentication surface.
- **Shared storage** — reads and writes the same `inline-review.json` as the browser UI. Changes are picked up immediately by both sides.
- **Three tools** — a streamlined `list → start → finish` workflow that guides agents through the complete lifecycle.

## 2. Quick Start

### Auto-discovery (recommended)

Add a `.mcp.json` file to the root of the project that has `review-loop` installed:

```json
{
  "mcpServers": {
    "review-loop": {
      "type": "stdio",
      "command": "node",
      "args": [
        "./node_modules/review-loop/dist/mcp/server.js",
        "--storage",
        "./inline-review.json"
      ]
    }
  }
}
```

MCP-compatible agents (Claude Code, Cursor, Windsurf, etc.) read `.mcp.json` on startup and spawn the server automatically. No further configuration is needed.

### Manual invocation

For agents that don't support `.mcp.json`, or for testing:

```sh
node ./node_modules/review-loop/dist/mcp/server.js --storage ./inline-review.json
```

The server communicates over stdin/stdout using the MCP stdio protocol. It runs silently — output goes to stderr only on errors.

### Prerequisites

- **Node.js** >= 20
- **review-loop** installed in the project (`npm install -D review-loop`)
- An **MCP-compatible coding agent**
- **Annotations exist** in `inline-review.json` (created by reviewers using the browser UI)

## 3. Agent Workflow

The three MCP tools follow a **list → start → finish** pattern. This workflow is designed to be simple enough that agents naturally follow it, whilst ensuring the browser UI stays in sync.

### Step 1: Discover — `list_annotations`

Call `list_annotations` to see all review feedback. Returns both annotations (tied to specific text or elements) and page notes (general feedback about a page).

```json
// List everything
list_annotations({})

// Filter by page
list_annotations({ "pageUrl": "/about" })

// Filter by status — only open items
list_annotations({ "status": "open" })

// Combine filters
list_annotations({ "pageUrl": "/about", "status": "open" })
```

### Step 2: Claim — `start_work`

Before editing source code, call `start_work` with the annotation ID. This does two things:

1. Returns the full annotation detail (selectors, text ranges, reviewer note)
2. Atomically sets the status to `in_progress`, so the browser UI shows "Agent working..." instead of an orphan warning during hot-reloads

```json
start_work({ "id": "abc123" })
```

### Step 3: Complete — `finish_work`

After making the source code change, call `finish_work` to mark the annotation as addressed. Optionally record what text replaced the original and leave a message explaining what was done.

```json
// Minimal — just mark addressed
finish_work({ "id": "abc123" })

// With anchor text (text annotations only) and explanation
finish_work({
  "id": "abc123",
  "anchorText": "Updated heading text",
  "message": "Changed the heading from 'Loren ipsum' to 'Updated heading text' to fix the typo."
})
```

### Complete Example

Here is a concrete example showing the full lifecycle for a text annotation:

**1. List open annotations:**

```json
// Agent calls:
list_annotations({ "status": "open" })

// Server returns:
{
  "annotations": [
    {
      "id": "a1b2c3",
      "type": "text",
      "pageUrl": "/about",
      "pageTitle": "About Us",
      "note": "This heading has a typo — should be 'Our Mission'",
      "status": "open",
      "selectedText": "Our Misson",
      "createdAt": "2026-03-01T10:00:00.000Z",
      "updatedAt": "2026-03-01T10:00:00.000Z",
      "range": {
        "startXPath": "/html/body/main/h2[1]/text()[1]",
        "startOffset": 0,
        "endXPath": "/html/body/main/h2[1]/text()[1]",
        "endOffset": 10,
        "selectedText": "Our Misson",
        "contextBefore": "",
        "contextAfter": ""
      }
    }
  ],
  "pageNotes": []
}
```

**2. Claim the annotation:**

```json
// Agent calls:
start_work({ "id": "a1b2c3" })

// Server returns the full annotation with status updated:
{
  "id": "a1b2c3",
  "type": "text",
  "status": "in_progress",
  "inProgressAt": "2026-03-01T10:05:00.000Z",
  // ... all other fields
}
```

**3. Agent edits the source file** — fixes "Our Misson" → "Our Mission"

**4. Mark as addressed:**

```json
// Agent calls:
finish_work({
  "id": "a1b2c3",
  "anchorText": "Our Mission",
  "message": "Fixed typo: 'Our Misson' → 'Our Mission'"
})

// Server returns the updated annotation:
{
  "id": "a1b2c3",
  "type": "text",
  "status": "addressed",
  "addressedAt": "2026-03-01T10:05:30.000Z",
  "replacedText": "Our Mission",
  "replies": [
    {
      "message": "Fixed typo: 'Our Misson' → 'Our Mission'",
      "createdAt": "2026-03-01T10:05:30.000Z",
      "role": "agent"
    }
  ],
  // ... all other fields
}
```

**5. Reviewer sees "Addressed" in the browser panel**, reads the agent's reply, and clicks Accept to delete the annotation — or Reopen with a follow-up note if the fix isn't right.

## 4. Tool Reference

### `list_annotations`

List all review feedback — text annotations, element annotations, and page notes — in a single call.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pageUrl` | `string` | No | Filter by page URL path (e.g. `"/about"`) |
| `status` | `enum` | No | Filter annotations by lifecycle status. Values: `"open"`, `"in_progress"`, `"addressed"` |

> **Note:** The `status` filter applies to annotations only, not page notes. Page notes do not have a status field.

**Returns:**

```json
{
  "annotations": [
    {
      "id": "string",
      "type": "text | element",
      "pageUrl": "/path",
      "pageTitle": "Page Title",
      "note": "reviewer's comment",
      "status": "open | in_progress | addressed",
      "createdAt": "ISO 8601",
      "updatedAt": "ISO 8601",
      "inProgressAt": "ISO 8601 (if in_progress or later)",
      "addressedAt": "ISO 8601 (if addressed)",
      "replies": [{ "message": "...", "createdAt": "...", "role": "agent | reviewer" }],
      "selectedText": "quoted text (text annotations only)",
      "replacedText": "replacement text (text annotations only, optional)",
      "range": { "startXPath": "...", "startOffset": 0, "endXPath": "...", "endOffset": 0, "selectedText": "...", "contextBefore": "...", "contextAfter": "..." },
      "elementSelector": { "cssSelector": "...", "xpath": "...", "description": "...", "tagName": "...", "attributes": {}, "outerHtmlPreview": "..." }
    }
  ],
  "pageNotes": [
    {
      "id": "string",
      "pageUrl": "/path",
      "pageTitle": "Page Title",
      "note": "reviewer's comment",
      "createdAt": "ISO 8601",
      "updatedAt": "ISO 8601"
    }
  ]
}
```

Text annotations include `selectedText`, `range`, and optionally `replacedText`. Element annotations include `elementSelector`. Both types share all base fields.

**Examples:**

```json
// All annotations and page notes
list_annotations({})

// Single page
list_annotations({ "pageUrl": "/pricing" })

// Only open annotations (page notes always included)
list_annotations({ "status": "open" })

// Open annotations on a specific page
list_annotations({ "pageUrl": "/about", "status": "open" })
```

---

### `start_work`

Begin working on an annotation. Returns the full annotation detail and atomically sets its status to `in_progress`. The browser UI will show "Agent working..." instead of an orphan warning during code edits and hot-reloads.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | Yes | The annotation ID to start working on (min length: 1) |

**Returns:** The full annotation object as JSON, with `status` set to `"in_progress"` and `inProgressAt` set to the current timestamp.

**Status transition:** `open` → `in_progress`

**Error cases:**

| Error | Cause |
|-------|-------|
| `Annotation with ID "..." not found` | The ID does not match any annotation in the store |

**Example:**

```json
start_work({ "id": "a1b2c3" })
```

---

### `finish_work`

Mark an annotation as addressed. Optionally updates the anchor text (so the browser UI can re-locate the annotation after the text has changed) and/or adds an agent reply explaining what action was taken.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | Yes | The annotation ID to mark as finished (min length: 1) |
| `anchorText` | `string` | No | The new text that replaced the original annotated text. Text annotations only. Enables the browser UI to re-locate the annotation after the text has changed. |
| `message` | `string` | No | A reply message explaining what action was taken. Visible to reviewers in the panel UI. Added with `role: "agent"`. |

**Returns:** The full annotation object as JSON, with `status` set to `"addressed"` and `addressedAt` set to the current timestamp. If `anchorText` was provided, `replacedText` is updated. If `message` was provided, a new entry is appended to `replies`.

**Status transition:** any status → `addressed`

**Anchor text behaviour:** The `anchorText` parameter maps to the `replacedText` field in the JSON storage. This field tells the browser UI what text now exists where the original `selectedText` was, enabling Tier 2.5 location matching (the UI searches for `replacedText` when `selectedText` can no longer be found on the page). Only valid for text annotations — element annotations will return an error.

**Error cases:**

| Error | Cause |
|-------|-------|
| `Annotation with ID "..." not found` | The ID does not match any annotation in the store |
| `anchorText must not be empty` | `anchorText` was provided but is empty or whitespace-only |
| `message must not be empty` | `message` was provided but is empty or whitespace-only |
| `Annotation "..." is not a text annotation — anchorText only applies to text annotations` | `anchorText` was used on an element annotation |

**Examples:**

```json
// Minimal — just mark addressed
finish_work({ "id": "a1b2c3" })

// Record replacement text
finish_work({ "id": "a1b2c3", "anchorText": "Our Mission" })

// Leave an explanation
finish_work({ "id": "a1b2c3", "message": "Fixed the typo in the heading" })

// Both anchor text and message
finish_work({
  "id": "a1b2c3",
  "anchorText": "Our Mission",
  "message": "Fixed typo: 'Our Misson' → 'Our Mission'"
})
```

## 5. Data Model Reference

### Annotation Types

Annotations come in two types, distinguished by the `type` field:

**Text annotations** (`type: "text"`) — created when a reviewer selects text on the page.

- `selectedText` — the exact text that was highlighted
- `range` — DOM location information (XPaths, offsets, surrounding context) for re-locating the text
- `replacedText` — (optional) what the agent changed the text to, enabling re-location after edits

**Element annotations** (`type: "element"`) — created when a reviewer Alt+clicks an element.

- `elementSelector` — location information including:
  - `cssSelector` — CSS selector path to the element
  - `xpath` — XPath to the element
  - `description` — human-readable description
  - `tagName` — the element's tag name
  - `attributes` — key-value pairs of HTML attributes
  - `outerHtmlPreview` — truncated outer HTML for visual identification

### Status Lifecycle

```
  Reviewer creates annotation
          │
          ▼
     ┌─────────┐
     │  OPEN   │  ← Initial status; also set by Reopen
     └────┬────┘
          │  Agent calls start_work
          ▼
  ┌───────────────┐
  │  IN_PROGRESS  │  ← Agent is actively working
  └───────┬───────┘
          │  Agent calls finish_work
          ▼
  ┌───────────────┐
  │   ADDRESSED   │  ← Awaiting human review
  └───────┬───────┘
          │
     ┌────┴────┐
     ▼         ▼
  Accept    Reopen
     │         │
     ▼         ▼
  DELETED    OPEN (with optional follow-up note)
```

| Status | Meaning | Set By | Timestamps Set |
|--------|---------|--------|----------------|
| `open` | Awaiting agent action | Creation / reviewer Reopen | — |
| `in_progress` | Agent is working | `start_work` | `inProgressAt` |
| `addressed` | Agent is done, awaiting review | `finish_work` | `addressedAt` |

Terminal actions (performed by the reviewer in the browser UI):
- **Accept** — deletes the annotation entirely
- **Reopen** — returns to `open` with an optional follow-up note appended to `replies`

### Page Notes

Page notes are general feedback about a page, not tied to a specific text selection or element. They have a simpler structure:

```json
{
  "id": "string",
  "pageUrl": "/path",
  "pageTitle": "Page Title",
  "note": "reviewer's comment",
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
```

Page notes do not have a status lifecycle — they exist until manually deleted. They are returned alongside annotations by `list_annotations`.

### The `anchorText` / `replacedText` Relationship

The MCP tool parameter is called `anchorText` (in `finish_work`), but it maps to the `replacedText` field in the JSON storage and TypeScript types. This rename exists at the MCP interface only — the storage format is unchanged.

- **`anchorText`** (MCP parameter) — what the agent passes when calling `finish_work`
- **`replacedText`** (storage field) — what gets written to `inline-review.json`
- Both refer to the same thing: the text that now exists where the original `selectedText` was

The browser UI uses `replacedText` for Tier 2.5 location matching: when `selectedText` can no longer be found on the page, it searches for `replacedText` as a fallback.

## 6. Architecture

### How the MCP Server Fits In

```
┌─────────────┐     HTTP REST API    ┌──────────────────┐
│   Browser   │ ←──────────────────→ │  Vite/Astro      │
│  (reviewer) │                      │  Dev Server      │
└─────────────┘                      │                  │
                                     │  ReviewStorage   │ ←→ inline-review.json
                                     │                  │
┌──────────────┐   MCP (stdio)       │  MCP Server      │
│ Coding Agent │ ←─────────────────→ │  (subprocess)    │
│(Claude Code) │                     └──────────────────┘
└──────────────┘
```

**Key design decisions:**

1. **stdio transport** — the agent spawns the MCP server as a child process. Communication is via stdin/stdout pipes. No HTTP ports, no CORS, no authentication surface.

2. **Separate process** — runs independently of the Vite dev server. The MCP server works even when the dev server is not running (e.g., reading annotations after a review session ends).

3. **Shared `ReviewStorage`** — the MCP server uses the same `ReviewStorage` class as the REST API. This ensures identical file I/O behaviour, migration logic, and write queuing. Both the browser UI and the MCP server read from and write to the same `inline-review.json` file.

4. **Reads from disk on every call** — `ReviewStorage` has no in-memory cache. Each tool invocation reads the current file state from disk. This means changes made by the browser UI (or direct file edits) are picked up immediately by the MCP server, and vice versa.

### Auto-Discovery

The `.mcp.json` file at the project root enables auto-discovery. MCP-compatible agents read this file on startup and spawn the server as configured. The file specifies:

- **Transport**: `stdio`
- **Command**: `node`
- **Arguments**: path to the server script and storage file

### Process Lifecycle

The MCP server is a single-process, single-connection stdio server:

1. The agent spawns the server as a subprocess
2. The server initialises `ReviewStorage` and registers tools
3. Tool calls arrive over stdin, responses go over stdout
4. The server exits when stdin closes (i.e., when the parent process terminates)

No explicit shutdown or cleanup logic is needed.

## 7. Configuration

### CLI Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `--storage <path>` | `./inline-review.json` | Path to the JSON storage file |

The path is resolved relative to `process.cwd()`, not relative to the server script. In practice, this means relative to the project root when spawned via `.mcp.json`.

### `.mcp.json` for Development

When developing review-loop itself (as opposed to using it as a dependency), the `.mcp.json` points to the built output in `dist/`:

```json
{
  "mcpServers": {
    "review-loop": {
      "type": "stdio",
      "command": "node",
      "args": ["./dist/mcp/server.js", "--storage", "./inline-review.json"]
    }
  }
}
```

### `.mcp.json` for Consumers

Projects that install review-loop as a dependency point to `node_modules`:

```json
{
  "mcpServers": {
    "review-loop": {
      "type": "stdio",
      "command": "node",
      "args": [
        "./node_modules/review-loop/dist/mcp/server.js",
        "--storage",
        "./inline-review.json"
      ]
    }
  }
}
```

### Custom Storage Paths

The `--storage` flag accepts any path. Useful for multi-environment setups or per-sprint annotation files:

```json
{
  "mcpServers": {
    "review-loop": {
      "type": "stdio",
      "command": "node",
      "args": [
        "./node_modules/review-loop/dist/mcp/server.js",
        "--storage",
        "./reviews/sprint-42.json"
      ]
    }
  }
}
```

## 8. Concurrency Model

The MCP server assumes **single-agent use**. This is inherent to the stdio transport — one connection per process.

### Write Serialisation

`ReviewStorage` uses an internal write queue to serialise all write operations within the process. Write tools (`start_work`, `finish_work`) perform atomic read-modify-write operations:

1. Read the current store from disk
2. Apply the mutation
3. Write to a temporary file
4. Atomically rename the temporary file to the target path

This prevents data corruption from concurrent tool calls within the same MCP session.

### Limitations

- **Cross-process writes are not safe.** If the browser UI and the MCP server both write at the same moment, one write could be lost. In practice this is rare because reviewer actions (creating/deleting annotations) and agent actions (claiming/addressing annotations) don't typically overlap on the same annotation.
- **Multiple agents are not supported.** Running two MCP server instances against the same `inline-review.json` could lead to lost updates. Use one agent at a time.
- **Reads are always fresh.** Since there is no in-memory cache, each tool call reads the latest state from disk. This means agent and reviewer actions interleave correctly at the read level, even if writes have a small race window.

## 9. Troubleshooting

### "Server not found" or connection errors

- Ensure the package is installed — the server runs from `node_modules/review-loop/dist/mcp/server.js`
- Check that the path in `.mcp.json` is correct relative to the project root
- Verify Node.js >= 20 is available in the agent's PATH
- Run the server manually to check for startup errors: `node ./node_modules/review-loop/dist/mcp/server.js`

### Empty results from `list_annotations`

- Check that `inline-review.json` exists and contains annotations
- If using a custom `--storage` path, verify it points to the correct file
- The file might contain annotations with a status that your filter excludes — try `list_annotations({})` without filters

### `start_work` or `finish_work` returns "Annotation not found"

- The annotation ID may have been deleted (accepted by the reviewer) since you last listed
- Call `list_annotations` again to get current IDs
- IDs are case-sensitive — ensure you're using the exact ID from the listing

### `anchorText` error on element annotation

- The `anchorText` parameter only applies to text annotations (`type: "text"`)
- Element annotations don't have selected text to replace
- For element annotations, just call `finish_work` with `id` and optionally `message`

### Tools not appearing in the agent

- Some MCP clients cache tool lists — restart the agent or reconnect the MCP server
- Verify the server starts without errors by running it manually
- Check that `.mcp.json` is in the project root (the directory where the agent starts)

### Storage path errors

- Paths in `--storage` are resolved relative to `process.cwd()`, not the server script location
- When spawned via `.mcp.json`, `cwd` is typically the project root
- Use an absolute path if relative resolution is causing issues

### Changes not visible in the browser

- The browser UI polls for changes periodically — changes should appear within a few seconds
- If the dev server is not running, changes are only visible when it next starts
- Verify the MCP server and browser UI are using the same `inline-review.json` path

## See Also

- [Annotation Status Workflows](./2026-02-28-annotation-status-workflows.md) — detailed status lifecycle documentation
- [Specification § 4.3](../spec/specification.md) — formal MCP server specification
