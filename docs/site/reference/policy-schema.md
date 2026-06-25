---
title: Policy Schema
---

# `.toolpin/policy.json` schema

The local policy file is an optional JSON gate. `toolpin install`, `toolpin ci`,
TUI installs, and `toolpin policy check` can enforce it before accepting an
install plan.

```json
{
  "version": 1,
  "minTrustScore": 70,
  "allowedSources": ["official", "docker"],
  "deniedSources": ["pulse"],
  "allowedClients": ["claude", "codex", "vscode"],
  "deniedClients": ["generic"],
  "deniedServers": ["io.github/example/unsafe-server"],
  "deniedPackageTypes": ["cargo"],
  "deniedTransports": ["sse"],
  "deniedRemoteHosts": ["untrusted.example.com"],
  "requireDigestPinnedOci": true,
  "requireMcpbSha256": true
}
```

Unknown keys are rejected.

| Field | Type | Effect |
|---|---|---|
| `version` | `1` | Optional schema marker. |
| `minTrustScore` | number 0-100 | Rejects plans below the minimum score. |
| `allowedSources` | string array | Allows only these registry sources. |
| `deniedSources` | string array | Rejects these registry sources. |
| `allowedClients` | string array | Allows only these clients. |
| `deniedClients` | string array | Rejects these clients. |
| `deniedServers` | string array | Rejects exact server names. |
| `deniedPackageTypes` | string array | Rejects selected package types such as `npm`, `pypi`, `oci`, or `mcpb`. |
| `deniedTransports` | string array | Rejects selected transports such as `sse` or `stdio`. |
| `deniedRemoteHosts` | string array | Rejects exact remote host names. |
| `requireDigestPinnedOci` | boolean | Requires selected OCI identifiers to include `@sha256:`. |
| `requireMcpbSha256` | boolean | Requires selected MCPB targets to declare `fileSha256`. |

`requireDigestPinnedOci` and `requireMcpbSha256` check declared pins. ToolPin
does not download artifacts and recompute bytes for OCI images or MCPB bundles.

The policy file is a local JSON gate, not the future Cedar/OPA enterprise policy
engine. `--no-policy` is an explicit local bypass.
