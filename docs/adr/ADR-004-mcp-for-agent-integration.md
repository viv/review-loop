---
status: accepted
date: 2026-02-22
decision_makers: [matthewvivian]
tags: [mcp, agent-integration, protocol, architecture]
---

# ADR-004: MCP as the Agent Integration Layer

## Status

Accepted

## Context

review-loop bridges human reviewers and AI coding agents. The reviewer annotates a rendered page in the browser; the agent needs to read those annotations, act on them, and report back. The central design question is how the agent accesses and interacts with annotations.

Four approaches were evaluated in the [Agent Bridge engineering plan](../engineering-plans/2026-02-22-agent-bridge.md). The key requirements were:

1. **Structured access** — agents should know what operations are available without reading documentation
2. **Bidirectional** — agents need to read annotations but also write back (mark as addressed, reply with what they changed)
3. **Independent of the dev server** — agents may work on annotations after a review session, without Vite running
4. **Low friction** — ideally zero-config for the primary agent (Claude Code)

## Options Considered

### Option A: Direct JSON file access

The agent reads `inline-review.json` directly from the filesystem.

**Pros:**
- Zero infrastructure — the file already exists and is always up to date
- Works with any agent that can read files
- `ReviewStorage` reads from disk on every call, so external edits are picked up immediately

**Cons:**
- No push notifications — agent must poll or be told to re-read
- Raw JSON is less discoverable than a structured tool interface — agents need documentation to understand the schema
- Read-only unless the agent parses, modifies, and rewrites the JSON (error-prone)
- No input validation — a malformed write by the agent could corrupt the store

### Option B: MCP server over stdio (chosen)

Run an MCP (Model Context Protocol) server as a subprocess, communicating via stdin/stdout. Agents connect and discover available tools with typed schemas.

**Pros:**
- Structured, typed tool interface — agents discover operations through Zod-validated schemas
- Bidirectional — agents can list, read, address annotations, add replies, update text targets, and signal work-in-progress status
- Independent of Vite — runs as a separate subprocess using the same `ReviewStorage` class
- Auto-discovery — `.mcp.json` at the project root enables zero-config setup for Claude Code
- Schema self-documenting via MCP tool descriptions — the agent can understand the interface without reading any documentation
- No HTTP ports, no CORS, no authentication surface

**Cons:**
- Requires MCP client support in the agent (Claude Code has this; others may not)
- More code to build and maintain than direct file access
- Testing is harder (need to test MCP protocol compliance)
- Single-connection model — only one agent at a time per server instance

### Option C: REST API from the agent

The agent calls the existing `/__inline-review/api/*` REST endpoints via HTTP.

**Pros:**
- API already exists — no new server code needed
- Works with any agent that can make HTTP requests
- Bidirectional (existing CRUD endpoints support all operations)

**Cons:**
- Requires the dev server to be running
- Agent needs to know the dev server URL (typically `http://localhost:4321`)
- Less discoverable than MCP — agent needs explicit documentation about API shape
- No push notifications (polling only)

### Option D: File watcher with agent notification

Monitor `inline-review.json` for changes and notify the agent via a sentinel file or file system events.

**Pros:**
- Push-based — agent does not need to poll

**Cons:**
- Agent-side file watching support varies across tools
- Adds complexity without the structured interface of MCP
- Largely superseded by MCP's capabilities — if MCP notifications are needed, they can be added to the MCP server

## Decision

Implement MCP (Option B) as the primary agent integration layer, with Option A (direct JSON file access) documented as a fallback for agents without MCP support, and Option C (REST API) available as-is for agents that can make HTTP requests.

Option D was deferred as it is superseded by MCP.

Key implementation decisions:

- **Transport: stdio** — agent spawns the MCP server as a child process. Simplest for local dev; no ports or authentication.
- **Separate process** — runs independently of Vite, sharing the same `ReviewStorage` class. Works even without the dev server running.
- **SDK: `@modelcontextprotocol/sdk` v1.x** — the stable, production-recommended version.
- **8 tools** — 4 read-only (`list_annotations`, `list_page_notes`, `get_annotation`, `get_export`) and 4 write (`address_annotation`, `add_agent_reply`, `update_annotation_target`, `set_in_progress`).

Auto-discovery via `.mcp.json` at the project root means Claude Code users get MCP integration with zero configuration.

## Consequences

**Positive:**
- Agents have a self-describing interface — tool names, parameter schemas, and descriptions are visible through the MCP protocol itself
- The feedback loop is truly closed: reviewer annotates → agent reads via MCP → agent edits code → agent marks addressed and replies → reviewer sees the response in the browser panel → reviewer accepts or reopens
- The `set_in_progress` tool enables graceful UX during agent work — the browser shows a working indicator instead of orphan warnings while code is being edited and hot-reloaded
- Independence from the dev server means agents can batch-process annotations offline
- `ReviewStorage` sharing ensures identical file I/O behaviour, write queuing, and backward compatibility logic across REST API and MCP

**Negative:**
- MCP is not universally supported — agents without MCP clients fall back to direct JSON file access (Option A) or REST API (Option C)
- The MCP server adds `@modelcontextprotocol/sdk` and `zod` as runtime dependencies (though these are only loaded by the MCP subprocess, not by the framework integration)
- Single-agent concurrency assumption — the write queue serialises within the MCP process, but running two MCP servers against the same file is unsupported. This is acceptable because stdio transport is inherently single-connection.
