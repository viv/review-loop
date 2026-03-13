---
name: release
description: Use when the user wants to publish a new version to npm. Bumps version, commits, tags, and pushes to trigger the automated release workflow.
user_invocable: true
---

# Release

Publish a new version of review-loop to npm by bumping the version, committing, and pushing a tag that triggers the GitHub Actions release workflow.

## Prerequisites

- You must be on the `main` branch with a clean working tree
- CI must be passing on `main`

## Arguments

The user should specify a version bump: `patch`, `minor`, `major`, or an explicit version like `1.0.0`.

Examples: `/release patch`, `/release minor`, `/release 1.0.0`

If no argument is provided, ask which version bump they want. Show the current version to help them decide.

## Process

1. **Pre-flight checks** — run in parallel:
   - `fish -c "git branch --show-current"` — must be `main`
   - `fish -c "git status --porcelain"` — must be empty (clean working tree)
   - `fish -c "git fetch origin main && git rev-list HEAD..origin/main --count"` — must be `0` (up to date with remote)
   - `fish -c "node -p \"require('./package.json').version\""` — show current version
   - `fish -c "git tag --sort=-v:refname | head -3"` — show recent tags

   If any check fails, stop and explain what needs fixing. Do not proceed.

2. **Run the build and tests** — run in parallel:
   - `fish -c "npm run build"`
   - `fish -c "npm test"`
   - `fish -c "npm run lint"`

   If any fail, stop. Do not proceed with a broken build.

3. **Bump version** — this updates `package.json`, `package-lock.json`, creates a commit, and creates the tag in one command:
   ```bash
   fish -c "npm version <patch|minor|major|1.0.0> -m 'chore: release v%s'"
   ```

4. **Confirm before pushing** — show the user:
   - The new version number
   - The commit that was created
   - The tag that was created
   - Ask for explicit confirmation before pushing

5. **Push commit and tag** — once confirmed:
   ```bash
   fish -c "git push origin main --tags"
   ```

6. **Verify** — confirm the push succeeded and tell the user:
   - The GitHub Actions release workflow will now run automatically
   - It will build, test, validate version against tag, publish to npm with provenance, and create a GitHub Release
   - Link to the Actions tab: `https://github.com/viv/review-loop/actions`

## If something goes wrong after tagging but before pushing

```bash
fish -c "git tag -d v<version>"
fish -c "git reset HEAD~1"
```

This removes the local tag and undoes the version commit, letting them fix and retry.

## If the workflow fails after pushing

```bash
# Delete the tag locally and remotely
fish -c "git tag -d v<version>"
fish -c "git push origin :refs/tags/v<version>"

# Fix the issue, then re-tag and push
fish -c "git tag v<version>"
fish -c "git push origin main --tags"
```

## Important notes

- Never skip the pre-flight checks or build/test steps
- Never push without explicit user confirmation
- The `prepublishOnly` script in package.json guards against accidental local publishes
- Authentication uses OIDC trusted publishing — no tokens or secrets needed