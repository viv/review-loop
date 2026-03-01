---
generated_by: Claude Opus 4.6
generation_date: 2026-02-28
model_version: claude-opus-4-6
purpose: developer_guide
status: active
human_reviewer: matthewvivian
tags: [status, workflow, annotations, lifecycle, guide]
---

# Annotation Status Workflows

Canonical guide to the annotation status lifecycle in review-loop. Covers all statuses, transitions, UI behaviour, MCP agent integration, and edge cases.

## Status Model

There are exactly three annotation statuses, defined in `src/shared/types.ts`:

```typescript
type AnnotationStatus = 'open' | 'in_progress' | 'addressed';
```

| Status | Meaning | Set By |
|--------|---------|--------|
| `open` | New annotation, or reopened by reviewer | Default on creation; reviewer via Reopen button |
| `in_progress` | Agent is actively working on the annotation | Agent via MCP `start_work` tool |
| `addressed` | Agent has acted on the annotation (awaiting human review) | Agent via MCP `finish_work` tool |

Terminal actions (not statuses):
- **Accept** — deletes the annotation (reviewer approves)
- **Reopen** — status returns to `open` with optional follow-up note (reviewer disagrees)
- **Delete** — removes the annotation (only on `open` status)

### Status Storage

Status is stored explicitly in the `status` field on each annotation. For backward compatibility, annotations without a `status` field are derived using `getAnnotationStatus()`:

- If `resolvedAt` timestamp exists (legacy): `'addressed'`
- If `status` is `'resolved'` (legacy): `'addressed'`
- Otherwise: `'open'`

## Lifecycle Diagram

```
  Reviewer creates annotation
          |
          v
     +---------+
     |  OPEN   |  Buttons: [Delete]
     +----+----+
          |  Agent calls start_work (MCP)
          v
  +---------------+
  |  IN_PROGRESS  |  Buttons: [NONE]  Badge: "Agent working..."
  +-------+-------+
          |  Agent calls finish_work (MCP)
          v
  +---------------+
  |   ADDRESSED   |  Buttons: [Accept] [Reopen]  Badge: "Addressed"
  +-------+-------+
          |
     +----+----+
     v         v
  Accept    Reopen (shows textarea for follow-up note)
     |         |
     v         v
  DELETED   +---------+
            |  OPEN   |  + optional reviewer reply appended
            +---------+
```

### All Possible Transitions

```
              +----------+
  +---------->|   OPEN   |<---------- Reopen -----------+
  |           +-----+----+        (from addressed)      |
  |                 |                                    |
  |            start_work                                |
  |                 |                                    |
  |                 v                                    |
  |        +--------------+                              |
  |        | IN_PROGRESS  |                              |
  |        +------+-------+                              |
  |               |                                      |
  |        finish_work                                   |
  |               |                                      |
  |               v                                      |
  |        +------------+                                |
  |        |  ADDRESSED |-------- Reopen ----------------+
  |        +------+-----+
  |               |
  |          Accept (deletes)
  |               |
  |               v
  +----------+==========+
             |  DELETED  |
             +==========+
```

### Button Visibility Matrix

```
+--------------+---------+---------+---------+-------------+
|   Status     | Delete  | Accept  | Reopen  | Status Badge|
+--------------+---------+---------+---------+-------------+
| open         |   Yes   |   No    |   No    |   (none)    |
| in_progress  |   No    |   No    |   No    |  "Working"  |
| addressed    |   No    |   Yes   |   Yes   |  "Addressed"|
+--------------+---------+---------+---------+-------------+
```

## MCP Agent Integration

### Recommended Agent Workflow (list → start → finish)

```
1. list_annotations()              -- See all feedback (annotations + page notes)
        |
2. start_work(id)                  -- Signal work starting + get full detail
        |
3. (edit source code)              -- Make changes
        |
4. finish_work(id, anchorText?,    -- Mark work complete, update anchor text,
                message?)             and leave a reply (all in one call)
```

### MCP Tools Reference

| Tool | Effect | Status After |
|------|--------|--------------|
| `list_annotations` | Returns all feedback with optional status/page filters | (unchanged) |
| `start_work` | Signals agent is working; returns full detail; UI shows grace period | `in_progress` |
| `finish_work` | Marks work complete, optionally updates anchor text and adds reply | `addressed` |

## Timestamp Management

Each status transition sets specific timestamps and clears others:

```
  Transition to:      | inProgressAt | addressedAt
  ---------------------+--------------+-------------
  open                 |   CLEARED    |   CLEARED
  in_progress          |   SET (now)  |   CLEARED
  addressed            |   CLEARED    |   SET (now)
```

Legacy `resolvedAt` is cleared on all transitions but is never set by new code.

## Reviewer Actions

### Accept Button

- **Shown on**: `addressed` annotations
- **Action**: Deletes the annotation entirely (removes from store)
- **Use case**: Reviewer is satisfied with the agent's work

### Reopen Button

- **Shown on**: `addressed` annotations
- **Action**: Shows an inline textarea for an optional follow-up note, then transitions status to `open`
- **Follow-up note**: Appended to the `replies` array with `role: 'reviewer'`
- **Effect**: Clears all timestamps (`inProgressAt`, `addressedAt`)

### Delete Button

- **Shown on**: `open` annotations only
- **Action**: Two-click confirmation ("Sure?"), then deletes the annotation
- **Hidden when**: Workflow buttons (Accept/Reopen) are present

## Reply System

Annotations have a `replies` array that serves as a chronological conversation thread:

```typescript
interface AgentReply {
  message: string;
  createdAt: string;               // ISO 8601
  role?: 'agent' | 'reviewer';    // Defaults to 'agent'
}
```

- **Agent replies**: Added via MCP `finish_work` tool's `message` parameter (`role: 'agent'` set explicitly)
- **Reviewer replies**: Added when reopening with a follow-up note (`role: 'reviewer'`)
- **Display**: Panel shows "Agent:" or "Reviewer:" prefix; markdown export uses the same prefixes

## Orphan Tracking

When annotations lose their DOM anchor (e.g., after a Vite hot-reload), the `OrphanTracker` manages a grace period:

```
  isDomAnchored?
     |
  +--+--+
  | Yes  | --> 'anchored' (highlight visible)
  +------+
  | No   |
  +--+---+
     |
  status === 'in_progress'?
     |
  +--+--+
  | Yes  | --> 'checking' (indefinite — never times out)
  +------+
  | No   |
  +--+---+
     |
  Ever been anchored on this page?
     |
  +--+--+
  | No   | --> 'orphaned' (immediate — no grace period)
  +------+
  | Yes  |
  +--+---+
     |
  Within 15-second grace period?
     |
  +--+--+
  | Yes  | --> 'checking' (showing "Checking..." indicator)
  +------+
  | No   | --> 'orphaned' (showing "Could not locate on page")
  +------+
```

## Key File Paths

| File | Role |
|------|------|
| `src/shared/types.ts` | Status type definitions, `getAnnotationStatus()` |
| `src/server/storage.ts` | `ReviewStorage` class (JSON file I/O) |
| `src/server/middleware.ts` | REST API, status validation, timestamp management |
| `src/client/ui/panel.ts` | Button rendering, `appendStatusActions()`, reopen form |
| `src/client/index.ts` | Status change callback wiring |
| `src/client/orphan-tracker.ts` | Grace period logic for orphaned annotations |
| `src/shared/export.ts` | Markdown export with status badges |
| `src/mcp/tools/start-work.ts` | MCP start_work tool |
| `src/mcp/tools/finish-work.ts` | MCP finish_work tool |
