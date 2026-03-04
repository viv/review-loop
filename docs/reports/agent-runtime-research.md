# Research: Agent Runtime Architecture — From Embedded Component to Browser-Native Runtime

**Date:** 2026-03-04
**Status:** Research / RFC
**Scope:** Complete architectural pivot from embedded Shadow DOM overlay to an agent runtime model

---

## Executive Summary

review-loop currently operates as an **embedded dev-only component** — a Shadow DOM overlay injected into the host page via Vite/Astro/Express integration, backed by a JSON file store and an MCP server for agent access. This document researches a fundamental architectural shift: moving from the embedded component model to an **agent runtime** that controls a browser, potentially embedded in a Chromium-based application.

This shift would change review-loop from "a UI you add to your dev server" to "a browser you use to review sites", opening capabilities like visual regression, autonomous annotation verification, multi-page crawling, and deep AI agent integration.

---

## 1. Current Architecture (Baseline)

### Component Model

```
┌─────────────────────────────────────────────────────┐
│  Host Page (user's Astro/Vite/Express app)          │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Shadow DOM Host (#review-loop-host)            │ │
│  │  ├── FAB (floating action button)               │ │
│  │  ├── Panel (annotation list, tabs, export)      │ │
│  │  ├── Popup (annotation editor)                  │ │
│  │  └── Toast (notifications)                      │ │
│  └─────────────────────────────────────────────────┘ │
│  <mark> highlights in light DOM                      │
│  Element outlines via inline styles                  │
├─────────────────────────────────────────────────────┤
│  Vite Dev Server                                     │
│  └── /__inline-review/api/* (REST middleware)        │
├─────────────────────────────────────────────────────┤
│  inline-review.json (disk)                           │
├─────────────────────────────────────────────────────┤
│  MCP Server (stdio subprocess)                       │
│  └── list_annotations / start_work / finish_work     │
└─────────────────────────────────────────────────────┘
```

### Key Characteristics

- **Injection model**: Client JS is injected via `injectScript('page', ...)` (Astro) or `transformIndexHtml` (Vite)
- **Shadow DOM isolation**: All UI lives in a shadow root; highlights live in light DOM (ADR-001)
- **JSON file store**: Single `inline-review.json`, read from disk on every call, write-queued (ADR-002)
- **Dev-only**: Ships zero bytes in production; only active during `astro dev` / Vite serve
- **MCP integration**: stdio-based MCP server reads same JSON file (ADR-004)
- **Framework coupling**: Requires integration adapter per framework (Astro, Vite, Express)

### Limitations of Current Model

1. **Framework dependency** — Must maintain adapters for each framework
2. **Dev server required** — REST API only works while dev server runs (MCP works independently)
3. **Same-page constraint** — Can only annotate pages the user navigates to manually
4. **No visual regression** — Cannot screenshot, diff, or verify visual changes
5. **No autonomous navigation** — Agent cannot browse the site to verify its own changes
6. **Style interference risk** — Light DOM highlights can be affected by host page CSS
7. **Single-page context** — No way to batch-review or crawl multiple pages programmatically

---

## 2. Agent Runtime Models — Landscape Research

### 2.1 Browser-Use (Open Source)

