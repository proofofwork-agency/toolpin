---
title: Install Your First Server
---

# Install your first MCP server

This tutorial installs a server into one MCP client and writes the reviewed
install plan to `mcp-lock.json`.

## Install the CLI

Install ToolPin from npm:

```bash
npm install -g @proofofwork-agency/toolpin
toolpin --version
tpn -v
```

When changing ToolPin itself from a source checkout, use the npm scripts:

```bash
npm ci
npm test
npm run dev -- --version
```

## Search for a server

```bash
toolpin search github --source all --limit 5 --live
```

`--live` fetches current registry metadata. Without it, ToolPin uses its local
cache when available.

## Review the install plan

```bash
toolpin plan io.github.github/github-mcp-server --client claude --live
```

The plan shows the selected package or remote target, generated client config,
trust tier, metadata score, evidence summary, and review notes. Treat the output
as a change request, not as an automatic approval. A high metadata score can
still be capped when artifact proof is missing.

## Install and lock

```bash
toolpin install io.github.github/github-mcp-server \
  --client claude \
  --scope project \
  --live \
  --verify \
  --update-lock
```

This writes project-scope client config and updates `mcp-lock.json`.

`--verify` runs metadata checks plus, where allowed, a live MCP `tools/list`
probe of the selected package or remote launch target (skip it with
`--skip-live-verification`). When that probe succeeds, ToolPin pins the live
tool surface — tool names, descriptions, and input schemas — as
`toolSurfaceHash` in the lockfile.

Capturing that live pin for a **package** target has to start the server, so it
executes the package and requires explicit `--allow-execute`. Without
`--allow-execute`, artifact checks still run, live package execution is skipped
with a `package_execution_skipped` warning, and the live pin stays unavailable.
Remote targets are probed over an SSRF-guarded transport without executing
anything.

Package targets also get registry pin checks where supported: OCI digest
resolution and MCPB byte hashing are best-effort when the registry or trusted
HTTPS bundle bytes are reachable. npm targets are checked against
`registry.npmjs.org` `dist.integrity`; PyPI, NuGet, and Cargo targets are
checked for exact declared versions and drift, not artifact integrity.

Because `mcp-lock.json` now pins this server/client, a later `toolpin install`
without `--update-lock` refuses if the version, selected target, generated client
config, capability manifest, pinned tool surface, or trust score (on decrease)
has changed. Review the drift, then update the lock with
`toolpin lock io.github.github/github-mcp-server --client claude` or repeat the
install with `--update-lock`.

## Check the result

```bash
toolpin doctor --scope project
toolpin ci --live
```

Commit `mcp-lock.json` so teammates and CI can reject drift. Use `--client all`
only after reviewing the generated configs for every supported project-scope
client.

## Protect the repo in CI

With `mcp-lock.json` committed, make drift fail pull requests. Scaffold the
workflow with one command:

```bash
toolpin init ci
```

This writes a hardened GitHub Actions workflow that runs `toolpin ci` in strict
mode with `doctor` and SARIF upload, so a pull request fails when the committed
lockfile no longer matches the reviewed install plan.
