# review-loop

Dev-only annotation overlay that bridges human reviewers and AI coding agents. Works with Astro, Vite-based frameworks (SvelteKit, Nuxt, Remix), and Express/Connect. Reviewers annotate the site in-browser; annotations persist to a JSON file. Ships zero bytes in production.

## Architecture

- **Client**: Shadow DOM UI injected via `injectScript('page', ...)` — FAB, panel, popup, highlights
- **Server**: Vite dev middleware at `/__inline-review/api/*` — CRUD REST API
- **Storage**: Single JSON file (`inline-review.json`) in project root via `ReviewStorage` class
- **Types**: Canonical definitions in `src/shared/types.ts`, re-exported by `src/types.ts` and `src/client/types.ts`
- **Dismissal**: The panel includes per-annotation delete buttons (two-click confirmation: "Sure?" then delete) and orphan indicators for annotations whose target elements have changed (content modified or removed). The popup dismisses on scroll only after 50px threshold.

## Agent Integration — Reading Annotations

The annotation store is a single JSON file at the project root:

```
inline-review.json
```

This file is the source of truth. `ReviewStorage` reads from disk on every call (no in-memory cache), so external edits are picked up immediately.

### Schema

```json
{
  "version": 1,
  "annotations": [
    {
      "id": "string",
      "type": "text | element",
      "pageUrl": "/path",
      "pageTitle": "Page Title",
      "note": "reviewer's comment",
      "createdAt": "ISO 8601",
      "updatedAt": "ISO 8601",
      "status": "open | in_progress | addressed (optional, derived from timestamps if absent)",
      "inProgressAt": "ISO 8601 (optional)",
      "addressedAt": "ISO 8601 (optional)",
      "replies": [{ "message": "string", "createdAt": "ISO 8601", "role": "agent | reviewer (optional, defaults to agent)" }],
      "selectedText": "quoted text (text annotations only)",
      "replacedText": "text that replaced the original (optional, text annotations only)",
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

### Reading annotations as an agent

To read review annotations, parse `inline-review.json` from the project root. Each annotation has:

- `pageUrl` — the route path (e.g., `/about`)
- `note` — the reviewer's comment describing what to change
- `type: "text"` — includes `selectedText` and `range` for locating the exact text; optionally `replacedText` if the agent changed the text
- `type: "element"` — includes `elementSelector` with `cssSelector`, `xpath`, and `outerHtmlPreview`
- `status` — lifecycle state: `open` → `in_progress` (agent working) → `addressed` (agent acted on it, awaiting human review). Terminal actions: Accept (deletes annotation) or Reopen (back to open). Derived from timestamps if absent for backward compatibility
- `pageNotes` — general notes about a page, not tied to specific elements

### REST API (when dev server is running)

Base: `http://localhost:4321/__inline-review/api`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/annotations` | List all (optional `?page=/path` filter) |
| GET | `/annotations?page=/path` | Filter by page URL |
| POST | `/annotations` | Create annotation |
| PATCH | `/annotations/:id` | Update note, replacedText, status (incl. in_progress), and/or reply |
| DELETE | `/annotations/:id` | Delete annotation |
| GET | `/page-notes` | List all page notes |
| POST | `/page-notes` | Create page note |
| PATCH | `/page-notes/:id` | Update note only |
| DELETE | `/page-notes/:id` | Delete page note |
| GET | `/version` | Lightweight fingerprint for polling (`{ fingerprint: "count:timestamp" }`) |
| GET | `/export` | Markdown export (text/markdown) |

## MCP Server — Structured Agent Access

The `.mcp.json` file at the project root enables auto-discovery for Claude Code and other MCP-compatible agents. The MCP server reads the same `inline-review.json` as the browser UI — no dev server required.

### Available Tools

| Tool | Description |
|------|-------------|
| `list_annotations` | List all annotations, optionally filtered by `pageUrl` |
| `list_page_notes` | List all page-level notes, optionally filtered by `pageUrl` |
| `get_annotation` | Get a single annotation by ID with full detail |
| `get_export` | Get a markdown export of all annotations and page notes |
| `address_annotation` | Mark an annotation as addressed by the agent. Optionally provide `replacedText` to record what text replaced the original |
| `add_agent_reply` | Add a reply to an annotation explaining what action was taken |
| `update_annotation_target` | Update what text replaced the original annotated text (text annotations only) |
| `set_in_progress` | Signal that the agent is about to start working — sets status to `in_progress` so the UI shows a working indicator instead of orphan warnings |

### Running manually

```sh
node ./dist/mcp/server.js --storage ./inline-review.json
```

The `--storage` flag is optional and defaults to `./inline-review.json` relative to the working directory.

## Development

- **Build**: `npm run build` (tsup — server ESM + client browser bundle)
- **Lint**: `npm run lint` (ESLint with typescript-eslint, flat config)
- **Test**: `npm test` (vitest — client with happy-dom, server with node)
- **Watch**: `npm run dev` / `npm run test:watch`
- Runtime dependencies: `@modelcontextprotocol/sdk`, `zod` (for MCP server only); `astro ^5.0.0` peer dependency
- ESM-only package (`"type": "module"`)

## Releasing

Releases are tag-triggered. Pushing a `v*` tag to GitHub runs the release workflow which publishes to npm with provenance and creates a GitHub Release. See `docs/guides/release.md` for the full process.

```bash
npm version <major|minor|patch|1.0.0> -m "chore: release v%s"
git push origin main --tags
```

- Authentication uses OIDC trusted publishing — no tokens or secrets to manage
- The `prepublishOnly` script guards against accidental local publishes
- Version in `package.json` must match the tag or the workflow fails

## Architecture Decision Records

Significant architectural decisions are documented in `docs/adr/`. When implementing a change that involves a non-obvious trade-off, closes off alternatives, or would make a future contributor ask "why did you do it this way?", prompt the user to record an ADR. Reference existing ADRs in commit messages where relevant (e.g., "See: ADR-004").

## Key File Paths

- `src/shared/types.ts` — canonical type definitions
- `src/server/storage.ts` — `ReviewStorage` class (JSON file I/O)
- `src/server/middleware.ts` — REST API middleware + server-side export
- `src/client/export.ts` — client-side markdown export
- `src/client/orphan-tracker.ts` — grace period tracker for orphaned annotations during agent work
- `src/index.ts` — main entry point (re-exports Astro adapter)
- `src/integrations/astro.ts` — Astro integration adapter
- `src/integrations/vite.ts` — standalone Vite plugin adapter (`review-loop/vite`)
- `src/integrations/express.ts` — Express/Connect adapter (`review-loop/express`)
- `src/mcp/server.ts` — MCP server entry point (CLI argument parsing, tool registration)
- `src/mcp/types.ts` — shared MCP tool result types (ToolResult, ErrorResult)
- `src/mcp/tools/` — individual MCP tool handlers
- `.mcp.json` — MCP auto-discovery configuration
- `docs/spec/specification.md` — full component specification
- `docs/adr/` — architecture decision records
