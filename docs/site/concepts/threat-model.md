---
title: Threat Model
---

# Threat model

ToolPin operates before MCP servers run. It improves review, reproducibility,
and CI enforcement for installs, but it is not a runtime gateway or sandbox.

## Assets

| Asset | Why it matters |
|---|---|
| Agent credentials and environment | MCP servers run with the user's OS permissions and may receive API tokens or filesystem access. |
| Agent tool surface | Tool names and descriptions influence model behavior. |
| `mcp-lock.json` | The committed governance artifact for reviewed installs. |
| `.toolpin/policy.json` | The local policy gate for install and CI decisions. |
| CI exit codes | A failed `toolpin ci` should block unreviewed drift. |

## In scope

| Threat | ToolPin defense | Limit |
|---|---|---|
| Mutable OCI tags | Trust and policy checks can require selected OCI identifiers to include `@sha256:`. | Presence check only; ToolPin does not fetch and recompute image bytes. |
| MCPB bundles without declared integrity | Trust and policy checks can require `fileSha256`; `verify` recomputes SHA-256 when bytes are available from file or HTTP. | Unavailable bytes are explicit `unavailable` evidence, not a verified result. |
| Incomplete automated evidence | Trust tiers and cap reasons show when metadata is strong but artifact proof is missing. | A cap is a review signal, not runtime containment. |
| Insecure remotes | Non-HTTPS or invalid remote URLs are critical trust issues. | Runtime behavior after install is outside ToolPin. |
| Lockfile tampering | Per-entry integrity, whole-lock digest pins, and detached Ed25519 signatures can detect changes. | Signatures depend on out-of-band key management and branch protection. |
| Install drift | `install` and `ci` compare resolved plans with the lockfile and fail on drift. | Trust-score increases are not treated as a failure. |
| Policy violations | Local JSON policy can reject sources, clients, servers, package types, transports, remote hosts, and missing pins. | `--no-policy` is an explicit bypass; the policy file is not signed by ToolPin. |
| Plaintext secrets in config | `toolpin secrets audit` reports redacted advisory findings. | Advisory only; not a DLP engine. |

## Out of scope

- Runtime sandboxing or network mediation.
- Reliable prompt-injection detection.
- Byte-level OCI or MCPB artifact verification.
- Sigstore, transparency logs, SLSA provenance, or SBOM verification.
- Preventing a malicious running server from exposing misleading tools.
- Secret brokering at runtime.

## Recommended posture

- Commit `mcp-lock.json`.
- Run `toolpin ci --live` on pull requests.
- Store `toolpin lock digest` output outside the pull request path when using
  `--expect-digest`.
- Keep Ed25519 private keys outside the repository when signing lockfiles.
- Review `.toolpin/policy.json` changes like application code.
- Use runtime controls from clients, gateways, containers, and secret managers
  for defenses ToolPin does not provide.
