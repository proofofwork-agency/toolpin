---
title: Lockfile Schema
---

# `mcp-lock.json` schema

ToolPin writes lockfile version 2. The file is keyed by `server:client`, so one
server can be locked differently for different MCP clients.

```json
{
  "lockfileVersion": 2,
  "generatedAt": "2026-06-25T00:00:00.000Z",
  "updatedAt": "2026-06-25T00:00:00.000Z",
  "servers": {
    "io.github.example/server:claude": {
      "name": "io.github.example/server",
      "version": "1.2.3",
      "client": "claude",
      "selectedTarget": {
        "kind": "package",
        "registryType": "oci",
        "identifier": "ghcr.io/example/server@sha256:...",
        "version": "1.2.3",
        "fileSha256": "abcd1234...",
        "transport": "stdio"
      },
      "trust": {
        "score": 85,
        "tier": "conditional",
        "gatedBy": [],
        "evidence": [
          {
            "code": "digest_present",
            "status": "declared",
            "message": "OCI image ghcr.io/example/server@sha256:... declares a digest pin; image bytes were not resolved by ToolPin.",
            "verificationMethod": "metadata-presence",
            "verifiedByToolPin": false
          },
          {
            "code": "lock_integrity",
            "status": "passed",
            "message": "Lock entry integrity digest is computed over the reviewed install plan.",
            "verificationMethod": "canonical-json-sha256",
            "verifiedByToolPin": true
          }
        ],
        "badges": [],
        "issues": []
      },
      "config": {},
      "notes": [],
      "capabilityManifest": {
        "version": 1,
        "generatedAt": "2026-06-25T00:00:00.000Z",
        "serverName": "io.github.example/server",
        "serverVersion": "1.2.3",
        "registrySource": "official",
        "packageTypes": ["oci"],
        "transports": ["stdio"],
        "remoteHosts": [],
        "secrets": [],
        "toolDescriptionHash": {
          "algorithm": "sha256",
          "value": "ef5678...",
          "toolCount": 12,
          "generatedAt": "2026-06-25T00:00:00.000Z"
        },
        "toolSurfaceHash": {
          "algorithm": "sha256",
          "coverage": ["name", "description", "inputSchema"],
          "value": "cd9012...",
          "toolCount": 12,
          "generatedAt": "2026-06-25T00:00:00.000Z"
        },
        "toolManifestHash": {
          "algorithm": "sha256",
          "value": "ab7890...",
          "toolCount": 12,
          "generatedAt": "2026-06-25T00:00:00.000Z"
        },
        "toolDescriptionScan": {
          "version": 1,
          "generatedAt": "2026-06-25T00:00:00.000Z",
          "scannedDescriptions": 12,
          "findings": []
        }
      },
      "resolvedAt": "2026-06-25T00:00:00.000Z",
      "lockedAt": "2026-06-25T00:00:00.000Z",
      "resolved": {
        "source": "official",
        "name": "io.github.example/server",
        "version": "1.2.3"
      },
      "original": {
        "name": "io.github.example/server",
        "version": "1.2.3",
        "client": "claude"
      },
      "locked": {
        "selectedTarget": {},
        "config": {},
        "capabilityManifest": {}
      },
      "integrity": "sha256-..."
    }
  }
}
```

## Required top-level fields

| Field | Type | Meaning |
|---|---|---|
| `lockfileVersion` | `2` | Current supported schema version. v1 lockfiles must be regenerated. |
| `generatedAt` | string | Original file creation timestamp. Ignored by whole-lock digest calculations. |
| `servers` | object | Map of lock entries keyed by `<server-name>:<client>`. |
| `updatedAt` | string *(optional)* | Last write timestamp, present after the first mutation. Ignored by whole-lock digest calculations. |

## Entry fields

