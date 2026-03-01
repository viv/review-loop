---
generated_by: Claude Opus 4.6
generation_date: 2026-02-23
model_version: claude-opus-4-6
purpose: component_specification
status: reviewed
human_reviewer: matthewvivian
tags: [astro, integration, annotation, dev-tools, specification, element-annotation, status-lifecycle]
---

# review-loop: Component Specification

## 1. Overview

**review-loop** is a dev-only annotation overlay that bridges the gap between a human reviewing a rendered site and a coding agent acting on that feedback. It supports Astro, any Vite-based framework (SvelteKit, Nuxt, Remix), and Express/Connect servers.

A reviewer browses the live dev site and annotates it in two ways: **selecting text** and attaching notes, or **Alt+clicking elements** (cards, images, buttons, layout sections) to annotate non-text targets. Each annotation captures the page URL, the precise location (text range or CSS selector), and the reviewer's instruction — providing both the *what* and the *where*. The result can be consumed by coding agents (Claude Code, Codex, Cursor, etc.) in three ways:

- **MCP server** (primary) — agents connect via the [Model Context Protocol](https://modelcontextprotocol.io) to read annotations, act on them, mark them addressed, and reply — forming a closed feedback loop with the reviewer
- **JSON storage file** (`inline-review.json`) — machine-readable with rich location data (XPath ranges, character offsets, surrounding context for text; CSS selectors, XPaths, and attribute snapshots for elements), readable directly from the project root
- **Markdown export** (secondary) — one-click copy to clipboard, designed for pasting into chat-based agent interfaces that don't support MCP

The integration ships **zero bytes** in production builds. All UI, storage, and API infrastructure exists only during dev.

### 1.1 Design Principles

1. **Dev-only**: No traces in production builds (no scripts, no host elements, no API references)
2. **Zero-config**: Works with a single line of configuration
3. **Non-invasive**: Shadow DOM isolates all UI from site styles; highlights use inline styles
4. **Persistent**: Annotations survive page reloads, navigation, and dev server restarts
5. **Multi-page**: Annotations are scoped by URL but viewable across all pages
6. **Agent-ready**: MCP server provides structured tool access; Markdown export and JSON file offer additional consumption paths


## 2. Integration Lifecycle

### 2.1 Installation

The integration is added as a dev dependency and configured in `astro.config.mjs`:

```javascript
import inlineReview from 'review-loop';

export default defineConfig({
  integrations: [inlineReview()],
});
```

### 2.2 Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storagePath` | `string` | `'inline-review.json'` in project root | Path to the JSON storage file |

### 2.3 Design Boundary

Additional configuration options (theme, position, keybindings, storage backend) are intentionally omitted to maintain zero-config simplicity. The integration is designed for dev-only use where customisation is low priority. Any future options should be justified against the zero-config principle.

### 2.4 Activation Rules

- The integration **only activates** when `command === 'dev'` (i.e. during `astro dev`)
- When `command === 'build'` or `command === 'preview'`, the hook returns immediately
- No scripts are injected, no middleware is registered, no host element exists in production

### 2.5 What Happens on Activation

During `astro dev`, the Astro integration:

1. Resolves the storage file path relative to the project root
2. Creates a `ReviewStorage` instance for JSON file I/O
3. Registers a Vite dev server middleware plugin that serves the REST API
4. Injects the client script on every page via `injectScript('page', ...)`

### 2.6 Adapter Model

The core functionality (REST API middleware, client overlay, JSON storage, MCP server) is framework-agnostic. Three thin adapters wire these components into different frameworks:

| Entry point | Framework | Client injection | Notes |
|---|---|---|---|
| `review-loop` | Astro | `injectScript('page', ...)` | Default export, wraps Vite plugin inside Astro integration |
| `review-loop/vite` | Vite (SvelteKit, Nuxt, Remix) | `transformIndexHtml` | Standalone Vite `Plugin`, `apply: 'serve'` |
| `review-loop/express` | Express/Connect | Manual `<script>` tag | Returns `{ apiMiddleware, clientMiddleware }` |

All adapters share `ReviewStorage` and `createMiddleware` directly — no shared setup abstraction. Each adapter is 15-50 lines. The `createMiddleware` function uses native `http.IncomingMessage`/`http.ServerResponse` types, making it compatible with any Node.js HTTP framework.


## 3. Data Model

### 3.1 ReviewStore

The root data structure persisted in `inline-review.json`:

```typescript
interface ReviewStore {
  version: 1;
  annotations: Annotation[];
  pageNotes: PageNote[];
}
```

- `version` must be exactly `1`. Any other value causes the store to be treated as invalid.
- `annotations` and `pageNotes` must both be arrays. Non-array values cause the store to be treated as invalid.

### 3.2 Annotation (Discriminated Union)

Annotations use a discriminated union with a `type` field to support both text selections and element annotations. The two variants share common fields via `BaseAnnotation`.

#### 3.2.1 BaseAnnotation

```typescript
type AnnotationStatus = 'open' | 'in_progress' | 'addressed';

interface BaseAnnotation {
  id: string;           // Server-generated unique ID
  type: 'text' | 'element';  // Discriminant field (see 3.2.4)
  pageUrl: string;      // window.location.pathname at creation time
  pageTitle: string;    // document.title at creation time
  note: string;         // User's annotation note (may be empty)
  createdAt: string;    // ISO 8601 timestamp, server-generated
  updatedAt: string;    // ISO 8601 timestamp, updated on each edit
  status?: AnnotationStatus;    // Explicit lifecycle status (see 3.2.5)
  inProgressAt?: string;        // ISO 8601 — when marked in_progress by an agent (optional)
  addressedAt?: string;         // ISO 8601 — when marked addressed by an agent (optional)
  resolvedAt?: string;          // ISO 8601 — kept for backward compatibility reads only, never set by new code (optional)
  replies?: AgentReply[];       // Replies from agents and reviewers (optional)
}
```

#### 3.2.1a AgentReply

```typescript
interface AgentReply {
  message: string;                 // The reply text
  createdAt: string;               // ISO 8601 timestamp
  role?: 'agent' | 'reviewer';    // Who wrote the reply (defaults to 'agent')
}
```

Replies are appended to the `replies` array chronologically. Agent replies are added via the MCP `finish_work` tool (optional `message` parameter). Reviewer replies are added via `PATCH /annotations/:id` with a `reply` field when reopening an annotation with a follow-up note. The `role` field defaults to `'agent'` when absent for backward compatibility. The `status`, `inProgressAt`, `addressedAt`, and `replies` fields are all optional — their absence means "open" / "not in progress" / "not addressed" / "no replies". The `resolvedAt` field is kept for backward compatibility reads but is never set by new code. No migration is needed for existing data.

#### 3.2.2 TextAnnotation

```typescript
interface TextAnnotation extends BaseAnnotation {
  type: 'text';
  selectedText: string;    // The verbatim text the user selected
  range: SerializedRange;  // Three-tier restoration data (see 3.5)
  replacedText?: string;   // Text that replaced the original selection (optional, set by agent)
}
```

Text annotations are the original annotation type — created by selecting text on the page and attaching a note.

The optional `replacedText` field records what the original selected text was changed to by an agent. When set, the client uses it for Tier 2.5 location matching (see Section 15.2). It is set via the `finish_work` MCP tool (optional `anchorText` parameter, stored as `replacedText`) or the `PATCH /annotations/:id` REST endpoint. Its absence means "no replacement recorded" — behaviour is identical to before.

#### 3.2.3 ElementAnnotation

```typescript
interface ElementAnnotation extends BaseAnnotation {
  type: 'element';
  elementSelector: ElementSelector;  // Element location data (see 3.4)
}
```

Element annotations are created by Alt+clicking any visible DOM element. They capture a CSS selector, XPath, and descriptive metadata so the element can be re-identified on page reload.

#### 3.2.4 Annotation Type

```typescript
type Annotation = TextAnnotation | ElementAnnotation;
```

The discriminant field is `type`:
- `'text'` — text selection annotation (has `selectedText` and `range`)
- `'element'` — element annotation (has `elementSelector`)

**Backward compatibility**: Annotations without a `type` field (created before this feature) are treated as `TextAnnotation` with `type: 'text'`. The migration is applied on read (see Section 4.1.1).

#### 3.2.5 Annotation Status Lifecycle

Annotations have an explicit lifecycle status that tracks their progress from creation through agent action to human acceptance:

```
open → in_progress → addressed
  ↑                       │
  └───────────────────────┘  (reopen)
```

| Status | Meaning | Set by |
|--------|---------|--------|
| `open` | Annotation is new or has been reopened | Default on creation; human reviewer via Reopen button |
| `in_progress` | An agent is actively working on the annotation | Agent via MCP `start_work` tool |
| `addressed` | An agent has acted on the annotation (awaiting human review) | Agent via MCP `finish_work` tool |

Terminal actions (not statuses):
- **Accept** → deletes the annotation (reviewer approves the agent's work)
- **Reopen** → status returns to `open` with optional follow-up note (reviewer disagrees)
- **Delete** → removes the annotation (only on `open` status)

**Status transitions**:
- `open` → `in_progress`: Agent calls `start_work` MCP tool before editing source code
- `open` or `in_progress` → `addressed`: Agent calls `finish_work` MCP tool
- `addressed` → *(deleted)*: Human reviewer clicks Accept button in panel — annotation is removed entirely
- `addressed` → `open`: Human reviewer clicks Reopen button in panel (clears all progress timestamps), optionally with follow-up note

**Timestamp semantics**:
- `inProgressAt` is set when status transitions to `in_progress`
- `addressedAt` is set when status transitions to `addressed`
- Each transition clears the timestamps of other states (e.g. `addressed` clears `inProgressAt`)
- Transitioning to `open` (reopen) clears `inProgressAt` and `addressedAt`

**Orphan grace period**: When an agent edits source code, Vite hot-reloads the page and the annotation temporarily loses its DOM anchor. The `OrphanTracker` provides a 15-second grace period before showing the "Could not locate on page" orphan warning, but only for annotations that were previously located on the page. Annotations that have never been DOM-anchored (e.g. the referenced text no longer exists) are shown as orphaned immediately — there is no reason to show "Checking…" for text that was never on the page. Annotations with `in_progress` status never time out — they always show a "Checking..." indicator until the agent resolves them or the reviewer acts. The `onStoreChanged()` method resets all grace period timers (but not the anchor history) when external store changes are detected.

**`getAnnotationStatus()` helper**: A shared helper function provides backward compatibility for annotations that predate the `status` field:

```typescript
function getAnnotationStatus(a: BaseAnnotation): AnnotationStatus {
  if (a.status === 'resolved') return 'addressed';
  if (a.status) return a.status;
  if (a.resolvedAt) return 'addressed';
  return 'open';
}
```

- Annotations with an explicit `status` field use it directly (with `'resolved'` mapped to `'addressed'` for backward compatibility)
- Annotations without `status` but with `resolvedAt` are treated as `'addressed'` (backward compatibility with pre-status-lifecycle data)
- Annotations without either field default to `'open'`
- No migration is needed — the helper handles legacy data transparently

### 3.3 PageNote

```typescript
interface PageNote {
  id: string;
  pageUrl: string;
  pageTitle: string;
  note: string;         // Must be non-empty (empty notes are not saved)
  createdAt: string;
  updatedAt: string;
}
```

### 3.4 ElementSelector

Captures enough information to re-locate a DOM element across page reloads using multiple strategies:

```typescript
interface ElementSelector {
  cssSelector: string;             // Best-effort unique CSS selector (see 3.4.1)
  xpath: string;                   // Positional XPath fallback (same format as text annotation XPaths)
  description: string;             // Human-readable: "img (class=hero-image, src=hero.jpg)"
  tagName: string;                 // Lowercase tag name (e.g. "img", "section", "button")
  attributes: Record<string, string>;  // Key attributes snapshot (see 3.4.2)
  outerHtmlPreview: string;        // First 200 characters of element.outerHTML
}
```

#### 3.4.1 CSS Selector Generation

The CSS selector is generated with the following priority cascade:

1. **`id`**: If the element has an `id`, use `#id` (most reliable)
2. **`data-testid`**: If present, use `[data-testid="value"]`
3. **Class-based**: Combine tag name with significant classes, e.g. `section.hero`
4. **Positional**: If the above are not unique, append `:nth-child(n)` to disambiguate

**Uniqueness verification**: After generating a selector, verify with `document.querySelectorAll(selector).length === 1`. If the selector matches multiple elements, refine by prepending the parent's selector or appending `:nth-child()`.

**Selector scope**: Selectors are generated relative to `document` (not scoped to a container). This means they may break if the page structure changes significantly, which is acceptable for a dev tool.

#### 3.4.2 Captured Attributes

The `attributes` record captures a snapshot of key attributes for display and future matching. The following attributes are captured **if present on the element** (regardless of tag name):

`id`, `class`, `data-testid`, `src`, `alt`, `href`, `role`, `aria-label`, `type`, `name`

Other attributes are not captured. The set is intentionally small to keep the stored data concise.

#### 3.4.3 Human-Readable Description

The `description` field is formatted as:

```
base (attr1=value1, attr2=value2)
```

Where `base` is:
- `tag#id` if the element has an `id`
- `tag.firstClassName` if the element has classes (uses only the first class)
- `tag` if neither

The parenthetical part lists captured attributes **excluding `id` and `class`** (which are already represented in the base). Attribute values longer than 40 characters are truncated with `...`.

Examples:
- `img.hero-image (src=hero.jpg, alt=Hero banner)`
- `section#expertise` (no attributes beyond id)
- `button.btn-primary (type=submit)`
- `div (data-testid=card-container)`
- If no attributes are present beyond id/class: just the base, e.g. `div`

#### 3.4.4 Element Resolution (Three-Tier)

When restoring element annotations on page load:

**Tier 1 — CSS Selector** (primary):
- `document.querySelector(cssSelector)` — returns the first matching element
- If the selector matches any element, it is used (no uniqueness re-verification at resolution time)
- Note: uniqueness is verified at *generation* time but not re-checked at *resolution* time. If the DOM has changed, a formerly-unique selector may match multiple elements, and the first is used.

**Tier 2 — XPath** (fallback):
- Resolve using `document.evaluate()` with `FIRST_ORDERED_NODE_TYPE`
- Same mechanism as text annotation XPath resolution (see Section 15.2)
- Less stable than CSS selectors (positional, breaks on DOM reorder)

**Tier 3 — Orphaned** (last resort):
- Neither selector resolves to an element
- The annotation is visible in the panel but has no highlight on the page
- Displayed with orphaned warning indicator (same as text annotations)

### 3.5 SerializedRange

Captures enough information for four-tier highlight restoration:

```typescript
interface SerializedRange {
  startXPath: string;      // XPath to the start text node
  startOffset: number;     // Character offset within start node
  endXPath: string;        // XPath to the end text node
  endOffset: number;       // Character offset within end node
  selectedText: string;    // Verbatim selected text (for XPath validation — see note below)
  contextBefore: string;   // Up to 80 characters before selection within the same block-level ancestor
  contextAfter: string;    // Up to 80 characters after selection within the same block-level ancestor
}
```

**selectedText duplication**: The `selectedText` in `SerializedRange` duplicates `Annotation.selectedText`. The range's copy exists for independent validation during Tier 1 highlight restoration — the deserialised range's `.toString()` is compared against `SerializedRange.selectedText` to verify the XPath still points to the correct text. The annotation-level copy is used for UI display (panel, popup preview, export).

### 3.6 ID Generation

IDs are generated server-side using `crypto.randomUUID()` from `node:crypto`, producing standard v4 UUIDs (e.g. `550e8400-e29b-41d4-a716-446655440000`).

**Collision resistance**: UUID v4 provides 122 bits of randomness from a cryptographically secure source, making collisions effectively impossible for any practical use case. No server-side deduplication guard is implemented.


## 4. Server Architecture

### 4.1 JSON File Storage

**Source of truth**: `inline-review.json` in the project root (configurable via `storagePath`).

**Behaviour**:
- **Reads** always come from disk (no in-memory cache). This means external edits to the JSON file are picked up immediately.
- **Writes** are queued via a promise chain to prevent concurrent file corruption. Each write serialises the entire store as pretty-printed JSON.
- **Missing file**: Returns an empty store (`{ version: 1, annotations: [], pageNotes: [] }`)
- **Corrupted JSON**: Returns an empty store (silent recovery, with `console.warn` for debuggability)
- **Invalid schema** (wrong version, non-array fields): Returns an empty store (silent recovery)
- **Partially corrupt entries**: Individual annotations missing required fields (`id`, `pageUrl`, or `note`) are filtered out with a `console.warn`. Valid annotations in the same file are preserved. This is more resilient than returning an empty store for the entire file.

#### 4.1.1 Annotation Type Migration

On read, the storage layer applies a transparent migration for backward compatibility:

- Any annotation object **without** a `type` field receives `type: 'text'`
- This migration happens in memory only — the JSON file is not rewritten
- The migration is idempotent and has no visible effect on already-typed annotations
- No schema version bump is needed (the `version: 1` stays unchanged)

This ensures that stores created before element annotation support are automatically compatible.

### 4.2 REST API

All routes are served via Vite dev server middleware at the prefix `/__inline-review/api`.

#### 4.2.1 Annotation Endpoints

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| `GET` | `/annotations` | List all annotations | 200 |
| `GET` | `/annotations?page=/path` | List annotations filtered by page URL | 200 |
| `POST` | `/annotations` | Create a new annotation | 201 |
| `PATCH` | `/annotations/:id` | Update an annotation (note, replacedText, range, and/or status) | 200 |
| `DELETE` | `/annotations/:id` | Delete an annotation | 200 |

**GET /annotations** response shape:
```json
{
  "version": 1,
  "annotations": [...],
  "pageNotes": [...]
}
```

Note: The GET response returns the full store shape (including `pageNotes`), with annotations optionally filtered by `?page=`. This allows the client to cache the full store from a single request.

**Filter behaviour**: The `?page=` query parameter only filters the `annotations` array. The `pageNotes` array is **always returned unfiltered**, regardless of the `?page=` parameter. This is intentional — the client uses a single `GET /annotations` request to populate its cache with all page notes, then applies local filtering in the panel's "This Page" tab (filtering by `window.location.pathname`).

**Response with `?page=` filter**:
```json
{
  "version": 1,
  "annotations": [ /* only annotations matching the page filter */ ],
  "pageNotes": [ /* ALL page notes, unfiltered */ ]
}
```

**POST /annotations** request body (text annotation):
```json
{
  "type": "text",
  "pageUrl": "/",
  "pageTitle": "Home",
  "selectedText": "example text",
  "note": "my note",
  "range": { ... }
}
```

**POST /annotations** request body (element annotation):
```json
{
  "type": "element",
  "pageUrl": "/",
  "pageTitle": "Home",
  "note": "Replace with a higher resolution image",
  "elementSelector": {
    "cssSelector": "section.hero > img.hero-image",
    "xpath": "/html[1]/body[1]/section[2]/img[1]",
    "description": "img (class=hero-image, src=hero.jpg, alt=Hero banner)",
    "tagName": "img",
    "attributes": { "class": "hero-image", "src": "hero.jpg", "alt": "Hero banner" },
    "outerHtmlPreview": "<img class=\"hero-image\" src=\"hero.jpg\" alt=\"Hero banner\">"
  }
}
```

The server generates `id`, `createdAt`, and `updatedAt` fields. Missing fields default to empty strings/objects. If `type` is not provided, it defaults to `'text'` (backward compatibility).

**PATCH /annotations/:id** request body: `{ "note": "new value", "replacedText": "new text", "range": { ... }, "status": "addressed", "reply": { "message": "follow-up note" } }`

**Field mutability on PATCH**: The server uses an allowlist pattern — only `note`, `replacedText` (for text annotations), `range` (for text annotations), `status`, and `reply` from the request body are applied; all other fields in the request body are ignored. The `reply` field, when provided, appends a new entry to the annotation's `replies` array with `role: 'reviewer'` and a server-generated `createdAt` timestamp.

| Field | Mutable via PATCH? | Notes |
|-------|-------------------|-------|
| `id` | No | Server-enforced, always preserved |
| `pageUrl` | No | Preserved from original |
| `pageTitle` | No | Preserved from original |
| `selectedText` | No | Preserved from original |
| `note` | **Yes** | Mutable — primary use case |
| `replacedText` | **Yes** (text only) | Mutable on text annotations only, ignored on element annotations. Send `null` to clear. |
| `range` | **Yes** (text only) | Mutable on text annotations only, ignored on element annotations. Used for re-anchoring after fallback tier match (see Section 8.4). |
| `status` | **Yes** | Must be `'open'`, `'in_progress'`, or `'addressed'` (see status side-effects below) |
| `elementSelector` | No | Preserved from original |
| `createdAt` | No | Preserved from original |
| `updatedAt` | No | Server-generated on every PATCH |
| `inProgressAt` | No | Server-generated as side-effect of `status` change |
| `addressedAt` | No | Server-generated as side-effect of `status` change |
**Status side-effects on PATCH**: When `status` is included in the request body, the server automatically manages the related timestamp fields:
- `status: 'in_progress'` → sets `inProgressAt` to current timestamp, clears `addressedAt`
- `status: 'addressed'` → sets `addressedAt` to current timestamp, clears `inProgressAt`
- `status: 'open'` → clears `inProgressAt` and `addressedAt` (sets to `undefined`)

**Validation**: `POST /annotations` validates required fields and returns 400 with a descriptive error message on failure:
- `type` must be `"text"` or `"element"`
- `pageUrl` must be a string
- `note` must be a string
- When `type` is `"text"`: `selectedText` must be a string, `range` must be an object
- When `type` is `"element"`: `elementSelector` must be an object

`PATCH /annotations/:id` validates:
- `replacedText` must not be empty when provided as a string; send `null` to clear (removes the field from the persisted annotation)
- `range` must be an object (if provided); applied to text annotations only, ignored on element annotations
- `status` must be one of `'open'`, `'in_progress'`, `'addressed'` (if provided)
- `reply.message` must be a non-empty string (if `reply` is provided)

`POST /page-notes` validates:
- `pageUrl` must be a string
- `note` must be a string

**DELETE /annotations/:id**: Returns `{ "ok": true }` on success. Returns 404 if the ID does not exist.

#### 4.2.2 Page Note Endpoints

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| `GET` | `/page-notes` | List all page notes | 200 |
| `GET` | `/page-notes?page=/path` | List page notes filtered by page URL | 200 |
| `POST` | `/page-notes` | Create a new page note | 201 |
| `PATCH` | `/page-notes/:id` | Update a page note | 200 |
| `DELETE` | `/page-notes/:id` | Delete a page note | 200 |

Same CRUD semantics as annotation endpoints (POST creates with server-generated ID/timestamps, PATCH updates by ID, DELETE removes by ID).

**GET /page-notes** response shape: Returns filtered page notes but **unfiltered** annotations (the mirror of the annotation endpoint's asymmetry):
```json
{
  "version": 1,
  "annotations": [ /* ALL annotations, unfiltered */ ],
  "pageNotes": [ /* only page notes matching the page filter */ ]
}
```

**Client usage**: The client exclusively uses `GET /annotations` as its store-fetch endpoint. The response from `GET /annotations` includes both the `annotations` and `pageNotes` arrays, making `GET /page-notes` redundant for normal client operation. The `GET /page-notes` endpoint exists for API completeness and potential external tool use (e.g. curl-based debugging).

#### 4.2.3 Version Endpoint

| Method | Path | Description | Status |
|--------|------|-------------|--------|
| `GET` | `/version` | Return a lightweight store fingerprint | 200 |

**Response shape**:
```json
{ "fingerprint": "5:2026-02-26T10:30:00.000Z" }
```

The fingerprint is `<totalCount>:<latestUpdatedAt>` where:
- `totalCount` is the sum of all annotations and page notes (not page-filtered)
- `latestUpdatedAt` is the most recent `updatedAt` ISO 8601 timestamp across all annotations and page notes, or empty string if the store is empty

Any mutation — create, update, delete, status change — modifies either the count or the latest `updatedAt`, causing the fingerprint to change. This endpoint is designed for lightweight polling by the client's store poller (see Section 5.7).

#### 4.2.4 Export Endpoint

| Method | Path | Description | Content-Type |
|--------|------|-------------|--------------|
| `GET` | `/export` | Generate Markdown export | `text/markdown; charset=utf-8` |

Returns raw Markdown text (not JSON). See [Section 9: Markdown Export](#9-markdown-export) for format details.

#### 4.2.5 Error Handling

- **400**: Returned when a POST request body fails validation (missing or invalid required fields)
- **404**: Returned for unknown API routes or when an annotation/note ID is not found
- **413**: Returned when the request body exceeds 1 MB
- **400**: Also returned when the request body contains malformed JSON (invalid JSON is a client error)
- **500**: Returned for unexpected internal errors (e.g. file I/O failure)
- Error response shape: `{ "error": "message" }`
- Non-API requests (URLs not starting with `/__inline-review/api`) are passed through to the next middleware via `next()`


### 4.3 MCP Server

The MCP (Model Context Protocol) server provides structured agent access to review annotations. It runs as a separate subprocess communicating over stdio, independent of the Vite dev server.

#### 4.3.1 Architecture

```
┌─────────────┐     HTTP API      ┌──────────────────┐
│   Browser    │ ←──────────────→ │   Vite/Astro      │
│  (reviewer)  │                  │   Dev Server      │
└─────────────┘                  │                    │
                                  │   ReviewStorage    │ ←→ inline-review.json
                                  │                    │
┌─────────────┐   MCP (stdio)    │   MCP Server       │
│ Coding Agent │ ←──────────────→ │   (subprocess)    │
│ (Claude Code)│                  └──────────────────┘
└─────────────┘
```

**Key design decisions:**

1. **stdio transport** — The agent spawns the MCP server as a child process. No HTTP ports, no CORS, no authentication surface. Communication via stdin/stdout pipes.
2. **Separate process** — Runs independently of Vite. Works even without the dev server running (e.g., reading annotations after a review session).
3. **Shared `ReviewStorage`** — Reuses the same storage class as the REST API, ensuring identical file I/O behaviour, migration logic, and write queuing.

#### 4.3.2 MCP Tools

The MCP server exposes three tools that follow a **list → start → finish** workflow:

| Tool | Type | Parameters | Description |
|------|------|-----------|-------------|
| `list_annotations` | Read | `pageUrl` (string, optional), `status` (enum: `open` \| `in_progress` \| `addressed`, optional) | List all review feedback — both annotations and page notes — in a single response. Returns `{ annotations: [...], pageNotes: [...] }`. Optionally filtered by page URL and/or status. |
| `start_work` | Write | `id` (string, required) | Begin working on an annotation. Returns the full annotation detail and atomically sets status to `in_progress`, so the UI shows a working indicator instead of an orphan warning during code edits and hot-reloads. This is step 2 of the list → start → finish workflow. |
| `finish_work` | Write | `id` (string, required), `anchorText` (string, optional), `message` (string, optional) | Mark an annotation as addressed. Optionally updates the anchor text (stored as `replacedText` — records what the original selected text was changed to) and/or adds an agent reply explaining what action was taken. This is step 3 of the workflow. |

All parameters are validated via Zod schemas at the MCP SDK layer. ID parameters require non-empty strings (`.min(1)`). The `finish_work` tool validates that `anchorText`, when provided, is non-empty after trimming and returns an error if the annotation is not a text annotation. The `message` parameter, when provided, is validated as non-empty after trimming.

**`finish_work` behaviour**: This tool sets the annotation's status to `'addressed'` and records an `addressedAt` timestamp. If `anchorText` is provided, it is stored as the annotation's `replacedText` field (only valid for text annotations). If `message` is provided, it is appended to the annotation's `replies` array with `role: 'agent'`. This reflects the intended workflow: the agent marks its work as done, and a human reviewer later accepts or reopens it via the UI.

**Return format:** All tools return `{ content: [{ type: 'text', text: '...' }] }`. `list_annotations` returns JSON-stringified data containing both annotations and page notes. `start_work` returns the full annotation as JSON-stringified data. `finish_work` returns the full updated annotation as JSON-stringified data. Error responses include `isError: true` with a descriptive message.

#### 4.3.3 Configuration

**Auto-discovery:** The `.mcp.json` file at the project root enables auto-discovery for Claude Code and other MCP-compatible agents:

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

**CLI arguments:**

| Argument | Default | Description |
|----------|---------|-------------|
| `--storage <path>` | `./inline-review.json` | Path to the JSON storage file (resolved relative to `process.cwd()`) |

#### 4.3.4 Process Lifecycle

The MCP server is a single-process, single-connection stdio server. The agent spawns it as a subprocess and communicates via pipes. The server exits when stdin closes (parent process terminates). No explicit shutdown logic is needed.

#### 4.3.5 Concurrency Model

The server assumes single-agent use. Write tools perform read-modify-write operations that are not atomic across processes — the `ReviewStorage` write queue serialises writes within a single process, but concurrent access from multiple processes could lose data. This is acceptable because MCP stdio transport is inherently single-connection.


## 5. Client Architecture

### 5.1 Bootstrap Sequence

The client entry point runs on every page during dev. The bootstrap sequence is:

1. **Idempotency check**: If `window.__review_loop_init` is truthy, exit immediately
2. Set `window.__review_loop_init = true`
3. **Create Shadow DOM host**: `createHost()` returns the shadow root
4. **Create panel**: `createPanel(shadowRoot, callbacks, mediator)` — the slide-in sidebar
5. **Create FAB**: `createFab(shadowRoot, onToggle)` — the floating action button
6. **Create annotator**: `createAnnotator({ shadowRoot, badge, mediator })` — text selection detection, element Alt+click detection, popup, highlights
7. **Register shortcuts**: `registerShortcuts(handlers)` — keyboard shortcuts
8. **Restore highlights**: `annotator.restoreHighlights()` — restore persisted highlights for the current page
9. **Listen for page transitions**: `document.addEventListener('astro:page-load', ...)` — re-restore highlights on SPA navigation
10. **Start store poller**: `createStorePoller({ onStoreChanged })` — poll for external changes (e.g. MCP agent updates) and refresh highlights/panel

The bootstrap runs when `DOMContentLoaded` fires, or immediately if the document is already loaded.

**Notes**:
- `restoreHighlights()` is async but called without `await` (fire-and-forget). The `init()` function is synchronous; highlights appear asynchronously after the API response arrives.
- The annotator returns an `AnnotatorInstance` with three fields: `restoreHighlights()` (async, restores highlights from store), `destroy()` (removes all six event listeners — `mouseup`, `scroll`, `keydown`, `keyup`, `mousemove`, `click` capture — and calls `destroyInspector()` to clean up the overlay), and `popup` (the `PopupElements` reference, exposed so the Escape handler can call `isPopupVisible()` and `hidePopup()` directly).
- `destroy()` is not called during normal operation — the annotator lives for the entire page lifecycle. The method exists for potential future use (e.g. hot-module replacement cleanup).

**Ordering dependency**: The panel MUST be created before the FAB because the `refreshBadge` closure (defined before both) references `fab.badge`. This works because the closure captures the variable by reference, not by value, and `refreshBadge` is never invoked during construction — it only executes when the user opens the panel, by which time the FAB exists.

### 5.2 Idempotency

The integration guards against creating duplicate hosts:

- The `window.__review_loop_init` flag prevents the entire bootstrap from running twice
- `createHost()` checks for an existing `#review-loop-host` element and returns its shadow root if found
- The `astro:page-load` event handler calls `restoreHighlights()` (which clears and re-applies highlights) rather than re-running the full bootstrap

### 5.3 Shadow DOM Host

- **Element**: `<div id="review-loop-host">`
- **Shadow root**: Open mode (inspectable in DevTools)
- **Style isolation**: `:host { all: initial; }` resets all inherited styles
- **Appended to**: `document.body`
- All UI components (FAB, panel, popup, toast) live inside the shadow root
- Text highlights (`<mark>` elements) live in the **light DOM** because they must wrap existing text nodes
- Element highlights (CSS outline on annotated elements) live in the **light DOM** as inline styles on the original elements
- The inspector overlay (during Alt+hover) lives in the **light DOM** so it can position over any element

### 5.4 Client-Side Caching

**localStorage key**: `review-loop`

**Purpose**:
- Fast reads when the API is available (avoids network round-trip for cached data)
- Fallback when the API is unreachable (shouldn't happen in normal dev, but provides resilience)

**Behaviour**:
- The cache is written after every successful API response
- `readCache()` returns the full `ReviewStore` or `null` if missing/corrupt
- `writeCache()` silently ignores errors (e.g. quota exceeded)
- The cache is **not** the source of truth — the JSON file on disk is

**Cache contents**: When the client fetches with a page filter (e.g. `GET /annotations?page=/`), the cached store contains page-filtered annotations but **unfiltered** page notes. The panel's "This Page" tab applies an additional client-side filter on `pageNotes` by `window.location.pathname`.

### 5.5 API Client

The client communicates with the server via fetch requests to `/__inline-review/api/*`. All requests set `Content-Type: application/json` via a shared `request()` helper. Error responses throw exceptions with the error message from the server. Markdown export is generated locally by the client (see Section 9), not fetched from the server.

**Error feedback**: All API errors are surfaced to the user via toast notifications (e.g. "Failed to save annotation", "Failed to delete annotation", "Failed to load annotations") in addition to `console.error` logging for debugging. The panel's "Failed to load annotations" message includes guidance: "Is the dev server running?".

**Endpoints used by the client**:
- `GET /annotations` (with optional `?page=` filter) — primary store fetch
- `POST /annotations` — create annotation
- `PATCH /annotations/:id` — update annotation
- `DELETE /annotations/:id` — delete annotation
- `POST /page-notes` — create page note
- `PATCH /page-notes/:id` — update page note
- `DELETE /page-notes/:id` — delete page note
- `GET /version` — lightweight fingerprint for change detection polling (see Section 5.7)

**Endpoints NOT used by the client**: `GET /page-notes` (page notes are included in the `GET /annotations` response), `GET /export` (client generates Markdown locally via `shared/export.ts`).


### 5.6 Inter-Component Communication

The panel, annotator, FAB, and shortcuts modules are separate concerns that communicate via callbacks and shared references on the shadow root.

#### 5.6.1 Callback Injection

Components accept callback interfaces during construction:

| Component | Callback | Provider | Purpose |
|-----------|----------|----------|---------|
| Panel | `onAnnotationClick(id)` | Client bootstrap | Scroll to highlight and pulse |
| Panel | `onAnnotationDelete(id)` | Client bootstrap | Delete annotation, remove highlight, refresh badge and panel |
| Panel | `onAnnotationStatusChange(id, status)` | Client bootstrap | Update annotation status via PATCH, restore highlights, refresh badge and panel |
| Panel | `isAnnotationOrphaned(id, pageUrl)` | Client bootstrap | Check if annotation's target cannot be found on page |
| Panel | `onRefreshBadge()` | Client bootstrap | Update FAB badge count |
| Panel | `onExport()` | Client bootstrap | Export annotations to clipboard as Markdown |
| Panel | `mediator` | Client bootstrap | Typed mediator for cross-module refresh/restore |
| Annotator | `mediator` | Client bootstrap | Typed mediator — annotator wires up `restoreHighlights` |
| FAB | `onToggle()` | Client bootstrap | Toggle panel open/closed |
| Shortcuts | `togglePanel()` | Client bootstrap | Toggle panel |
| Shortcuts | `closeActive()` | Client bootstrap | Dismiss popup or close panel |
| Shortcuts | `exportToClipboard()` | Client bootstrap | Export and show toast |
| Shortcuts | `addPageNote()` | Client bootstrap | Open panel and show add-note form |

#### 5.6.2 Typed Mediator

Cross-module communication uses a typed `ReviewMediator` interface, avoiding circular imports:

```typescript
interface ReviewMediator {
  refreshPanel: () => Promise<void>;
  restoreHighlights: () => Promise<void>;
}
```

The bootstrap creates a mediator stub object and passes it to both `createPanel` and `createAnnotator`. Each module wires up its own implementation:

| Method | Wired by | Used by | Purpose |
|--------|----------|---------|---------|
| `refreshPanel()` | Panel (`createPanel`) | Panel note CRUD, Clear All | Fetch store, re-render panel content and update tab counts |
| `restoreHighlights()` | Annotator (`createAnnotator`) | Clear All | Remove all DOM highlights and re-apply from store |

**Performance**: `refreshPanel()` fetches the store once and passes it to both the panel content renderer and tab count updater, avoiding redundant API calls. On fetch error, it falls back to independent fetches.

**Scroll-to-annotation**: The `onAnnotationClick` callback is wired directly in the bootstrap via imported highlight functions (`getHighlightMarks`, `pulseHighlight`, `getElementByAnnotationId`, `pulseElementHighlight`) — it does not go through the mediator.

#### 5.6.3 Dependency Graph

```
Client Bootstrap (index.ts)
  ├── creates ShadowRoot
  ├── creates Mediator stub (refreshPanel, restoreHighlights — stubs replaced by modules)
  ├── creates Panel (receives onAnnotationClick, onRefreshBadge, mediator) → wires mediator.refreshPanel
  ├── creates FAB (receives onToggle → togglePanel)
  ├── creates Annotator (receives shadowRoot, badge, mediator) → wires mediator.restoreHighlights
  └── registers Shortcuts (receives togglePanel, closeActive, export, addPageNote)

Panel operations → call onRefreshBadge → update FAB badge
Panel annotation click → call onAnnotationClick → scroll to highlight (via imported functions)
Panel note CRUD → call mediator.refreshPanel() → re-render panel content
Annotator save/delete → call refreshCacheAndBadge → update FAB badge
Shortcuts → call togglePanel/closeActive/export/addPageNote → affect Panel/Popup
Clear All → call mediator.restoreHighlights() → clean up marks/outlines
Store Poller → detects fingerprint change → restoreHighlights + refreshPanel (if open)
```


### 5.7 Auto-Refresh (Store Polling)

The client automatically detects external changes to the annotation store (e.g. when an MCP agent resolves or updates an annotation) and refreshes the UI without requiring the reviewer to manually close and reopen the panel.

#### 5.7.1 Mechanism

A lightweight poller (`createStorePoller`) runs continuously after bootstrap:

1. Every 2 seconds (configurable), fetches `GET /__inline-review/api/version` — returns only a fingerprint string (`<count>:<latestUpdatedAt>`), not the full store
2. Compares the server fingerprint with the last known value
3. On the first poll, stores the fingerprint as a baseline without triggering any refresh
4. On subsequent polls, if the fingerprint has changed:
   - **Always** calls `restoreHighlights()` — updates DOM highlights regardless of panel state
   - **Only** calls `mediator.refreshPanel()` when the panel is currently open — avoids unnecessary DOM re-rendering for an invisible panel

#### 5.7.2 Performance Characteristics

- **Idle cost**: One lightweight HTTP request every 2 seconds (tiny JSON payload: `{ "fingerprint": "5:2026-02-26T10:00:00Z" }`)
- **On change**: Full store fetch via `restoreHighlights()` (same as page load), plus panel re-render if panel is open
- **Panel closed**: Only `restoreHighlights()` runs on change. When the panel is subsequently opened via `togglePanel()`, it fetches fresh data as part of its normal open flow.
- **No change**: Zero additional work beyond the fingerprint fetch

#### 5.7.3 Fingerprint Design

The fingerprint `<count>:<latestUpdatedAt>` captures all meaningful mutations:
- **Create** → count increases
- **Update/PATCH** → `updatedAt` changes (server sets `updatedAt = now` on every PATCH)
- **Delete** → count decreases
- **Status change** → `updatedAt` changes (status PATCH updates `updatedAt`)

The fingerprint is computed from ALL annotations and page notes globally (not page-filtered), so changes on any page are detected regardless of which page the reviewer is viewing.

#### 5.7.4 Error Handling

Network errors and non-OK HTTP responses are silently ignored. The poller continues on its next interval. This handles:
- Dev server restarts (temporary connection refused)
- Network hiccups
- Server errors (500, etc.)

The `onStoreChanged` callback is never invoked on error — the last known fingerprint is preserved, and the next successful poll will detect any accumulated changes.


## 6. UI Components

### 6.1 Floating Action Button (FAB)

**Position**: Fixed, bottom-right corner (24px from each edge)

**Appearance**:
- 48px circle
- Background: `#D97706` (amber/orange), hover: `#B45309`
- Icon: Clipboard/notes SVG (closed state) / Plus SVG rotated 45deg (open state, looks like X)
- Box shadow for elevation
- `z-index: 10000`

**Badge**:
- Red circle (`#EF4444`) positioned top-right of the FAB
- Shows the count of **all annotations** (text + element, not page notes) for the **current page only**
- Hidden when count is 0 (via `display: none`)
- Font: 11px bold white

**Behaviour**:
- Click toggles the review panel open/closed
- Icon swaps between clipboard and close (X) based on panel state
- The `data-air-el="fab"` attribute is the stable automation contract
- The `data-air-state` attribute reflects `"open"` or `"closed"`

**State Synchronisation**:

The FAB derives its state from the `data-air-state` attribute on each click rather than maintaining an independent boolean. Because the panel can be opened or closed by means other than a direct FAB click, two helper functions keep the FAB and panel in sync:

- `openFab(fab)` — sets the icon to the plus/X SVG, adds the `air-fab--open` class, and sets `data-air-state` to `"open"`. Called whenever the panel is opened by a non-FAB-click path: the toggle-panel keyboard shortcut, the add-page-note keyboard shortcut, and the panel state restoration on page load/navigation.
- `resetFab(fab)` — sets the icon back to the clipboard SVG, removes the `air-fab--open` class, and sets `data-air-state` to `"closed"`. Called whenever the panel is closed by a non-FAB-click path: the Escape key handler and the toggle-panel keyboard shortcut (when toggling closed).

All paths that open or close the panel must call the appropriate helper to keep the FAB visual state consistent.

**Accessibility**:
- `aria-label="Toggle inline review panel"` (updated dynamically to include count when annotations exist, e.g. "Toggle inline review (3 annotations)")
- `title="Inline Review"`

### 6.2 Review Panel

**Position**: Fixed, right side, full viewport height

**Dimensions**:
- Width: 380px on desktop
- Width: 100% on viewports below 480px (responsive breakpoint)
- Height: 100vh

**Animation**:
- Slides in from the right via `transform: translateX(100%)` to `translateX(0)`
- Transition: `0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- Uses `visibility: hidden` / `visibility: visible` alongside transform to prevent interaction with hidden panel
- **Timing**: `data-air-state` is set immediately when `togglePanel()` is called, before the CSS transition completes. The `visibility` CSS property transitions alongside `transform` over 0.3s. Tests checking `data-air-state` will see the new state immediately; tests checking CSS visibility may need to wait for the transition to complete.

**Theme**: Dark neutral
- Background: `#1a1a1a`
- Text: `#e5e5e5`
- Borders: `#333`
- Accent: `#D97706` (orange)
- `z-index: 9999`

**Structure**:
- **Header**: Title "Inline Review" + action buttons ("+ Note", "Copy All", "Clear All")
- **Tabs**: "This Page" / "All Pages" with active indicator
- **Content**: Scrollable area showing annotations and page notes
- **Shortcuts footer**: Keyboard shortcuts reference at the bottom, showing platform-aware modifier keys (⌘ on Mac, Ctrl elsewhere). `data-air-el="shortcuts-help"`

**Data attributes**:
- `data-air-el="panel"` on the container
- `data-air-state="open"` or `"closed"`
- `data-air-el="tab-this-page"` and `data-air-el="tab-all-pages"` on tab buttons
- `data-air-el="page-note-add"` on the add note button
- `data-air-el="export"` on the Copy All button
- `data-air-el="clear-all"` on the clear all button
- `data-air-el="annotation-item"` on each annotation list item
- `data-air-el="page-note-item"` on each page note list item

#### 6.2.1 This Page Tab

Shows annotations and page notes for the **current page only** (`window.location.pathname`).

**Layout order**:
1. Page notes section (if any exist) with "Page Notes" header
2. Annotations section (if any exist) with "Annotations" header
3. Empty state message if neither exists

**Empty state**: "No annotations on this page yet. Select text or Alt+click elements to get started."

**Tab label**: Includes count in parentheses, e.g. "This Page (3)". The count includes both annotations (text + element) AND page notes for the current page. This differs from the FAB badge, which counts all annotations (text + element, not page notes).

#### 6.2.2 All Pages Tab

Shows all annotations and page notes **across all pages**, grouped by page URL.

**Grouping**: Each page URL gets a section header formatted as `URL — Page Title`.

**Layout order per group**:
1. Page notes for that URL
2. Annotations for that URL

**Empty state**: "No annotations across any pages."

**Tab label**: Includes total count, e.g. "All Pages (7)".

#### 6.2.3 Text Annotation Items

Each text annotation item in the panel shows:
- **Status badge** (if not `open`) — see 6.2.3b
- **Selected text** in italic yellow (`#FCD34D`), truncated to 80 characters with ellipsis
- **Note** (if non-empty) in light grey
- Wrapped in quotes: `"selected text..."`

**Status styling**: The item container receives a modifier class based on the annotation's effective status (via `getAnnotationStatus()`):
- `addressed`: `.air-annotation-item--addressed` — blue left border (`#3B82F6`), reduced opacity (0.85)
- `open`: no modifier class (default styling)

**Status action buttons**: Each annotation item includes contextual action buttons based on its status (see 6.2.3c).

**Delete button**: Each text annotation item in `open` status has a "Delete" button (`data-air-el="annotation-delete"`) with a two-click confirmation flow matching the Clear All pattern (section 6.2.5). First click changes the button text to "Sure?" and sets `data-air-state="confirming"`. A second click within 3 seconds executes the delete (calls the API, removes highlight marks, refreshes badge and panel). If no second click occurs within 3 seconds, the button reverts to "Delete". The Delete button is hidden when workflow buttons (Accept, Reopen) are present — see section 6.2.3c.

**Orphan indicator**: If the annotation's text cannot be located on the page (Tier 4 orphan per section 8.4), a red indicator is shown with the text "Could not locate on page" (class `.air-annotation-item__orphan`). The item container receives the `.air-annotation-item--orphan` modifier class, which adds a red left border and reduced opacity. Orphan detection only applies to annotations on the current page — annotations for other pages (shown in the "All Pages" tab) do not show an orphan indicator since their DOM is not available.

**Click behaviour**: Scrolls the page to the corresponding highlight and triggers a pulse animation. Uses `scrollIntoView({ behavior: 'smooth', block: 'center' })`.

#### 6.2.3a Element Annotation Items

Each element annotation item in the panel shows:
- **Status badge** (if not `open`) — see 6.2.3b
- **Element description** in yellow (`#FCD34D`), showing `elementSelector.description` (e.g. `img.hero-image (src=hero.jpg, alt=Hero banner)`)
- **Note** (if non-empty) in light grey

**Data attributes**: `data-air-el="element-annotation-item"` on each element annotation item (distinct from `annotation-item` used for text annotations).

**Status styling**: Same modifier classes and visual treatment as text annotations (section 6.2.3).

**Status action buttons**: Same contextual action buttons as text annotations (see 6.2.3c).

**Delete button**: Each element annotation item in `open` status has a "Delete" button (`data-air-el="annotation-delete"`) with the same two-click confirmation flow as text annotations (section 6.2.3). First click shows "Sure?" with `data-air-state="confirming"`, second click within 3 seconds executes the delete. Hidden when workflow buttons are present — see section 6.2.3c.

**Orphan indicator**: If the annotated element cannot be found on the page (its highlight was not restored), a red indicator is shown with the text "Could not locate on page". The item receives the `.air-annotation-item--orphan` modifier class. Same current-page-only restriction as text annotations (section 6.2.3).

**Click behaviour**: Scrolls the page to the annotated element and triggers a pulse animation on the element's outline highlight. Uses `scrollIntoView({ behavior: 'smooth', block: 'center' })`.

#### 6.2.3b Status Badges

Annotation items display a status badge (`data-air-el="status-badge"`) when the annotation is not in the `open` state:

| Status | Badge class | Text | Colour | Timestamp shown |
|--------|------------|------|--------|----------------|
| `addressed` | `.air-annotation-item__addressed-badge` | `🔧 Addressed` | Blue (`#3B82F6`) | `addressedAt` (formatted as short date+time) |
| `open` | — | — | — | No badge shown |

The badge appears at the top of the annotation item, above the selected text/element description. The timestamp (if available) is displayed as a lighter grey span beside the status text.

#### 6.2.3c Status Action Buttons

Each annotation item includes contextual action buttons based on its effective status. The Delete button (section 6.2.3d) is only shown when no workflow buttons are present (i.e., in `open` status):

| Status | Buttons shown | Label | `data-air-el` | Action |
|--------|--------------|-------|---------------|--------|
| `open` | Delete | "Delete" | `annotation-delete` | Two-click delete (see section 6.2.3d) |
| `addressed` | Accept, Reopen | "Accept", "Reopen" | `annotation-accept`, `annotation-reopen` | Accept deletes annotation; Reopen shows inline form (see below) |

**Accept button**: Green background (`#166534`), green text (`#86EFAC`). Shown on `addressed` annotations. Used by the human reviewer to confirm that the agent's work is satisfactory. Sends `DELETE /annotations/:id`, removes highlights, refreshes badge, and refreshes panel. The annotation is removed entirely — accepting means the reviewer is happy with the change and the annotation has served its purpose.

**Reopen button**: Styled as a cancel-type button. Shown on `addressed` annotations. Used when the reviewer disagrees with the agent's work and wants to re-open the annotation. Instead of immediately changing status, clicking Reopen shows an inline form (`data-air-el="reopen-form"`) with:
- A textarea (`data-air-el="reopen-textarea"`) for an optional follow-up note, placeholder: "Add a follow-up note (optional)…"
- A "Cancel" button (`data-air-el="reopen-cancel"`) that dismisses the form without changes
- A "Reopen" submit button (`data-air-el="reopen-submit"`) that sends `PATCH /annotations/:id` with `{ "status": "open" }` and optionally `{ "reply": { "message": "..." } }` if the reviewer entered a note

The follow-up note is appended to the annotation's `replies` array with `role: 'reviewer'`. This enables back-and-forth conversation between the reviewer and agent. The form is removed from the DOM after submit or cancel. Clicks within the form call `e.stopPropagation()` to prevent scroll-to-annotation.

Both buttons call `e.stopPropagation()` to prevent the click from triggering the scroll-to-annotation behaviour.

#### 6.2.4 Page Note Items

Each page note item shows:
- Note text
- **Edit** button (inline)
- **Delete** button (inline, immediate — no confirmation; page notes do not use the two-click pattern)

Edit mode replaces the item content with a textarea form.

#### 6.2.5 Clear All

**Two-click confirmation flow**:
1. First click: Button text changes from "Clear All" to "Confirm Delete", `data-air-state` set to `"confirming"`
2. If no second click within 3 seconds: Auto-resets to "Clear All"
3. Second click within 3 seconds: Deletes **all** annotations and page notes (across all pages), refreshes panel and badge

**Implementation**: Clear All deletes each annotation and page note individually via separate `DELETE` requests. There is no bulk delete endpoint. For a store with N annotations and M page notes, this sends N+M sequential HTTP requests, each performing a full file read-modify-write cycle. After all deletions complete, the cache is cleared to an empty store and the badge is refreshed.

**Highlight cleanup**: After all individual deletions complete, the Clear All handler explicitly calls `mediator.restoreHighlights()`. This clears all existing text marks and element outlines from the DOM. The empty store means no highlights are re-applied, leaving the page clean.

### 6.3 Selection Popup

**Trigger**: Appears when the user selects text on the page (detected via `mouseup` event), OR when the user Alt+clicks an element (element annotation mode — see Section 6.5)

**Positioning algorithm**:
1. Calculate horizontal centre: `left = selection.left + (selection.width / 2) - (POPUP_WIDTH / 2)` where `POPUP_WIDTH = 300px`
2. Determine right boundary: if the panel is open (`data-air-state="open"`), use the panel's `offsetLeft - 8`; otherwise use `viewportWidth - 8`
3. Clamp horizontally: `left = max(8, min(left, rightBound - 300))`
4. Try above: `top = selection.top - 8`
5. If `top < 208` (not enough room above): switch to below: `top = selection.bottom + 8`
6. If placed above: apply `transform: translateY(-100%)` so the popup's bottom edge aligns with the selection's top edge
7. If placed below: no transform (popup's top edge aligns with the selection's bottom edge)

The 208px threshold is `8px margin + 200px` (approximate popup height including textarea and buttons).

- Width: 300px
- `z-index: 10001` (above panel)

**Create mode — text** (new text annotation):
- Shows selected text preview (truncated to 100 characters with ellipsis, wrapped in quotes)
- Empty textarea with placeholder "Add a note (optional)..."
- Save and Cancel buttons
- Textarea auto-focused after render

**Create mode — element** (new element annotation):
- Shows element description instead of selected text (e.g. `img (class=hero-image, src=hero.jpg)`) in yellow
- Empty textarea with placeholder "Add a note (optional)..."
- Save and Cancel buttons
- Textarea auto-focused after render
- Positioned near the Alt+clicked element using the element's `getBoundingClientRect()`

**Edit mode** (clicking existing highlight or element outline):
- Shows selected text preview
- Textarea pre-filled with existing note
- Save, Cancel, and **Delete** buttons
- Delete button positioned left (separate from save/cancel via `margin-right: auto`)

**Dismissal**:
- Cancel button
- Page scroll beyond 50px from popup's original position (see section 7.4)
- Escape key (when popup is visible)

**Visibility mechanism**: The popup's visibility is controlled by two mechanisms in parallel:
1. The CSS class `air-popup--visible` toggles `display: block` (visible) / `display: none` (hidden)
2. The `data-air-state` attribute is set to `"visible"` or `"hidden"` in parallel

Tests should use `data-air-state` (the automation contract) rather than CSS display inspection.

**Data attributes**:
- `data-air-el="popup"` on container
- `data-air-state="visible"` or `"hidden"`
- `data-air-el="popup-textarea"` on the textarea
- `data-air-el="popup-save"`, `"popup-cancel"`, `"popup-delete"` on buttons

**Empty note handling**: Saving with an empty note is allowed — the annotation is created with an empty `note` field. This is distinct from page notes, where empty notes are discarded.

### 6.4 Toast Notifications

**Position**: Fixed, bottom-right, above the FAB (80px from bottom, 24px from right)

**Appearance**: Dark background, light text, 13px font, rounded corners, subtle shadow

**Behaviour**:
- Fades in with opacity + translateY transition
- Auto-dismisses after 2.5 seconds (default)
- Multiple calls reuse the same element and restart the timer
- `z-index: 10003` (above everything — see Section 17.2)
- `pointer-events: none` (non-interactive)

**Data attributes**: `data-air-el="toast"`


### 6.5 Inspector Overlay (Element Annotation Mode)

**Trigger**: Holding the Alt (Option on macOS) key activates inspector mode.

**Visual feedback while Alt is held**:
- As the user moves the mouse over elements, an **inspector overlay** highlights the element under the cursor
- The overlay is a semi-transparent blue box (`rgba(66, 133, 244, 0.15)`) with a 2px solid border (`rgba(66, 133, 244, 0.6)`) placed over the hovered element using its `getBoundingClientRect()`
- A **tag label** appears at the top-left corner of the overlay showing the element's tag name and key identifier (e.g. `img.hero-image`, `section#expertise`, `div`). The label is clamped to `max-width: 400px` with `overflow: hidden` and `text-overflow: ellipsis` to prevent overflow on long selectors
- The overlay and label are injected into the **light DOM** (not shadow DOM) so they can position over any element
- The overlay updates on `mousemove` events while Alt is held
- `data-air-el="inspector-overlay"` on the overlay element
- `data-air-el="inspector-label"` on the tag label element

**Alt+click**:
- When the user clicks while holding Alt, the clicked element is captured
- `e.preventDefault()` is called in a capture-phase click handler when `e.altKey` is true — this prevents the default Alt+click behaviour (which on macOS downloads link targets)
- `e.stopPropagation()` is also called to prevent the click from triggering site handlers
- The inspector overlay is removed
- The popup appears near the clicked element (positioned using the element's bounding rect)
- The popup shows the element's description (from `ElementSelector.description`) instead of selected text

**Alt key release**:
- When Alt is released (`keyup` event where `key === 'Alt'`), the inspector overlay is removed
- Inspector mode deactivates — mouse movement no longer highlights elements

**Excluded elements**:
- The Shadow DOM host (`#review-loop-host`) and its children are excluded from inspection
- Elements inside the Shadow DOM are excluded
- The `<html>` and `<body>` elements are excluded (too broad to be useful)

**Z-index**: The inspector overlay uses `z-index: 10002` — above the FAB and panel but below the toast, ensuring the highlight is visible while inspecting.

**Implementation notes**:
- The overlay is a single `<div>` element that is repositioned on each `mousemove`, not one-per-element
- The label is a child of the overlay
- Both are removed from the DOM when Alt is released or after the click is processed
- All inspector-related event listeners (`keydown`, `keyup`, `mousemove`, `click`) are registered once during annotator creation and remain attached for the page lifetime
- The `mousemove` handler short-circuits with an early return when `inspectorActive` is `false`
- The `keyup` handler only acts when `e.key === 'Alt'`
- The `click` capture handler only acts when `e.altKey` is `true`
- This avoids the overhead of dynamic listener attachment/detachment on every Alt key press


## 7. Annotation Workflow

### 7.1 Creating an Annotation

1. User selects text on the page
2. `mouseup` event fires on `document`
3. Annotator checks: is the selection non-empty, non-whitespace, and outside the Shadow DOM host?
4. If valid: clones the selection range, shows the popup near the selection
5. User optionally types a note, clicks Save
6. Client serialises the range (XPath + offsets + context)
7. `POST /annotations` sends the data to the server
8. Server generates ID and timestamps, persists to JSON file
9. Client applies highlight to the selected text
10. Client updates localStorage cache and badge count
11. Selection is cleared

### 7.2 Editing an Annotation

1. User clicks an existing `<mark>` highlight (the click detection checks only the direct `mouseup` target — if a child element like `<em>` inside a `<mark>` is clicked, the edit path is not triggered)
2. Annotator reads the `data-air-id` attribute to find the annotation
3. Fetches annotation data from cache (or API)
4. Shows edit popup with pre-filled note and Delete button
5. Save: `PATCH /annotations/:id` with new note text
6. Delete: `DELETE /annotations/:id`, removes highlight marks from DOM
7. Cache and badge updated

### 7.3 Selection Filtering

Selections are ignored (no popup shown) if ANY of:

1. The `mouseup` event target is a descendant of the host element (or the host itself)
2. The selection is collapsed (cursor click without drag)
3. The selected text, after trimming, is empty (whitespace-only)
4. The range's `commonAncestorContainer` is a descendant of the host element OR a descendant of the shadow root

Note: `Element.contains()` does not pierce shadow boundaries, so both checks are needed. The shadow root check handles the edge case where `commonAncestorContainer` is inside the shadow DOM (e.g. via programmatic selection).

### 7.4 Scroll Dismissal

When the page scrolls more than 50 pixels from the popup's original position, the popup is hidden and the current range is discarded. This prevents the popup from floating away from its associated text whilst tolerating minor scroll adjustments. The initial `scrollY` is captured when the popup is shown and compared against the current `scrollY` on each scroll event.

**Unsaved changes protection**: If the popup textarea contains non-empty content (after trimming whitespace), scroll dismissal is skipped. This prevents accidental loss of in-progress notes. Users can always dismiss via the Cancel button regardless of textarea content.

**Active interaction protection**: If any element within the popup container has focus (checked via `shadowRoot.activeElement`), scroll dismissal is skipped. This prevents the popup from disappearing while the user is actively composing an annotation — even when the textarea is empty. The check uses `popup.container.contains(shadowRoot.activeElement)` to cover the textarea, buttons, and any other focusable elements within the popup. The popup is only dismissed on scroll when it is in "passive mode" — no focus inside the popup and no content in the textarea.


### 7.5 Creating an Element Annotation

1. User holds Alt key — inspector mode activates
2. User moves mouse — inspector overlay highlights hovered elements
3. User Alt+clicks an element
4. Inspector overlay is removed
5. Client generates `ElementSelector` (CSS selector, XPath, description, attributes, outerHTML preview)
6. CSS selector uniqueness is verified via `querySelectorAll()`
7. Popup appears near the clicked element showing the element description
8. User optionally types a note, clicks Save
9. `POST /annotations` sends `type: 'element'` with `elementSelector` data
10. Server generates ID and timestamps, persists to JSON file
11. Client applies element highlight (dashed amber outline) to the element
12. Client updates localStorage cache and badge count

### 7.6 Editing an Element Annotation

1. User clicks an element that has a `data-air-element-id` attribute, **or any descendant of such an element** (existing element annotation highlight). The annotator walks up the DOM tree from the click target to find the closest ancestor with the attribute. This means clicking a child element (e.g. text inside an annotated section) triggers the edit popup for the parent annotation.
2. Annotator reads the annotation ID from the attribute
3. Fetches annotation data from cache (or API)
4. Shows edit popup with pre-filled note and Delete button, showing element description
5. Save: `PATCH /annotations/:id` with new note text
6. Delete: `DELETE /annotations/:id`, removes element highlight (outline) from DOM
7. Cache and badge updated

### 7.7 Element Selection Filtering

Alt+clicks are ignored (no annotation created) if ANY of:

1. The clicked element is the Shadow DOM host or a descendant of it
2. The clicked element is inside the Shadow DOM
3. The clicked element is `<html>` or `<body>`
4. The popup is already visible (prevents stacking)


## 8. Highlight System

### 8.1 Highlight Elements

Highlights are `<mark>` elements injected into the **light DOM** (the page's own DOM, not the shadow DOM). This is necessary because they must wrap existing text nodes.

**Attributes**:
- `data-air-id="<annotation-id>"` — links the mark to its annotation
- `style="background-color: rgba(217,119,6,0.3); border-radius: 2px; cursor: pointer;"`

**Status-based text highlight colours**: The highlight background colour changes based on the annotation's effective status (via `getAnnotationStatus()`):

| Status | Background colour | Visual effect |
|--------|------------------|---------------|
| `open` | `rgba(217,119,6,0.3)` | Amber (default) |
| `in_progress` | `rgba(139,92,246,0.2)` | Purple |
| `addressed` | `rgba(59,130,246,0.2)` | Blue |

This visually distinguishes annotations at different lifecycle stages.

**Single-node selections**: Use `Range.surroundContents()` for simplicity.

**Cross-element selections**: The selection is split into multiple `<mark>` elements, one per text node segment. All marks share the same `data-air-id`. Text nodes are split at the selection boundaries to isolate the highlighted portion.

### 8.2 Highlight Removal

When an annotation is deleted:

1. All `<mark>` elements with the matching `data-air-id` are found
2. Each mark's children are moved out of the mark (re-parented to the mark's parent)
3. The mark element is removed
4. `parent.normalize()` merges adjacent text nodes to restore the original DOM structure

### 8.3 Highlight Pulse Animation

When scrolling to an annotation from the panel, the highlight "pulses":

1. Set `data-air-pulse` attribute on the mark(s) (test hook — see Section 14.3)
2. Set `transition: background-color 0.3s ease` on the mark(s)
3. Change background to `rgba(217,119,6,0.6)` (brighter)
4. After 600ms: revert to `rgba(217,119,6,0.3)` (normal)
5. After 900ms: remove the transition property and `data-air-pulse` attribute

**Testability**: The `data-air-pulse` attribute provides a stable, timing-independent test hook. Tests should check for the presence of this attribute rather than inspecting inline style values, which are transient.

### 8.4 Three-Tier Text Highlight Restoration

When the page loads (or on SPA navigation), **text** highlights are restored from persisted text annotations:

**Tier 1 — XPath + Offset** (primary):
- Resolve the start and end XPaths to DOM nodes
- Create a Range with the stored offsets
- Verify the range's text content matches `selectedText`
- If all checks pass: apply highlight

**Tier 2 — Context Matching** (fallback):
- Walk all text nodes in `document.body` to build a full-text index
- Find all occurrences of `selectedText` in the concatenated text
- Score each match by graduated longest-boundary-match on `contextBefore` and `contextAfter` (see Section 15.3 for the full scoring algorithm)
- Reject the match if below the minimum confidence threshold (30% of maximum possible context score)
- If accepted, use the best-scoring match to create a Range and apply highlight
- If rejected (or no occurrences found), fall through to Tier 2.5

**Tier 2.5 — Replacement Text Context Matching** (agent-assisted fallback):
- Only attempted when the annotation has a `replacedText` field set (see Section 3.2.2)
- Reuses the same `findRangeByContext()` function as Tier 2, but passes `replacedText` instead of `selectedText`
- The `contextBefore` and `contextAfter` from the original range are retained — because the agent changed the annotated text, not the surrounding text
- Same graduated scoring and confidence threshold as Tier 2
- If accepted: apply highlight. If rejected: fall through to Tier 3

**Tier 3 — Context-Seam Matching** (structural fallback):
- Attempted when the annotated text has been completely rewritten but the surrounding text is intact
- Finds where `contextBefore` ends and `contextAfter` begins in the document, without requiring the annotated text itself to exist
- Searches for exact substring matches of the full `contextBefore` and `contextAfter` in the concatenated page text
- For each pair of matches, computes the gap between the end of `contextBefore` and the start of `contextAfter`
- Selects the pair with the smallest valid gap (at least 1 character, at most 500 characters)
- Requires both `contextBefore` and `contextAfter` to be at least 3 characters long
- If a valid seam is found: create a Range covering the gap text and apply highlight
- If no valid seam: fall through to Tier 4

**Tier 4 — Orphaned** (last resort):
- The annotation exists in the store but cannot be located in the DOM
- It is **visible in the review panel** (listed as an annotation item)
- No highlight is applied on the page
- The panel indicates orphaned status with a red indicator ("Could not locate on page") and the `.air-annotation-item--orphan` modifier class (red left border, reduced opacity)
- The annotation can be deleted via its Delete button in the panel (`data-air-el="annotation-delete"`)

**Re-anchoring after fallback match**: When a Tier 2.5 or Tier 3 match succeeds, the client serialises the live DOM Range (via `serializeRange`) and sends a PATCH request to update the annotation's stored `range` data with the fresh XPath, offset, and context information. This promotes the annotation to Tier 1 on subsequent page loads, eliminating repeated fallback resolution.

- Re-anchoring is fire-and-forget — the PATCH runs asynchronously and does not block highlight restoration
- Each annotation is re-anchored at most once per session (tracked by an in-memory `reanchoredIds` set)
- If the annotation has a `replacedText` field, the PATCH also clears it (sends `replacedText: null`) because the new range's `selectedText` now contains the current text, making `replacedText` redundant
- Tier 1 and Tier 2 matches do not trigger re-anchoring: Tier 1 data is already accurate; Tier 2 matched the original text so stored `selectedText` remains valid for future context matches
- If the PATCH fails (e.g., network error), the annotation continues to use fallback restoration until the next session, when re-anchoring is attempted again

### 8.5 Element Highlights

Element annotations use **CSS outline** (not background colour or border) to avoid affecting the element's layout.

#### 8.5.1 Element Highlight Style

**Status-based element highlight colours**: The outline colour changes based on the annotation's effective status (via `getAnnotationStatus()`):

| Status | Outline style | Visual effect |
|--------|--------------|---------------|
| `open` | `2px dashed rgba(217,119,6,0.8)` | Amber (default) |
| `in_progress` | `2px dashed rgba(139,92,246,0.5)` | Purple |
| `addressed` | `2px dashed rgba(59,130,246,0.5)` | Blue |

All element highlights share:
- `outline-offset: 2px` — adds visual breathing room
- `outline` does not affect element dimensions or layout (unlike `border`)
- Dashed outline distinguishes element annotations from text highlights (solid background)
- The `data-air-element-id="<annotation-id>"` attribute is added to the element to link it to its annotation
- `cursor: pointer` is added to indicate the element is clickable for editing

#### 8.5.2 Element Highlight Removal

When an element annotation is deleted:

1. Find the element with `data-air-element-id="<id>"`
2. Remove the `data-air-element-id` and `data-air-pulse` attributes
3. Remove the inline `outline`, `outline-offset`, and `cursor` styles
4. Defensively clear `backgroundColor`, `boxShadow`, and `transition` (may be set by a mid-flight pulse animation)

#### 8.5.3 Element Highlight Pulse

When scrolling to an element annotation from the panel, the element "pulses" with a background flash and box-shadow glow (matching the visual impact of the text highlight pulse):

1. Set `data-air-pulse` attribute on the element (same test hook as text highlights)
2. Save original `backgroundColor` and `boxShadow` values (to restore after animation)
3. Set `transition: background-color 0.3s ease, box-shadow 0.3s ease, outline-color 0.3s ease`
4. Change outline to `rgba(217,119,6,1)` (fully opaque)
5. Set `backgroundColor` to `rgba(217,119,6,0.15)` (subtle amber flash)
6. Set `boxShadow` to `0 0 0 4px rgba(217,119,6,0.3)` (amber glow)
7. After 600ms: revert outline to `rgba(217,119,6,0.8)`, restore original `backgroundColor` and `boxShadow`
8. After 900ms: remove the transition and `data-air-pulse` attribute

**Design rationale**: The previous implementation only animated `outline-color` from 80% to 100% opacity — a 25% relative change on a thin dashed border that was nearly imperceptible. The background flash and box-shadow glow provide a filled-area visual cue that matches the noticeability of the text highlight pulse (see Section 8.3).

#### 8.5.4 Element Highlight Restoration

On page load or SPA navigation, element annotations are restored:

1. Fetch element annotations for the current page
2. For each element annotation:
   a. **Tier 1**: `document.querySelector(cssSelector)` — returns first match (no uniqueness re-verification)
   b. **Tier 2**: `document.evaluate(xpath)` — positional fallback
   c. **Tier 3**: Orphaned — no highlight applied, visible only in panel (element annotations use 3 tiers; text annotations have 4 — see Section 8.4)
3. If found: apply outline style and `data-air-element-id` attribute

Element highlights are removed before re-applying (same as text highlights) by querying all elements with `data-air-element-id` and removing their styles/attributes.

### 8.6 Layout Preservation

Highlights must not break the page layout:
- Text highlights: No extra whitespace, no block-level changes, `<mark>` is inline, cross-element marks split text nodes without altering structure
- Element highlights: `outline` does not affect element dimensions or layout flow

### 8.7 Restoration on Navigation

- On initial page load: `restoreHighlights()` is called during bootstrap
- On `astro:page-load` event (Astro SPA/view transitions): `restoreHighlights()` is called again
- Before restoring, all existing text marks (elements with `data-air-id`) are removed to prevent duplicates
- Before restoring, all existing element highlights (elements with `data-air-element-id`) have their outline styles and attribute removed


## 9. Export and Agent Consumption

The integration provides two complementary formats for feeding review feedback to coding agents:

- **Markdown export** (section 9.1–9.3): Human-readable, designed for pasting into coding agents (Claude Code, Codex, Cursor, etc.). Each annotation includes the page URL and selected text, giving the agent enough context to locate and act on the feedback.
- **JSON storage file** (section 4.1): Machine-readable, designed for file-aware agents that can read `inline-review.json` directly from the project root. Contains richer location data — XPath ranges, character offsets, and 80-character context windows before and after each selection — enabling more precise source-text matching.

### 9.1 Export Format

Both the server (`GET /export`) and client generate identical Markdown:

```markdown
# Inline Review — Copy Annotations
Exported: YYYY-MM-DD HH:MM

---

## /page-url — Page Title

### Page Notes
- First page note
- Second page note

### Text Annotations
1. **"selected text here"**
   > User's note about this text

2. **"another selection"**
   > Another note

### Element Annotations
1. **`section.hero > img.hero-image`** (`<img src="hero.jpg" alt="Hero banner">`)
   > Replace with a higher resolution image

---

## /other-page — Other Title

### Text Annotations
1. **"text on other page"**
```

### 9.2 Format Rules

- **Heading**: Always `# Inline Review — Copy Annotations`
- **Export date**: ISO-like format `YYYY-MM-DD HH:MM` (no seconds, UTC timezone — no timezone suffix displayed). Both the server and client export use `new Date().toISOString()` which always produces UTC.
- **Page groups**: Separated by `---` horizontal rules
- **Page heading**: `## /url — Title` (title omitted if empty)
- **Page notes**: Bullet list under `### Page Notes`
- **Text annotations**: Numbered list under `### Text Annotations`
- **Element annotations**: Numbered list under `### Element Annotations` (see 9.2.1)
- **Selected text**: Bold with quotes: `**"text"**`
- **Notes**: Blockquote: `   > note text` (indented 3 spaces)
- **Empty notes**: No blockquote line rendered
- **Empty store**: Shows "No annotations or notes yet." instead of page groups
- **Status labels**: Appended after the selected text or selector based on annotation status:
  - `addressed`: ` 🔧 [Addressed]`
  - `open`: no label
- **Agent replies**: Shown as blockquotes with `**Agent:**` prefix: `   > **Agent:** reply text`
- All pages are included in the export, not just the current page

#### 9.2.1 Element Annotation Export Format

Element annotations are listed under `### Element Annotations` within each page group, after text annotations:

```markdown
### Element Annotations
1. **`section.hero > img.hero-image`** (`<img src="hero.jpg" alt="Hero banner">`)
   > Replace with a higher resolution image

2. **`button.cta-primary`** (`<button class="cta-primary" type="submit">`)
   > Change button colour to match brand
```

- CSS selector is bold and in backticks: `` **`cssSelector`** ``
- Outer HTML preview (up to 200 chars, as stored) in parentheses and backticks: `` (`preview`) ``
- Note as blockquote (same as text annotations)

### 9.3 Clipboard Export

Export can be triggered by either:
- The **"Copy All"** button in the panel header
- The keyboard shortcut `Cmd/Ctrl + Shift + E`

Both use the same underlying logic:

1. Fetches the full (unfiltered) store from the server via `GET /annotations` (no `?page=` filter). The client-side cache is not used for export because it only contains the current page's annotations.
2. Attempts `navigator.clipboard.writeText()` (modern Clipboard API)
3. Falls back to `textarea.select()` + `document.execCommand('copy')` for older browsers
4. Shows a toast notification: "Copied to clipboard!" on success, "Export failed — try again" on failure

The "Copy All" button is styled with an orange accent (`border-color: #D97706`, `color: #FCD34D`) to visually distinguish it from the neutral "+ Note" button, while the destructive "Clear All" button uses a red accent. Button order in the header is: "+ Note" | "Copy All" | "Clear All".


## 10. Keyboard Shortcuts

### 10.1 Shortcut Map

| Shortcut | Action | Notes |
|----------|--------|-------|
| `Cmd/Ctrl + Shift + .` | Toggle panel open/closed | Also handles `>` (Shift+. on some layouts) |
| `Escape` | Close active UI | Popup takes precedence over panel |
| `Cmd/Ctrl + Shift + E` | Export to clipboard | |
| `Cmd/Ctrl + Shift + N` | Add page note | Opens panel if closed, displays add-note form |

### 10.2 Event Handling

- All shortcuts are registered via a single `keydown` event listener on `document`
- **Escape** uses the **capture phase** (`addEventListener(..., true)`) so it fires before the site's own handlers
- All other shortcuts use the capture phase as well (single listener)
- `e.preventDefault()` is called for modifier shortcuts to prevent browser defaults

### 10.3 Input Suppression

- When focus is in an `<input>`, `<textarea>`, or `contentEditable` element, **all shortcuts except Escape are suppressed**
- Escape always fires regardless of focus state (for dismissing popups/panels)
- This applies to both the site's own inputs and the integration's own textareas (e.g. popup textarea, page note textarea)

### 10.4 Escape Precedence

When Escape is pressed, `closeActive()` is called. The handler checks state in priority order:

1. If the popup is visible (via `isPopupVisible()`): check for unsaved changes — if the textarea has non-empty content (after trimming), the Escape is consumed but the popup stays open. Otherwise, dismiss the popup using `hidePopup()`, which removes the visibility class, sets `data-air-state` to `"hidden"`, and clears the textarea value.
2. If the panel is open (and popup is not visible): close the panel via `closePanel()` and reset the FAB to closed state via `resetFab()`.
3. If neither is open: no action taken, the event propagates normally to site handlers.

When `closeActive()` returns `true` (cases 1 and 2), the handler calls `e.stopPropagation()` and `e.preventDefault()` to prevent the event from reaching site handlers.


## 11. Page Notes

### 11.1 Overview

Page notes are free-text notes associated with a page URL (not with a specific text selection). They appear in the review panel's "This Page" tab above annotations.

### 11.2 CRUD Operations

- **Create**: Click "+ Note" button in panel header. Opens a textarea form at the top of the content area. Save sends `POST /page-notes`. The "+ Note" button acts as a toggle: if the add-note form is already visible, clicking "+ Note" again dismisses it without creating a note.
- **Edit**: Click "Edit" button on a page note item. Replaces the item with an inline textarea form. Save sends `PATCH /page-notes/:id`.
- **Delete**: Click "Delete" button on a page note item. Immediately sends `DELETE /page-notes/:id` (no confirmation required, unlike Clear All).
- **Empty notes**: If the user tries to save an empty/whitespace-only note, the form is dismissed without creating a note.

### 11.3 Scoping

Page notes are scoped by `pageUrl`:
- The "This Page" tab only shows notes for the current `window.location.pathname`
- The "All Pages" tab shows notes grouped by page URL
- Notes created on page A do not appear when viewing page B's "This Page" tab

### 11.4 Persistence

Page notes are persisted to the same `inline-review.json` file as annotations, in the `pageNotes` array. They survive page reloads and dev server restarts.


## 12. Multi-Page Behaviour

### 12.1 URL Scoping

Annotations and page notes are associated with `window.location.pathname` at creation time:
- Highlights are only applied for annotations matching the current page URL
- The FAB badge shows the count for the **current page only**
- The "This Page" panel tab filters by current URL

### 12.2 Navigation

When navigating between pages:
- The badge count updates to reflect the new page's annotation count
- Highlights for the previous page are removed (either by page navigation or explicit cleanup)
- Highlights for the new page are restored via `restoreHighlights()`
- The panel's "This Page" tab re-renders with the new page's data

### 12.3 Astro View Transitions

The integration supports Astro's view transitions (SPA-style navigation):
- Listens for `astro:page-load` events to re-restore highlights after soft navigation
- The Shadow DOM host persists across transitions (idempotency guard)
- Annotations created before a view transition survive the navigation

### 12.4 All Pages View

The "All Pages" tab and the export endpoint both aggregate data across all pages, grouped by URL. This provides a complete overview of all annotations regardless of which page the user is currently viewing.


## 13. Production Safety

### 13.1 Requirements

When the site is built with `astro build`:

1. **No scripts**: The integration's client script must not appear in any HTML file
2. **No host element**: No `<div id="review-loop-host">` in the rendered HTML
3. **No API references**: No references to `__inline-review` in any JavaScript bundle
4. **No JSON file references**: No references to `inline-review.json` in built output

### 13.2 Implementation

This is achieved by the integration hook returning immediately when `command !== 'dev'`. Since `injectScript` and `updateConfig` are never called during build, no traces of the integration exist in the production output.


## 14. Automation Contract (data-air-* Attributes)

The integration exposes stable `data-air-el` and `data-air-state` attributes for automated testing. These attributes form a **stable contract** that tests can rely on, decoupled from CSS class names which may change. Internal CSS class names referenced elsewhere in this spec (e.g. `air-panel--open`, `air-popup--visible`, `air-fab--open`) are **not** part of the automation contract and are documented for implementer context only.

### 14.1 Element Identification (data-air-el)

| Value | Element | Location | Lifecycle |
|-------|---------|----------|-----------|
| `fab` | FAB button | Shadow DOM | Always present after bootstrap |
| `badge` | FAB badge | Shadow DOM | Always present (child of FAB) |
| `panel` | Review panel container | Shadow DOM | Always present (may be hidden) |
| `popup` | Annotation popup | Shadow DOM | Always present (starts hidden, `display: none`) |
| `popup-textarea` | Popup note textarea | Shadow DOM | Always present (child of popup) |
| `popup-save` | Popup save button | Shadow DOM | Rebuilt each time popup is shown |
| `popup-cancel` | Popup cancel button | Shadow DOM | Rebuilt each time popup is shown |
| `popup-delete` | Popup delete button (edit mode only) | Shadow DOM | Only present in edit mode |
| `tab-this-page` | "This Page" tab | Shadow DOM | Always present (child of panel) |
| `tab-all-pages` | "All Pages" tab | Shadow DOM | Always present (child of panel) |
| `annotation-item` | Annotation list item in panel | Shadow DOM | Present when panel is open and annotations exist |
| `page-note-item` | Page note list item in panel | Shadow DOM | Present when panel is open and page notes exist |
| `page-note-add` | "Add Note" button in panel header | Shadow DOM | Always present (child of panel header) |
| `export` | "Copy All" button in panel header | Shadow DOM | Always present (child of panel header) |
| `page-note-textarea` | Page note textarea (add/edit form) | Shadow DOM | Present when add/edit note form is open |
| `page-note-edit` | Page note edit button | Shadow DOM | Present on each page note item when panel shows notes |
| `page-note-delete` | Page note delete button | Shadow DOM | Present on each page note item when panel shows notes |
| `page-note-cancel` | Page note form cancel button | Shadow DOM | Present when add/edit note form is open |
| `page-note-save` | Page note form save button | Shadow DOM | Present when add/edit note form is open |
| `clear-all` | "Clear All" button | Shadow DOM | Always present (child of panel header) |
| `toast` | Toast notification | Shadow DOM | Created on first toast, then reused |
| `annotation-delete` | Annotation delete button | Shadow DOM | Present on open-status annotation items only (hidden when workflow buttons shown) |
| `element-annotation-item` | Element annotation list item in panel | Shadow DOM | Present when panel is open and element annotations exist |
| `panel-content` | Panel content area (scrollable) | Shadow DOM | Always present (child of panel) |
| `status-badge` | Status badge on annotation (addressed) | Shadow DOM | Present on non-open annotations |
| `annotation-accept` | Accept button on addressed annotation | Shadow DOM | Present on addressed annotations |
| `annotation-reopen` | Reopen button on addressed annotation | Shadow DOM | Present on addressed annotations |
| `agent-reply` | Agent reply block on annotation | Shadow DOM | Present when annotation has replies with `role !== 'reviewer'` |
| `reviewer-reply` | Reviewer reply block on annotation | Shadow DOM | Present when annotation has replies with `role === 'reviewer'` |
| `reopen-form` | Inline form for reopening with follow-up note | Shadow DOM | Present after clicking Reopen button |
| `reopen-textarea` | Textarea in reopen form | Shadow DOM | Present inside reopen-form |
| `reopen-submit` | Submit button in reopen form | Shadow DOM | Present inside reopen-form |
| `reopen-cancel` | Cancel button in reopen form | Shadow DOM | Present inside reopen-form |
| `first-use-tooltip` | First-use tooltip near FAB | Shadow DOM | Shown once on first visit, then dismissed |
| `empty-arrow` | Directional arrow in empty state | Shadow DOM | Present when "This Page" tab has no annotations |
| `shortcuts-help` | Keyboard shortcuts footer in panel | Shadow DOM | Always present (child of panel) |
| `inspector-overlay` | Inspector overlay during Alt+hover | Light DOM | Present only while Alt is held and mouse is over an element |
| `inspector-label` | Tag label on inspector overlay | Light DOM | Child of inspector overlay |

### 14.2 State Tracking (data-air-state)

| Element | Possible Values | Meaning |
|---------|----------------|---------|
| FAB | `open`, `closed` | Panel is open or closed |
| Panel | `open`, `closed` | Panel visibility state |
| Popup | `visible`, `hidden` | Popup visibility state |
| Clear All button | `"confirming"` or not set | Waiting for second click; attribute removed after timeout or delete |
| Annotation delete button | `"confirming"` or not set | Waiting for second click; attribute removed after timeout or delete |

### 14.3 Light DOM Attributes

| Attribute | Element | Location | Notes |
|-----------|---------|----------|-------|
| `data-air-id` | `<mark>` highlight elements | Light DOM | Links mark to text annotation ID |
| `data-air-element-id` | Any annotated element | Light DOM | Links element to element annotation ID. Applied as inline outline style. |
| `data-air-pulse` | `<mark>` or annotated element | Light DOM | Present during pulse animation (transient, ~900ms). Provides a stable, timing-independent test hook for verifying pulse behaviour. Used by both text and element highlights. |


## 15. XPath Serialisation

### 15.1 Format

- **Elements**: `/html[1]/body[1]/div[1]/p[2]` — tag names in lowercase, 1-indexed among same-tag siblings
- **Text nodes**: `/html[1]/body[1]/p[1]/text()[1]` — `text()` pseudo-selector, 1-indexed among sibling text nodes
- Positions count only siblings of the same type (same tag for elements, text nodes for text nodes)

### 15.2 Resolution

XPaths are resolved using `document.evaluate()` with `FIRST_ORDERED_NODE_TYPE`. Returns `null` on any error (malformed XPath, missing node).

### 15.3 Context Matching

The context matching algorithm:
1. Walks all text nodes in `document.body` using `TreeWalker`
2. Concatenates all text content into a single string with node boundary tracking
3. Finds all occurrences of `selectedText` in the concatenated text
4. Scores each match candidate by graduated context similarity using longest-boundary-match:
   - `contextBefore` score: the length of the longest suffix of `contextBefore` that matches the end of the text immediately preceding the match (0 to `contextBefore.length` points)
   - `contextAfter` score: the length of the longest prefix of `contextAfter` that matches the start of the text immediately following the match (0 to `contextAfter.length` points)
   - Total score ranges from 0 to `contextBefore.length + contextAfter.length` (typically 0–160)
   - Each matching context character contributes exactly 1 point, providing smooth gradient degradation
5. The candidate with the highest score is selected. On tie, the first occurrence wins.
6. **Minimum confidence threshold**: if `maxPossibleScore` (`contextBefore.length + contextAfter.length`) is greater than 0 and the best score is below `maxPossibleScore × MIN_CONFIDENCE_RATIO` (0.3), `null` is returned — the annotation falls through to Tier 3 (context-seam matching). When both context strings are empty (`maxPossibleScore === 0`), any match is accepted to preserve backward compatibility.
7. Returns the best-scoring match as a Range, or `null` if below the confidence threshold

**Context length**: Up to 80 characters are stored before and after the selection boundary. The `CONTEXT_LENGTH` constant is defined as `80`.

**Context extraction**: `contextBefore` and `contextAfter` are extracted by walking all text nodes within the nearest **block-level ancestor** of the selection boundary (e.g. `<p>`, `<div>`, `<li>`, `<h1>`–`<h6>`). Text content is concatenated across inline element boundaries (`<strong>`, `<em>`, `<a>`, `<code>`, etc.) but does not cross block-level boundaries. This means an annotation on "bold" inside `<p>Before <strong>bold</strong> after</p>` produces `contextBefore="Before "` and `contextAfter=" after"`. Text nodes inside `<script>`, `<style>`, and `<noscript>` elements are excluded from context extraction and all text node walks.

### 15.4 Context-Seam Matching

When context matching fails for both the original and replacement text, the context-seam algorithm provides a structural fallback that locates the annotation's position even when the annotated text has been completely rewritten:

1. Requires both `contextBefore` and `contextAfter` to be at least 3 characters long
2. Walks all text nodes in `document.body` (excluding `<script>`, `<style>`, `<noscript>`)
3. Concatenates all text content into a single string with node boundary tracking
4. Finds all positions where the full `contextBefore` string ends (exact substring match)
5. Finds all positions where the full `contextAfter` string begins (exact substring match)
6. For each (start, end) pair, computes the gap: `end - start`
7. Selects the pair with the smallest valid gap (at least 1 character, at most `MAX_GAP` of 500 characters)
8. Returns a Range covering the text between the two context anchors, or `null` if no valid pair exists

### 15.5 Range Re-anchoring

When a fallback tier (Tier 2.5 or Tier 3) successfully restores a highlight, the matched Range is re-serialised and the annotation's stored range data is updated via a PATCH request (see Section 8.4 for full details). The re-serialised range captures the current XPath, offset, selectedText, and context for the matched location, enabling Tier 1 restoration on subsequent page loads.


## 16. Error Handling

### 16.1 Strategy

| Scenario | Behaviour |
|----------|-----------|
| API unreachable | Console error, fall back to localStorage cache |
| JSON file missing | Return empty store |
| JSON file corrupted | Return empty store (silent recovery) |
| JSON schema invalid | Return empty store (silent recovery) |
| XPath resolution fails | Return null, try context matching |
| Context matching fails (original text) | Try replacement text if `replacedText` is set, otherwise try context-seam |
| Context matching fails (replacement text) | Try context-seam matching |
| Context-seam matching fails | Annotation becomes orphaned (Tier 4) |
| localStorage full | Silently ignore write error |
| Concurrent file writes | Queued via promise chain |
| Highlight application fails | Console error logged, continue with other annotations |
| CSS selector matches zero elements | Element annotation becomes orphaned (Tier 3) |
| CSS selector matches multiple elements | First match is used (no uniqueness re-verification at resolution time) |
| Alt+click on excluded element | Silently ignored (no popup shown) |
| Store poller network error | Silently ignored, continues polling on next interval (see 5.7.4) |
| Clipboard API unavailable | Fall back to execCommand, return false on total failure |
| Status update fails | Console error, toast notification "Failed to update status" |
| Invalid status value in PATCH | 400 error: "status must be one of: open, in_progress, addressed" |

### 16.2 Console Logging

Errors are logged with the prefix `[review-loop]` for easy filtering. No errors should appear during normal operation — the integration should not pollute the console.


## 17. Style Reference

### 17.1 Colour Palette

| Token | Value | Usage |
|-------|-------|-------|
| FAB background | `#D97706` | FAB button, active tab, accent colour |
| FAB hover | `#B45309` | FAB hover state |
| Badge background | `#EF4444` | Badge red circle |
| Panel background | `#1a1a1a` | Panel, popup, toast backgrounds |
| Panel text | `#e5e5e5` | Primary text colour |
| Panel border | `#333` | Borders and separators |
| Button background | `#2a2a2a` | Panel action buttons |
| Selected text | `#FCD34D` | Annotation text preview in panel/popup |
| Highlight background | `rgba(217,119,6,0.3)` | Mark background (30% opacity) |
| Highlight pulse | `rgba(217,119,6,0.6)` | Mark pulse animation (60% opacity) |
| Danger text | `#fca5a5` | Delete buttons, danger actions |
| Danger background | `#7f1d1d` | Delete button background |
| Orphan warning | `#F87171` | Orphaned annotation indicator |
| Inspector overlay background | `rgba(66,133,244,0.15)` | Blue tint on hovered element during Alt+hover |
| Inspector overlay border | `rgba(66,133,244,0.6)` | Blue border around hovered element |
| Inspector label background | `rgba(66,133,244,0.9)` | Blue background for tag label |
| Inspector label text | `white` | White text on tag label |
| Element highlight outline (open) | `rgba(217,119,6,0.8)` | Dashed amber outline on open annotated elements |
| Element highlight outline (addressed) | `rgba(59,130,246,0.5)` | Dashed blue outline on addressed annotated elements |
| Element highlight pulse outline | `rgba(217,119,6,1)` | Fully opaque amber outline during pulse |
| Element highlight pulse background | `rgba(217,119,6,0.15)` | Subtle amber background flash during pulse |
| Element highlight pulse glow | `rgba(217,119,6,0.3)` | Amber box-shadow glow during pulse (`0 0 0 4px`) |
| In-progress text highlight | `rgba(139,92,246,0.2)` | Purple background on in-progress text annotations |
| Addressed text highlight | `rgba(59,130,246,0.2)` | Blue background on addressed text annotations |
| In-progress element outline | `rgba(139,92,246,0.5)` | Dashed purple outline on in-progress annotated elements |
| Addressed badge text | `#3B82F6` | Blue text for addressed status badge |
| Addressed border | `#3B82F6` | Blue left border on addressed annotation items |
| Accept button background | `#166534` | Green background for Accept button |
| Accept button text | `#86EFAC` | Light green text for Accept button |

### 17.2 Z-Index Stack

| Layer | Z-Index | Element |
|-------|---------|---------|
| Panel | 9999 | `.air-panel` |
| FAB | 10000 | `.air-fab` |
| Popup | 10001 | `.air-popup` |
| Inspector overlay | 10002 | `.air-inspector-overlay` (light DOM) |
| Tooltip | 10002 | `.air-tooltip` |
| Toast | 10003 | `.air-toast` |

All z-index values are centralised in the `Z_INDEX` constant exported from `src/client/styles.ts`. The integration uses `z-index: 9999+` to position above typical site z-indexes (which conventionally stay below 9999).

### 17.3 Typography

- Font family: System stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)
- Base size: 14px
- Line height: 1.5


## 18. Accessibility

The integration provides accessibility support following WAI-ARIA patterns:

### 18.1 ARIA Semantics

- **Panel**: `role="complementary"`, `aria-label="Inline Review Panel"`
- **Tabs**: WAI-ARIA tabs pattern — `role="tablist"` on container, `role="tab"` on buttons with `aria-selected`, `role="tabpanel"` on content with `aria-labelledby`
- **Panel content**: `aria-live="polite"` on the content container so screen readers announce when the content refreshes (tab switches, annotation changes)
- **Popup**: `role="dialog"`, `aria-modal="true"`, `aria-label="Add annotation"`
- **Toast**: `role="status"`, `aria-live="polite"` — used for success messages (e.g. "Copied to clipboard!") and error feedback (e.g. "Failed to save annotation")
- **FAB**: `aria-label` dynamically updated to include count (e.g. "Toggle inline review (3 annotations)"), `title="Inline Review"`

### 18.2 Focus Management

- **Panel open**: Focus moves to first focusable element in panel
- **Panel close** (FAB toggle or Escape): Focus returns to FAB
- **Popup**: Focus trap cycles through textarea and buttons via Tab/Shift+Tab
- **Popup dismiss**: Focus returns to previously focused element
- **Popup/page note textareas**: Auto-focused on open via `requestAnimationFrame(() => textarea.focus())`

### 18.3 Keyboard Navigation

- **Annotation items**: `tabindex="0"` with Enter/Space activation (triggers onAnnotationClick)
- **Escape**: Closes popup (priority) or panel

### 18.4 Motion

- **`prefers-reduced-motion: reduce`**: All animations and transitions reduced to 0.01ms

### 18.5 Out of Scope

The following accessibility features are not yet implemented:
- High contrast mode support


## 19. UX Improvements

**Status**: Implemented (2026-02-21)

### 19.1 FAB Icon — Clipboard Instead of Pencil

**Problem**: The pencil icon creates a false affordance — it suggests "click to start annotating" when annotation mode is always active via text selection. The FAB actually toggles the review sidebar.

**Solution**: Replace the pencil icon with a clipboard/notes icon that better communicates "view your review notes".

**Implementation** (done):
- Replaced `PENCIL_ICON` with `CLIPBOARD_ICON` in `fab.ts` — Material Design clipboard SVG
- `aria-label` dynamically includes annotation count (e.g. "Toggle inline review (3 annotations)"); `title` unchanged ("Inline Review")
- Plus/X icon (open state) unchanged

### 19.2 First-Use Tooltip

**Problem**: New users don't know that text selection triggers annotation — they click the FAB expecting to "start annotating" and see an empty panel.

**Solution**: Show a one-time tooltip near the FAB on first visit that says "Select any text on the page to annotate it". Dismissed on click or after a timeout, and never shown again.

**Implementation** (done):
- On `init()`, checks `localStorage` for `air-tooltip-dismissed` key
- Creates tooltip element inside the shadow root, positioned above the FAB (bottom-right, 80px from bottom)
- Tooltip text: "Select text to annotate it, or Alt+click any element"
- `data-air-el="first-use-tooltip"` for test automation
- `id="air-tooltip"`, `role="tooltip"` for ARIA semantics; the FAB has `aria-describedby="air-tooltip"` while the tooltip is visible (removed on dismiss)
- Dismissed on: click anywhere (document or shadow root), or after 8 seconds auto-fade
- On dismiss, the `air-tooltip--hidden` class is added (triggering a CSS opacity fade-out), then the element is removed from the DOM after a 300ms timeout to allow the transition to complete
- On dismiss, sets `localStorage.setItem('air-tooltip-dismissed', '1')`
- Idempotent — guarded against double-dismiss via `dismissed` boolean
- Styled consistently with existing dark theme, amber border to match FAB

### 19.3 Empty State Enhancement — Directional Arrow

**Problem**: When the panel is open with no annotations, the empty state text says "No annotations on this page yet. Select text to get started." but there's no visual cue directing the user toward the page content.

**Solution**: Add a small left-pointing arrow (←) to the empty state message, visually guiding the user toward the page content outside the panel.

**Implementation** (done):
- Added `<span class="air-panel__empty-arrow" data-air-el="empty-arrow">←</span>` before the empty state text in `renderThisPage()`
- Arrow is amber (`#D97706`), 28px, with `air-nudge` CSS animation (gentle horizontal bounce, 1.5s infinite)
- "All Pages" empty state unchanged (different context)


---


## Appendix A: Action-Response Quick Reference

| User Action | System Response | Key Sections |
|-------------|----------------|--------------|
| Select text on page | Popup appears near selection | 7.1, 6.3 |
| Click Save in popup (text) | Text annotation created, highlight applied, badge updated | 7.1, 8.1, 6.1 |
| Click Cancel in popup | Popup dismissed, selection cleared | 6.3 |
| Click existing highlight | Edit popup appears with pre-filled note | 7.2, 6.3 |
| Click Delete in edit popup | Annotation deleted, highlight removed | 7.2, 8.2 |
| Hold Alt key | Inspector overlay activates, elements highlighted on hover | 6.5 |
| Alt+click element | Element captured, popup appears with element description | 7.5, 6.5 |
| Click Save in popup (element) | Element annotation created, outline highlight applied, badge updated | 7.5, 8.5, 6.1 |
| Click element with outline | Edit popup appears for element annotation | 7.6, 6.3 |
| Release Alt key | Inspector overlay removed | 6.5 |
| Click FAB | Panel toggles open/closed | 6.1, 6.2 |
| Click text annotation in panel | Page scrolls to highlight, highlight pulses | 6.2.3, 8.3 |
| Click element annotation in panel | Page scrolls to element, outline pulses | 6.2.3a, 8.5.3 |
| Click "+ Note" in panel | Add-note form appears/toggles | 11.2 |
| Click "Copy All" in panel | Export all annotations to clipboard, show toast | 9.3 |
| Click Accept on addressed annotation | Annotation is deleted entirely (removed from store, highlights cleared) | 6.2.3c |
| Click Reopen on addressed annotation | Shows inline form for optional follow-up note, then reopens | 6.2.3c |
| Click Delete on annotation in panel | Two-click confirmation: first click shows "Sure?", second click deletes | 6.2.3, 6.2.3a |
| Click "Clear All" in panel | Confirmation step, then deletes all | 6.2.5 |
| Press Escape | Dismiss popup (priority) or close panel | 10.4 |
| Press Cmd/Ctrl+Shift+. | Toggle panel | 10.1 |
| Page reload | Highlights restored from server (text + element) | 8.4, 8.5.4, 8.7 |
| Navigate to different page | Badge updates, highlights re-applied | 12.2 |
| Agent calls `finish_work` MCP tool | Annotation status set to addressed; store poller detects fingerprint change within 2s, restores highlights and refreshes panel if open | 4.3.2, 3.2.5, 5.7 |
| `astro build` | Zero traces in output | 13 |
