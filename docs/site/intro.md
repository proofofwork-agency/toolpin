---
title: Introduction
slug: /
---

# ToolPin documentation

ToolPin is the missing review gate between MCP registries and the AI clients
that run MCP servers with your credentials. It gives MCP installs the same
basic engineering loop teams expect from code dependencies: inspect the thing
that will run, write exact client config, commit a lockfile, and fail CI when
the reviewed install drifts.

The factual claim: ToolPin combines official/Docker registry metadata,
neutral config generation for 12 MCP clients, an enforcing `mcp-lock.json`,
and local CI/policy checks in one Apache-2.0 CLI. It is not a replacement
registry, a hosted gateway, a runtime sandbox, or a secret vault.

## Why this matters

Adding an MCP server can give an agent new tools, local process access,
network access, and credentials. Without a repo-owned artifact, that decision
is often just a copied JSON snippet in one developer's editor. ToolPin turns it
into a reviewed install plan plus `mcp-lock.json`, so teammates and CI can see
what changed before the server runs.

## Does this already exist?

Parts of it exist. Registries and catalogs help users find servers. Smithery
and similar installers make installation easier. Docker, Glama, Stacklok
ToolHive, and security vendors focus on runtime governance, gateways, policy,
and observability. MCP clients own their local runtime settings.

ToolPin's lane is the layer in between: neutral multi-client config,
install-time review, a committed lockfile, and CI drift detection. If another
tool already gives your team all four in one workflow, use it.

## What ToolPin does now

- Searches and inspects MCP registry entries from supported sources.
- Provides a guided `toolpin interactive` / `tpn i` flow that searches,
  previews the one-shot command, and requires confirmation before writes.
- Generates client config for supported MCP clients.
- Creates a v2 `mcp-lock.json` keyed by server and client.
- Rejects install drift when resolved metadata, selected target, trust score,
  generated config, or capability metadata changes from the lockfile.
- Checks declared integrity pins: OCI targets must include `@sha256:` when
  required, and MCPB targets must declare `fileSha256` when required.
- Separates metadata completeness from evidence tier. `verified` requires a
  pinned install target plus ToolPin-verified artifact proof; missing proof caps the
  machine-readable `overallScore` and is shown as a `cap` reason in CLI/TUI
  output. Trusted-source conditional entries cap at 69% until artifact proof is
  verified. Current artifact proof means npm tarball SRI, OCI registry digest,
  or MCPB byte-hash verification.
- Runs `toolpin ci` as a read-only gate for committed lockfiles.
- Supports optional whole-lock digest pins and detached Ed25519 lockfile
  signatures using keys managed outside ToolPin.

## Limits to understand

ToolPin recomputes MCPB SHA-256 only from code-allowlisted HTTPS artifact hosts,
verifies npm tarballs against `registry.npmjs.org` SRI, and resolves OCI
manifest digests when registries are reachable. Unavailable bytes are reported
as `unavailable`, not treated as verified.
It checks whether declared pins are present and whether the reviewed lockfile
still matches the resolved install plan. It is not a blanket runtime validator;
optional live checks can capture tool-description hashes when the server is
reachable and credentials are available.

Start with [Install your first server](./tutorials/install-first-server.md).
