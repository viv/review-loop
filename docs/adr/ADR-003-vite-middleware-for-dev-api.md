---
status: accepted
date: 2026-02-20
decision_makers: [matthewvivian]
tags: [server, middleware, vite, api, architecture]
---

# ADR-003: Vite Middleware Rather Than Separate Dev Server

## Status

Accepted

## Context

review-loop needs an HTTP API for the browser overlay to communicate with the server (creating, reading, updating, and deleting annotations). This API must be available during development only and must work across multiple web frameworks (Astro, SvelteKit, Nuxt, Remix, Express).

The key question is whether to serve this API from the existing framework dev server (as middleware) or from a separate, independent HTTP server.

## Options Considered

### Option 1: Vite dev server middleware (chosen)

Register the REST API as middleware on the framework's existing dev server, serving routes at `/__inline-review/api/*`.

**Pros:**
- Single HTTP server — no additional port, process, or lifecycle to manage
- Same origin — no CORS configuration needed; the API and the page share the same host:port
- Automatic dev-only activation — middleware is only registered when `command === 'dev'` (Astro) or `apply: 'serve'` (Vite)
- Zero startup overhead — the API is available as soon as the dev server starts
- Framework-agnostic middleware — using native `http.IncomingMessage`/`http.ServerResponse` types (not Vite-specific Connect types) enables the same middleware to work with Astro, Vite, and Express

**Cons:**
- Coupled to the dev server lifecycle — API unavailable when the dev server is not running
- Non-API requests must be explicitly passed through to the next middleware via `next()`
- Each framework needs a thin adapter to wire the middleware in (though these are 15-50 lines each)

### Option 2: Separate sidecar HTTP server

Run a dedicated HTTP server on a separate port (e.g., `localhost:4322`) for the annotation API.

**Pros:**
- Independent lifecycle — API available even when the main dev server restarts
- Clear separation of concerns — annotation API is fully decoupled from the framework
- Could serve as the MCP HTTP transport if needed

**Cons:**
- Port management — needs to find an available port, handle conflicts, and communicate the port to the client
- CORS required — browser requests cross-origin; need permissive CORS headers in dev
- Additional process — must be started alongside the dev server, adding DX friction
- Client script needs to know the API URL — either hardcoded, injected, or discovered
- Two things to start instead of one — violates the zero-config principle
- Shutdown coordination — need to ensure the sidecar stops when the dev server stops

### Option 3: WebSocket server

Use WebSocket connections for real-time bidirectional communication between browser and server.

**Pros:**
- Real-time push — server can notify the client of changes immediately
- Bidirectional — more natural for a live annotation tool

**Cons:**
- More complex than REST for simple CRUD operations
- Requires connection management, reconnection logic, and message framing
- Harder to debug than HTTP request/response pairs
- Still needs a server — either embedded in Vite or separate (same choice as above)
- CRUD semantics map naturally to HTTP methods; WebSocket adds unnecessary protocol overhead

### Option 4: Service Worker proxy

Intercept fetch requests in a Service Worker to provide an offline-capable API layer.

**Pros:**
- Works offline — could store annotations in IndexedDB via the Service Worker
- No server needed for reads

**Cons:**
- Service Workers cannot access the filesystem — still needs a server for persistence
- Registration and lifecycle management is complex
- Caching semantics add confusion for a dev tool where freshness is critical
- Does not solve the fundamental problem of persisting to a file on disk

## Decision

Register the REST API as middleware on the framework's existing dev server. Use native Node.js HTTP types (`http.IncomingMessage`/`http.ServerResponse`) rather than framework-specific types, enabling the same `createMiddleware` function to work across all supported frameworks.

Three thin adapters wire the middleware into different frameworks:

| Adapter | Framework | Client injection mechanism |
|---------|-----------|---------------------------|
| `review-loop` (default) | Astro | `injectScript('page', ...)` |
| `review-loop/vite` | Vite (SvelteKit, Nuxt, Remix) | `transformIndexHtml` |
| `review-loop/express` | Express/Connect | Manual `<script>` tag |

Each adapter is 15-50 lines. All share `ReviewStorage` and `createMiddleware` directly — no shared setup abstraction was needed.

The Vite file watcher is explicitly told to ignore the storage file (`server.watcher.unwatch(storagePath)`), preventing spurious full-page reloads when the MCP server or REST API writes to the JSON file. The client detects changes independently via a lightweight polling mechanism on the `/version` endpoint.

## Consequences

**Positive:**
- Zero-config DX — the API is available the moment `astro dev` or `vite dev` starts; nothing extra to run
- Same-origin requests eliminate CORS complexity entirely
- The middleware approach proved remarkably portable — decoupling from Vite-specific types (commit `10cbc1e`) enabled Express/Connect support with no changes to the core middleware
- Watcher unwatching prevents the feedback loop where MCP writes → Vite reload → client refetch → unnecessary DOM churn

**Negative:**
- The API is unavailable when the dev server is not running — the MCP server (ADR-004) addresses this by reading the JSON file directly, independent of the dev server
- Each new framework requires a thin adapter, though the pattern is established and each adapter is minimal
- The `/__inline-review/api` prefix is hardcoded — if a host site uses the same prefix, there would be a routing conflict (extremely unlikely in practice)
