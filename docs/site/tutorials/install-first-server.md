---
title: Install Your First Server
---

# Install your first MCP server

This tutorial installs a server into one MCP client and writes the reviewed
install plan to `mcp-lock.json`.

The public npm package path is prepared, but the first publish may not have
happened yet. Use the repository development flow until npm ownership, token or
2FA, and package-name availability are confirmed.

## Install the CLI

```bash
npm ci
npm test
node dist/cli.js --version
```

After npm publish:

```bash
npm install -g toolpin
toolpin --version
tpn -v
```

## Search for a server

```bash
node dist/cli.js search github --source all --limit 5 --live
```

`--live` fetches current registry metadata. Without it, ToolPin uses its local
cache when available.

## Review the install plan

```bash
node dist/cli.js plan io.github.github/github-mcp-server --client claude --live
```

The plan shows the selected package or remote target, generated client config,
trust tier, metadata score, evidence summary, and review notes. Treat the output
as a change request, not as an automatic approval. A high metadata score can
still be capped when artifact proof is missing.

## Install and lock

```bash
node dist/cli.js install io.github.github/github-mcp-server \
  --client claude \
  --scope project \
  --live \
  --verify \
  --update-lock
```

This writes project-scope client config and updates `mcp-lock.json`.

`--verify` runs metadata checks plus a live MCP `tools/list` probe of the
selected package or remote launch target (skip it with
`--skip-live-verification`). When that probe succeeds, ToolPin stores normalized
tool-description and tool-manifest hashes in the lockfile. Package targets also
get registry pin checks where supported: OCI digest resolution and MCPB byte
hashing are best-effort when the registry or trusted HTTPS bundle bytes are
reachable. npm targets are checked against `registry.npmjs.org`
`dist.integrity`; PyPI, NuGet, and Cargo targets are checked for exact declared
versions and drift, not artifact integrity.

Because `mcp-lock.json` now pins this server/client, a later `toolpin install`
without `--update-lock` refuses if the version, selected target, generated client
config, capability manifest, tool-description hash, or trust score (on decrease)
has changed. Review the drift, then update the lock with
`toolpin lock io.github.github/github-mcp-server --client claude` or repeat the
install with `--update-lock`.

## Check the result

```bash
node dist/cli.js doctor --scope project
node dist/cli.js ci --live
```

Commit `mcp-lock.json` so teammates and CI can reject drift. Use `--client all`
only after reviewing the generated configs for every supported project-scope
client.
