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
  "minTrustTier": "conditional",
  "requireToolPinVerifiedEvidence": false,
  "allowedSources": ["official", "docker"],
  "deniedSources": ["pulse"],
  "allowedClients": ["claude", "codex", "vscode"],
  "deniedClients": ["generic"],
  "deniedServers": ["io.github/example/unsafe-server"],
  "deniedPackageTypes": ["cargo"],
  "deniedTransports": ["sse"],
  "deniedRemoteHosts": ["untrusted.example.com"],
  "denyRemoteEndpoints": false,
  "denyRequiredSecrets": false,
  "requireDigestPinnedOci": true,
  "requireMcpbSha256": true
}
```

Every field is optional; an omitted field is not enforced. Unknown keys are
rejected: any property not listed below causes `readPolicy`/`enforcePolicy` to
throw `Invalid policy schema ... unknown policy key <name>` before evaluation.

| Field | Type | Default | Validation & effect |
|---|---|---|---|
| `version` | literal `1` | omitted | Optional schema marker. If present it must equal `1`, otherwise `unsupported version`. |
| `minTrustScore` | number | omitted | Integer/float in the inclusive range `0`-`100`; outside that range the schema is rejected. A plan passes when `trust.score >= minTrustScore`. |
| `minTrustTier` | string | omitted | Minimum evidence-gated tier: `blocked`, `unverified`, `conditional`, or `verified`. A plan below the tier is denied (`trust_tier_below_minimum`). |
| `requireToolPinVerifiedEvidence` | boolean | omitted | When true, at least one evidence entry must be `passed` with `verifiedByToolPin: true`, otherwise denied (`toolpin_verified_evidence_required`). |
| `allowedSources` | string array | omitted | Allow-list of registry sources. Each entry must be one of `official`, `docker`, `pulse`, `smithery`, `glama`; any other value is rejected as an unknown registry source. When non-empty, a plan with no resolved source, or a source not in the list, is denied (`source_not_allowed`). |
| `deniedSources` | string array | omitted | Same enum as `allowedSources`. Denies a plan whose resolved source is listed (`source_denied`). |
| `allowedClients` | string array | omitted | Allow-list of client names. Each entry must be a known ToolPin client (`claude`, `cursor`, `vscode`, `codex`, `opencode`, `windsurf`, `cline`, `continue`, `gemini`, `zed`, `roo`, `generic`); unknown clients are rejected. When non-empty, a plan whose client is not in the list is denied (`client_not_allowed`). |
| `deniedClients` | string array | omitted | Same client-name validation as `allowedClients`. Denies a plan whose client is listed (`client_denied`). |
| `deniedServers` | string array | omitted | Free-form strings compared by exact equality against the plan's server name. A match denies the plan (`server_denied`). |
| `deniedPackageTypes` | string array | omitted | Free-form strings compared against the selected package target's `registryType` (e.g. `npm`, `pypi`, `cargo`, `oci`, `mcpb`). Any match denies the plan (`package_type_denied`). |
| `deniedTransports` | string array | omitted | Free-form strings compared against the selected target's transport (a remote target's `type`, or a package target's `transport`, e.g. `sse`, `stdio`, `http`, `ws`). Any match denies the plan (`transport_denied`). |
| `deniedRemoteHosts` | string array | omitted | Free-form strings compared by **exact equality** against each remote host string declared in the capability manifest. The host includes its port when present, so deny `api.example.com` and `example.com:443` separately. Subdomain suffix matching (e.g. denying `.example.com`) is **not** supported. Any match denies the plan (`remote_host_denied`). |
| `denyRemoteEndpoints` | boolean | omitted | When true, any selected remote endpoint host denies the plan (`remote_endpoint_denied`). |
| `denyRequiredSecrets` | boolean | omitted | When true, any required secret input in the capability manifest denies the plan (`required_secrets_denied`). |
| `requireDigestPinnedOci` | boolean | omitted | Must be a boolean. When true and the selected target is an `oci` package, its identifier must contain `@sha256:`, otherwise denied (`oci_digest_required`). |
| `requireMcpbSha256` | boolean | omitted | Must be a boolean. When true and the selected target is an `mcpb` package, it must declare a non-empty `fileSha256`, otherwise denied (`mcpb_sha256_required`). |

`requireDigestPinnedOci` and `requireMcpbSha256` only inspect the pins already
declared in the install plan / capability manifest. Use
`requireToolPinVerifiedEvidence` when policy should require evidence from a
ToolPin verifier, such as `verify` recomputing MCPB SHA-256 or resolving an OCI
manifest digest.

The policy file is a local JSON gate, not the future Cedar/OPA enterprise policy
engine. `--no-policy` is an explicit local bypass.
