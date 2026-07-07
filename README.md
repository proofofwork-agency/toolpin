# ToolPin

[![CI](https://github.com/proofofwork-agency/toolpin/actions/workflows/ci.yml/badge.svg)](https://github.com/proofofwork-agency/toolpin/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![npm](https://img.shields.io/npm/v/@proofofwork-agency/toolpin)](https://www.npmjs.com/package/@proofofwork-agency/toolpin)
[![Status: pre-1.0 beta](https://img.shields.io/badge/status-pre--1.0%20beta-yellow)](https://github.com/proofofwork-agency/toolpin/releases)

ToolPin is a review gate for MCP server installs — a lockfile for what your
agent actually sees and runs. It verifies what it can about a server's
artifact (npm SRI, OCI digest, MCPB hash), hashes the live tool surface the
agent reads at connection time, writes correct client config, commits all of
it to an enforcing `mcp-lock.json`, and fails CI when any of it drifts.

NSA and OWASP guidance for MCP prescribes exactly this control — pin server
versions, hash tool definitions, alert on drift. ToolPin implements it as one
command: `toolpin init ci`.

Use `toolpin` for explicit commands or the shorter `tpn` alias for daily work.

Public documentation: <https://proofofwork-agency.github.io/toolpin/>

ToolPin is pre-1.0 beta software, Apache-2.0 licensed, and requires Node.js 22
or newer.

![Animated terminal demo showing ToolPin search, plan, install, audit, and CI drift-check commands.](docs/assets/readme/terminal-demo.svg)

## Contents

- [Highlights](#highlights)
- [Screenshots](#screenshots)
- [Why ToolPin](#why-toolpin)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [GitHub Actions](#github-actions)
- [Safety Model](#safety-model)
- [What Exists Now](#what-exists-now)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Resources](#resources)

## Highlights

- **An enforcing lockfile:** `mcp-lock.json` records the reviewed artifact,
  the live tool surface hash, and the generated config — with per-entry
  integrity and optional ed25519 signatures. CI rejects drift in any of them.
- **One command to protected:** `toolpin init ci` writes a minimal, SHA-pinned
  GitHub workflow plus a starter policy. Rug pulls — a server changing its
  tool descriptions after you approved it — fail your build instead of
  steering your agent.
- **Three-verdict output:** every server is `verified`, `needs-review`, or
  `blocked`, with the reason. `--explain` shows the full evidence when you
  want it.
- **One lockfile across clients:** correct config for Claude, Cursor, VS Code,
  Codex, OpenCode, Continue, Gemini CLI, and more — reviewed once, written
  everywhere.
- **Registry-aware, registry-neutral:** reads the Official MCP Registry,
  Docker MCP Catalog, the ToolPin curated registry, and custom registries; it
  is a verification layer over them, not a competing catalog.
- **Local policy gate:** minimum verdict floor, source/client allow/deny
  rules, remote endpoint rules, required-secret rules, and pinning
  requirements — enforced at install and in CI.
- **An open format:** the lockfile is a
  [vendor-neutral draft spec](docs/spec/mcp-lockfile-v1.md) with JSON Schemas
  and byte-exact test vectors, so other tools can read and enforce it too.
- **Terminal UI:** browse, inspect, install, update, adopt, remove, and test MCP
  servers from an Ink-based TUI.

## Screenshots

ToolPin gives MCP installs the same review loop teams already expect for code:
inspect the server, verify the evidence, preview the exact client config, then
write a lockfile that CI can enforce.

![ToolPin TUI browse overview with ContextRelay selected, verified evidence, trust scores, and install actions.](docs/assets/readme/tui-browse-overview.jpg)

The TUI is built for repeated operations: source-aware browsing, registry/cache
state, trust scoring, version selection, installed inventory, config preview,
and one-key install/adopt/update/delete flows.

| Config preview | Installed inventory |
|---|---|
| ![ToolPin TUI config preview showing the Claude project MCP JSON that will be written for a streamable HTTP server.](docs/assets/readme/tui-config-preview.jpg) | ![ToolPin TUI installed inventory showing locked and unlocked Codex MCP servers.](docs/assets/readme/tui-installed-inventory.jpg) |

![ToolPin TUI help screen showing keyboard shortcuts, scoring explanations, locking behavior, sources, and installed actions.](docs/assets/readme/tui-help.jpg)

## Why ToolPin

Adding an MCP server is not like installing an editor theme. It can give an
agent new tools, local process access, network access, and credentials. Today
that decision is often a copied JSON snippet with no reviewed artifact and no
CI check that says "this is still the server and config we approved."

The failure modes are no longer theoretical: postmark-mcp shipped an email
BCC backdoor in a patch release, mcp-remote had a CVSS 9.6 RCE
(CVE-2025-6514), and the quietest one — the rug pull — needs no new release
at all: a server you approved changes its tool descriptions upstream, your
agent reads them live at the next connection, and nothing in your repo
changed. MCP clients do not notify you.

ToolPin turns MCP installs into a normal engineering control:

1. Inspect the server and install plan (`verified` / `needs-review` /
   `blocked`, with reasons).
2. Generate the right config for the MCP client.
3. Commit `mcp-lock.json` as the reviewed record — artifact digests, tool
   surface hash, config, evidence.
4. Run `toolpin init ci` once; from then on drift fails the build.

ToolPin is deliberately one layer, and not the others:

| Layer | Examples | What it checks | What it misses |
|---|---|---|---|
| Identity allowlists | GitHub/VS Code enterprise MCP policies | server name/URL is on the list | artifact bytes, tool surface, config — and CI is uncovered |
| File/package pinning | generic agent package managers | files on disk match a hash | the live tool surface the agent actually reads |
| Static scanners | MCP security scanners | known-bad patterns at scan time | day-7 changes to an approved server |
| Runtime gateways | hosted MCP proxies | traffic at runtime | nothing — but you must route everything through them |
| **ToolPin** | this repo | **artifact + live tool surface + config, enforced in CI** | runtime behavior (by design — see threat model) |

It is not a hosted gateway, runtime sandbox, secret vault, or marketplace. It
sits between registries and clients as a local, repo-owned verification
layer — the part every registry and client currently leaves to you.

## Getting Started

### Prerequisites

- Node.js 22 or newer.
- npm.
- Git.
- One supported MCP client, such as Claude, Cursor, VS Code, Codex, OpenCode,
  Continue, Gemini CLI, Windsurf, Cline, Roo Code, Zed, or a generic sidecar.

### Install From npm

```bash
npm install -g @proofofwork-agency/toolpin
toolpin --version
tpn -v
tpn upgrade --dry-run
```

`toolpin` and `tpn` are aliases for the same CLI. `toolpin upgrade` and
`tpn upgrade` update the globally installed package; pass `--dry-run` to preview
the package-manager command.

### Develop From Source

Use the source checkout when changing ToolPin itself:

```bash
git clone https://github.com/proofofwork-agency/toolpin.git
cd toolpin
npm ci
npm test
```

Build the CLI:

```bash
npm run dev -- --help
```

## Usage

### The 30-second version

```bash
toolpin search github --live                                  # find a server
toolpin install io.github.github/github-mcp-server \
  --client claude --update-lock                               # review, write config + lock
toolpin init ci                                               # workflow + starter policy
git add mcp-lock.json .toolpin .github && git commit          # protected
```

From here on, a PR that changes the server's artifact, its tool surface, the
generated config, or the lockfile itself fails CI with the exact remediation
command.

### Search Registries

```bash
toolpin ingest --source all --limit 500 --pages 25
toolpin search github --source all --limit 5
```

### Guided Interactive CLI

```bash
toolpin interactive github
tpn i github
```

The guided CLI is scrollback-friendly and separate from the full-screen TUI. It
searches, reviews trust/evidence/client defaults, shows the exact equivalent
command, and writes only after explicit confirmation. In scripts or pipes,
`toolpin i github --no-input` prints command guidance and makes no writes.

### Review an Install Plan

```bash
toolpin plan io.github.github/github-mcp-server \
  --client claude \
  --scope project \
  --live
```

### Install and Lock

```bash
toolpin install io.github.github/github-mcp-server \
  --client claude \
  --scope project \
  --live \
  --verify \
  --update-lock
```

The install writes client config and `mcp-lock.json`. Commit the lockfile so
teammates and CI can reject drift.

### Check Drift

```bash
toolpin doctor --scope project
toolpin ci --file mcp-lock.json --live --verify
```

`doctor` checks the actual project/global client config files on disk against
`mcp-lock.json`. `ci` re-resolves locked entries and rejects lockfile, registry,
policy, generated-plan, signature, or verification drift without reading local
client config files.

### Use the TUI

```bash
toolpin tui
tpn tui
npm run tui
```

Useful keys:

| Key | Action |
|---|---|
| `/` | Search |
| `tab` or `1-6` | Switch panels |
| `enter` | Open selected install plan |
| `i` | Install wizard |
| `r` or `: ingest` | Persistently refresh registry cache |
| `l` | Toggle live/cache view for the session |
| `m` or `+` | Show more Browse results |
| `a` | Cycle Browse sort: source-first, alpha A-Z, alpha Z-A, source-last, relevance |
| `g` | Cycle the exact source filter (`all`, then enabled sources such as `toolpin`, `official`, `docker`) |
| `S` | Show sources |
| `I` | Show installed inventory |
| `q` | Quit |

See the hosted [CLI reference](https://proofofwork-agency.github.io/toolpin/docs/reference/cli)
for the full command list.

## GitHub Actions

The fastest path is the scaffold — it writes the workflow and a starter
policy, and refuses to set up a repo that has no lockfile yet:

```bash
toolpin init ci
```

Which produces the whole setup:

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
- uses: proofofwork-agency/toolpin@v0.3.2
```

Useful inputs on the composite Action:

- `strict: "true"` — require verified artifact evidence (`--verify
  --require-verified`). Remote tool-surface pins are re-probed over the
  network; package live pins additionally need `allow-execute: "true"`
  because re-verifying them executes the package.
- `doctor: auto|true|false` — also check committed client config files
  (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`)
  against the lockfile. `auto` runs it when such files exist.
- `sarif: "true"` — write SARIF and expose `sarif-path` for
  `github/codeql-action/upload-sarif`.
- `toolpin-version` — install from npm instead of building the action source.

Conflicting inputs (for example `strict: "true"` with `verify: "false"`) fail
closed with an explanation rather than silently downgrading. See the
[drift-in-CI guide](https://proofofwork-agency.github.io/toolpin/docs/how-to/catch-drift-in-ci)
for the full matrix, digest pinning, and signature verification.

For direct CLI workflows, `toolpin ci --live --verify` re-runs verification
before comparing locked plans. Use `--skip-live-verification` only as an explicit downgrade when you accept skipping live `tools/list` capability
hashing; CI refuses that downgrade for entries that already have live pins.

## Safety Model

ToolPin is intentionally conservative:

- It answers with three verdicts — `verified`, `needs-review`, `blocked` —
  and always says why. `--explain` exposes the underlying tier, profile
  score, evidence list, and caps.
- `verified` requires ToolPin-verified artifact proof (npm integrity, OCI
  digest, or MCPB hash evidence) — publisher claims alone never earn it;
  they are reported as declared, and capped until re-verified locally.
- It fails closed when a client config path is not verified.
- It keeps structured output on stdout and progress/errors on stderr.
- It does not print raw secret values during secret audits.
- It rejects lockfile drift unless you deliberately review and update the lock.

Verification currently covers install metadata and selected evidence paths:
npm tarball SRI verification from `registry.npmjs.org`, OCI manifest digest
resolution, declared attestation metadata, generated capability manifests, and
optional live `tools/list` hashes. For MCPB artifacts, ToolPin can
recompute MCPB SHA-256 only for allowlisted HTTPS artifact hosts. See the
[threat model](https://proofofwork-agency.github.io/toolpin/docs/concepts/threat-model)
for the exact scope and limits.

## What Exists Now

- Official MCP Registry and Docker MCP Catalog ingestion.
- ToolPin curated registry source of truth in GitHub:
  <https://github.com/proofofwork-agency/toolpin/blob/main/registry/v0/servers>
  with a GitHub Pages static mirror for docs/browsing:
  <https://proofofwork-agency.github.io/toolpin/registry/v0/servers>
- Custom registry configuration via `.toolpin/registries.json`.
- Search ranking over name, title, description, package type, transport, and
  repository.
- Install plans and lockfile v2 writes keyed by server/client.
- Config export for Claude, Cursor, VS Code, Codex, OpenCode, Windsurf, Cline,
  Continue, Gemini CLI, Zed, Roo Code, and generic sidecar clients.
- Local policy checks through `.toolpin/policy.json`.
- Lockfile digest and detached Ed25519 signature verification.
- Advisory tool-description scans and SARIF output for CI pipelines.
- Read-only secret hygiene audits for installed client config.
- Installed inventory, adopt, update, remove, test-installed, and doctor flows.
- Full-screen terminal UI for browse/install/config workflows.

## Roadmap

The first public release path is complete. Near-term work now focuses on
adoption and evidence quality:

- Keep npm provenance publishing healthy for every release.
- Keep the GitHub Action pinned and documented for CI adoption.
- Continue tightening evidence definitions, policy fields, and trust docs.

Longer-term direction:

- Broader verified evidence coverage.
- Better enterprise policy integration.
- More client-path verification.
- Safer secret brokering without plaintext client config.
- Task-first MCP discovery and stronger tool-description review signals.

See [docs/ROADMAP.md](https://github.com/proofofwork-agency/toolpin/blob/main/docs/ROADMAP.md) for project direction.

## Contributing

Contributions are welcome, especially focused fixes with tests. Start with:

```bash
npm ci
npm test
npm run docs:check
npm run registry:check
```

Please read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[CLA.md](https://github.com/proofofwork-agency/toolpin/blob/main/CLA.md)
before opening larger changes.

## License

ToolPin is distributed under the Apache License 2.0. See [LICENSE](LICENSE).

## Resources

- [Hosted documentation](https://proofofwork-agency.github.io/toolpin/)
- [CLI reference](https://proofofwork-agency.github.io/toolpin/docs/reference/cli)
- [Threat model](https://proofofwork-agency.github.io/toolpin/docs/concepts/threat-model)
- [Client config matrix](https://github.com/proofofwork-agency/toolpin/blob/main/docs/client-configs.md)
- [Catch drift in CI](docs/how-to/catch-drift-in-ci.md)
- [ToolPin vs. the MCP ecosystem](https://proofofwork-agency.github.io/toolpin/docs/concepts/comparison)
- [Security policy](SECURITY.md)
- [Disclaimer](https://github.com/proofofwork-agency/toolpin/blob/main/DISCLAIMER.md)

## Notice

> **No warranty. You assume all risk.** ToolPin installs and launches
> third-party MCP servers, including npm packages, Docker images, and remote
> services. That code can access files, networks, and credentials through the
> client that runs it. ToolPin's score, evidence tier, and lockfile checks are
> review aids, not a guarantee that any server is safe. See
> [DISCLAIMER.md](https://github.com/proofofwork-agency/toolpin/blob/main/DISCLAIMER.md)
> and the [threat model](https://proofofwork-agency.github.io/toolpin/docs/concepts/threat-model).
