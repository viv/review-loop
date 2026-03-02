---
generated_by: Claude Opus 4.6
generation_date: 2026-03-02
model_version: claude-opus-4-6
purpose: demonstrator_guide
status: draft
human_reviewer: matthewvivian
tags: [demo, review-loop, demonstrator]
---

# Review Loop Demonstrator

A multi-page Astro site that demonstrates Review Loop's annotation features. The site presents "SynergyFlow", a fictional SaaS product whose content is deliberately written in AI-generated style, giving reviewers plenty to annotate.

## Pages

| Page | Purpose |
|------|---------|
| **Home** (`/`) | Landing page with buzzword features, hollow testimonials, and repeated "Get Started" buttons |
| **About** (`/about`) | Company story with corporate speak, interchangeable team bios, and empty values |
| **Blog** (`/blog`) | Full article using every common AI writing pattern: "delve", "tapestry", formulaic structure |
| **Pricing** (`/pricing`) | Pricing cards with vague differentiation, identical tone across tiers |

## Running the demo

```bash
cd demo
npm install
npm run dev
```

The site runs on `http://localhost:4321`. Review Loop is automatically active in dev mode.

## Guide widget

The guide is distributed across the site as a floating panel (bottom-left corner). Click "Guide" in the navigation to toggle it. The panel shows:

- Three getting-started steps (select text, Alt+click elements, open the panel)
- A contextual tip specific to whichever page you're on
- A one-liner for AI agent integration via MCP

There is no separate guide page — the widget is always available as you browse.

## What the text contains

The AI-generated copy across the site deliberately includes patterns that are widely recognised as AI writing tells:

**Vocabulary**: "delve", "tapestry", "leverage", "seamless", "robust", "holistic", "actionable insights", "cutting-edge", "world-class", "passionate about"

**Structural patterns**:
- Formulaic openings ("In today's fast-paced digital age...")
- Unnecessary hedging ("aims to", "seeks to", "tries to")
- Em dash overuse where commas or full stops would work
- Staccato dramatic fragments ("Not theoretical. Practical.")
- Label-colon-explanation pattern ("The foundation: world-class security...")
- Antithetical phrasing ("it's not X — it's Y") used heavily on every page
- "I" repetition (four consecutive sentences starting with "I")
- Perspective shifts (switching from "I" to "you" mid-paragraph)
- Conclusions that restate everything and add nothing
- Bold text on every key term in lists

**Locale**: US English is used throughout ("organization", "optimize") where UK English would be appropriate.

## Design issues

The design is broadly fine but includes a few things worth flagging:

- All three feature cards on the home page have identical structure and identical button text
- Every call-to-action says "Get Started" regardless of context (including Enterprise "Contact Sales")
- Pricing tier descriptions are nearly identical in tone, making it hard to differentiate value
- The testimonials are hollow and interchangeable

## How to use it

### For live demonstrations

1. Start the dev server
2. Click "Guide" in the navigation — the floating panel explains the basics
3. Browse the site, select text, Alt+click elements, add page notes
4. Open the Review Loop panel (bottom-right button) to see annotations grouped by page

### For AI agent demonstrations

1. Create some annotations using the browser UI
2. Connect an AI agent via MCP, then ask it to "check Review Loop"
3. Annotations are stored in `inline-review.json` at the demo root

## Git protection

A pre-commit hook prevents accidental commits of changes to `demo/src/`. When someone demos Review Loop and an agent fixes the AI slop text, those changes are blocked from being committed.

- To reset after a demo: `git checkout demo/src/`
- To commit intentional updates: `ALLOW_DEMO_CHANGES=1 git commit ...`

## Rationale

The existing examples in `examples/` are minimal integration guides — they show developers how to add Review Loop to Astro, Vite, or Express projects. This demonstrator serves a different purpose: it provides a realistic canvas of content with genuine problems to annotate, so that people evaluating or learning Review Loop can experience the full workflow without needing to set up their own project first.

The AI slop text is not random — each pattern is a well-documented, widely-mocked tell of AI-generated writing. This makes the annotations feel natural rather than contrived. A reviewer encountering "delve into the tapestry of innovation" would genuinely want to flag it, which is exactly the kind of authentic experience the demonstrator aims to provide.
