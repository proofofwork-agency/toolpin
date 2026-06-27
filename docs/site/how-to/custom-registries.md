---
title: Custom Registries
---

# Custom Registries

ToolPin can read built-in registries and repo-owned registry definitions from
`.toolpin/registries.json`. That lets teams add private lists, curated GitHub
lists, and broad discovery indexes without changing ToolPin core.

The important rule is simple: ToolPin may search broad directories, but it only
installs entries that normalize into reviewable, lockable install metadata.

## Built-In Sources

ToolPin ships with these source IDs:

| Source | Status | Use |
|---|---:|---|
| `toolpin` | installable, pinned | ToolPin hosted curated registry with bundled fallback. |
| `official` | installable | Official MCP Registry metadata. |
| `docker` | installable | Docker MCP Catalog metadata. |
| `pulse` | disabled directory | PulseMCP directory source; auth-gated and opt-in. |
| `smithery` | disabled directory | Known marketplace/hosted connector source; hosted targets require `--allow-hosted-directory-targets`. |
| `glama` | disabled directory | Known broad directory/gateway source; installable only when re-resolved through a matching Official MCP Registry entry. |

Use built-ins directly:

```sh
toolpin ingest --source official
toolpin ingest --source docker
toolpin search github --source all --live
```

`toolpin`, `official`, and `docker` are enabled by default. `toolpin` is pinned
and cannot be disabled. Directory sources are known but disabled by default, so
they do not inflate Browse or `--source all` until you turn them on:

```sh
toolpin registry list
toolpin registry enable glama
toolpin registry disable glama
```

Those commands write top-level source preferences in `.toolpin/registries.json`:

```json
{
  "sources": {
    "glama": {
      "enabled": true
    },
    "smithery": {
      "enabled": false
    }
  },
  "registries": []
}
```

## ToolPin Curated Registry

ToolPin also maintains a GitHub-backed curated registry. Current ToolPin
versions expose it as the built-in `toolpin` source and fetch
`https://raw.githubusercontent.com/proofofwork-agency/toolpin/main/registry/v0/servers`
first, falling back to the bundled snapshot if the hosted file is unavailable
or invalid.

Then run:

```sh
toolpin registry list
toolpin ingest --source toolpin
toolpin search github --source toolpin
```

See [ToolPin Curated Registry](./toolpin-curated-registry.md) for the PR-based
review workflow.

## Official-Compatible Registries

Use `official-compatible` when the registry exposes the MCP Registry
`/v0/servers` response shape. This is the best option for company registries,
private allowlists, and GitHub-hosted curated lists.

```json
{
  "registries": [
    {
      "id": "company",
      "type": "official-compatible",
      "url": "https://registry.company.com/v0",
      "mode": "installable",
      "trust": "private"
    }
  ]
}
```

ToolPin appends `/servers` to the URL. Configure the base path, not the final
file path.

```sh
toolpin registry list
toolpin ingest --source company
toolpin search postgres --source company
toolpin install company/postgres --client claude --update-lock
```

Installable entries still need enough machine-readable metadata for ToolPin to
build a lockable install plan: a package or remote target, version, transport,
source metadata, and declared secrets.

Verified metadata comes from an installable source that exposes reviewable MCP
Registry-style server records: the Official MCP Registry, Docker MCP Catalog,
or an `official-compatible` custom/curated registry. To turn a broad directory
result into installable metadata, curate it with package/remotes, exact
versions, repository URLs, and artifact pins where available, such as OCI
`@sha256:` digests or MCPB `fileSha256` values.

## GitHub-Hosted Private Lists

You can host your own registry in a repository without running infrastructure.
Create this file:

```text
registry/v0/servers
```

Then point ToolPin at the raw GitHub base URL:

```json
{
  "registries": [
    {
      "id": "team",
      "type": "official-compatible",
      "url": "https://raw.githubusercontent.com/acme/mcp-registry/main/registry/v0",
      "mode": "installable",
      "trust": "private"
    }
  ]
}
```

For public repositories, raw GitHub works immediately after merge. For private
repositories, make sure your environment can fetch the raw URL with the
appropriate GitHub authentication before relying on CI.

## TUI Installed View

The TUI Browse list defaults to source-first ordering: `toolpin`, `official`,
`docker`, then other enabled sources. Press `a` to cycle source-first, alpha
A-Z, alpha Z-A, source-last, and relevance ordering. Press `g` to cycle the
exact source filter; exact source IDs such as `toolpin`, `official`, and
`docker` act as source-narrowing terms in the search box.

Open the `Installed` tab to inspect servers already written to supported config
files across folder/project and global/user scopes. Rows show registry match
status (`registry:exact`, `registry:alias`, or `registry:none`), lifecycle action
(`action:update`, `action:adopt`, or `action:none`), and test source
(`test:config` when ToolPin can test the installed client config).

The Installed hotkeys map to the same CLI actions: `t` runs
`toolpin test-installed`, `u` runs either `toolpin update` or `toolpin adopt`,
`v`/`V` chooses an explicit locked target version before `u`, `U` runs
`toolpin update --all`, `d` runs `toolpin doctor`, and `x` runs `toolpin remove`.

## Discovery-Only HTTP JSON

Use `http-json` for broad directories, scraped lists, or indexes that are not
MCP Registry compatible yet:

```json
{
  "registries": [
    {
      "id": "glama-public",
      "type": "http-json",
      "url": "https://example.com/mcp-servers.json",
      "mode": "discovery"
    }
  ]
}
```

Discovery entries can appear in search and info views when their source is
enabled. ToolPin refuses to install them until they normalize into a source
explicitly marked `installable`, or an adapter can safely re-resolve them to an
installable registry entry.

This is the right mode for large public lists, marketplace exports, gateway
connector inventories, and data that may contain hosted-only, stale, duplicate,
or missing-source entries.

That distinction is intentional. A directory such as Glama may list many useful
servers, but ToolPin still needs a matching official entry with a lockable
package or remote target before it can review, install, lock, and enforce the
server.

## Future Adapter Packages

Some registries need custom pagination, auth, score mapping, hosted-connector
metadata, or deduplication rules. Those should become explicit adapter packages
instead of ad hoc parsing in core.

The intended shape is:

```sh
toolpin registry add glama --adapter @toolpin/registry-glama
toolpin registry add smithery --adapter @toolpin/registry-smithery
toolpin registry add pulse --adapter @toolpin/registry-pulse
```

Adapter modules should require explicit opt-in before ToolPin executes external
code. Until then, prefer `official-compatible` registries for installable
sources and `http-json` for discovery-only sources.

## Choosing a Mode

| Source kind | Recommended type | Recommended mode |
|---|---|---|
| Official MCP Registry mirror | `official-compatible` | `installable` |
| Company allowlist | `official-compatible` | `installable` |
| Public GitHub curated list | `official-compatible` | `installable` when reviewed |
| Broad marketplace export | `http-json` or adapter | `discovery` |
| Hosted connector platform | adapter | `discovery` until normalized |
| Scraped GitHub/npm/PyPI list | `http-json` or adapter | `discovery` |

Keep the distinction visible in product copy and PR review: broad search is
useful, but automatic install requires enough metadata for review, lockfile
reproducibility, and CI enforcement.
