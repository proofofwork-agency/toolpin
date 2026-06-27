# Changelog

## 0.2.4

- Release hygiene: version bump 0.2.3 -> 0.2.4 because 0.2.3 was already published.
- Package hygiene: clean `dist/` before every TypeScript build so removed generated files cannot be packed into npm tarballs.
- TUI command help: align the command palette with the actual broad registry refresh settings and the preferred `toolpin audit server <server-name>` syntax.
- Docs/readme polish: update public Action examples, package-facing README resource links, registry mirror URLs, roadmap/threat-model scope, and README terminal artwork for the live npm release.
- Action metadata: remove pre-publication wording from the `toolpin-version` input description.

## 0.2.3

- Honesty pass: the README "Verification currently covers" line and `docs/site/reference/lockfile-schema.md` now describe attestations as declared metadata, not verified, and `attestation_verified` was removed from the evidence-code list. A `docs:check` regression guard forbids the overclaiming phrasing so it cannot silently return.
- CI self-check (dogfooding): `toolpin ci` now runs against the repository's own `mcp-lock.json` in CI (`npm run self:ci`) and is chained into `release:check`, so the publish gate enforces the product's own drift check on itself.
- Curated-evidence trust seam closed: registry evidence sourced from the ToolPin curated registry may only count toward the `verified` tier when its `trustAnchor` host is on the code allowlist for that evidence code (npm packument/tarball hosts, allowlisted OCI registries, allowlisted MCPB sources). A self-declared `trustedAnchor: true` with a missing or non-allowlisted host is downgraded to `trustedAnchor: false`. Regression test added.
- Policy source normalization: the legacy `pulse` alias in `allowedSources`/`deniedSources` is accepted and normalized to the canonical `pulsemcp`, `toolpin` was added to the source enum, and unknown sources fail closed. Tests added.
- CLI docs: corrected `toolpin lock sign`/`verify-signature` synopses in the CLI reference and the catch-drift how-tos to include the required `--policy` argument and the `--public-key` flag.
- Runtime audits: `npm run audit:runtime` (`npm audit --omit=dev`) added to `release:check`.
- TUI review UX: the default Browse search is empty instead of prefilled with `github`, empty Browse now lists registry entries without a hidden fallback keyword, and the footer includes a compact trust-state legend (`OK`, `REVIEW`, `UNVERIFIED`, `BLOCKED`).
- Repo hygiene: stopped tracking the internal `docs/research/mcp-sentiment.md` positioning brief and the `website/CLAUDE-DESIGN-BRIEF.md` design deck (now gitignored); marked the homepage install demo as an illustrative placeholder and surfaced the pre-1.0 beta status on the landing page; kept npm distribution claims honest before publication.
- Release hygiene: version bump 0.2.2 -> 0.2.3.

## 0.2.2

- Release positioning: mark ToolPin as pre-1.0 beta software in the README while keeping the package on the normal `0.x` semver release track.
- Distribution: switch the npm package target to `@proofofwork-agency/toolpin` while keeping the `toolpin` and `tpn` CLI binaries.
- README/docs: lead with npm-first install and CI examples, call out the `tpn` shortcut, add an animated terminal workflow plus TUI screenshots to the README, and keep source-checkout commands as development-only fallbacks.
- Curated ContextRelay verification: accept ToolPin-owned npm tarball integrity evidence from the curated registry, validate it against `registry.npmjs.org`, and show verified curated entries as evidence-complete without overriding ordinary registry metadata rules.
- Registry cache correctness: invalidate stale built-in ToolPin cache partitions when the bundled curated registry snapshot changes, so users do not keep seeing removed or outdated trusted listings after upgrading.
- Installed inventory: expose stale lock-only rows as deletable in the TUI and remove stale lock entries from the repo lockfile so audit no longer reports servers that are gone from client config.
- ContextRelay install metadata: clarify that Codex support is a stdio MCP registration, not a Codex plugin, and document the upstream `ctxrelay codex-mcp install` path alongside ToolPin's direct Codex config install.
- Contributor workflow: make curated-registry PRs ask explicitly for install targets, runtime/package details, and per-client setup fields.
- Release hygiene: defer the pending npm release from `0.2.1` to `0.2.2` so the evidence, cache invalidation, and install-metadata changes are represented in the published version.

