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
          "sha256": "ef5678...",
          "toolCount": 12,
          "generatedAt": "2026-06-25T00:00:00.000Z"
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
| `capabilityManifest` | object *(optional)* | Normalized package, transport, remote host, secret, and optional tool-description metadata. Includes a required `generatedAt`; `toolDescriptionHash` and `toolDescriptionScan` appear only after a successful `--verify` live probe. |
| `resolvedAt` | string | Time the entry was resolved. Excluded from the integrity payload. |
| `lockedAt` | string *(optional)* | Time the entry was written. Excluded from the integrity payload. |
| `resolved` | object *(synthesized)* | Registry source, name, and version resolved by ToolPin. |
| `original` | object *(synthesized)* | Original name, version, and client at lock time. |
| `locked` | object *(synthesized)* | Snapshot used for drift checks. |
| `integrity` | string *(optional on read, enforced by `ci`)* | `sha256-...` over timestamp-insensitive entry contents. |

The whole-lock digest from `toolpin lock digest` excludes timestamps and covers
the canonical set of locked server/client entries.
