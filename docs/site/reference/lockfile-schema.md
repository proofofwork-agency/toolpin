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
| `trust` | object | Score, badges, and review issues at lock time. |
| `config` | any JSON value | Generated client config fragment. |
| `notes` | string array | Human-readable install notes. |
| `capabilityManifest` | object *(optional)* | Derived capability manifest. See [Capability manifest](#capability-manifest). `toolDescriptionHash` and `toolDescriptionScan` appear only after a successful `--verify` live probe of a remote target. |
| `resolvedAt` | string | Time the entry was resolved. Excluded from the integrity payload. |
| `lockedAt` | string *(optional)* | Time the entry was written. Excluded from the integrity payload. |
| `resolved` | object *(synthesized)* | Registry source, name, and version resolved by ToolPin. |
| `original` | object *(synthesized)* | Original name, version, and client at lock time. |
| `locked` | object *(synthesized)* | Snapshot used for drift checks. |
| `integrity` | string *(optional on read, enforced by `ci`)* | `sha256-...` over timestamp-insensitive entry contents. |

The whole-lock digest from `toolpin lock digest` excludes timestamps and covers
the canonical set of locked server/client entries.

## Capability manifest

The optional `capabilityManifest` object is derived by `toolpin verify` (and
persisted by `toolpin install --verify`) from normalized registry metadata and,
for remote targets, an optional live `tools/list` probe. Array fields are
de-duplicated and sorted deterministically.

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
| `toolDescriptionHash` | object *(optional)* | Present only after a successful live `tools/list` probe of a remote target. `{ algorithm: "sha256", value, toolCount, generatedAt }` over the sorted `name`/`description` pairs returned by the probe. |
| `toolDescriptionScan` | object *(optional)* | Present only after a successful live `tools/list` probe. `{ version: 1, generatedAt, scannedDescriptions, findings }` of advisory review signals (see below). |

### Verification rules

`toolpin verify` derives the manifest above and adds a `critical` issue (so the
report is not `ok`) when:

- an OCI package identifier is not pinned by digest (`@sha256:`) — code `mutable_oci_tag`;
- an MCPB package is missing `fileSha256` — code `missing_mcpb_hash`;
- a remote live probe is enabled but fails to connect or list tools — code `remote_probe_failed`;
- no install target (package or remote) is available — code `no_install_target`.

A successful OCI digest pin earns the `digest-pinned` badge; an MCPB package with
`fileSha256` earns the `fileSha256` badge. Skipping the live probe
(`--skip-live-verification`) downgrades remote tool-description pinning to a
`remote_probe_skipped` warning rather than a blocker, leaving the manifest
metadata-only. A successful live probe earns `tool-description-pinned`.

Registry attestations read from `_meta` (`dev.toolpin/attestations`) are surfaced
in the report and each emit a `<type>-declared` badge; a manifest already pinned
in `_meta` (`dev.toolpin/capabilities`) earns `capability-pinned`.

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
