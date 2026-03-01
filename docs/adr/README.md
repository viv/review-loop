# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the review-loop project. ADRs document significant architectural design decisions, the context in which they were made, the options that were considered, and the consequences of the chosen approach.

## Format

Each ADR follows the standard structure:

- **Title** — Short descriptive name with ADR number
- **Status** — Accepted, Proposed, Deprecated, or Superseded
- **Date** — When the decision was made (not when the ADR was written)
- **Context** — The problem, constraints, and forces at play
- **Options Considered** — All alternatives evaluated, with pros and cons
- **Decision** — What was chosen and why
- **Consequences** — Positive and negative outcomes of the decision

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](ADR-001-shadow-dom-for-ui-isolation.md) | Shadow DOM for UI isolation | Accepted | 2026-02-20 |
| [ADR-002](ADR-002-single-json-file-for-storage.md) | Single flat JSON file for storage | Accepted | 2026-02-20 |
| [ADR-003](ADR-003-vite-middleware-for-dev-api.md) | Vite middleware rather than separate dev server | Accepted | 2026-02-20 |
| [ADR-004](ADR-004-mcp-for-agent-integration.md) | MCP as the agent integration layer | Accepted | 2026-02-22 |
| [ADR-005](ADR-005-esm-only-package.md) | ESM-only package | Accepted | 2026-02-20 |
| [ADR-006](ADR-006-oidc-trusted-publishing.md) | OIDC trusted publishing over token-based auth | Accepted | 2026-03-01 |
| [ADR-007](ADR-007-framework-neutral-package-name.md) | Package name: review-loop | Accepted | 2026-02-28 |

## When to write an ADR

Record an ADR when a decision:

- Is non-obvious or has significant trade-offs
- Constrains future work or closes off alternatives
- Would be questioned by a new contributor ("why did you do it this way?")
- Affects multiple components or the project's public API

## Referencing ADRs

When making commits related to an architectural decision, reference the ADR in the commit message body (e.g., "See: ADR-006"). This helps anyone using `git blame` to discover the reasoning behind a change.
