# review-loop

[![CI](https://github.com/viv/review-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/viv/review-loop/actions/workflows/ci.yml)
[![Acceptance Tests](https://github.com/viv/review-loop/actions/workflows/acceptance.yml/badge.svg)](https://github.com/viv/review-loop/actions/workflows/acceptance.yml)
[![CodeQL](https://github.com/viv/review-loop/actions/workflows/codeql.yml/badge.svg)](https://github.com/viv/review-loop/actions/workflows/codeql.yml)
[![npm version](https://img.shields.io/npm/v/review-loop)](https://www.npmjs.com/package/review-loop)
[![npm downloads](https://img.shields.io/npm/dm/review-loop)](https://www.npmjs.com/package/review-loop)
[![node](https://img.shields.io/node/v/review-loop)](package.json)
[![licence](https://img.shields.io/npm/l/review-loop)](LICENSE)

A dev-only annotation overlay that bridges human reviewers and AI coding agents. Browse your rendered site, annotate what needs changing, and let your coding agent act on the feedback directly via [MCP](https://modelcontextprotocol.io) — no copy-paste, no hunting through source files.

Works with [Astro](https://astro.build), any [Vite](https://vite.dev)-based framework (SvelteKit, Nuxt, Remix), and [Express](https://expressjs.com)/Connect servers. Ships **zero bytes** in production.

## Overview

Reviewing a live site and turning that into actionable code changes is tedious. You spot a typo, an awkward heading, a paragraph that needs rewriting — but translating "that bit on the homepage, third section down" into a precise instruction means switching context, finding the right file, and describing what you saw.

**review-loop** keeps you in the browser. Select text, write your note, move on. Your coding agent reads the annotations directly and acts on them.

```
Human reviewer                    AI coding agent
──────────────                    ───────────────
1. Browse site during dev
2. Select text or Alt+click
   elements, attach notes
                          ───────►
                                  3. Read annotations via MCP
                                  4. Edit source files
                                  5. Mark annotations addressed
                          ◄───────
6. See status updates and
   agent replies in the panel
7. Confirm or re-annotate
```

## Why MCP-First

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) is the primary integration path. MCP lets your coding agent connect to the annotation store and work through feedback autonomously:

- **No copy-paste** — the agent reads annotations directly from `inline-review.json`
- **Rich context** — each annotation carries the page URL, exact text, XPath ranges, and surrounding context
- **Closed loop** — the agent marks annotations as addressed, adds reply messages, and updates replaced text — the reviewer sees all of this in the browser panel
- **Status lifecycle** — annotations progress through `open` → `in_progress` (agent working) → `addressed` (agent acted). Reviewers then Accept (delete) or Reopen with follow-up notes

A secondary **Markdown export** is also available for agents that don't support MCP, or for sharing feedback outside agent workflows. See [Markdown Export](#markdown-export).

## Quickstart

**Prerequisites:** Node.js >= 20 and an MCP-compatible coding agent (Claude Code, Cursor, Windsurf, etc.)

### 1. Install

```bash
npm install -D review-loop
```

### 2. Add the integration

<details open>
<summary><strong>Astro</strong></summary>

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import inlineReview from 'review-loop';

export default defineConfig({
  integrations: [inlineReview()],
});
```

</details>

<details>
<summary><strong>Vite</strong> (SvelteKit, Nuxt, Remix, etc.)</summary>

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import inlineReview from 'review-loop/vite';

export default defineConfig({
  plugins: [inlineReview()],
});
```

The Vite plugin uses `transformIndexHtml` to inject the client script automatically.

</details>

<details>
<summary><strong>Express / Connect</strong></summary>

```javascript
import express from 'express';
import { inlineReview } from 'review-loop/express';

const app = express();
const { apiMiddleware, clientMiddleware } = inlineReview();

app.use(apiMiddleware);
app.use(clientMiddleware);

// Add to your HTML template:
// <script type="module" src="/__inline-review/client.js"></script>
```

Express users add a single `<script>` tag to their HTML template — the `clientMiddleware` serves the bundled client JS. In monorepo setups where `process.cwd()` may differ from the project root, pass `storagePath` explicitly.

</details>

The only option is `storagePath` (defaults to `'inline-review.json'` in the project root). Annotations are persisted to this file — commit it for shared review, or add it to `.gitignore` for personal use. The browser UI, REST API, and MCP server all read and write the same file.

### 3. Connect your agent via MCP

Add a `.mcp.json` file to your project root:

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

Claude Code reads `.mcp.json` on startup and discovers the annotation tools automatically. The `--storage` flag is optional and defaults to `./inline-review.json`. For other MCP clients, see the [MCP Guide](docs/guides/mcp.md).

### 4. Annotate and go

1. Start your dev server and browse your site
2. **Select text** — a popup appears to add a note about what needs changing
3. **Alt+click elements** — annotate cards, images, buttons, or layout sections
4. **Add page notes** for broader feedback via the panel
5. Your agent reads the annotations via MCP and starts working
6. Check the **slide-out panel** (click the FAB or `Cmd/Ctrl+Shift+.`) to see agent replies and status updates

## Usage

### Agent workflow (MCP)

Once connected via MCP, the agent follows a three-step workflow:

1. Calls `list_annotations` to see all feedback (annotations + page notes) with page URLs and selected text
2. Calls `start_work` on an annotation — gets full detail and signals "working on it" to the browser UI
3. Makes source code changes based on annotation context
4. Calls `finish_work` to mark the annotation as addressed, optionally recording the replacement text and a reply message

The reviewer sees status updates and agent replies in the browser panel in real time.

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Shift + .` | Toggle review panel |
| `Cmd/Ctrl + Shift + E` | Export to clipboard |
| `Cmd/Ctrl + Shift + N` | Add page note |
| `Escape` | Close active UI (popup or panel) |

Shortcuts are suppressed when focus is in an input, textarea, or contentEditable element (except Escape, which always fires).

### Features

- **Text annotations.** Select any text on the page and attach a note.
- **Element annotations.** Alt+click any element (images, buttons, sections) to annotate it.
- **Page notes.** Add free-text notes scoped to a page, not tied to a selection.
- **MCP server.** Coding agents connect via MCP to read, resolve, and reply to annotations.
- **Status lifecycle.** Annotations track `open` → `in_progress` → `addressed` states, with Accept/Reopen terminal actions.
- **Persistent.** Annotations survive page reloads, navigation, and dev server restarts.
- **Multi-page.** Annotations are scoped by URL but viewable across all pages.
- **Shadow DOM isolation.** All UI is isolated from your site's styles.

## MCP Server

The MCP server lets coding agents read and respond to annotations directly — no dev server required. Setup is covered in [Quickstart step 3](#3-connect-your-agent-via-mcp).

For MCP clients other than Claude Code, configure the stdio transport manually:

- **Command**: `node`
- **Arguments**: `["./node_modules/review-loop/dist/mcp/server.js", "--storage", "./inline-review.json"]`
- **Transport**: stdio
- **Working directory**: your Astro project root

### Available tools

The MCP server exposes three tools that guide agents through a **list → start → finish** workflow:

| Tool | Description |
|------|-------------|
| `list_annotations` | List all feedback (annotations + page notes), optionally filtered by page URL and/or status |
| `start_work` | Get full annotation detail and atomically set status to `in_progress` |
| `finish_work` | Mark as addressed, optionally update anchor text and add a reply message |

See [MCP Guide](docs/guides/mcp.md) for detailed tool reference and workflow documentation.

## Markdown Export

For agents that don't support MCP, or for sharing feedback outside agent workflows, a Markdown export is available via the "Copy All" button in the panel or the REST API (`GET /__inline-review/api/export`).

The export groups annotations by page:

```markdown
# Inline Review — Copy Annotations
Exported: 2026-02-21 14:30

---

## / — Home Page

### Page Notes
- Consider restructuring the hero section — the CTA is below the fold

### Text Annotations
1. **"We've been building software since 2001"**
   > This is vague. Replace with specific achievements or a concrete claim.

2. **"Loren ipsum dolor"**
   > Placeholder text still in production copy — replace with real content

---

## /about — About

### Text Annotations
1. **"Our team of rockstar ninjas"**
   > Rewrite in a professional tone
```

Paste this into any coding agent chat and it has the context to act.

## How It Works

The integration registers a [Vite dev server middleware](https://vite.dev/guide/api-plugin.html#configureserver) that serves a REST API at `/__inline-review/api/*` and injects a client script on every page. The client uses Shadow DOM for UI isolation and stores annotations via the API to a local JSON file.

See [docs/spec/specification.md](docs/spec/specification.md) for the full component specification.

## Troubleshooting

### MCP connection failures

- Ensure you've run `npm run build` (or `npm install` — the package ships pre-built) — the server runs from `dist/mcp/server.js`
- Check that the path in `.mcp.json` is correct relative to the project root
- Verify Node.js >= 20 is available in your PATH
- Some MCP clients cache tool lists — restart the agent or reconnect the MCP server

### Agent not seeing annotations

- Check that `inline-review.json` exists and contains annotations
- If using a custom `--storage` path, verify it points to the correct file
- The MCP server reads from disk on every call — if the file was just created, it should be picked up immediately

### Panel not showing

- Ensure you're running in dev mode — the overlay is not injected in production or preview builds
- Look for an orange floating action button in the bottom-right corner
- For Express: check that both `apiMiddleware` and `clientMiddleware` are registered, and the `<script>` tag is in your HTML
- Check the browser console for errors

### Common environment issues

- **Node version**: requires >= 20. Check with `node --version`
- **Astro version**: requires ^5.0.0 (Astro adapter only)
- **Vite version**: requires ^5.0.0 or ^6.0.0 (Vite adapter only)
- **ESM-only**: the package uses `"type": "module"` — ensure your tooling supports ESM

## FAQ

**Does this ship anything to production?**
No. The Astro and Vite adapters only activate during dev. For Express, you control when the middleware is mounted — simply don't use it in production.

**Do I need the dev server running for MCP to work?**
No. The MCP server reads directly from `inline-review.json`. The dev server is only needed for the browser annotation UI.

**Can multiple reviewers annotate the same project?**
Yes. Annotations are stored in `inline-review.json`. Commit the file for shared review, or add it to `.gitignore` for personal use.

**What agents support MCP?**
Claude Code, Cursor, Windsurf, and other MCP-compatible agents. See [modelcontextprotocol.io](https://modelcontextprotocol.io) for an up-to-date list.

## Examples

The `examples/` directory contains minimal projects for each supported framework:

| Directory | Framework | How to run |
|-----------|-----------|------------|
| `examples/astro/` | Astro | `npm install && npm run dev` |
| `examples/vite/` | Vite (plain) | `npm install && npm run dev` |
| `examples/express/` | Express | `npm install && npm run dev` |

Each example includes two pages with navigation links so you can test multi-page annotation (annotations scoped by URL, panel showing all pages).

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

The acceptance test suite lives in a separate repository: [review-loop-tests](https://github.com/viv/review-loop-tests).

## Alternatives

[astro-annotate](https://github.com/jan-nikolov/astro-annotate) is a similar Astro integration built independently around the same time. Both tools solve the same core problem — annotating a rendered Astro site and producing structured output for coding agents — but take different approaches:

| | review-loop | astro-annotate |
|---|---|---|
| **Selection model** | Text selection + element selection (Alt+click) | Element selection (annotate whole HTML elements) |
| **Agent integration** | MCP server (primary) + Markdown export | JSON file |
| **Location tracking** | XPath ranges with surrounding context | CSS selectors (IDs, data-testid, tag+class) |
| **Status tracking** | open → in_progress → addressed, with agent replies via MCP | open/resolved status per annotation |
| **Device tagging** | No | Yes, desktop/mobile/tablet with viewport dimensions |
| **Deployment model** | Dev-only by design | Dev-only now, deployed mode planned (Cloudflare Pages) |

**Choose review-loop** if you want a tight feedback loop between human reviewers and coding agents. The MCP integration lets agents read, act on, and resolve annotations without copy-paste.

**Choose astro-annotate** if you're collecting UI/layout feedback from clients or stakeholders and want device-tagged element-level annotations.

---

[Vibe Annotations](https://www.vibe-annotations.com/) is a Chrome extension + MCP server that takes a framework-agnostic approach to the same problem:

| | review-loop | Vibe Annotations |
|---|---|---|
| **Delivery** | Framework integration (zero-config, auto-injected) | Chrome extension + separate MCP server |
| **Framework support** | Astro, Vite (SvelteKit/Nuxt/Remix), Express/Connect | Any localhost dev server |
| **Selection model** | Text selection + element selection (Alt+click) | Element click only |
| **MCP transport** | stdio | SSE |
| **Status lifecycle** | open → in_progress → addressed, with agent replies | Read → implement → delete (batch cycle) |
| **Persistence** | JSON file in project root (survives restarts, committable) | Server-side (cleared per cycle) |

**Choose review-loop** if you need text-level precision for copy review, a persistent status lifecycle with agent replies, or zero-install setup for Astro projects.

**Choose Vibe Annotations** if you need framework-agnostic coverage today and element-level annotation is sufficient for your workflow.

## Licence

[MIT](LICENSE)
