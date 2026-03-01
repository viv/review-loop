---
generated_by: Claude Opus 4.6
generation_date: 2026-03-01
model_version: claude-opus-4-6
purpose: implementation_plan
status: implemented
human_reviewer: matthewvivian
tags: [mcp, simplification, agent-workflow, tools]
---

# MCP Tool Set Simplification

**Issues:** [#56](https://github.com/viv/review-loop/issues/56), [#59](https://github.com/viv/review-loop/issues/59)

## Goal

Replace the current eight MCP tools with a streamlined three-tool set that guides agents through a clear **list → start → finish** workflow. Remove `get_export` (issue #56) as part of the same change.

## Current State

| Tool | Purpose |
|------|---------|
| `list_annotations` | List annotations (JSON) |
| `list_page_notes` | List page notes (JSON) |
| `get_annotation` | Get single annotation by ID |
| `get_export` | Markdown export (human-readable) |
| `set_in_progress` | Mark annotation as in_progress |
| `address_annotation` | Mark annotation as addressed |
| `add_agent_reply` | Add reply to annotation |
| `update_annotation_target` | Update replacedText on annotation |

**Problems identified:**
- Agents call `get_export` first (wasted round-trip for unstructured data)
- `list_annotations` and `list_page_notes` require two calls for full picture
- `set_in_progress` is easy to skip
- `address_annotation` + `update_annotation_target` + `add_agent_reply` have confusing overlap
- `replacedText` parameter name is ambiguous

## Target State

| Tool | Purpose |
|------|---------|
| `list_annotations` | List all feedback (annotations + page notes), with optional `pageUrl` and `status` filters |
| `start_work(id)` | Get full annotation detail and atomically set status to `in_progress` |
| `finish_work(id, anchorText?, message?)` | Mark addressed, update anchor text, add reply — all in one call |

## Design Decisions

### 1. `replacedText` renamed to `anchorText` at MCP interface only

The `replacedText` field in the JSON storage format and TypeScript types stays unchanged — it's used by the browser UI for Tier 2.5 location matching. The rename only applies to the MCP tool parameter name (`anchorText`), which maps to `replacedText` internally.

### 2. `list_annotations` response format

Returns a structured JSON object with two arrays:
```json
{
  "annotations": [...],
  "pageNotes": [...]
}
```
This preserves the distinction between annotation types whilst delivering everything in one call.

### 3. Removed tools — no deprecation period

Since this is a dev-only tool with a small user base, we remove all deprecated tools immediately rather than maintaining backward compatibility shims. The `.mcp.json` auto-discovery ensures agents always get the current tool set.

### 4. `get_annotation` absorbed into `start_work`

The only time an agent needs a single annotation's full detail is when it's about to work on it. `start_work` combines lookup + status transition, eliminating the need for a separate read-only tool.

### 5. Standalone `address_annotation` and `add_agent_reply` removed

`finish_work` subsumes both. There's no valid use case for marking addressed without optionally leaving a trace.

## File Changes

### New files
- `src/mcp/tools/start-work.ts` — `start_work` tool handler
- `src/mcp/tools/finish-work.ts` — `finish_work` tool handler
- `tests/mcp/tools/start-work.test.ts` — unit tests
- `tests/mcp/tools/finish-work.test.ts` — unit tests
- `docs/guides/mcp.md` — comprehensive MCP documentation
- `docs/reviews/2026-03-01-mcp-simplification-review.md` — independent review

### Modified files
- `src/mcp/tools/list-annotations.ts` — merge page notes, add status filter
- `src/mcp/server.ts` — update registrations (3 tools instead of 8)
- `tests/mcp/tools/list-annotations.test.ts` — add tests for page notes and status filter
- `docs/spec/specification.md` — update section 4.3.2
- `CLAUDE.md` — update MCP tools table and agent integration section
- `README.md` — update if MCP tools are mentioned

### Deleted files
- `src/mcp/tools/get-export.ts`
- `src/mcp/tools/list-page-notes.ts`
- `src/mcp/tools/get-annotation.ts`
- `src/mcp/tools/address-annotation.ts`
- `src/mcp/tools/add-agent-reply.ts`
- `src/mcp/tools/update-annotation-target.ts`
- `src/mcp/tools/set-in-progress.ts`
- `tests/mcp/tools/list-page-notes.test.ts`
- `tests/mcp/tools/get-annotation.test.ts`
- `tests/mcp/tools/add-agent-reply.test.ts`

## Task Breakdown

### Session 1: Core Implementation
1. Create feature branch `feat/mcp-simplification`
2. Implement `start_work` tool handler
3. Implement `finish_work` tool handler
4. Modify `list_annotations` to include page notes and status filter
5. Update `server.ts` registrations
6. Delete removed tool files
7. Build and lint check

### Session 2: Testing (can parallelise)
8. Update `list-annotations.test.ts` with new test cases
9. Write `start-work.test.ts`
10. Write `finish-work.test.ts`
11. Delete obsolete test files
12. Run full unit test suite
13. Check acceptance tests in `../review-loop-tests/`

### Session 3: Documentation (can parallelise with Session 2)
14. Update `docs/spec/specification.md` section 4.3.2
15. Update `CLAUDE.md` MCP tools table
16. Update `README.md` if needed
17. Create `docs/guides/mcp.md`
18. Grep for stale references to removed tools

### Session 4: Review and PR
19. Independent review → `docs/reviews/2026-03-01-mcp-simplification-review.md`
20. Address review findings
21. Verify all quality gates
22. Create pull request

## Quality Gates (from issue #59)

- [x] Engineering plan created ← this document
- [x] Engineering plan maintained throughout
- [x] Specification updated
- [x] Independent review with markdown report
- [x] Review findings assessed and addressed
- [x] Conventional commit format (no co-authored-by)
- [x] All documentation updated
- [x] CI passes
- [x] Acceptance tests pass
- [x] MCP tools tested end-to-end
- [x] No references to removed tools in source code
