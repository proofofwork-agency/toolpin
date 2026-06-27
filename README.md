# ToolPin

[![CI](https://github.com/proofofwork-agency/toolpin/actions/workflows/ci.yml/badge.svg)](https://github.com/proofofwork-agency/toolpin/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![npm publish pending](https://img.shields.io/badge/npm-publish%20pending-orange)](https://www.npmjs.com/package/toolpin)

ToolPin is a review gate for MCP server installs. It helps teams inspect what
an MCP server will run, generate client config, commit an enforcing
`mcp-lock.json`, and fail CI when the reviewed install drifts.

Public documentation: <https://proofofwork-agency.github.io/toolpin/>

ToolPin is Apache-2.0 licensed and requires Node.js 22 or newer.

> **No warranty. You assume all risk.** ToolPin installs and launches
> third-party MCP servers, including npm packages, Docker images, and remote
> services. That code can access files, networks, and credentials through the
> client that runs it. ToolPin's score, evidence tier, and lockfile checks are
> review aids, not a guarantee that any server is safe. See
> [DISCLAIMER.md](DISCLAIMER.md) and [docs/threat-model.md](docs/threat-model.md).

## Contents

- [Highlights](#highlights)
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

- **Review before install:** inspect registry metadata, selected target, trust
  score, evidence tier, required secrets, and generated config before writing.
- **One lockfile across clients:** write `mcp-lock.json` entries for Claude,
  Cursor, VS Code, Codex, OpenCode, Continue, Gemini CLI, and more.
- **CI drift checks:** reject changes in registry metadata, selected target,
  config output, capability manifest, policy, signature, or evidence state.
- **Registry-aware discovery:** ingest Official MCP Registry, Docker MCP
  Catalog, the ToolPin curated registry, and configured custom registries.
- **Local policy gate:** enforce minimum trust tier/score, source and client
  allow/deny rules, remote endpoint rules, required-secret rules, and pinning
  requirements.
- **Terminal UI:** browse, inspect, install, update, adopt, remove, and test MCP
  servers from an Ink-based TUI.

## Why ToolPin

Adding an MCP server is not like installing an editor theme. It can give an
agent new tools, local process access, network access, and credentials. Today
that decision is often a copied JSON snippet with no reviewed artifact and no
CI check that says "this is still the server and config we approved."

ToolPin turns that into a normal engineering control:

1. Inspect the server and install plan.
2. Generate the right config for the MCP client.
3. Commit `mcp-lock.json` as the reviewed record.
4. Run `toolpin ci` so drift is caught before it reaches users.

ToolPin is not a hosted gateway, runtime sandbox, secret vault, or broad MCP
marketplace. It sits between registries and clients as a local, repo-owned
reproducibility layer.

## Getting Started

### Prerequisites

- Node.js 22 or newer.
- npm.
- Git.
- One supported MCP client, such as Claude, Cursor, VS Code, Codex, OpenCode,
  Continue, Gemini CLI, Windsurf, Cline, Roo Code, Zed, or a generic sidecar.

### Install From Source

The npm package metadata is ready, but `toolpin` has not been published from
this repository yet. Use the source checkout until the first npm release is
complete.

```bash
git clone https://github.com/proofofwork-agency/toolpin.git
cd toolpin
npm ci
npm test
```

Build the CLI:

```bash
npm run build
node dist/cli.js --help
```

### Install From npm

After the package is published:

```bash
npm install -g toolpin
toolpin --version
tpn -v
tpn upgrade --dry-run
```

`toolpin` and `tpn` are aliases for the same CLI. `toolpin upgrade` and
`tpn upgrade` update the globally installed package; pass `--dry-run` to preview
the package-manager command.

## Usage

### Search Registries

```bash
node dist/cli.js ingest --source all --limit 500 --pages 25
node dist/cli.js search github --source all --limit 5
```

### Review an Install Plan

```bash
node dist/cli.js plan io.github.github/github-mcp-server \
  --client claude \
  --scope project \
  --live
```

### Install and Lock

```bash
node dist/cli.js install io.github.github/github-mcp-server \
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
node dist/cli.js doctor --scope project
node dist/cli.js ci --file mcp-lock.json --live --verify
```

### Use the TUI

```bash
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

Run ToolPin against a committed MCP lockfile:

```yaml
name: ToolPin

on:
  pull_request:
  push:
    branches: [main]

jobs:
  toolpin:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: proofofwork-agency/toolpin@v0.2.2
        with:
          live: "true"
          verify: "true"
          file: mcp-lock.json
```

The checked-in composite Action builds ToolPin from the action source by
default, then runs `toolpin ci`. After npm publish, set `toolpin-version` to an
npm version specifier if you want the Action to install from npm instead.

Recommended CI posture for reviewed lockfiles is `toolpin ci --live --verify`
for capability drift. Use `--skip-live-verification` only as an explicit downgrade
when live `tools/list` hashing is unavailable.

## Safety Model

ToolPin is intentionally conservative:

- It fails closed when a client config path is not verified.
- It keeps structured output on stdout and progress/errors on stderr.
- It does not print raw secret values during secret audits.
- It treats score as triage, not proof.
- It separates evidence tier from metadata completeness.
- It rejects lockfile drift unless you deliberately review and update the lock.

Verification currently covers install metadata and selected evidence paths:
npm tarball SRI verification from `registry.npmjs.org`, OCI manifest digest
resolution, registry attestations, generated capability manifests, and optional
live `tools/list` hashes. For MCPB artifacts, ToolPin can
recompute MCPB SHA-256 only for allowlisted HTTPS artifact hosts. See the
[threat model](https://proofofwork-agency.github.io/toolpin/docs/concepts/threat-model)
for the exact scope and limits.

## What Exists Now

- Official MCP Registry and Docker MCP Catalog ingestion.
- ToolPin curated registry source of truth in GitHub:
  <https://github.com/proofofwork-agency/toolpin/blob/main/registry/v0/servers>
  with a GitHub Pages static mirror for docs/browsing:
  <https://proofofwork-agency.github.io/toolpin/registry/v0>
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

The immediate release path is public distribution:

- Publish the npm package with provenance.
- Move README and docs install examples from source checkout to npm-first usage.
- Keep the GitHub Action pinned and documented for CI adoption.
- Continue tightening evidence definitions, policy fields, and trust docs.

Longer-term direction:

- Broader verified evidence coverage.
- Better enterprise policy integration.
- More client-path verification.
- Safer secret brokering without plaintext client config.
- Task-first MCP discovery and stronger tool-description review signals.

See [docs/ROADMAP.md](docs/ROADMAP.md) for project direction.

## Contributing

Contributions are welcome, especially focused fixes with tests. Start with:

```bash
npm ci
npm test
npm run docs:check
npm run registry:check
```

Please read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[CLA.md](CLA.md) before opening larger changes.

## License

ToolPin is distributed under the Apache License 2.0. See [LICENSE](LICENSE).

## Resources

- [Hosted documentation](https://proofofwork-agency.github.io/toolpin/)
- [CLI reference](https://proofofwork-agency.github.io/toolpin/docs/reference/cli)
- [Threat model](https://proofofwork-agency.github.io/toolpin/docs/concepts/threat-model)
- [Client config matrix](docs/client-configs.md)
- [Catch drift in CI](docs/how-to/catch-drift-in-ci.md)
- [ToolPin vs. the MCP ecosystem](docs/site/concepts/comparison.md)
- [Security policy](SECURITY.md)
- [Disclaimer](DISCLAIMER.md)
