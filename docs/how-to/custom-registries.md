# Custom Registries

ToolPin can read built-in registries and repo-owned registry definitions from `.toolpin/registries.json`.

Built-in sources:

- `official`: Official MCP Registry, installable.
- `docker`: Docker MCP Catalog, installable.
- `pulse`, `smithery`, `glama`: known directory sources, discovery-only until an adapter and credentials are configured.

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

## TUI Installed View

Run:

```sh
toolpin tui
```

Open the `Installed` tab to inspect servers already written to supported config files across folder/project and global/user scopes. The view shows:

- config file, client, and scope
- locked, unlocked, or drift state
- locked and latest known versions
- update availability
- delete, update, doctor, and test actions

Runtime status is advisory. ToolPin can mark a server `reachable` after `t` succeeds and `stale` when lock/config or version drift is detected. It does not claim process monitoring unless ToolPin owns the runtime or can query a client/gateway API.
