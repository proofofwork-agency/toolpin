---
title: Trust Explained
---

# Trust explained

ToolPin separates metadata completeness from evidence. The numeric score is a
deterministic review score over registry metadata and the selected install
target. The tier is evidence-gated: `verified` means automated evidence checks
passed, not that a server is safe to run.

## Score scale and computation

Every server starts at a base of **50**. Signals add or subtract points, the
running total is rounded, then clamped to **0–100**. The score sorts attention
and feeds local policy thresholds; it is not the same as the trust tier.

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

## Evidence and tiers

`TrustReport.evidence` records automated evidence separately from badges:

| Evidence code | Status | Meaning |
|---|---|---|
| `package_pin` | `declared` / `failed` | Package registry target declares an exact version, or an OCI target declares a digest pin. This is metadata, not byte verification. |
| `digest_present` | `declared` / `failed` | OCI identifier includes `@sha256:`. This means the pin is present; `oci_digest_verified` records registry verification. |
| `file_hash_present` | `declared` / `failed` | MCPB package declares `fileSha256`. This means the hash is present; `mcpb_sha256_verified` records byte hashing. |
| `oci_digest_verified` | `passed` / `failed` / `unavailable` | ToolPin resolved the OCI manifest digest through the registry API, or could not. |
| `mcpb_sha256_verified` | `passed` / `failed` / `unavailable` | ToolPin read MCPB bytes from a code-allowlisted HTTPS artifact host and recomputed SHA-256, or could not. |
| `npm_integrity_verified` | `passed` / `failed` / `unavailable` | ToolPin fetched the npm packument from `registry.npmjs.org`, required exact version `dist.integrity`, fetched a trusted npm tarball, and compared SHA-512 SRI. |
| `lock_integrity` | `passed` | New lock entries include an integrity digest over the reviewed install plan, including entry timestamps. |
| `tool_description_hash` | `passed` / `failed` / `unavailable` | Live package or remote `tools/list` descriptions were hashed, failed, or were skipped. |
| `attestation_declared` | `declared` | Attestation metadata exists, but ToolPin has not cryptographically verified it. |

Tiering is conservative:

- `verified`: no critical issues, a pinned install target, and passed evidence with `verifiedByToolPin: true`, such as `oci_digest_verified`, `mcpb_sha256_verified`, `npm_integrity_verified`, or future verified attestations.
- `conditional`: usable metadata or pinning exists, but artifact proof is incomplete or unavailable.
- `unverified`: weak or failed optional evidence, mutable OCI tags, missing MCPB hashes, or other non-blocking critical trust gaps.
- `blocked`: unsafe or uninstallable cases such as no install target, insecure remote URLs, invalid remote URLs, or failed required evidence checks.

Repository URL presence, registry source trust, `capability-pinned`, and
self-declared attestations are useful review metadata. They do not make a
server `verified` by themselves.

## Why a score can be capped

ToolPin computes metadata completeness and pillar scores first, then caps the
overall score when evidence is missing or a gate fires. This is why the TUI can
show green metadata/pillar bars while the evidence row is red or yellow.

Common cap reasons:

| Cap reason | Meaning |
|---|---|
| `automated evidence incomplete` | Metadata and package pinning may look good, but ToolPin has not verified artifact bytes/provenance: an OCI `@sha256:`, MCPB `fileSha256`, or npm exact version may be declared without a successful `oci_digest_verified`, `mcpb_sha256_verified`, `npm_integrity_verified`, or future verified attestation. Declared attestations alone do not count. |
| `no verified provenance` | The entry is not from an official/Docker source with a repository URL, so provenance is not strong enough for a higher cap. |
| `mutable_oci_tag` | The OCI target uses a mutable tag instead of a digest. |
| `missing_mcpb_hash` | The MCPB target does not declare `fileSha256`. |
| `veto: ...` | A blocked critical issue, such as no install target or an insecure/invalid remote URL, forces the score down. |

CLI and TUI output include a `cap` line with a human-readable explanation when
one of these caps applies.

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
- Guarantee MCPB byte verification when the bundle is unavailable from a
  code-allowlisted HTTPS artifact host.
- Prove publisher identity with sigstore or provenance attestations.
- Detect prompt injection reliably.
- Sandbox a server after it starts.

Use the score as an install-time gate, then combine it with code review, branch
protection, runtime isolation, secret management, and client-side tool approval.
