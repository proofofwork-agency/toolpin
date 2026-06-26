# Custom Registries

ToolPin can read built-in registries and repo-owned registry definitions from `.toolpin/registries.json`.

Built-in sources:

- `official`: Official MCP Registry, installable, `canonical` trust.
- `docker`: Docker MCP Catalog, installable, `curated` trust.
- `pulse` (PulseMCP), `smithery`, `glama`: known directory sources. They ship disabled and discovery-only — `pulse` and `smithery` require an API key, while `glama` needs no auth but has no stable public adapter yet. Selecting any of them throws until an adapter is enabled.

ToolPin also maintains a GitHub-backed curated registry. It is not built into
the CLI by default yet; add it as a custom `official-compatible` registry:

```json
{
  "registries": [
    {
      "id": "toolpin",
      "type": "official-compatible",
      "url": "https://raw.githubusercontent.com/proofofwork-agency/toolpin/main/registry/v0",
      "mode": "installable",
      "trust": "curated"
    }
  ]
}
```

See [ToolPin Curated Registry](./toolpin-curated-registry.md) for the PR-based
review workflow.

## Official-Compatible Registry

Use this for company or private registries that expose the MCP Registry `/v0/servers` response shape.

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

Then run:

```sh
toolpin registry list
toolpin ingest --source company
toolpin search postgres --source company
toolpin install company/postgres --client claude --update-lock
```

Installable entries still need enough machine-readable metadata for ToolPin to build a lockable install plan: a package or remote target, version, transport, source metadata, and any declared secrets.

## Discovery Registries

Broad directories and scraped indexes should start as discovery sources:

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

Discovery entries can appear in search and info views. ToolPin refuses to install them until they normalize into a source that is explicitly marked `installable`.

This keeps the product claim precise: ToolPin can search broad directories, but only installs servers it can normalize, review, lock, and enforce.

## Config Reference

Each entry in `.toolpin/registries.json` supports:

| Field | Required | Default | Notes |
|---|---|---|---|
| `id` | yes | — | Stable source identifier used by `--source`. |
| `url` | yes | — | Registry endpoint. For `official-compatible`, ToolPin appends `/servers`. |
| `type` | no | `official-compatible` | `official-compatible` (MCP Registry `/v0/servers` shape) or `http-json` (response with a `servers` or `entries` array). |
| `mode` | no | `installable` for `official-compatible`, `discovery` for `http-json` | Whether entries from this source can be installed. |
| `label` | no | the `id` | Display label in `toolpin registry list` and the TUI. |
| `trust` | no | `private` | One of `canonical`, `curated`, `directory`, `private`. |
| `enabled` | no | `true` | Set to `false` to hide a source from `--source all` and `registry list`. |
| `authEnv` | no | — | Environment variable name that holds an auth token; marks the source `authRequired`. Advisory only — ToolPin does not yet send this token in registry requests. |
| `description` | no | generated | Human-readable source description. |

Invalid `type` or `mode` values are rejected. If a custom entry reuses a built-in `id`, the built-in wins and the custom entry is ignored.

## Source Resolution and Caching

`--source all` fetches every enabled, non-`known` source in parallel and deduplicates entries by repository URL, server name, and version. On collisions, `official` beats `docker`, which beats any custom source.

`toolpin ingest` always fetches live and writes the combined result to `.toolpin/registry-cache.json` (a `{ generatedAt, entries }` document). Other commands read that cache when `--live` is omitted; if the cache is missing or does not contain the requested source, they transparently fall back to a live fetch. Pass `--live` to bypass the cache entirely. A cache file that exists but is not valid registry-cache JSON raises a `CacheSchemaError` instead of falling back.

## TUI Installed View

Run:

```sh
toolpin tui
```

Open the `Installed` tab to inspect servers already written to supported config files across folder/project and global/user scopes. The view shows:

- config file, client, and scope
- locked, unlocked, or drift state
- registry match status: `registry:exact`, `registry:alias`, or `registry:none`
- locked and latest known versions
- lifecycle action: `action:update`, `action:adopt`, or `action:none`
- test source: `test:config` when ToolPin can test the installed client config
- delete, update/adopt, explicit version relock, doctor, and `test-installed` actions

Runtime status is advisory. ToolPin can mark a server `reachable` after `t` succeeds and `stale` when lock/config or version drift is detected. It does not claim process monitoring unless ToolPin owns the runtime or can query a client/gateway API.
