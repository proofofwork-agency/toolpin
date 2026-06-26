# ToolPin — Analysis #8 (release gate for 0.2.0)
*opencode (glm-5.2) · 26 Jun 2026 · 4 read-only research agents + empirical verification · HEAD now `ddfda6e`*

This audit was the gate for tagging/releasing **0.2.0**. Verdict up front, then evidence.

---

## STABILITY VERDICT: ✅ SOLID — release-ready

- **Build:** clean (`tsc`, 0 errors).
- **Tests:** **233/233 pass** in a clean environment (see note below on a local-only artifact).
- **Clean-clone build:** ✅ now works — the previously-untracked functional files (`packageIntegrity.ts`, `safeFetch.ts`, `verificationTrust.ts`, `check-doc-consistency.mjs`, 2 tests) are committed in `ddfda6e`. A fresh `git clone && npm ci && tsc` succeeds.
- **No secrets** in the tree; `.toolpin/`, `dist/`, `node_modules/` are gitignored and not shipped.
- **Distribution:** `release.yml` uses `npm publish --provenance` with `id-token: write`; tarball `files[]` is an explicit allowlist (no CLA/DISCLAIMER/analysis scratch leak).

### One local-only artifact (NOT a regression)
Running `npm test` in the maintainer's repo cwd initially showed **2 fails / 233**. Root cause: the gitignored `.toolpin/registries.json` has `glama/smithery/pulsemcp` set `enabled:true` (leftover from testing the directory unblock). That overrides the disabled-by-default **only in the local cwd**. With `.toolpin` moved aside (clean-checkout equivalent): **233/233 pass, 0 fail.** CI runs in a clean checkout, so the release workflow is green. The code is correct; the failures were local user-preference state.

---

## Security — every gate intact, zero new holes (vs analysis-7)

| Gate | State | Evidence |
|---|---|---|
| **OCI digest spoof** (publisher-controlled host → `verified`) | ✅ CLOSED | `trustedOciRegistry()` allowlist runs **before** any fetch (`verify.ts:418-426`); non-allowlisted host → `unavailable`/`trustedAnchor:false`. Asserted at `test/verify.test.js:159-168`. |
| **SSRF / private-IP** | ✅ CLOSED | `safeFetch` https-only + `redirect:"error"` + full IPv4/IPv6 private-range block incl. all `::ffff:`/`::`-mapped forms (`safeFetch.ts:101-134`). |
| **LFI** (`readArtifactBytes`) | ✅ CLOSED | No `readFile` on registry input; MCPB local/`file://`/http → `unavailable` (`verify.ts:333-350`). |
| **MCPB** | ✅ allowlisted (not disabled) | `trustedMcpbSourceHost` checked before fetch (`verify.ts:352-361`); `TRUSTED_MCPB_SOURCES`. |
| **npm SRI** | ✅ live | Exact-version pin, dual host allowlist (packument + tarball), sha512 recompute (`packageIntegrity.ts`). |
| **3-anchor `verified`** | ✅ intact | `verifiedProvenance && hasUsablePinEvidence && hasFreshTrustedArtifactEvidence` (7-day) (`trust.ts:131`). |
| **Smithery hosted** | ✅ opt-in | Default no-op + reason; `--allow-hosted-directory-targets` gates the detail fetch + install. |
| **Glama re-resolution** | ✅ refuse-on-ambiguity | Canonical repo match → name disambiguation → refuse if still ambiguous (`registry.ts:1607-1617`). |

**One sound widening since analysis-7:** the provenance gate (`trust.ts:88`, `verify.ts:43`) now also accepts `resolvedFromRegistry === "official"`, so a Glama server re-resolved to a curated official entry can reach `verified` once byte-verification passes. This is safe: `resolvedFromRegistry` is a purely internal field set only inside `enrichGlamaTarget` on a unique official match; without `--verify` there's no fresh artifact evidence, so it still caps at `conditional`, and `--require-verified`/`minTrustTier:verified`/`requireToolPinVerifiedEvidence` all still block.