Required unless noted. `resolved`, `original`, and `locked` are synthesized by
ToolPin on write; `capabilityManifest`, `lockedAt`, and `integrity` are optional
on read but `ci` will reject entries missing `integrity`.

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Registry server name. |
| `version` | string | Locked server version. |
| `client` | client name | Client this generated config targets. |
| `selectedTarget` | object | Package or remote target selected for install. Package targets include `fileSha256` for MCPB. |
| `trust` | object | Metadata completeness score, optional tier/gating/evidence, badges, and review issues at lock time. |
| `config` | any JSON value | Generated client config fragment. |
| `notes` | string array | Human-readable install notes. |
| `capabilityManifest` | object *(optional)* | Derived capability manifest. See [Capability manifest](#capability-manifest). `toolDescriptionHash`, `toolSurfaceHash`, `toolManifestHash`, and `toolDescriptionScan` appear only after a successful `--verify` live probe of the selected MCP launch target. |
| `resolvedAt` | string | Time the entry was resolved. Included in per-entry integrity and whole-lock digest calculations. |
| `lockedAt` | string *(optional)* | Time the entry was written. Included in per-entry integrity and whole-lock digest calculations. |
| `resolved` | object *(synthesized)* | Registry source, name, and version resolved by ToolPin. |
| `original` | object *(synthesized)* | Original name, version, and client at lock time. |
| `locked` | object *(synthesized)* | Snapshot used for drift checks. |
| `integrity` | string *(optional on read, enforced by `ci`)* | `sha256-...` over the reviewed entry contents, including entry timestamps. |

The whole-lock digest from `toolpin lock digest` excludes only top-level file
metadata timestamps (`generatedAt`, `updatedAt`) and covers the canonical set of
locked server/client entries, including entry timestamps such as `resolvedAt`
and `lockedAt`.

## Trust object

`trust.score` remains a 0–100 metadata completeness score for compatibility
with older lockfiles and score-based policy. Newer entries may also include:

| Field | Type | Meaning |
|---|---|---|
| `tier` | `"verified" \| "conditional" \| "unverified" \| "blocked"` *(optional)* | Evidence-gated trust tier. `verified` means required ToolPin-verified evidence passed, not that the server is safe. |
| `overallScore` | number *(optional)* | Machine-readable gated score after provenance/evidence caps. A capped value such as `69` is an evidence gate limit, not a percentile-like quality score. |
| `metadataCompleteness` | number *(optional)* | The legacy 0–100 metadata/profile score recorded explicitly for UI/explanations and human-facing numeric differentiation. |
| `capReason` | string *(optional)* | Reason the evidence gate capped `overallScore`, such as `automated evidence incomplete`, `no verified provenance`, or a critical gate code. |
| `gatedBy` | string array *(optional)* | Issue or evidence codes that prevented a stronger tier. |
| `gates` / `vetoes` | object arrays *(optional)* | Non-blocking gates and blocking vetoes derived from critical issues or required evidence failures. |
| `pillars` | object *(optional)* | Breakdown of provenance, integrity, reputation, and metadata completeness scores. |
| `evidence` | object array *(optional)* | Automated evidence entries. Older lockfiles without this field remain valid and are not rewritten on read. |

Evidence entries are `{ code, status, message, source?, claim?,
verificationMethod?, verifiedByToolPin?, verifiedAt?, failureReason?,
required? }`, where `status` is `passed`, `declared`, `failed`, or
`unavailable`. Current codes include
`package_pin`, `digest_present`, `file_hash_present`, `lock_integrity`,
`lock_signature`, `oci_digest_verified`, `mcpb_sha256_verified`,
`npm_integrity_verified`, `tool_surface_hash`, and `attestation_declared`.
Declared pins, hashes, and attestations are not treated as ToolPin-verified
unless a future verifier records
`verifiedByToolPin: true` on a passed evidence entry. Evidence carried in
registry metadata (including the ToolPin curated registry's `_meta` evidence)
is read as a claim: a registry-supplied `passed` entry is downgraded to
`declared` with `verifiedByToolPin: false` on ingestion. Only this
installation's own verification (`toolpin verify`, `--verify` flows) records
`passed` + `verifiedByToolPin: true`, so the `verified` tier and
`requireToolPinVerifiedEvidence` always reflect a local recompute.

`automated evidence incomplete` means the entry has not satisfied all evidence
required for `verified`. In practice this usually means an exact package pin
exists but artifact proof is missing, stale, unavailable, or only declared:
ToolPin could not resolve the OCI manifest digest, recompute MCPB bytes from a
trusted HTTPS host, verify npm tarball integrity, or verify an attestation.
Declared pins and declared attestations alone do not count as ToolPin-verified
proof.

## Capability manifest

The optional `capabilityManifest` object is derived by `toolpin verify` (and
persisted by `toolpin install --verify` or `toolpin lock --verify`) from
normalized registry metadata and an optional live `tools/list` probe of the
selected package or remote launch target. Array fields are de-duplicated and
sorted deterministically.

| Field | Type | Meaning |
|---|---|---|
| `version` | `1` | Capability manifest schema version. |
| `serverName` | string | Registry server name. |
| `serverVersion` | string | Server version. |
| `registrySource` | string | Registry source id the manifest was derived from. |
| `packageTypes` | string array | Sorted unique package registry types declared (e.g. `npm`, `pypi`, `nuget`, `cargo`, `oci`, `mcpb`). |
| `transports` | string array | Sorted unique transport types declared by packages and remotes. |
| `remoteHosts` | string array | Sorted unique egress hosts parsed from remote URLs. |
| `secrets` | object array | Sorted declared secret inputs. Each entry is `{ name, source: "env" \| "header", required }`, covering package environment variables and remote headers marked `isSecret` or `isRequired`. |
| `generatedAt` | string | ISO timestamp the manifest was generated. Required. |
| `toolDescriptionHash` | object *(optional)* | Present only after a successful live `tools/list` probe of the selected launch target. `{ algorithm: "sha256", value, toolCount, generatedAt }` over the sorted `name`/`description` pairs returned by the probe. |
| `toolSurfaceHash` | object *(optional)* | Present only after a successful live `tools/list` probe of the selected launch target. `{ algorithm: "sha256", coverage: ["name", "description", "inputSchema"], value, toolCount, generatedAt }` over tools sorted by name, with each hash record omitting fields the server did not return. This is the preferred drift pin for tool names, descriptions, and input schemas. |
| `toolManifestHash` | object *(optional)* | Present only after a successful live `tools/list` probe of the selected launch target. `{ algorithm: "sha256", value, toolCount, generatedAt }` over the sorted tool `name`, `description`, and `inputSchema` values returned by the probe. |
| `toolDescriptionScan` | object *(optional)* | Present only after a successful live `tools/list` probe. `{ version: 1, generatedAt, scannedDescriptions, findings }` of advisory review signals (see below). |

### Verification rules

`toolpin verify` derives the manifest above and adds a `critical` issue (so the
report is not `ok`) when:

- an OCI package identifier is not pinned by digest (`@sha256:`) — code `mutable_oci_tag`;
- an MCPB package is missing `fileSha256` — code `missing_mcpb_hash`;
- a remote live probe is enabled but fails to connect or list tools — code `remote_probe_failed`;
- a package live probe is enabled but fails to start or list tools — code `package_probe_failed`;
- no install target (package or remote) is available — code `no_install_target`.

A valid OCI digest pin earns the `digest-pinned` badge and is required before
ToolPin attempts best-effort registry digest verification. A valid MCPB
`fileSha256` earns the `fileSha256` badge and is required before ToolPin attempts
best-effort byte hashing from code-allowlisted HTTPS artifact hosts. Skipping
the live probe (`--skip-live-verification`) leaves package manifests
metadata-only and downgrades remote tool-description pinning to a
`remote_probe_skipped` warning rather than a blocker. A successful live probe
earns `tool-description-pinned` and `tool-manifest-pinned`.

Attestation metadata read from `_meta` (`dev.toolpin/attestations`) is surfaced
in the report and each entry emits a `<type>-declared` badge; a manifest already
pinned in `_meta` (`dev.toolpin/capabilities`) earns `capability-pinned`.

### Tool surface hash and drift

`toolSurfaceHash` is the preferred capability-manifest pin for a changed tool
surface, surfaced in evidence as the `tool_surface_hash` kind. Its `value` is a
sha256 over the live `tools/list` records projected onto the `coverage` fields —
`["name", "description", "inputSchema"]` — with tools sorted by name and each
record omitting any covered field the server did not return. An omitted field is
not the same as a field the server returned as `null`: the projection preserves
that distinction, so adding, removing, or nulling an input schema changes the
hash. Because `coverage` is part of the hashed record, a locked hash and a fresh
probe are only comparable at the same coverage.

`install` and `ci` recompute the surface hash from a fresh probe and fail on
drift, reporting `tool input schemas changed` when the schema projection differs
at equal coverage. When the new probe returns a narrower coverage than the lock,
CI reports `tool surface coverage downgraded` rather than accepting the weaker
pin as a match.

Legacy locks written before surface pinning carry only the description-only
`toolDescriptionHash`. They still verify as a fallback, but ToolPin records a
non-fatal `tool_surface_hash` advisory and a `needs-review` verdict with reason
`input schemas not pinned`, prompting a re-capture of the live surface to upgrade
the pin.

### Advisory tool-description scan

The server's own registry `name`/`description` is always scanned, and when the
live probe succeeds each returned tool `name`/`description` is scanned too.
Findings are severity `info` or `warning` only — they never fail verification on
their own — and are recorded in `toolDescriptionScan.findings` (mirrored as
`info`/`warning` trust issues):

- `agent_instruction_override`, `agent_hidden_behavior`, `agent_forced_tool_order` — agent-directed phrasing in descriptions;
- `hidden_control_characters` — hidden, control, or bidirectional formatting characters;
- `duplicate_tool_name` — a tool name appears more than once in the `tools/list` response;
- `cross_tool_instruction` — a description instructs the agent to call a sibling tool.

These are advisory human-review signals, not prompt-injection detection, not a
sandbox, and not an install blocker.
