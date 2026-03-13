---
name: demo
description: Use when the user asks to start, stop, or manage the ReviewLoop demo app, or wants to try out ReviewLoop interactively in the browser
user_invocable: true
---

# Demo App

Start or stop the ReviewLoop demo app.

## Arguments

- `start` or no argument — start the demo dev server
- `stop` — stop the running demo dev server

## Start

### 1. Build the package (if needed)

Check if `dist/` exists at the repo root. If not, build first:

```bash
fish -c "npm run build"   # from repo root
```

### 2. Install demo dependencies (if needed)

```bash
fish -c "cd demo && npm install"
```

### 3. Start the dev server

Run as a **background task**:

```bash
fish -c "cd demo && npm run dev"
```

Wait for output (non-blocking check after a few seconds), then parse the URL from the `Local` line (usually `http://localhost:4321/`, but it increments if the port is busy).

### 4. Show the user this message

Replace `URL` with the actual URL from step 3:

---

**Demo running at URL**

The site is "SynergyFlow" — a fictional SaaS product written in deliberately bad AI-generated style, giving you plenty to annotate.

**Pages to explore:**

| Page | What to look for |
|------|-----------------|
| **Home** (`/`) | Buzzword features, hollow testimonials, repeated "Get Started" buttons |
| **About** (`/about`) | Corporate speak, interchangeable team bios, empty values |
| **Blog** (`/blog`) | AI writing tells: "delve", "tapestry", formulaic structure |
| **Pricing** (`/pricing`) | Vague tier differentiation, identical tone across cards |

**Try the full ReviewLoop workflow:**

1. Browse the site and find text that reads like AI slop
2. **Select text** you want to flag and add an annotation with your feedback
3. Try **Alt+clicking** an element to annotate a whole component
4. Open the **ReviewLoop panel** (clipboard button, bottom-right) to see your annotations
5. Come back here and say: **"check review-loop and address the annotations"**

I'll use the MCP tools to read your feedback and update the demo site.

---

## Stop

1. List running background tasks to find the demo dev server
2. Stop the task
3. Confirm: "Demo app stopped."

## Notes

- The demo runs on port 4321 by default, falling back to the next available port
- ReviewLoop is automatically active in dev mode — no configuration needed
- Annotations persist in `demo/inline-review.json`
- After a demo, reset source changes with `git checkout demo/src/`