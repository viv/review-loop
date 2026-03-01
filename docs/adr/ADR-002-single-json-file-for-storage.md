---
status: accepted
date: 2026-02-20
decision_makers: [matthewvivian]
tags: [storage, json, persistence, concurrency, architecture]
---

# ADR-002: Single Flat JSON File for Storage

## Status

Accepted

## Context

review-loop needs persistent storage for annotations and page notes that survives dev server restarts, page reloads, and browser sessions. The storage must be accessible to three consumers simultaneously:

1. **REST API middleware** — serving the browser UI via HTTP endpoints
2. **MCP server** — serving coding agents via stdio as a separate subprocess
3. **External tools** — agents or scripts reading/writing the file directly

A core design principle is **zero-config** — the storage mechanism should work with no setup, no database, and no additional services. The data volume is small (typically tens to low hundreds of annotations per project).

## Options Considered

### Option 1: Single JSON file in project root (chosen)

Store all annotations and page notes in a single `inline-review.json` file at the project root, using `ReviewStorage` to manage reads and writes.

**Pros:**
- Zero configuration — works immediately with no setup
- Human-readable — developers can inspect and edit annotations directly
- Version control friendly — can be committed to git if the team wants shared annotations
- Framework-agnostic — any tool, agent, or script can read a JSON file
- Enables direct file editing by MCP agents or external scripts, picked up immediately on next read
- Portable — no database drivers, no connection strings, no server processes

**Cons:**
- No concurrent multi-process write safety — the write queue serialises within a single process, but two processes (e.g., REST API and MCP server) writing simultaneously could lose data
- Entire store is read and written on every operation — no partial updates
- No indexing — filtering by page URL is a linear scan (acceptable for expected data volumes)
- Schema migrations must be backward-compatible (no `ALTER TABLE` equivalent)

### Option 2: SQLite database

Use an embedded SQLite database for structured storage with proper concurrency.

**Pros:**
- ACID transactions — safe concurrent access from multiple processes
- Efficient queries — indexed lookups by page URL, annotation ID, etc.
- Partial updates — only modified rows are written
- Mature tooling for schema migrations

**Cons:**
- Adds a native dependency (`better-sqlite3` or similar) — complicates installation, especially cross-platform
- Binary format — not human-readable, not directly editable by agents
- Requires schema migration tooling for data model changes
- Overkill for the expected data volume (tens to hundreds of records)
- Not version-control friendly — binary diffs are meaningless
- Violates the zero-config principle — adds installation and compatibility concerns

### Option 3: IndexedDB / localStorage (client-only)

Store annotations in the browser's built-in storage.

**Pros:**
- No server-side storage needed
- Built into every browser

**Cons:**
- Browser-scoped — MCP server and external tools cannot access browser storage
- Lost when browser data is cleared
- No persistence across different browsers or devices
- Cannot be committed to version control
- Fundamentally incompatible with the multi-consumer requirement

### Option 4: In-memory with periodic flush

Keep annotations in memory and periodically write to disk.

**Pros:**
- Fast reads (no disk I/O)
- Simple implementation

**Cons:**
- Data loss on crash or unexpected shutdown
- MCP server (separate process) would see stale data between flushes
- External file edits not picked up until next read-from-disk cycle
- Adds complexity around flush timing and shutdown hooks

## Decision

Use a single JSON file (`inline-review.json`) in the project root with the following guarantees:

- **Reads always from disk** — no in-memory cache. External edits (by MCP agents, scripts, or manual editing) are picked up immediately on the next read.
- **Writes are atomic** — write to a temp file first, then rename, preventing partial writes on crash.
- **Writes are serialised** — a promise-based write queue prevents concurrent mutations within a single process from interleaving and losing data.
- **Schema evolution via optional fields** — new fields (e.g., `status`, `inProgressAt`, `addressedAt`, `replies`, `replacedText`) are always optional with sensible defaults derived at read time, avoiding forced migrations.
- **Corrupt data resilience** — malformed JSON returns an empty store with a `console.warn`; individual annotations missing required fields are filtered out while preserving valid siblings.

The single-agent concurrency assumption (one MCP connection at a time, stdio transport) means the cross-process write safety gap is acceptable. This was explicitly documented in the specification (Section 4.3.5).

## Consequences

**Positive:**
- True zero-config — `npm install` and go; no database setup, no connection strings
- Agents can read and modify `inline-review.json` directly without any API — the file is the API
- The store can be committed to git for team-shared annotations or added to `.gitignore` for personal use
- Schema evolution has been smooth — five optional fields added over the project's lifetime without any migration scripts
- Atomic writes (temp-file-then-rename) prevent data corruption on crash (added in commit `362578a`)
- Write queue prevents data loss from concurrent REST API requests within the same process (added in commit `4e992e7`)

**Negative:**
- Concurrent writes from multiple processes (e.g., two MCP servers) could lose data — mitigated by the single-agent design assumption
- The entire store is serialised on every write — acceptable for current data volumes but would not scale to thousands of annotations
- No query indexing — page-filtered reads scan all annotations linearly
- Binary data (images, attachments) would be impractical to store — not a current requirement
