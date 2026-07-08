---
title: Introduction
slug: /
---

# ToolPin documentation

ToolPin is the missing review gate between MCP registries and the AI clients
that run MCP servers with your credentials. It gives MCP installs the same
basic engineering loop teams expect from code dependencies: review the server
that will run, write exact client config, commit an enforcing `mcp-lock.json`,
and fail CI when the reviewed install drifts.

Every review resolves to one of three public verdicts. `verified` means fresh
ToolPin-verified artifact proof passed for a pinned target. `needs-review`
means metadata may be useful, but proof is missing, stale, declared only, or
weak. `blocked` means the entry is unsafe, uninstallable, or failed a fatal
gate. Add `--explain` to any command to see the internal tier, evidence rows,
and cap reasons behind the verdict.

`toolpin init ci` is the one-command path to a protected repo: it scaffolds a
GitHub workflow so `toolpin ci` fails a pull request when the committed
lockfile no longer matches the reviewed install plan.

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
- Reports one of three public verdicts — `verified`, `needs-review`, or
  `blocked` — with reasons, and exposes the internal tier and evidence detail
  through `--explain`.
- Generates client config for supported MCP clients.
- Creates a v2 `mcp-lock.json` keyed by server and client.
- Pins the live MCP tool surface in a `toolSurfaceHash` over the `tools/list`
  tool names, descriptions, and input schemas, so a later schema swap is drift.
- Rejects install drift when resolved metadata, selected target, trust score,
  generated config, capability metadata, or the pinned tool surface changes
  from the lockfile.
- Checks declared integrity pins: OCI targets must include `@sha256:` when
  required, and MCPB targets must declare `fileSha256` when required.
- Separates metadata completeness from evidence tier. `verified` requires a
  pinned install target plus ToolPin-verified artifact proof; missing proof caps the
  machine-readable `overallScore` and is shown as a `cap` reason in CLI/TUI
  output. Trusted-source conditional entries cap at 69% until artifact proof is
  verified. Current artifact proof means npm tarball SRI, OCI registry digest,
  or MCPB byte-hash verification.
- Runs `toolpin ci` as a read-only gate for committed lockfiles, with `--json`
  and `--sarif` output for pipelines and code-scanning tools.
- Scaffolds a protected repo with `toolpin init ci` — a hardened GitHub Action
  that runs strict CI plus `doctor` and uploads SARIF — and writes a starter
  policy with `toolpin policy init --recommended`.
- Supports optional whole-lock digest pins and detached Ed25519 lockfile
  signatures using keys managed outside ToolPin.

The `mcp-lock.json` format is also published as a vendor-neutral draft, the
MCP Install Lockfile Specification v1.0 (draft), shipped in the repo at
docs/spec/mcp-lockfile-v1.md. The npm package ships that spec's JSON Schemas
and conformance test vectors alongside the CLI.

## Limits to understand

ToolPin recomputes MCPB SHA-256 only from code-allowlisted HTTPS artifact hosts,
verifies npm tarballs against `registry.npmjs.org` SRI, and resolves OCI
manifest digests when registries are reachable. Unavailable bytes are reported
as `unavailable`, not treated as verified.
It checks whether declared pins are present and whether the reviewed lockfile
still matches the resolved install plan. It is not a blanket runtime validator;
optional live checks pin the live MCP tool surface, including input schemas,
when the server is reachable and credentials are available.

Start with [Install your first server](./tutorials/install-first-server.md).
