---
status: accepted
date: 2026-02-20
decision_makers: [matthewvivian]
tags: [client, ui, css, isolation, shadow-dom]
---

# ADR-001: Shadow DOM for UI Isolation

## Status

Accepted

## Context

review-loop injects a full annotation UI (floating action button, slide-in panel, popup editor, toast notifications) into the host page during development. This UI must coexist with arbitrary site styles without interference in either direction — the host page's CSS must not break the overlay, and the overlay must not alter the host page's appearance.

The tool is designed to work across any web framework (Astro, SvelteKit, Nuxt, Remix, Express), so the isolation mechanism must be framework-agnostic and work with any CSS methodology the host site uses (Tailwind, CSS Modules, CSS-in-JS, plain CSS, etc.).

A secondary constraint is that text and element highlights must wrap or modify existing DOM nodes in the host page. Any isolation mechanism must accommodate this hybrid requirement — UI components isolated, highlights injected into the host document.

## Options Considered

### Option 1: Shadow DOM (chosen)

Attach all UI components to a shadow root on a host `<div>`, using `:host { all: initial; }` to reset inherited styles completely.

**Pros:**
- Complete CSS isolation — shadow boundary prevents style leakage in both directions
- Native browser feature — no build tooling, runtime library, or naming convention required
- Works with any CSS methodology on the host page
- Open mode (`mode: 'open'`) allows DevTools inspection for debugging
- Framework-agnostic — works identically across Astro, Vite, Express, etc.
- Event targeting naturally separates UI events from host page events

**Cons:**
- Cannot use Shadow DOM for highlights — `<mark>` elements must wrap host page text nodes, which requires light DOM injection
- Element highlights (outlines on annotated elements) must use inline styles on host page elements
- The inspector overlay (Alt+hover) must be in the light DOM to position over host page elements
- This hybrid pattern (UI in shadow, highlights in light) adds architectural complexity
- Inline styles on light DOM elements could theoretically be overridden by host page `!important` declarations

### Option 2: iframe

Render the annotation UI inside an iframe, providing complete document-level isolation.

**Pros:**
- Strongest possible isolation — separate document context, separate stylesheets
- No risk of style contamination in either direction

**Cons:**
- Cannot overlay the host page naturally — iframes are rectangular and positioned within the document flow
- Cross-document communication (postMessage) is cumbersome for the frequent interactions between highlights and UI
- Highlights still need to be in the host page — same hybrid problem as Shadow DOM, but with a harder communication boundary
- Z-index stacking across iframe boundaries is problematic
- Performance overhead of a separate document context

### Option 3: CSS namespacing / BEM prefixing

Prefix all annotation UI class names (e.g., `.air-panel`, `.air-fab`) to avoid collisions, without any DOM-level isolation.

**Pros:**
- Simplest to implement — no special browser APIs
- All elements in the same DOM tree — no cross-boundary communication needed
- Highlights and UI share the same styling context

**Cons:**
- No protection against inherited styles — host page `body { font-family: ... }` or global resets affect the UI
- No protection against overly broad host page selectors (e.g., `div { margin: 10px }`)
- Prefixing reduces but does not eliminate collision risk — host pages could use the same prefix
- Requires careful management of specificity wars
- Breaks when host pages use `* { ... }` or `all: unset` patterns

### Option 4: CSS `@scope` / scoped styles

Use the CSS `@scope` at-rule or framework-level scoped styles to contain the overlay's CSS.

**Pros:**
- Modern CSS feature with growing browser support
- Cleaner than BEM — scope is enforced by the browser

**Cons:**
- `@scope` only limits where styles apply *outward* — it does not prevent host page styles from reaching *inward*
- Browser support was limited in early 2026 (Chrome 118+, Firefox 128+, Safari not yet)
- Does not solve the inherited styles problem — `color`, `font-family`, `line-height` still cascade in
- Framework-specific scoped styles (Vue, Svelte) only work within that framework

## Decision

Use Shadow DOM with an open shadow root for all UI components. Use `:host { all: initial; }` to completely reset inherited styles. Accept the hybrid pattern where highlights are injected into the light DOM using inline styles.

The hybrid approach is architecturally clean because the boundary is functional: UI components (which need isolation) live in the shadow root, while highlights (which must interact with host page DOM nodes) live in the light DOM. This split is a consequence of the problem domain, not an implementation compromise.

## Consequences

**Positive:**
- Zero CSS interference with host pages regardless of their styling methodology
- The `all: initial` reset provides a known baseline for all UI component styles
- Open shadow root allows developers to inspect the UI in DevTools
- Cross-boundary communication uses a typed `ReviewMediator` interface, which is cleaner than the untyped shadow root bridge it replaced (commit `1781c69`)
- Selection detection explicitly excludes shadow DOM elements, preventing accidental annotation of the overlay's own UI

**Negative:**
- Light DOM highlights use inline styles, which are slightly harder to maintain than CSS classes
- The inspector overlay lives in the light DOM (documented as tech debt in IMPL-M6), creating a minor inconsistency
- Host page `!important` declarations on `mark` elements or outline styles could theoretically override highlight styles, though this has not been observed in practice
- Testing requires awareness of the shadow DOM boundary — locators must distinguish between shadow and light DOM elements