## 0.2.1

- Publish readiness: aligned the npm package homepage gate with the public GitHub Pages documentation site.
- Release identity: bumped the package/runtime version past the existing `v0.2.0` tag so the npm artifact can be tagged from the final release commit without moving an old tag.
- Public registry/docs polish: keep the curated registry focused on the ToolPin ContextRelay entry, sync CLI/help examples, and preserve the `release:check` gate as the publish prerequisite.

## 0.2.0

- Gated trust model: separated metadata-completeness from an evidence-gated `verified` tier that requires verified provenance, a pinned install target, and fresh (`verifiedByToolPin`) artifact evidence (≤7 days). Non-verified entries are capped (`conditional`/`unverified`/`blocked`) with a human-readable cap reason.
- Added a code-owned OCI registry allowlist (`verificationTrust.ts`) plus a hardened `safeFetch` (HTTPS-only, private/reserved IPv4 + IPv6 block, timeouts, size caps, `redirect:"error"`). The publisher-controlled-host OCI digest-spoof path is closed: non-allowlisted hosts are rejected before any fetch.
- Artifact verification: OCI registry manifest digest resolution (with critical `oci_digest_mismatch`), MCPB SHA-256 byte recompute for code-allowlisted HTTPS hosts (local/`file://`/HTTP/untrusted stay unavailable), and npm tarball SHA-512 SRI via `registry.npmjs.org` packuments.
- Directory install unblock: discovery sources (Glama, Smithery, PulseMCP) became real adapters. Glama servers install via official-registry re-resolution (canonical repo-URL match, refuse-on-ambiguity). Smithery hosted deployment targets install only with explicit `--allow-hosted-directory-targets` opt-in and are labelled "hosted by Smithery; subject to Smithery terms." Discovery sources are disabled by default and enable via `toolpin registry enable`.
- Policy additions: `minTrustTier`, `requireToolPinVerifiedEvidence`, `denyRemoteEndpoints`, `denyRequiredSecrets`, all enforced fail-closed across install/CI/lifecycle/TUI.
- Governance: `toolpin audit` aggregates lockfile + installed inventory + drift + secrets + policy + optional verification across `--scope all|project|global` (default `all`). Universal `--help`, typo-tolerant flag parsing (`Did you mean ...`), and `--flag=value` support.
- Repo/legal: added `DISCLAIMER.md` (no warranty, liability cap, indemnity), `CLA.md` (Apache-ICLA-based, with transparent relicense clause), `.cla-signatures/`. README leads with a "No warranty — you assume all risk" callout. Release workflow uses `npm publish --provenance`.
- Honest non-goals unchanged: `verified` means automated evidence checks passed, not that a server is safe; no sigstore/cosign identity proof, no full-image byte recompute, no prompt-injection detection.

## 0.1.0

- Initial prerelease hardening track for ToolPin lockfiles, policy checks, registry normalization, CI drift detection, and TUI review workflows.
- Hardened `safeFetch` against IPv4-mapped and IPv4-compatible IPv6 private-address forms before artifact fetches.
- Added trusted OCI registry-digest evidence, including critical mismatch handling for digest-pinned OCI targets.
- Re-enabled MCPB SHA-256 verification for code-allowlisted HTTPS artifact hosts while keeping local paths, `file://`, HTTP, and untrusted hosts unavailable.
- Added npm package integrity verification through `registry.npmjs.org` packuments, exact versions, `dist.integrity`, trusted npm tarball hosts, and SHA-512 SRI comparison.
