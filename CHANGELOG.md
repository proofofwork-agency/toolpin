# Changelog

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
