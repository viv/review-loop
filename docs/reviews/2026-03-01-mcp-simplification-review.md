---
generated_by: Claude Opus 4.6
generation_date: 2026-03-01
model_version: claude-opus-4-6
purpose: review
status: draft
human_reviewer: matthewvivian
tags: [mcp, simplification, review, agent-workflow, tools]
---

# MCP Simplification — Independent Review

**Branch:** `feat/mcp-simplification`
**Issues:** [#56](https://github.com/viv/review-loop/issues/56), [#59](https://github.com/viv/review-loop/issues/59)
**Engineering plan:** `docs/engineering-plans/2026-03-01-mcp-simplification.md`

## 1. Summary of Changes

This feature branch replaces the eight-tool MCP surface with a streamlined three-tool set:

| Before (8 tools) | After (3 tools) |
|---|---|
| `list_annotations`, `list_page_notes`, `get_annotation`, `get_export`, `set_in_progress`, `address_annotation`, `add_agent_reply`, `update_annotation_target` | `list_annotations`, `start_work`, `finish_work` |

**Key changes:**
- `list_annotations` now returns both annotations *and* page notes, with an optional `status` filter
- `start_work` combines `get_annotation` + `set_in_progress` — fetches full detail and atomically sets `in_progress`
- `finish_work` combines `address_annotation` + `update_annotation_target` + `add_agent_reply` — marks addressed, optionally updates anchor text, optionally adds agent reply
- `get_export` removed entirely (issue #56)
- 7 source files deleted, 2 new files created, 4 files modified
- 5 test files deleted, 2 new test files created, 2 test files modified
- Net: -1,201 lines (322 added, 1,523 removed)

The JSON storage format (`inline-review.json`) is unchanged. The browser UI, REST API, and client code are unaffected.

## 2. Code Quality Assessment

### 2.1 `list-annotations.ts`

**Quality: Good**

Clean implementation. The handler accepts `pageUrl` and `status` filters, applies them independently, and returns a combined `{ annotations, pageNotes }` object.

- Uses `getAnnotationStatus()` for backward-compatible status derivation — correct
- Status filter applies only to annotations, not page notes — intentional and documented
- Both filters are optional and compose correctly (page → status)
- Registration uses clear, descriptive tool description with workflow context ("This is step 1 of the agent workflow")

**No issues found.**

### 2.2 `start-work.ts`

**Quality: Good**

Uses `storage.mutate()` for atomic read-modify-write — correct pattern. Sets three fields atomically (`status`, `inProgressAt`, `updatedAt`).

- Returns the full annotation after mutation (re-finds by ID from the returned store)
- Error case wraps the entire operation in try/catch and returns `isError: true`
- Error message includes the searched ID for debugging

**No issues found.**

### 2.3 `finish-work.ts`

**Quality: Good**

The most complex handler, but well-structured with clear validation ordering:

1. Pre-mutation validation (empty `anchorText`, empty `message`) — returns early with clear error messages
2. Atomic mutation via `storage.mutate()` — sets `status`, `addressedAt`, `updatedAt`
3. Conditional `anchorText` → `replacedText` mapping with type guard check (`isTextAnnotation`)
4. Conditional reply append with proper `role: 'agent'` and `createdAt`
5. Returns updated annotation

- Correctly initialises `replies` array if it doesn't exist yet (line 49)
- The `anchorText` → `replacedText` mapping is clean — the MCP interface name is different from the storage field name, and the handler bridges them
- Type error for `anchorText` on element annotations is clear and specific

**No issues found.**

### 2.4 `server.ts`

**Quality: Good**

Minimal and clean. 33 lines total. Registers exactly three tools. `parseStoragePath` is exported for testing.

**Minor observation:** The MCP server `version` is hardcoded as `'0.1.0'` (line 22) whilst `package.json` is at `0.2.0`. This pre-dates this branch but is worth noting. Not a blocker — MCP server version and npm package version are independent.

### 2.5 `src/mcp/types.ts`

**Quality: Good**

Simple and correct. `ToolResult` and `ErrorResult` provide the MCP return shape contracts.

## 3. Test Coverage Assessment

### 3.1 `list-annotations.test.ts` — 10 tests

Covers:
- Empty store → empty arrays
- All annotations + page notes (no filter)
- `pageUrl` filter (annotations and page notes filtered)
- `status` filter (single status)
- Combined `pageUrl` + `status` filter
- Legacy annotations without `status` field → backward compat
- Status filter does not apply to page notes
- Non-matching `pageUrl` → empty arrays
- Mixed annotation types (text + element)
- Output format (pretty-printed JSON)

**Assessment: Thorough.** All filter combinations and edge cases covered.

### 3.2 `start-work.test.ts` — 8 tests

Covers:
- Returns full annotation detail
- Sets status to `in_progress`
- Sets `inProgressAt` timestamp (valid ISO 8601)
- Updates `updatedAt` timestamp
- Persists to JSON file
- Error for non-existent ID
- Works with element annotations
- Finds annotation among multiple

**Assessment: Thorough.** Covers both annotation types, persistence, and error cases.

### 3.3 `finish-work.test.ts` — 17 tests

Covers:
- Basic addressed behaviour (3 tests: status, timestamp, updatedAt)
- Persistence to JSON file
- `anchorText` parameter (4 tests: sets replacedText, error on element, error on empty, persistence)
- `message` parameter (4 tests: adds reply with role, appends to existing, error on empty, persistence)
- Combined parameters (anchorText + message together)
- No optional parameters (minimal call)
- Error for non-existent ID
- Element annotations with message only
- Reply `createdAt` is valid ISO 8601

**Assessment: Thorough.** All parameter combinations, validation errors, and edge cases covered. Good use of distinct test sections with clear headings.

### 3.4 `server.test.ts` — 10 integration tests

Covers:
- Initialisation and tool listing (exactly 3 tools, removed tools absent)
- `list_annotations` returns annotations and page notes
- `list_annotations` filters by `pageUrl`
- `list_annotations` filters by `status`
- `start_work` returns detail and sets `in_progress`
- `start_work` error for invalid ID
- `finish_work` with anchorText and message
- `finish_work` with only required params
- Missing required params error handling
- **End-to-end workflow**: list → start → finish → verify persisted → list with status filter

**Assessment: Excellent.** The end-to-end workflow test is particularly valuable — it exercises the complete agent lifecycle and verifies persistence at each step.

### 3.5 Test helpers (`fixtures.ts`)

Well-designed factory functions. `makeTextAnnotation` supports both 3-arg and 4-arg signatures for convenience, with sensible defaults.

### 3.6 Overall Test Verdict

**512 tests pass, 0 failures.** Build and lint both clean. Coverage of the new MCP tools is comprehensive — unit tests cover all branches, and integration tests verify the full lifecycle.

## 4. Documentation Completeness

### 4.1 `CLAUDE.md`

**Updated correctly.** The MCP tools table shows the three new tools. The agent workflow section describes the `list → start → finish` pattern. The key file paths include the new tool files.

### 4.2 `README.md`

**Updated correctly.** The "Available tools" table shows the three new tools with the `list → start → finish` framing. The agent workflow section at the top is updated.

**Finding (Minor):** The README contains four references to a `resolved` status that was removed in an earlier refactoring:
- Line 41: `open → addressed (agent acted) → resolved (reviewer confirmed)`
- Line 173: `Annotations track open → addressed → resolved states.`
- Lines 312 and 330: comparison tables with other tools

These pre-date this branch but are now more misleading given the simplified tool set. The current model is `open → in_progress → addressed` with terminal actions Accept/Reopen — there is no `resolved` status.

### 4.3 `docs/guides/mcp.md` (new)

**Comprehensive and well-structured.** Covers:
- Overview with workflow diagram
- Quick start (auto-discovery and manual invocation)
- Agent workflow with step-by-step examples
- Complete tool reference (parameters, return format, error cases, examples)
- Data model reference (annotation types, status lifecycle, page notes, anchorText/replacedText relationship)
- Architecture section (how MCP server fits in, auto-discovery, process lifecycle)
- Configuration (CLI arguments, .mcp.json for dev vs consumers)
- Concurrency model and limitations
- Troubleshooting

This is an excellent standalone guide. No issues found.

### 4.4 `docs/guides/mcp-tools.md`

**Correctly superseded.** Contains a brief notice pointing to `mcp.md` and noting the simplification.

### 4.5 `docs/guides/mcp-setup.md`

**Updated correctly.** References `start_work` and `finish_work` in the workflow diagram. Tool count reference updated. Links to `mcp.md` for detailed documentation.

### 4.6 `docs/guides/2026-02-28-annotation-status-workflows.md`

**Updated correctly.** Uses `start_work` and `finish_work` in lifecycle diagrams and transition tables.

### 4.7 `docs/spec/specification.md`

**Updated correctly.** Section 4.3.2 describes the three new tools with parameter details, validation behaviour, and return format.

**Finding (Minor):** Line 579 says `finish_work` "returns a confirmation message", but the actual implementation returns the full annotation object as JSON (same as `start_work`). The test at `server.test.ts:274` verifies it returns annotation fields like `status`, `addressedAt`, `replacedText`, and `replies`. The `mcp.md` guide correctly documents it as returning the full annotation.

### 4.8 `docs/engineering-plans/2026-03-01-mcp-simplification.md`

**Complete and maintained.** Covers goal, current/target state, design decisions, file changes, task breakdown with sessions, and quality gates checklist.

## 5. Stale Reference Check

### Active source code (`src/`)

**No stale references.** Grep of entire `src/` directory for all seven removed tool names returns zero matches.

### Tests (`tests/`)

**No problematic references.** The only hits are in `tests/mcp/server.test.ts` lines 185–191 — negative assertions verifying removed tools are NOT present. This is correct and intentional.

### Active documentation (`CLAUDE.md`, `README.md`, `docs/spec/`, `docs/guides/`)

**No stale references** to removed tool names.

### Historical documentation (`docs/reviews/`, `docs/engineering-plans/`, `docs/adr/`, `docs/agent-loop-plans/`, `docs/reports/`)

Many references exist in historical/point-in-time documents. These are expected — they document the state at the time they were written. No action needed.

### Other stale references

The `src/client/orphan-tracker.ts` JSDoc comment at line 8 correctly references `finish_work` (updated from the prior tool name).

## 6. Backward Compatibility Verification

### JSON storage format

**Unchanged.** The `ReviewStore`, `Annotation`, `TextAnnotation`, `ElementAnnotation`, `PageNote` types in `src/shared/types.ts` are identical. The `replacedText` field remains `replacedText` in storage — only the MCP parameter is named `anchorText`.

### Browser UI

**Unaffected.** No client-side files were modified except `orphan-tracker.ts` (JSDoc comment only). The Shadow DOM UI, panel, popup, highlights, FAB, and shortcuts are untouched.

### REST API

**Unaffected.** `src/server/middleware.ts` is not in the changeset. All REST endpoints (`/annotations`, `/page-notes`, `/version`, `/export`) continue to work as before.

### `replacedText` field

**Correctly preserved.** The `TextAnnotation.replacedText` field in `src/shared/types.ts` is unchanged. The `finish_work` handler maps `anchorText` → `annotation.replacedText` (line 44 of `finish-work.ts`). This is a MCP-interface-only rename as documented in the engineering plan.

## 7. Quality Gate Checklist

| Gate | Status | Evidence |
|------|--------|----------|
| Engineering plan created | **Pass** | `docs/engineering-plans/2026-03-01-mcp-simplification.md` |
| Engineering plan maintained | **Pass** | Plan reflects all sessions (implementation, testing, documentation, review) |
| Specification updated | **Pass** | Section 4.3.2 rewritten with three-tool description |
| Independent review with markdown report | **Pass** | This document |
| Conventional commit format | **N/A** | Changes are currently uncommitted (working directory changes only) — commit format compliance cannot be verified until commits are made |
| All documentation updated | **Pass** | CLAUDE.md, README.md, specification, mcp.md guide, mcp-tools.md (superseded), mcp-setup.md, status-workflows guide all updated |
| No references to removed tools in source code | **Pass** | Grep verified — zero matches in `src/`, only negative test assertions in `tests/` |
| Build passes | **Pass** | `npm run build` — clean success |
| Lint passes | **Pass** | `npm run lint` — no errors |
| Tests pass | **Pass** | 512 tests, 0 failures |

## 8. Findings

### Critical

None.

### Important

**IMP-1: Specification says `finish_work` returns "a confirmation message" — it actually returns the full annotation**

- **Location:** `docs/spec/specification.md` line 579
- **Issue:** The return format description says `finish_work returns a confirmation message`, but the actual implementation returns `JSON.stringify(annotation, null, 2)` — the full updated annotation object, identical in format to `start_work`.
- **Evidence:** `finish-work.ts:60` returns the annotation; `server.test.ts:274` asserts on annotation fields
- **Impact:** An agent relying solely on the specification would have an incorrect expectation of the return format.
- **Recommendation:** Update the specification to say `finish_work` returns the full annotation as JSON-stringified data (same as `start_work`).

### Minor

**MIN-1: README contains stale `resolved` status references**

- **Location:** `README.md` lines 41, 173, 312, 330
- **Issue:** Four references to `resolved` status remain. The current model is `open → in_progress → addressed` with terminal actions (Accept/Reopen). The `resolved` status was removed in an earlier refactoring.
- **Impact:** Low — these are descriptive sentences in the README, not API contracts. However they may confuse new users.
- **Recommendation:** Update these four lines to reflect the current three-status model.

**MIN-2: MCP server version hardcoded to `0.1.0`**

- **Location:** `src/mcp/server.ts` line 22
- **Issue:** The MCP server reports `version: '0.1.0'` whilst `package.json` is at `0.2.0`. This pre-dates this branch.
- **Impact:** Negligible — the MCP server version is metadata only and has no functional effect.
- **Recommendation:** Consider reading the version from `package.json`, or updating the hardcoded value when making the next release.

### Suggestions

**SUG-1: Consider Zod `.min(1)` on optional string parameters in `finish_work`**

The `anchorText` and `message` parameters use `z.string().optional()` without `.min(1)`, relying on application-level `.trim()` validation instead. The `id` parameter uses `z.string().min(1)`. This is internally consistent with the prior codebase convention and the empty-string checks are correct, but moving validation to the Zod layer would give better automatic error messages from the MCP SDK. This is a style choice, not a bug.

**SUG-2: Consider a test for calling `finish_work` on an already-addressed annotation**

The current tests don't cover calling `finish_work` on an annotation that's already `addressed`. The handler will happily overwrite `addressedAt` and re-set the status. This is likely intentional (agents may need to update their reply), but a test documenting this behaviour would be valuable.

**SUG-3: Consider a test for calling `start_work` on an already in-progress annotation**

Similar to SUG-2 — the handler allows re-claiming an already in-progress annotation. A test documenting this as intentional behaviour (rather than an oversight) would be useful.

## 9. Overall Assessment

**The implementation is clean, well-tested, and well-documented.** The three-tool simplification achieves its stated goal — the `list → start → finish` workflow is intuitive for agents and eliminates the confusion of overlapping tools.

**Strengths:**
- Significant API surface reduction (8 → 3 tools) with no loss of functionality
- Thorough test suite — 35 unit tests across the three tools + 10 integration tests including an end-to-end workflow
- Comprehensive `docs/guides/mcp.md` guide with examples, architecture, troubleshooting
- Backward compatibility fully preserved — JSON format, browser UI, REST API all unaffected
- Clean code with consistent patterns, clear error messages, and proper use of `storage.mutate()` for atomic writes

**One important finding:**
- IMP-1 (specification says `finish_work` returns confirmation message, but it actually returns the full annotation) should be fixed before merging

**Two minor findings:**
- MIN-1 (stale `resolved` references in README) — minor but worth cleaning up
- MIN-2 (hardcoded MCP server version) — cosmetic, can be deferred

**Verdict: Approve with minor changes** — fix IMP-1 (specification return format), and ideally MIN-1 (README status references). The implementation itself is correct and ready for commit.
