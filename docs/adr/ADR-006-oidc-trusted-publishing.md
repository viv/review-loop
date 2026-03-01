---
status: accepted
date: 2026-03-01
decision_makers: [matthewvivian]
tags: [ci-cd, npm, publishing, security, oidc]
---

# ADR-006: OIDC Trusted Publishing Over Token-Based Auth

## Status

Accepted

## Context

review-loop is published to npm via a GitHub Actions workflow triggered by git tag pushes (`v*`). The workflow needs to authenticate with npm to publish the package. The choice of authentication mechanism affects security posture, operational burden, and auditability.

npm introduced Trusted Publishers (OIDC-based authentication) as a GA feature on 31 July 2025, providing an alternative to the traditional approach of storing long-lived npm access tokens as GitHub repository secrets.

Issue [#14](https://github.com/viv/review-loop/issues/14) documented three problems with the token-based approach that motivated the migration.

## Options Considered

### Option 1: OIDC trusted publishing (chosen)

Configure npm to trust GitHub Actions workflows from a specific repository. During a workflow run, GitHub mints a short-lived OIDC identity token; the npm CLI exchanges it for a single-use publish credential.

**Pros:**
- No secrets to manage — no npm token stored in GitHub Secrets, no rotation schedule
- Short-lived credentials — each publish gets a fresh credential valid only for that workflow invocation
- Cryptographically bound — the credential is tied to a specific repository, workflow file, and run
- Provenance attestation — `npm publish --provenance` uses the same OIDC identity to cryptographically link the published package to the exact commit and workflow run
- Audit trail — npm records which workflow run published each version, not just "a token published it"
- Leak-proof — there is no long-lived token that could be extracted from GitHub Secrets and used elsewhere

**Cons:**
- Requires npm CLI 11.5.1+ for OIDC support — Node.js 22's bundled npm (10.x) is too old, so the workflow must explicitly upgrade npm
- One-time setup on npmjs.com is not validated at save time — typos in the workflow filename only surface as auth errors at publish time
- Newer mechanism with less community familiarity (as of early 2026)
- Tied to GitHub Actions — moving CI to another provider would require a different auth approach

### Option 2: Long-lived npm access token

Store an npm automation token as a GitHub repository secret (`NPM_TOKEN`) and pass it to `npm publish` via the `NODE_AUTH_TOKEN` environment variable.

**Pros:**
- Well-established pattern — widely documented and understood
- Works with any CI provider — not tied to GitHub Actions specifically
- Simple setup — generate token on npmjs.com, paste into GitHub Secrets

**Cons:**
- Token rotation burden — should be rotated periodically, but in practice often is not
- Secret sprawl — the token is stored in GitHub, visible to repository admins, and must be tracked
- Leak impact — a compromised token grants persistent publish access until discovered and revoked
- No identity binding — the token authenticates as the npm user, not as a specific workflow run
- Weaker audit trail — npm logs show "published by user X" rather than "published by workflow Y in repo Z at commit ABC"
- No provenance without additional configuration — provenance attestation requires OIDC `id-token: write` permission regardless

### Option 3: Granular access token with IP restrictions

Use an npm granular access token scoped to specific packages with CIDR range restrictions.

**Pros:**
- More restrictive than a classic automation token — limited to specific packages and IP ranges
- Reduces blast radius of a leak compared to a full-access token

**Cons:**
- Still a long-lived secret that requires rotation
- GitHub Actions runner IPs change frequently — maintaining CIDR allowlists is impractical
- Does not provide the cryptographic binding or provenance benefits of OIDC
- Same secret management burden as Option 2

## Decision

Use OIDC trusted publishing for npm authentication. The release workflow (`.github/workflows/release.yml`) declares `permissions: { id-token: write }` and calls `npm publish --provenance --access public` without any stored secrets.

The workflow explicitly upgrades npm to the latest version to ensure OIDC support, since Node.js 22's bundled npm (10.x) does not include it.

The trusted publisher is configured on npmjs.com with:
- Repository owner: `viv`
- Repository name: `review-loop`
- Workflow filename: `release.yml`

This configuration was set up alongside the first release under the `review-loop` package name (v0.2.0).

## Consequences

**Positive:**
- Zero secrets to manage — no token rotation, no secret sprawl, no risk of leaked credentials
- Every published version is cryptographically traceable to a specific commit, workflow run, and repository via npm provenance
- The `prepublishOnly` script (`npm run build && npm test`) provides a safety net against accidental local publishes — it will fail the build step, and even if bypassed, local machines lack the OIDC identity to authenticate with npm
- Multiple safety layers (CI on every push, version-tag validation, prepublishOnly, provenance, OIDC binding) make it difficult to publish a bad or tampered version

**Negative:**
- The npm upgrade step in the workflow adds a small amount of CI time and a dependency on npm's release cadence
- Moving to a non-GitHub CI provider would require re-implementing authentication (though the package could fall back to token-based auth if needed)
- The npmjs.com trusted publisher configuration does not validate at save time — a typo would only be caught at the next publish attempt
