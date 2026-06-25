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
trust score, and review notes. Treat the output as a change request, not as an
automatic approval.

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

`--verify` can run extra metadata and optional live MCP checks. When live
`tools/list` succeeds, ToolPin stores a normalized tool-description hash in the
lockfile. It does not download and verify OCI image bytes or MCPB bundle bytes.

## Check the result

```bash
node dist/cli.js doctor --scope project
node dist/cli.js ci --live
```

Commit `mcp-lock.json` so teammates and CI can reject drift. Use `--client all`
only after reviewing the generated configs for every supported project-scope
client.
