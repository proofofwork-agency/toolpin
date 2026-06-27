# ToolPin Curated Registry

ToolPin hosts a first-party curated registry without running any custom
infrastructure. The registry is versioned JSON in this repository, fetched from
raw GitHub at runtime, and bundled in the npm package as an offline fallback
snapshot.

Use it for servers ToolPin maintainers are willing to recommend because the
metadata is installable, reviewable, lockable, and documented. Do not use it as
a broad directory.

## URLs

Raw GitHub, no deploy required:

```text
https://raw.githubusercontent.com/proofofwork-agency/toolpin/main/registry/v0
```

GitHub Pages / Docusaurus:

```text
https://proofofwork-agency.github.io/toolpin/registry/v0
```

ToolPin appends `/servers` automatically for `official-compatible` registries.

## Built-In Source

ToolPin ships this registry as the built-in `toolpin` source: a hosted curated
registry with bundled fallback. It is first in the source list, enabled by
default, and pinned. Users can filter to another source, but `toolpin` cannot be
disabled through `.toolpin/registries.json`, `toolpin registry disable`, or the
TUI source selector.

Then:

```sh
toolpin registry list
toolpin ingest --source toolpin
toolpin search github --source toolpin
```

## Add a Server by PR

Edit both files:

```text
registry/v0/servers
website/static/registry/v0/servers
```

They must stay identical. CI runs:

```sh
npm run registry:check
```

Each entry must be installable and include curation metadata:

```json
{
  "server": {
    "name": "io.github.example/server",
    "title": "Example MCP Server",
    "description": "What this server does and why it is useful.",
    "version": "1.0.0",
    "repository": {
      "url": "https://github.com/example/server",
      "source": "github"
    },
    "packages": [
      {
        "registryType": "npm",
        "identifier": "@example/server",
        "version": "1.0.0",
        "transport": {
          "type": "stdio"
        }
      }
    ]
  },
  "_meta": {
    "dev.toolpin/curation": {
      "status": "reviewed",
      "reviewedAt": "2026-06-25",
      "reviewedBy": "toolpin-maintainers",
      "reason": "Why ToolPin recommends this server.",
      "evidenceTier": "metadata-only",
      "riskNotes": [],
      "testedClients": ["claude"],
      "toolpinEnforcement": {
        "status": "not-verified",
        "notes": "Branch protection and ToolPin CI enforcement have not been verified."
      }
    },
    "dev.toolpin/clientSupport": {
      "default": "unsupported",
      "clients": {
        "codex": {
          "status": "toolpin-installable",
          "installMode": "mcp-config",
          "requirements": ["node>=22"],
          "setupCommands": [],
          "notes": "ToolPin can write this as a normal Codex MCP server."
        },
        "claude": {
          "status": "toolpin-installable",
          "installMode": "mcp-config",
          "requirements": ["node>=22"],
          "setupCommands": [],
          "notes": "ToolPin can write this as a project MCP server."
        }
      }
    }
  }
}
```

The container file (`registry/v0/servers`) wraps entries in a `servers` array plus a `metadata` block. If `metadata.count` or `metadata.total` is present, it must equal `servers.length`, or `npm run registry:check` fails. Package targets require `registryType`, `identifier`, and `transport.type`; remote targets require an `https://` URL.

`dev.toolpin/clientSupport` is ToolPin-owned metadata:

- `toolpin-installable`: ToolPin can generate the client MCP config directly.
- `external-setup`: the client is supported, but setup needs documented steps
  outside ToolPin, such as plugins, daemons, project initialization, or
  instruction-file writes.
- `unsupported`: ToolPin must not offer that client as an install target.

Use `requirements` for runtimes, CLIs, API-key prerequisites, OAuth support, or
other normal setup constraints. Use `setupCommands` only for documented external
steps; ToolPin does not run external setup commands from registry metadata.

For ContextRelay specifically, Codex is `toolpin-installable` through a normal
MCP config that runs package arguments equivalent to `contextrelay codex-mcp
server`. Claude is `external-setup`: install ContextRelay globally, run
`ctxrelay init --instructions project`, and use the generated Claude
plugin/setup. ToolPin must not run `ctxrelay init` until an explicit external
setup flow exists because it writes project files and plugin state.

Reviewers should reject entries that are hosted-only, source-missing,
non-installable, stale, duplicate, or not useful enough to recommend. Use
`evidenceTier` and `toolpinEnforcement.status` honestly: `metadata-only` and
`not-verified` are valid for seed entries; reserve stronger labels for checks
ToolPin can actually verify.

Local validation:

```sh
npm run registry:check
npm test
```
