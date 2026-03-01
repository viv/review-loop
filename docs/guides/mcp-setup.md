# MCP Setup Guide

Connect your coding agent to review annotations via the [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. MCP is the primary integration path — agents read annotations directly, act on them, and mark them addressed without any copy-paste.

## Before you begin

- **Node.js** >= 20
- **review-loop** installed in your Astro project (`npm install -D review-loop`)
- An **MCP-compatible coding agent** (Claude Code, Cursor, Windsurf, etc.)
- **Annotations exist** — reviewers create them using the browser UI during `astro dev`, stored in `inline-review.json`

The MCP server reads directly from `inline-review.json`. The Astro dev server does **not** need to be running.

## Claude Code

Add a `.mcp.json` file to your Astro project root (the project that has `review-loop` installed as a dependency):

```json
{
  "mcpServers": {
    "review-loop": {
      "type": "stdio",
      "command": "node",
      "args": [
        "./node_modules/review-loop/dist/mcp/server.js",
        "--storage",
        "./inline-review.json"
      ]
    }
  }
}
```

No other configuration is needed — Claude Code reads `.mcp.json` on startup.

### What happens

1. Claude Code reads `.mcp.json` on startup
2. It spawns `node ./node_modules/review-loop/dist/mcp/server.js` as a child process using stdio transport
3. The MCP server reads `inline-review.json` from disk on every tool call
4. Claude Code gains access to three tools for listing, starting work on, and finishing annotations

### Custom storage path

The `--storage` flag is optional and defaults to `./inline-review.json` relative to the project root. If your annotations file is in a different location:

```json
{
  "mcpServers": {
    "review-loop": {
      "type": "stdio",
      "command": "node",
      "args": [
        "./node_modules/review-loop/dist/mcp/server.js",
        "--storage",
        "./reviews/sprint-42.json"
      ]
    }
  }
}
```

## Other MCP clients

For agents that don't support `.mcp.json` auto-discovery, configure the stdio transport manually. The exact format varies by client, but the core configuration is:

- **Command**: `node`
- **Arguments**: `["./node_modules/review-loop/dist/mcp/server.js", "--storage", "./inline-review.json"]`
- **Transport**: stdio
- **Working directory**: your Astro project root

The `--storage` flag is optional and defaults to `./inline-review.json` relative to the working directory.

## The feedback loop

```
Human reviewer (browser)        AI coding agent (MCP)
────────────────────────        ─────────────────────
1. Browse site in astro dev
2. Select text or Alt+click
   elements, add notes
                         ──────►
                                3. list_annotations → see all feedback
                                4. start_work → signal work starting
                                5. Make source code changes
                                6. finish_work → mark addressed, update
                                   anchor text, and explain changes
                         ◄──────
9. See addressed status and
   agent replies in panel
10. Accept (delete) or Reopen
    with follow-up note
```

1. **Reviewer annotates** — using the browser overlay during `astro dev`, the reviewer selects text or Alt+clicks elements and adds notes describing what needs to change.

2. **Agent reads annotations** — the coding agent calls `list_annotations` to see all review feedback (annotations + page notes) with page URLs, selected text, and reviewer notes.

3. **Agent starts work** — the agent calls `start_work` on an annotation to get full detail and signal that it's working. The browser UI shows a "working" indicator.

4. **Agent makes changes** — using the annotation context (page URL, selected text, reviewer note), the agent locates and modifies the relevant source files.

5. **Agent finishes work** — the agent calls `finish_work` to mark the annotation as addressed, optionally providing the replacement text (for re-anchoring) and a reply message explaining what changed.

5. **Reviewer sees responses** — the browser UI shows addressed annotations with their status and displays agent replies inline, so the reviewer can Accept (delete the annotation) or Reopen with a follow-up note.

## Troubleshooting

### "Server not found" or connection errors

- Ensure the package is installed — the server runs from `node_modules/review-loop/dist/mcp/server.js`
- Check that the path in `.mcp.json` is correct relative to the project root
- Verify Node.js >= 20 is available in your PATH

### Empty results from list_annotations

- Check that `inline-review.json` exists and contains annotations
- If using a custom `--storage` path, verify it points to the correct file
- The MCP server reads from disk on every call — if the file was just created, it should be picked up immediately

### Storage path errors

- Paths in `--storage` are resolved relative to the current working directory, not the server script location
- Use an absolute path if relative resolution is causing issues

### Tools not appearing in the agent

- Some MCP clients cache tool lists — restart the agent or reconnect the MCP server
- Verify the server starts without errors: `node ./node_modules/review-loop/dist/mcp/server.js` should run silently (output goes to stderr only on errors)

See [MCP Guide](./mcp.md) for detailed documentation of each tool and the complete agent workflow.
