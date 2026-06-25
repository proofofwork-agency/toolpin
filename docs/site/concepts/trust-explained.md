---
title: Trust Explained
---

# Trust explained

ToolPin trust is a deterministic review score over registry metadata and the
selected install target. It is designed to sort attention and enforce local
policy thresholds, not to certify that a server is safe to run.

## Score scale and computation

Every server starts at a base of **50**. Signals add or subtract points, the
running total is rounded, then clamped to **0–100**. The score is deterministic
review over registry metadata and the selected install target — it sorts
attention and feeds local policy thresholds; it does not certify that a server
is safe to run.

```text
score = clamp(round(50 + serverSignals + Σ packageSignals + Σ remoteSignals), 0, 100)
```

## Trust signals

The factors below are evaluated in `src/trust.ts`. Point values are exact.

### Server-level signals

| Signal | Condition | Score effect | Issue / badge |
|---|---|---|---|
| Source repository | `repositoryUrl` present | **+8** | badge `source repo` |
| Source repository missing | `repositoryUrl` absent | **−8** | warning `missing_repository` |
| Namespaced name | `name` contains `/` | **+6** | badge `namespaced` |
| No install target | no `packages` and no `remotes` | **−35** | critical `no_install_target` |
| Declares secrets | `requiresSecrets` is true | **−6** | info `requires_secrets`; badge `requires secrets` |
| Legacy transport | transports include `sse` | **−4** | info `legacy_transport` |

### Per-package signals (`packageScore`, summed for every package)

| Signal | Condition | Score effect | Issue / badge |
|---|---|---|---|
| Supported registry type | type in `npm, pypi, nuget, cargo, oci, mcpb` | **+5** | badge = type |
| Unknown registry type | type not in the supported set | **−8** | warning `unknown_package_type` |
| Strong registry type | type in `oci, mcpb` | **+4** | — |
| Pinned version | `version` present and not floating | **+5** | badge `pinned version` |
| Floating version | floating `version` and type ≠ `oci` | **−6** | warning `unpinned_package` |
| OCI digest pin | `oci` and identifier has `@sha256:` | **+8** | badge `digest-pinned` |
| OCI mutable tag | `oci` and identifier lacks `@sha256:` | **−10** | critical `mutable_oci_tag` |
| MCPB hash | `mcpb` and truthy `fileSha256` | **+8** | badge `fileSha256` |
| MCPB hash missing | `mcpb` and no `fileSha256` | **−12** | critical `missing_mcpb_hash` |

A version is treated as floating if it is `latest` or `*`, or contains any of
`~ ^ x *` (case-insensitive) — e.g. `^1.2.3`, `~1.2`, `1.x`. OCI packages are
exempt from the unpinned-version penalty; the digest pin is the stronger
signal there.

### Per-remote signals (`remoteScore`, summed for every remote)

| Signal | Condition | Score effect | Issue / badge |
|---|---|---|---|
| Remote declared | each remote | **+6** | badge = remote type |
| HTTPS remote | parsed URL protocol is `https:` | **+6** | badge `https remote` |
| Insecure remote | parsed URL protocol is not `https:` | **−15** | critical `insecure_remote` |
| Invalid remote URL | URL cannot be parsed | **−15** | critical `invalid_remote_url` |
| Streamable HTTP | remote type is `streamable-http` | **+4** | — |

### Badges and findings that do not change the score

`latest`, `capability-pinned`, attestation badges, and the
`description-scan-advisory` badge are recorded without a score delta. Advisory
tool-description scan findings (from `scanServerMetadata`) are appended as
issues for human review, not as score changes.

## How severity maps to enforcement

Critical issues make `toolpin verify` report `ok: false` and can fail installs
through policy. Warnings and info issues are surfaced for human review and
policy decisions. `minTrustScore` in `.toolpin/policy.json` (an optional
0–100 number; there is no built-in default) enforces a numeric floor against
the final clamped score.

## Verification boundaries

ToolPin checks registry metadata, declared integrity pins, and lockfile drift.
When `--verify` can reach a live server, it can hash normalized tool names and
descriptions from `tools/list` and store that hash in the lockfile.

ToolPin does not:

- Download OCI images and recompute the image digest.
- Download MCPB bundles and recompute `fileSha256`.
- Prove publisher identity with sigstore or provenance attestations.
- Detect prompt injection reliably.
- Sandbox a server after it starts.

Use the score as an install-time gate, then combine it with code review, branch
protection, runtime isolation, secret management, and client-side tool approval.
