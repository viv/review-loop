---
status: accepted
date: 2026-02-28
decision_makers: [matthewvivian]
tags: [naming, packaging, branding, multi-framework]
---

# ADR-007: Package Name — review-loop

## Status

Accepted

## Context

The package was originally named `astro-inline-review`, reflecting its origin as an Astro integration. After adding support for Vite and Express/Connect frameworks (see ADR-003), the name actively misrepresented the product — it was no longer Astro-specific.

A rename was needed to:

1. **Remove framework coupling** — the name should not reference Astro, Vite, Next.js, or any specific framework
2. **Convey the product's purpose** — in-browser annotation with an AI agent feedback loop
3. **Be available on npm** — the name must not conflict with existing packages
4. **Be memorable and searchable** — developers should be able to find it and remember it

A thorough evaluation of 70+ candidate names was documented in `docs/ideas/2026-02-24-package-name-candidates.md`, with 32 shortlisted and the rest eliminated for being taken on npm, disliked, or otherwise unsuitable.

## Options Considered

### Option 1: `review-loop` (chosen)

A hyphenated compound that describes the human → agent → human feedback cycle.

**Pros:**
- Captures the core workflow — reviewer annotates, agent acts, reviewer confirms/reopens
- Framework-neutral — no technology names in the package name
- Available on npm
- Reads naturally in both prose and code (`import reviewLoop from 'review-loop'`)
- "Loop" conveys iteration and feedback, which is central to the product

**Cons:**
- "Loop" is somewhat common in developer tooling names
- Does not explicitly signal the annotation or browser overlay mechanism

### Option 2: `redline-ai`

Evokes editorial redlining with an AI agent angle.

**Pros:**
- Strong editorial connotation — "redline" is widely understood as marking corrections
- Short and memorable
- Clear AI positioning

**Cons:**
- npm name taken by an active package in an adjacent space ("inline AI editing for local Markdown files")
- Both GitHub usernames (`redline-ai`, `redlineai`) already claimed
- Heavy brand crowding from legal tech / contract review tools using "Redline AI"
- Risk of confusion with existing products

### Option 3: `annotate-for-agents`

Extremely descriptive — makes the purpose immediately obvious.

**Pros:**
- Self-describing — developers building AI workflows would understand instantly
- Searches well for the target audience

**Cons:**
- Long and awkward as an import name (`import annotateForAgents from 'annotate-for-agents'`)
- Overly literal — does not convey the feedback loop aspect

### Option 4: `earmark`

A single-word metaphor — earmarking means flagging something for attention.

**Pros:**
- Short, memorable, evocative
- The folded page corner is a physical annotation gesture
- Best available single word from the evaluation

**Cons:**
- Modern usage skews toward budget allocation ("earmarked funds")
- Does not convey the agent or loop aspects of the product
- Could be confused with bookmark-adjacent tooling

### Option 5: `markup-loop`

Combines the editorial "markup" metaphor with the feedback loop concept.

**Pros:**
- "Markup" works on two levels — HTML markup and editorial marking
- "Loop" captures the feedback cycle

**Cons:**
- "Markup" strongly connotes HTML to developers, which could cause confusion
- Less clean as a compound than `review-loop`

### Option 6: `astro-inline-review` (original name, rejected)

Keep the existing name.

**Pros:**
- No migration effort
- Existing documentation and any early users reference this name

**Cons:**
- Actively misleading — the package supports Vite and Express, not just Astro
- Couples the brand to a specific framework, limiting perceived applicability
- Would need to be renamed eventually regardless

## Decision

Rename the package to `review-loop`. The name was selected after evaluating 70+ candidates against the constraints (npm availability, no framework names, conveys annotation + agent workflow, developer audience). The rename was implemented in commit `c3a1912` and the first release under the new name was v0.2.0 (`913ab9d`).

The rename touched package.json, all documentation, CI workflows, the Shadow DOM host element ID, CSS class prefixes, localStorage keys, and the MCP server name. Issue [#31](https://github.com/viv/review-loop/issues/31) documented every affected file and identifier.

## Consequences

**Positive:**
- The name accurately represents a framework-agnostic tool — no confusion when used with SvelteKit, Nuxt, or Express
- "review-loop" naturally explains the product to a new user — it is a loop between reviewer and agent
- The name aligns with the product's primary tagline: "Point. Fix. Repeat."
- Available on npm with no namespace conflicts

**Negative:**
- Any early adopters or documentation referencing `astro-inline-review` needed updating — mitigated by the fact that the rename happened before significant external adoption (v0.2.0)
- The rename required updating identifiers throughout the codebase (host element ID, class prefixes, localStorage key, API prefix) — a one-time cost documented in issue #31
- "Loop" is a common suffix in developer tooling, which slightly reduces distinctiveness in search results
