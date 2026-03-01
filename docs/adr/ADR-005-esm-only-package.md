---
status: accepted
date: 2026-02-20
decision_makers: [matthewvivian]
tags: [packaging, esm, module-system, build, compatibility]
---

# ADR-005: ESM-Only Package

## Status

Accepted

## Context

review-loop needs to choose a module format for its published package. The JavaScript ecosystem has two module systems: CommonJS (CJS, `require()`) and ECMAScript Modules (ESM, `import`). As of 2026, ESM is the standard for new packages, but CJS remains widespread in older tooling.

The package has three distinct build targets with different consumers:

1. **Server/integration code** — consumed by Astro, Vite, and Express during development
2. **Client code** — a browser bundle injected into the page via `<script type="module">`
3. **MCP server** — a CLI executable spawned as a subprocess by coding agents

All three target environments that natively support ESM. The primary peer dependencies (Astro 5+, Vite 5+/6+) are themselves ESM-only packages.

## Options Considered

### Option 1: ESM-only (chosen)

Publish with `"type": "module"` and only ESM exports. Require Node.js 20+.

**Pros:**
- Simplest build configuration — single format output from tsup
- Aligns with the ecosystem — Astro, Vite, and the MCP SDK are all ESM-first
- `import`/`export` syntax throughout — no mixed module semantics
- Tree-shakeable by consumer bundlers
- Node.js 20+ has stable, unflagged ESM support
- No dual-package hazard (the notorious issue where CJS and ESM versions of the same package load as separate instances)

**Cons:**
- Incompatible with CJS-only consumers that cannot use `import()` or have not migrated to ESM
- Older Node.js versions (< 20) are unsupported
- Some testing tooling historically had ESM quirks (largely resolved by 2026)

### Option 2: Dual CJS + ESM

Publish both CommonJS and ESM builds using conditional exports (`"require"` and `"import"` conditions).

**Pros:**
- Maximum compatibility — works with both `require()` and `import`
- Consumers do not need to migrate to ESM

**Cons:**
- Dual-package hazard — CJS and ESM versions can be loaded simultaneously, causing subtle bugs with shared state, `instanceof` checks, and type identity
- More complex build configuration — two output formats, two sets of file extensions (`.cjs`/`.mjs` or conditional exports)
- Testing burden doubles — must verify both module formats work correctly
- CJS output may silently lose features that depend on ESM semantics (top-level await, import.meta, etc.)
- Maintenance cost for a compatibility path that the target audience (Astro/Vite/modern Node.js users) does not need

### Option 3: CJS-only

Publish as a traditional CommonJS package.

**Pros:**
- Universally compatible with older Node.js and legacy tooling

**Cons:**
- Incompatible with ESM-only peer dependencies (Astro 5, Vite 5+)
- Cannot use `import` syntax in published code
- Cannot use top-level `await` or `import.meta`
- Goes against the direction of the Node.js ecosystem
- Would require consumers to use dynamic `import()` or interop wrappers to work with the ESM-only peer dependencies

## Decision

Publish as an ESM-only package with `"type": "module"` and Node.js 20+ as the minimum engine version. All three build targets (server, client, MCP) output ESM format via tsup.

The `exports` field in `package.json` provides explicit entry points:

| Export path | Target |
|-------------|--------|
| `review-loop` | Astro integration (default) |
| `review-loop/vite` | Vite plugin |
| `review-loop/express` | Express/Connect adapter |
| `review-loop/client` | Browser bundle |
| `review-loop/mcp` | MCP server CLI |

Each entry point specifies `"import"` and `"types"` conditions only — no `"require"` condition.

## Consequences

**Positive:**
- Build configuration is straightforward — tsup produces one format per target, no interop layers
- No dual-package hazard — consumers load exactly one copy of the package
- Aligns with the entire dependency tree (Astro, Vite, MCP SDK, zod) which is ESM-first
- `import.meta.url` and other ESM features are available without workarounds
- The Node.js 20+ requirement matches Astro 5's own minimum (Node 18.17.1+, with 20+ recommended)

**Negative:**
- Projects using CommonJS-only toolchains cannot consume the package directly — they would need to use dynamic `import()`. In practice, this is unlikely to affect the target audience since Astro and Vite users are already in ESM contexts.
- Legacy test runners or build tools that do not support ESM would need configuration adjustments. The project uses vitest, which has native ESM support.