**GitHub**: [browser-use/browser-use](https://github.com/browser-use/browser-use)

Python framework making websites accessible to AI agents, built on Playwright. Uses Chromium under the hood.

- AI agent recognizes UI elements semantically (not by CSS selectors)
- Install: `uv add browser-use` + `uvx browser-use install` for Chromium
- 21,000+ GitHub stars, active community
- **Relevance**: Demonstrates the pattern of an AI agent controlling a browser externally rather than being embedded in a page

### 2.2 Playwright MCP Server

**GitHub**: [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)

Microsoft's MCP server providing browser automation via the accessibility tree (not screenshots/vision).

- Uses **structured accessibility snapshots** — fast, deterministic, no vision model needed
- Supports headless/headful, multiple browsers
- Already integrated with VS Code Copilot, Cursor, Claude Desktop
- **Playwright Test Agents**: Planner → Generator → Healer pipeline for autonomous test creation
- **Key insight**: Accessibility tree is more reliable than raw DOM for AI interaction
- **Relevance**: Could serve as the browser control layer for review-loop's agent runtime

### 2.3 Chrome DevTools MCP

**Launched**: September 2025 (public preview)

Google's MCP server giving AI agents full Chrome DevTools access.

- 26 tools across 6 categories: Browser, DOM/CSS, Performance, Network, Console, Interaction
- `get_dom_snapshot`, `get_css_info`, `take_screenshot`, `evaluate_script`
- Uses CDP under the hood
- **Relevance**: Could provide the deep DOM inspection needed for annotation verification — checking whether agent changes actually rendered correctly

### 2.4 Stagehand (Browserbase)

**GitHub**: [browserbase/stagehand](https://github.com/browserbase/stagehand)

AI browser automation framework with atomic primitives: `act`, `extract`, `observe`.

- v3 (2025): CDP-native, self-healing, auto-caching, 44% faster
- Hybrid modes: DOM-based + coordinate-based (CUA) + combined
- MCP integration for external tools
- Cloud browser infrastructure via Browserbase
- **Relevance**: The `observe` + `extract` primitives map well to annotation verification ("observe this element, extract its current text, compare to expected")

### 2.5 Vercel Agent-Browser

**GitHub**: [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)

CLI tool for AI agents with a daemon architecture.

- Daemon stays running after first command → near-instant subsequent commands
- Experimental Rust daemon speaking CDP directly (no Node.js/Playwright)
- **Relevance**: The daemon pattern is interesting for review-loop — a persistent browser process that agents connect to

### 2.6 Agentic Browsers (Full Products)

Full Chromium-based browsers with native AI integration:

- **ChatGPT Atlas** (OpenAI, Oct 2025) — standalone Chromium browser with ChatGPT
- **Perplexity Comet** (Jul 2025) — Chromium + Perplexity search
- **Fellou** — task automation browser
- **Opera Neon** — Chromium + AI assistant + automation

These represent the end-state vision: browsers built for AI agents, not browsers with AI bolted on.

---

## 3. Chromium Embedding Technologies

### 3.1 Electron

**Maturity**: Very high | **Ecosystem**: Massive | **Bundle**: ~100MB+

- Bundles full Chromium + Node.js
- Rich IPC (main ↔ renderer processes)
- Used by VS Code, Slack, Discord, Notion
- Full access to Node.js APIs from main process
- Can embed multiple BrowserViews/WebContents for multi-page review
- **For review-loop**: Could host both the review UI and the target site in separate webviews. Main process runs storage, MCP server, and agent coordination.

### 3.2 Tauri v2

**Maturity**: Growing rapidly | **Bundle**: ~2.5MB | **Backend**: Rust

- Uses OS native WebView (WebView2 on Windows, WebKit on macOS)
- 10x smaller bundles, 10x less memory than Electron
- Rust plugin system, IPC via Invoke commands
- **Caveat**: WebView fragmentation across platforms — different rendering engines per OS
- **For review-loop**: Lighter deployment, but WebView inconsistency could affect annotation accuracy. No guaranteed Chromium.

### 3.3 Playwright (as Runtime)

**Maturity**: Very high | **Protocol**: CDP + WebDriver BiDi

- Not an app framework — a browser automation library
- Can launch persistent browser contexts
- Rich DOM interaction API: selectors, screenshots, network interception
- **For review-loop**: Use Playwright to launch and control a Chromium instance. The review UI could be a separate window or a Chrome extension sideloaded into the controlled browser.

### 3.4 Puppeteer

**Maturity**: High | **Protocol**: CDP (Chrome-specific)

- Chrome/Chromium-only (Firefox experimental)
- Deep CDP integration
- Puppeteer 24+ defaults to WebDriver BiDi
- **For review-loop**: Similar to Playwright but Chrome-specific. Less cross-browser but deeper Chrome integration.

### 3.5 Chrome Extension + Native Messaging

**Maturity**: High | **Architecture**: Extension ↔ Native Host ↔ Agent

The **Claude browser extension** demonstrates this pattern:
- MV3 extension with service worker + content scripts + side panel
- `chrome.runtime.connectNative()` bridges to Claude Desktop/Code
- MCP tools operate on browser tabs via the native messaging channel
- **For review-loop**: A Chrome extension could replace the injected Shadow DOM UI. The extension's content script handles highlights; the side panel hosts the annotation panel; native messaging connects to the MCP server and AI agents.

### 3.6 WebDriver BiDi

**Maturity**: Standard in progress | **Protocol**: W3C WebSocket-based

- Bidirectional protocol replacing CDP for cross-browser automation
- Real-time event push (network, console, DOM mutations)
- Adopted by Selenium, Puppeteer 24+, Cypress 14+, WebdriverIO v9
- **For review-loop**: Future-proof protocol choice for browser control. Cross-browser unlike CDP.

### Comparison Matrix

| Technology | Bundle Size | Cross-Browser | DOM Access | Agent Integration | Deployment |
|---|---|---|---|---|---|
| **Electron** | ~100MB | Chromium only (guaranteed) | Full (via IPC) | Node.js native | Desktop installer |
| **Tauri v2** | ~2.5MB | OS WebView (varies) | Via Invoke IPC | Rust + JS bridge | Desktop installer |
| **Playwright** | Runtime dep | Chromium/FF/WebKit | Full API | MCP server exists | npm package |
| **Puppeteer** | Runtime dep | Chromium only | Full CDP | Manual integration | npm package |
| **Chrome Extension** | ~1MB | Chrome/Edge | Content scripts | Native messaging | Web Store / sideload |
| **WebDriver BiDi** | Protocol | All major (emerging) | Via protocol | Emerging | Library-level |

---

## 4. Proposed Agent Runtime Architectures

### Architecture A: Playwright-Controlled Browser + Review Extension

```
┌──────────────────────────────────────────────────────────┐
│  Agent Runtime (Node.js process)                         │
│  ├── ReviewStorage (inline-review.json)                  │
│  ├── MCP Server (agent tools)                            │
│  ├── Playwright Browser Controller                       │
│  │   ├── Navigate / screenshot / DOM query               │
│  │   ├── Verify agent changes visually                   │
│  │   └── Multi-page crawl & annotate                     │
│  └── WebSocket server (runtime ↔ extension comms)        │
├──────────────────────────────────────────────────────────┤
│  Chromium Instance (launched by Playwright)               │
│  ├── Target site pages (user navigates normally)          │
│  ├── Review Extension (sideloaded)                        │
│  │   ├── Content Script: highlights, selection, element   │
│  │   ├── Side Panel: annotation list, status, replies     │
│  │   └── Service Worker: WebSocket bridge to runtime      │
│  └── DevTools Protocol access (screenshots, DOM, a11y)   │
└──────────────────────────────────────────────────────────┘
```

**How it works:**
1. User runs `npx review-loop browse http://localhost:4321`
2. Runtime launches Chromium via Playwright with review extension sideloaded
3. User browses and annotates normally via the extension UI
4. Extension communicates with runtime via WebSocket (not HTTP REST)
5. Agent connects via MCP, can also ask runtime to navigate, screenshot, verify
6. Runtime can autonomously crawl pages to verify agent work

**Pros:**
- No framework adapters needed — works with any site at any URL
- Agent can verify its own work (navigate to page, screenshot, compare)
- Multi-page crawling for batch review
- Accessibility tree available for smart element matching
- Extension side panel provides better UX than Shadow DOM overlay
- Dev server independence — can review deployed staging sites too

**Cons:**
- Requires launching a separate browser (not the user's existing browser session)
- Extension development is a different skill set
- Chrome Web Store distribution adds friction (or requires sideloading)
- More complex deployment than a Vite plugin

### Architecture B: Electron Review Browser

```
┌──────────────────────────────────────────────────────────┐
│  Electron Main Process                                    │
│  ├── ReviewStorage (inline-review.json)                   │
│  ├── MCP Server (stdio or internal)                       │
│  ├── Agent Coordinator                                    │
│  │   ├── Screenshot & visual diff                         │
│  │   ├── DOM inspection via webContents API                │
│  │   └── Annotation verification                          │
│  └── IPC bridge (main ↔ renderer)                         │
├──────────────────────────────────────────────────────────┤
│  Electron Renderer (BrowserView: Target Site)             │
│  ├── User's site loaded in webview                        │
│  └── Preload script injects highlight/selection logic     │
├──────────────────────────────────────────────────────────┤
│  Electron Renderer (Review Panel)                         │
│  ├── Annotation list, status management                   │
│  ├── Visual diff viewer                                   │
│  └── Agent activity feed                                  │
└──────────────────────────────────────────────────────────┘
```

**How it works:**
1. User runs `npx review-loop` or launches the Electron app
2. App opens with a browser view (target site) + review panel
3. User annotates in the browser view; panel shows annotations
4. Main process handles storage, MCP, and agent coordination
5. Agent can request screenshots, DOM snapshots, visual diffs

**Pros:**
- Self-contained — no extension installation, no dev server dependency
- Full control over the browser environment
- Can embed visual diff tools, screenshot comparison
- IPC is fast and type-safe
- Could include built-in AI agent (local or API)

**Cons:**
- ~100MB download / ~250MB memory
- Separate app to maintain (Electron updates, security patches)
- Users must switch from their normal browser to the review browser
- Electron apps feel "heavier" than a browser extension

### Architecture C: Chrome Extension + Native Messaging Host (Claude Pattern)

```
┌──────────────────────────────────────────────────────────┐
│  Chrome Extension (MV3)                                   │
│  ├── Service Worker: lifecycle, native messaging bridge   │
│  ├── Content Script: highlights, selection, element pick  │
│  ├── Side Panel: annotation list, status, replies         │
│  └── DevTools Panel (optional): DOM inspector for annots  │
├──────────────── chrome.runtime.connectNative() ──────────┤
│  Native Messaging Host (Node.js)                          │
│  ├── ReviewStorage (inline-review.json)                   │
│  ├── MCP Server (agent access)                            │
│  ├── Screenshot capture via CDP (optional)                │
│  └── Annotation verification engine                       │
└──────────────────────────────────────────────────────────┘
```

**How it works:**
1. User installs Chrome extension (Web Store or sideload for dev)
2. User installs native messaging host (`npx review-loop install`)
3. Extension works in user's normal Chrome browser — no separate app
4. Content script replaces Shadow DOM injection for highlights
5. Side panel replaces the injected panel
6. Native host handles storage, MCP, and agent bridge
7. Agent connects via MCP to the native host

**Pros:**
- Works in user's existing browser — no context switch
- Chrome Web Store distribution (or enterprise sideload)
- Side panel API provides proper UI surface (not a hacky overlay)
- Content scripts have full DOM access for highlights
- Native messaging is the same pattern Claude Desktop uses
- Can work on any site, not just dev servers

**Cons:**
- Chrome/Edge only (no Firefox/Safari support without separate extensions)
- Native messaging host installation is an extra step
- Extension review process for Web Store
- MV3 service worker lifecycle (can be terminated, must handle restart)
- More complex than a Vite plugin for simple use cases

### Architecture D: Hybrid — Keep Vite Plugin + Add Agent Browser Mode

```
┌─────────────────────────────────────────────────────────┐
│  Mode 1: Embedded (current — for quick annotation)       │
│  └── Vite/Astro/Express plugin → Shadow DOM overlay      │
├─────────────────────────────────────────────────────────┤
│  Mode 2: Agent Browser (new — for verification/review)   │
│  └── Playwright-controlled Chromium                      │
│      ├── Loads target site                               │
│      ├── Reads annotations from inline-review.json       │
│      ├── Visually verifies agent changes                 │
│      ├── Screenshots for before/after comparison         │
│      └── Reports back via MCP                            │
├─────────────────────────────────────────────────────────┤
│  Shared: ReviewStorage + MCP Server + JSON store         │
└─────────────────────────────────────────────────────────┘
```

**How it works:**
1. Reviewers continue using the embedded overlay for annotation (familiar workflow)
2. New `npx review-loop verify` command launches agent browser
3. Agent browser loads each annotated page, verifies changes, takes screenshots
4. MCP server gains new tools: `verify_annotation`, `screenshot_page`, `crawl_site`
5. Both modes share the same storage and MCP interface

**Pros:**
- Non-breaking — existing users keep their workflow
- Incremental adoption — add agent browser capabilities gradually
- Best of both worlds — lightweight embedding for humans, full browser for agents
- Shared storage means annotations flow seamlessly between modes
- Lower risk than a full rewrite

**Cons:**
- Two codebases to maintain (embedded + agent browser)
- Potential feature divergence between modes
- More complex mental model for users

---

## 5. Capability Comparison

| Capability | Current (Embedded) | A: Playwright+Ext | B: Electron | C: Extension+Native | D: Hybrid |
|---|---|---|---|---|---|
| Annotate in browser | Yes (overlay) | Yes (extension) | Yes (webview) | Yes (extension) | Yes (both) |
| Works on any site URL | No (dev only) | Yes | Yes | Yes | Partial |
| Agent visual verification | No | Yes | Yes | Partial | Yes |
| Multi-page crawl | No | Yes | Yes | No | Yes (agent mode) |
| Screenshot diff | No | Yes | Yes | Partial | Yes (agent mode) |
| Framework adapters needed | Yes (3+) | No | No | No | Yes (embedded mode) |
| Install friction | Low (npm) | Medium (CLI) | Medium (app) | Medium (ext+host) | Low-Medium |
| Memory overhead | Zero (dev only) | ~200MB (Chromium) | ~250MB (Electron) | Zero (uses existing) | Varies by mode |
| Works without dev server | MCP only | Yes | Yes | Yes | Yes |
| Production site review | No | Yes | Yes | Yes | Agent mode only |

---

## 6. Protocol Recommendations

### Browser Control Protocol

**Recommended: Start with CDP via Playwright, plan migration to WebDriver BiDi**

- Playwright abstracts CDP today and is adding BiDi support
- CDP gives deep Chrome integration (DOM snapshots, accessibility tree, screenshots)
- WebDriver BiDi will be the cross-browser standard but isn't fully ready
- Playwright's API layer means we can switch protocols without changing application code

### Agent Communication Protocol

**Recommended: Keep MCP as primary, add new browser-aware tools**

New MCP tools for the agent runtime:
- `screenshot_page(url)` — capture page screenshot
- `verify_annotation(id)` — navigate to annotation's page, check if change rendered
- `get_accessibility_tree(url)` — structured page representation
- `crawl_site(baseUrl, depth?)` — discover and catalog all pages
- `visual_diff(url, before?, after?)` — compare page states

### Runtime ↔ UI Communication

**Recommended: WebSocket for real-time, replacing HTTP polling**

- Current store-poller checks `/version` every 2 seconds
- WebSocket would push changes instantly
- Better for agent activity feed (show real-time agent navigation, screenshots)

---

## 7. Recommended Path Forward

### Phase 1: Hybrid (Architecture D) — Low Risk, High Value

Keep the embedded Vite plugin as-is. Add a new `review-loop verify` command that:
1. Launches Chromium via Playwright
2. Reads annotations from `inline-review.json`
3. Navigates to each annotated page
4. Takes screenshots and verifies DOM state
5. Reports results via new MCP tools

**Why start here:**
- Non-breaking change — existing users unaffected
- Validates the agent browser concept without committing to a full rewrite
- Playwright is a well-understood, stable technology
- Can be shipped as a new export (`review-loop/browser`) without changing the core

### Phase 2: Chrome Extension (Architecture C) — Replace Embedded UI

Build a Chrome extension that replaces the Shadow DOM overlay:
1. Content script handles highlights and selection (replacing light DOM injection)
2. Side panel replaces the Shadow DOM panel
3. Native messaging host connects to ReviewStorage and MCP

**Why this is the right next step:**
- Eliminates framework adapters entirely
- Works on any site (dev, staging, production)
- Better UI surface (side panel vs. overlay)
- Follows the pattern Claude's own browser extension uses
- Chrome + Edge cover the vast majority of developers

### Phase 3: Full Agent Runtime — Long-term Vision

Combine Phase 1 + Phase 2 into a unified agent runtime:
1. Extension handles human review (annotating in the browser)
2. Playwright backend handles agent operations (verification, crawling, screenshots)
3. MCP server orchestrates both
4. Optional: Electron wrapper for a self-contained "Review Browser" app

---

## 8. Impact on Existing Architecture

### What Stays

- `ReviewStorage` class and `inline-review.json` format — unchanged
- MCP protocol and tool interface — extended, not replaced
- Shared types (`src/shared/types.ts`) — unchanged
- Export functionality — unchanged

### What Changes

| Component | Current | Agent Runtime |
|---|---|---|
| UI injection | Shadow DOM via Vite plugin | Chrome extension content script + side panel |
| Framework adapters | Astro, Vite, Express | None needed |
| Browser control | None | Playwright + CDP |
| API transport | HTTP REST polling | WebSocket (real-time) |
| Agent verification | Manual (human checks) | Automated (screenshot + DOM) |
| Deployment | npm package | npm + Chrome extension + native host |

### Migration Risks

1. **User workflow disruption** — mitigated by hybrid approach (Phase 1)
2. **Extension review process** — mitigated by supporting sideload for dev
3. **Increased complexity** — mitigated by phased rollout
4. **Browser vendor lock-in** — mitigated by WebDriver BiDi migration path

---

## 9. Open Questions

1. **Should the agent runtime be a separate package?** (e.g., `review-loop-browser` vs keeping it in `review-loop`)
2. **Chrome extension distribution**: Web Store, enterprise sideload, or both?
3. **Should Playwright be a peer dependency or bundled?** (it's ~50MB)
4. **How to handle authentication on target sites** in agent browser mode?
5. **Should the extension support Firefox** via WebExtensions API? (significant additional work)
6. **Visual diff engine**: Build custom, use `pixelmatch`, or integrate with existing tools?
7. **Should the Electron app (Architecture B) be pursued at all**, given the extension approach covers most use cases with less overhead?

---

## 10. References

- [browser-use/browser-use](https://github.com/browser-use/browser-use) — AI browser agent framework
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) — Playwright MCP server
- [Chrome DevTools MCP](https://developer.chrome.com/blog/chrome-devtools-mcp) — Google's AI DevTools integration
- [browserbase/stagehand](https://github.com/browserbase/stagehand) — AI browser automation SDK
- [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) — Agent-first browser CLI
- [Playwright Test Agents](https://playwright.dev/docs/test-agents) — Autonomous test generation
- [WebDriver BiDi](https://w3c.github.io/webdriver-bidi/) — W3C bidirectional browser protocol
- [Claude Browser Extension](https://gist.github.com/sshh12/e352c053627ccbe1636781f73d6d715b) — Anthropic's MV3 + native messaging pattern
- [Top 5 Agentic Browsers 2026](https://seraphicsecurity.com/learn/ai-browser/top-5-agentic-browsers-in-2026-capabilities-and-security-risks/) — Market landscape
- [Browserbase](https://www.browserbase.com/) — Cloud browser infrastructure for AI agents
- ADR-001: Shadow DOM for UI Isolation (current architecture rationale)
- ADR-004: MCP as the Agent Integration Layer (current agent integration rationale)