**Latent residuals (unchanged from analysis-7, not reachable today):** NAT64 `64:ff9b::/96`, `fec0::/16`, DNS-rebinding TOCTOU (resolved IP not pinned into the dial). Low-med; allowlist gates first. Tighten before any new caller relies on `safeFetch` as a generic backstop.

## Registry — the "last mile" landed (vs analysis-7)
- **Gate is target-based** with a Glama carve-out: Glama discovery entries are non-installable until `enrichGlamaTarget` re-resolves them to official (`registry.ts:971-974`).
- **Name-extraction bug fixed** (`firstNonEmptyString`, prefers `qualifiedName`/`packageName` over empty `slug`) — Smithery/Glama entries that were silently dropped are now recognized.
- **Source descriptions corrected** (no longer claim installs are "disabled").
- **Discovery sources disabled by default** (opt-in via `toolpin registry enable`) — intentional, fail-loud if a disabled source is requested directly.
- D8 clean (0 unsafe casts), cache TTL 24h fail-loud, D5 still 5 metadata-only curated entries.

## CLI/UX — no regressions
- `toolpin audit` defaults to `--scope all`, threading scope into inventory + doctor + secrets (lockfile/policy inherently project-scoped).
- `findServer` runs `enrichGlamaTarget(await enrichSmitheryTarget(...))`; `--allow-hosted-directory-targets` in `KNOWN_FLAGS`; `resolutionNote` shown in info/install.
- Universal `--help`, typo detection (`Did you mean…`), `--flag=value` all intact.
- **Browse vs Sources explained:** Browse is double-capped (`MAX_RESULT_LIMIT=500` search cap + a display cap starting at 50, grown via `m`); Sources shows uncapped per-source totals. So Sources can read `400 + 300` while Browse tops out at ~500. They measure different things.

## Docs / legal — honest, no overclaim
- README leads with a "No warranty — you assume all risk" callout; `DISCLAIMER.md` (liability cap, indemnity) and `CLA.md` (Apache-ICLA + transparent relicense clause) are sound and correctly note "template — have a lawyer review."
- `trust-explained.md` / threat-model keep the "verified ≠ safe" honesty; no sigstore/SLSA/prompt-injection claims.
- `check-doc-consistency.mjs` guards doc drift and runs in `release:check`.

## Known limitations (honest, non-blocking for 0.2.0)
- `verified` = "automated evidence passed," **not** "safe." No sigstore/cosign identity proof, no full-image byte recompute. (Next tier on the roadmap.)
- Discovery installs default to executable-at-`conditional` (no auto `--require-verified`); they cannot be abused to *claim* `verified`, but `conditional` is installable. Recommend `--require-verified` in shared repos.
- Public-site `docs/site/concepts/threat-model.md:24/37` slightly underclaims OCI / contradicts MCPB — cosmetic; `check-doc-consistency.mjs` doesn't cover that file yet.
- `cli.ts` is a 1713-line god-module; `--require-verified` is duplicated 10× and `isFloatingVersion` in 3 files. Refactor candidate, not a blocker.
- Glama↔official overlap is near-zero, so most Glama servers hit the honest "install via the publisher's repo" fallback. Correct behaviour, not a bug.

## Release decision
**Solid → tag and release 0.2.0.** Version bumped (`package.json` 0.1.0 → 0.2.0); CHANGELOG updated; committed as `ddfda6e` and pushed to `main`. The `v0.2.0` tag triggers `release.yml` (`on: push: tags: v*`) → `npm publish --provenance`. The pre-existing `v0.1.0` tag is left untouched at the older pre-hardening commit (it was never npm-published), so 0.2.0 is the first public release and the tag a consumer can pin to the hardened tree.

*— opencode (glm-5.2), analysis-8. Release-gate audit for 0.2.0.*
