# ToolPin

[![CI](https://github.com/proofofworks/TPN/actions/workflows/ci.yml/badge.svg)](https://github.com/proofofworks/TPN/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![npm publish pending](https://img.shields.io/badge/npm-publish%20pending-orange)](https://www.npmjs.com/package/toolpin)

ToolPin is the missing review gate between MCP registries and the AI clients
that run MCP servers with your credentials. It gives MCP installs the habit
developers already expect from code dependencies: inspect what will run, write
the exact client config, commit a lockfile, and fail CI when the reviewed
install drifts.

The factual claim: ToolPin is an Apache-2.0 CLI that combines official/Docker
registry ingestion, neutral config generation for 12 MCP clients, an enforcing
`mcp-lock.json`, and local CI/policy checks in one workflow. It is not the
largest catalog, a hosted gateway, a runtime sandbox, or a secret vault.

Apache-2.0 licensed. Requires Node.js 22 or newer.

## Contents

- [Why ToolPin](#why-toolpin)
- [Who it is for](#who-it-is-for)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [GitHub Actions](#github-actions)
- [Release Checklist](#release-checklist)
- [What Exists Now](#what-exists-now)
- [Adoption Strategy](#adoption-strategy)
- [Troubleshooting](#troubleshooting)
- [Resources](#resources)

## Why ToolPin

The human reason is simple: adding an MCP server is not like installing a theme.
It can give an agent new tools, local process access, network access, and
credentials. Today that decision is often a copied JSON snippet in one editor,
with no reviewed artifact for teammates and no CI check that says "this is
still the server and config we approved."

ToolPin turns that into a normal engineering control:

- Review an install plan before writing config.
- Generate the right JSON, TOML, or YAML for the client your team uses.
- Commit `mcp-lock.json` as the record of what was approved.
- Run `toolpin ci` so pull requests fail when registry metadata, selected
  target, trust score, generated config, policy, or optional signatures drift.

## Who it is for

ToolPin is for developers and platform teams standardizing MCP usage across
multiple clients. It is most useful when a repository needs repeatable installs,
reviewable config changes, and a CI gate for MCP drift. It is not a runtime
sandbox, gateway, or secret broker.

## Does this already exist?

Parts of it exist. The combined workflow is the point.

| Product type | Examples | What they do well | What ToolPin adds |
|---|---|---|---|
| Registries and catalogs | Official MCP Registry, PulseMCP, Glama | Discovery and metadata. | A committed lockfile, drift checks, policy gates, and generated config. |
| Marketplaces/installers | Smithery, MCP installer tools | Easy install and distribution. | Neutral review and enforcement across clients instead of a marketplace-controlled install path. |
| Runtime gateways | Docker MCP Toolkit/Governance, Glama Gateway, Stacklok ToolHive, security vendors | Runtime isolation, auth, ACLs, observability, enterprise controls. | A local, portable, repo-owned install artifact that works before runtime and in CI. |
| Client-specific settings | Claude, Cursor, VS Code, Codex, OpenCode, and others | Native runtime integration. | One reviewed install plan and one lockfile across many client config formats. |

If another tool already gives your team neutral multi-client config,
install-time review, an enforcing lockfile, and CI drift detection, use it.
ToolPin exists because the current ecosystem mostly solves discovery, hosting,
or runtime control, but not the repo-level reproducibility layer in between.

## Prerequisites

- Node.js 22 or newer, and npm.
- Git (for source checkout and lockfile commits).
- An MCP client whose config format ToolPin writes (see
  [docs/client-configs.md](docs/client-configs.md) for the full matrix).
- Network access to the configured registry sources (official MCP Registry, Docker
  MCP Catalog, and any custom registries) for `--live` operations; otherwise
  ToolPin reads the local cache at `.toolpin/registry-cache.json` and falls back
  to a live fetch when the cache is missing or lacks the requested source.

## Quick Start

Use the source checkout today, inspect a server, then write the reviewed config
and lockfile into your project:

```bash
npm ci
npm test
node dist/cli.js plan io.github.github/github-mcp-server --client claude --live
node dist/cli.js install io.github.github/github-mcp-server --client claude --scope project --live --verify --update-lock
```

The first install writes client config plus `mcp-lock.json`. Commit
`mcp-lock.json` so teammates and CI can reject drift. Run
`node dist/cli.js doctor --scope project` and `node dist/cli.js ci --live`
before opening a pull request. Use `--client all` when you want ToolPin to fan
out to every supported project-scope client.

After the npm package is published, the same flow becomes:

```bash
npm install -g toolpin
toolpin --version
tpn -v
toolpin search github --source all --limit 5 --live
```

Release note: the package metadata is ready, but `toolpin` is not published on
npm from this repository yet. Do not use the npm install path until release
ownership, token/2FA, and name availability are confirmed.

## Commands

```text
toolpin ingest [--source official|docker|all|custom-id] [--limit 100] [--pages 10]
toolpin registry list [--json]
toolpin search <query> [--source official|docker|all|custom-id] [--limit 10] [--live]
toolpin info <server-name> [--source official|docker|all|custom-id] [--json] [--live]
toolpin audit <server-name> [--source official|docker|all|custom-id] [--live]
toolpin verify <server-name> [--source official|docker|all|custom-id] [--live] [--json] [--timeout 15000] [--skip-live-verification | --skip-live-verify]
toolpin versions <server-name> [--source official|docker|all|custom-id] [--live] [--limit 10] [--json]
toolpin list [--scope|-s all|project|global] [--client|-c claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all] [--json]
toolpin plan <server-name> --client|-c claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all [--source official|docker|all|custom-id] [--live]
toolpin install <server-name> --client|-c claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all [--scope|-s project|global] [--global|-g] [--project|-p] [--source official|docker|all|custom-id] [--live] [--update-lock] [--verify [--skip-live-verification | --skip-live-verify] [--timeout 15000]] [--policy .toolpin/policy.json] [--no-policy]
toolpin policy check <server-name> --client|-c claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all [--scope|-s project|global] [--global|-g] [--project|-p] [--policy .toolpin/policy.json] [--json] [--source official|docker|all|custom-id] [--live]
toolpin secrets audit [--file mcp-lock.json] [--scope|-s all|project|global] [--global|-g] [--project|-p] [--json]
toolpin remove <server-name> [--client|-c claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all] [--scope|-s project|global] [--global|-g] [--project|-p] [--file mcp-lock.json]
toolpin uninstall <server-name> [--client|-c claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all] [--scope|-s project|global] [--global|-g] [--project|-p] [--file mcp-lock.json]
toolpin ci [--file mcp-lock.json] [--expect-digest sha256-...] [--signature mcp-lock.sig --public-key public.pem] [--policy .toolpin/policy.json] [--no-policy] [--source official|docker|all|custom-id] [--live] [--verify [--skip-live-verification | --skip-live-verify] [--timeout 15000]]
toolpin outdated [--file mcp-lock.json] [--source official|docker|all|custom-id] [--live] [--json]
toolpin doctor [--file mcp-lock.json] [--scope|-s all|project|global] [--global|-g] [--project|-p] [--json]
toolpin test <server-name> [--source official|docker|all|custom-id] [--live] [--timeout 15000]
toolpin lock <server-name> --client|-c claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all [--source official|docker|all|custom-id] [--file mcp-lock.json] [--live]
toolpin lock digest [--file mcp-lock.json] [--json]
toolpin lock sign --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig] [--json]
toolpin lock verify-signature --key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig] [--json]
toolpin export-config <server-name> --client|-c claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all [--source official|docker|all|custom-id] [--live]
toolpin tui
```

`tpn` is registered as the short binary alias for the same CLI.
Common install/config shortcuts are also supported: `-c` for `--client`, `-s`
for `--scope`, `-g` for `--global`, and `-p` for `--project`.

## GitHub Actions

Run the normal Node test suite:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
```

Check a committed MCP lockfile for registry drift:

```yaml
jobs:
  toolpin:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: OWNER/REPO@v0.1.0
        with:
          live: "true"
          file: mcp-lock.json
```

Replace `OWNER/REPO` with the public ToolPin action repository after it is
tagged. By default, the checked-in composite Action installs ToolPin from the
action source via `$GITHUB_ACTION_PATH`, then runs `toolpin ci`.

After npm publish, you can opt into npm installation with `toolpin-version`:

```yaml
- uses: OWNER/REPO@v0.1.0
  with:
    toolpin-version: latest
    live: "true"
```

Or run the source checkout directly:

```bash
npm ci
npm test
node dist/cli.js ci --file mcp-lock.json --live
```

See `docs/how-to/catch-drift-in-ci.md` for digest, signature, policy, verification,
and all other action inputs.

## Release Checklist

Publishing is human-gated because it requires npm ownership, an npm token or
2FA, and package-name availability:

```bash
npm run release:check
npm publish --access public
npm view toolpin version
```

`npm run release:check` runs the full test suite, verifies the package metadata
and npm publish target, and performs an npm tarball dry run. After publish
succeeds, update docs and action examples that should prefer the public npm
path.

## Adoption Strategy

The next milestone is public distribution, not more core cleanup. The GitHub
Action is the first adoption path because it makes `mcp-lock.json` useful in
existing repositories before the npm package is published. After the first npm
release, switch the default quickstart and Action examples to the package path,
then focus on examples that show lockfile drift prevention in real MCP projects.

## What Exists Now

- Official MCP Registry and Docker MCP Catalog ingestion, with combined or source-specific views.
- GitHub-hosted ToolPin Curated Registry scaffold under `registry/v0/servers`, ready for PR-reviewed recommended servers without a custom backend.
- Repo-owned custom registries via `.toolpin/registries.json`; `official-compatible` registries can be installable, while broad `http-json` directory sources default to discovery-only.
- Known registry notes for PulseMCP, Smithery, and Glama; adapters stay discovery-only until stable access, credentials, and normalization are configured.
- Local cache at `.toolpin/registry-cache.json`.
- Normalized package and remote metadata.
- Search ranking over name, title, description, package type, transport, and repository.
- Trust scoring for repository presence, namespace shape, pinned versions, OCI digests, MCPB hashes, HTTPS remotes, secrets, legacy transports, and missing install targets.
- Verification reports that derive a capability manifest, surface registry attestations, reject mutable OCI targets, reject MCPB packages without `fileSha256`, and optionally pin remote tool descriptions via a live MCP `tools/list` probe.
- Version visibility via `toolpin versions <server>` and `toolpin outdated`: ToolPin compares the lockfile's pinned server version against known registry/cache versions, reports update availability, and lists recent previous versions. The TUI Overview and Install panels show locked/latest/update status for the selected client/scope.
- Advisory tool-description scans flag deterministic review signals: agent-directed instructions, hidden/control characters, and tool-name shadowing in registry descriptions and verified live `tools/list` descriptions. These are warnings for human review, not prompt-injection detection, sandboxing, or an install blocker.
- `toolpin install --verify` persists the verified capability manifest in `mcp-lock.json`, including remote tool-description hashes when the live probe succeeds.
- Config export for Claude/Cursor-style `mcpServers`, VS Code-style `servers`, Codex `config.toml` `[mcp_servers.*]` tables, OpenCode `mcp`, Windsurf/Cascade, Cline, Continue `config.yaml`, Gemini CLI, Zed `context_servers`, and Roo Code.
- Install plans and `mcp-lock.json` v2 writes keyed by server/client, with per-entry `original`, `resolved`, `locked`, capability manifest, and `sha256-...` integrity metadata.
- Install drift checks: if an existing lock entry changes version, selected target, generated client config, capability manifest, tool-description hash, or trust score (on decrease), install refuses until the lock is reviewed and updated with `toolpin lock` or `toolpin install --update-lock`.
- Whole-lock digest pinning via `toolpin lock digest` and `toolpin ci --expect-digest`: computes a timestamp-insensitive canonical `sha256-...` over the complete lockfile server/client set. This is useful only when CI or another verifier gets the expected digest from a trusted out-of-band source; it is not a signature, provenance, sigstore, or self-protecting lockfile.
- Detached lockfile signing via user-supplied Ed25519 keys: `toolpin lock sign --key private.pem` signs the canonical whole-lock digest into `mcp-lock.sig`, `toolpin lock verify-signature --key public.pem` verifies it, and `toolpin ci --signature mcp-lock.sig --public-key public.pem` fails closed before registry resolution. ToolPin does not generate or store keys; verification is meaningful only when the private key and public trust root are managed outside the repo/lockfile trust path.
- Frozen lockfile checks via `toolpin ci`: re-resolves every locked server/client entry, verifies lock integrity, rejects drift, and never mutates the lockfile.
- Local policy gate via optional `.toolpin/policy.json`: `toolpin install`, `toolpin ci`, TUI installs, and `toolpin policy check` can enforce trust minimums, source/client/server deny rules, denied package/transport/remote-host rules, and OCI/MCPB pin requirements.
- Read-only secret hygiene via `toolpin secrets audit`: reports likely plaintext env/header secrets in installed client config files using registry `isSecret` metadata and known token prefixes. Findings are advisory and redacted; ToolPin does not resolve or print secret values.
- Lockfile v1 entries must be regenerated before enforcement; missing v2 integrity fails closed. Use `--live` in CI when you need registry drift detection instead of local-cache validation.
- Installed inventory via `toolpin list` and the TUI Installed tab: listing of MCP server entries present in supported folder/project and global/user client config files, with explicit `registry:exact|alias|none`, `action:update|adopt|none`, and `test:config|none` status. Runtime status is advisory, not a process monitor.
- Installed lifecycle commands: `toolpin test-installed` tests the installed client config directly, `toolpin adopt` replaces an unlocked alias with its registry match and writes the lockfile, `toolpin update <server>` updates only locked rows, and `toolpin update --all` applies safe locked updates while reporting unlocked adoptable rows separately. Use `--dry-run` to preview `adopt` and `update` writes.
- Cursor project/global installs write `.cursor/mcp.json` and `~/.cursor/mcp.json`. Claude project installs write `.mcp.json`; Claude global config is managed by the Claude CLI, so ToolPin fails closed instead of writing a sidecar. Use `toolpin export-config ... --client claude` with `claude mcp add-json --scope user` for user-scope Claude setup.
- For generic clients whose real global config path is not standardized or verified, ToolPin's global scope means the ToolPin-managed sidecar file under `~/.config/toolpin/`.
- `toolpin remove` cleanup for supported client config files and matching lockfile entries, including Codex TOML table removal.
- `toolpin uninstall` is an alias for `toolpin remove`.
- `toolpin remove` defaults to all supported project clients when `--client` is omitted; pass `--client <name>` for targeted cleanup.
- `toolpin doctor` read-only reconciliation from `mcp-lock.json` to current project/global client config entries, including Codex TOML.
- Codex doctor support reads the documented `[mcp_servers.<name>]` TOML tables ToolPin writes; hand-authored inline/dotted TOML forms may be reported as missing or drift.
- Real install writes for project/global client config files, including scope-aware `--client all`, plus lockfile generation and install progress details. Newly verified paths include Windsurf/Cascade global, Cline global, Continue global, Gemini CLI project/global, and Roo Code project. Zed install and Roo global writes fail closed until their settings paths are verified.
- MCP server test action that connects with the SDK and lists available tools when credentials/runtime are available.
- Full-screen Ink TUI with a prompt-first search bar, selectable MCP server options, focused modal panels for Overview/Install/Config/Help, source selection, project/global install scope, and test status.

## TUI

Run:

```bash
npm run tui
```

Hotkeys:

```text
tab / 1-6       Switch panels (1=Browse, 2=Installed, 3=Overview, 4=Install, 5=Config, 6=Help)
/               Search
:               Open command palette
esc             Exit search/command mode, or return to Browse
up/down or j/k  Move selection
enter           Open selected-server overview
r               Refresh current source
i               Ingest live registry data into cache
g               Cycle registry source; in Installed, cycle all/project/global inventory scope
G               Toggle install scope: project or global
t               Test selected server by connecting and listing tools; in Installed, run test-installed
u / U           In Installed, update/adopt selected server / update all locked servers
d               In Installed, refresh drift/lock state with doctor reconciliation
I               Install selected server into active scope and lockfile
x               Remove selected server from active config and lockfile (press twice outside Installed; immediate in Installed)
l               Toggle live/cache source
c               Cycle client target, including all
o               Jump to opencode target
v / V           Cycle selected server version forward / back
m or +          Show more results
w               Write selected server to mcp-lock.json
s               Save selected client config under .toolpin/
R               Reset search/source/client/scope to defaults
h or ?          Help
q / ctrl-c      Quit
```

Mouse clicks are also supported: click menu tabs to switch panels and click a
result row to select/open it. All hotkeys remain active in every panel — there is
no modal focus trapping, so `I`/`x`/`w`/`s` still fire while Help or Overview is open.

## Local Policy

When `.toolpin/policy.json` exists, `toolpin install`, `toolpin ci`, `toolpin policy check`,
and TUI installs enforce it before writing config or accepting a frozen lock. Use `--policy <file>`
to point at a different policy file or `--no-policy` for an explicit local bypass.

```json
{
  "version": 1,
  "minTrustScore": 70,
  "allowedSources": ["official", "docker"],
  "deniedSources": ["smithery"],
  "allowedClients": ["claude", "cursor", "vscode", "codex", "opencode"],
  "deniedClients": ["generic"],
  "deniedServers": ["io.github/example/unsafe-server"],
  "deniedPackageTypes": ["cargo"],
  "deniedTransports": ["sse"],
  "deniedRemoteHosts": ["untrusted.example.com"],
  "requireDigestPinnedOci": true,
  "requireMcpbSha256": true
}
```

Every field is optional; unknown keys are rejected. `deniedRemoteHosts` matches the
exact `host` (including port) of a remote URL, so deny `api.example.com` and
`example.com:443` separately — subdomain suffix matching is not yet supported.

This is a local JSON enforcement gate, not the future Cedar/OPA enterprise policy
engine.

## Secret Hygiene

ToolPin generates placeholders and references, not plaintext secrets. `toolpin secrets audit`
checks installed client config entries against `mcp-lock.json` across all supported
project/global config locations by default. Use `--scope project` or `--scope global`
to narrow the check. It flags secret-expected fields that contain plaintext-looking
values instead of placeholders such as `<TOKEN>`, `${env:TOKEN}`, `${TOKEN}`,
`${{ secrets.TOKEN }}`, `op://...`, `vault://...`, or `doppler://...`.

The audit is read-only and advisory. It never prints raw secret values. Real secret
brokering remains a design-gated runtime feature; see `docs/secret-brokering.md`.

## Product Direction

ToolPin should be the trust, install, and governance layer over the official MCP Registry,
not a competing catalog. The official registry remains the source of package metadata;
ToolPin adds the layers production teams need before agent tools touch real systems.

- Keep official `server.json` as the public manifest base.
- Add namespaced `_meta` extensions for runtime policy, permissions, supply-chain evidence, scans, and marketplace metadata.
- Make trust enforceable: capability manifests, tool-description hash pins, content integrity, advisory checks, and signed provenance.
- Own neutral multi-client installation across Claude, Cursor, VS Code, Codex, OpenCode, and the long tail of MCP clients.
- Keep lockfiles as gates, not diaries: install and CI must fail on drift unless the lock is deliberately reviewed and updated.
- Add AI-native discovery: task-first search, eval-gated listings, and tool-description scans.
- Broker per-server secrets without writing plaintext credentials into client config files.
- Prefer remote MCP, OCI, and MCPB for language-neutral distribution; support npm, PyPI, NuGet, Cargo, and binaries through adapters.
- Generate client configs instead of requiring publishers to hand-maintain snippets for every host.
- Treat MCP metadata and tool descriptions as security-sensitive because they influence agent behavior.

## Troubleshooting

ToolPin fails closed rather than guessing when a client's config path is
unverified. Common cases:

- **Claude global scope** is not written by ToolPin. Claude's global config is
  owned by the Claude CLI. Use
  `toolpin export-config <server> --client claude` and feed the result to
  `claude mcp add-json --scope user`. Project-scope Claude writes `.mcp.json`.
- **Zed install (project and global) fails closed.** Zed's settings paths are
  not yet verified; use `export-config` and paste into `context_servers` by hand.
- **Roo global scope fails closed** (Roo project scope is supported).
- **Windsurf, Cline, Continue are global-only.** Installing them with
  `--scope project` fails.
- **Codex hand-authored TOML may drift.** ToolPin reads and writes the
  `[mcp_servers.<name>]` table form; inline/dotted TOML (`mcp_servers.x.env = ...`)
  is not removed or detected and may be reported as missing or drift.
- **v1 lockfile entries must be regenerated.** ToolPin rejects pre-v2
  `mcp-lock.json` entries; re-run `install --update-lock` to write v2 integrity.
- **CI reports "lock integrity is missing" or drift.** Re-resolve with
  `toolpin install --update-lock` (and `--verify` if you pin tool descriptions),
  commit the updated `mcp-lock.json`, then re-run `toolpin ci --live`.
- **`toolpin ci` without `--live` validates against the local cache.** If the
  cache is stale or committed, drift detection is cache-vs-cache; pass `--live`
  when you need real registry drift detection.
- **Global scope for generic clients** writes a ToolPin-managed sidecar under
  `~/.config/toolpin/`, because a real global config path is not standardized.

## Resources

- [SECURITY.md](SECURITY.md) — security policy and reporting.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute.
- [docs/threat-model.md](docs/threat-model.md) — what ToolPin does and does not
  protect against.
- [docs/client-configs.md](docs/client-configs.md) — per-client config paths,
  root keys, and transport shapes.
- [docs/how-to/catch-drift-in-ci.md](docs/how-to/catch-drift-in-ci.md) — digest
  and signature options for CI.
- [docs/comparison.md](docs/comparison.md) — ToolPin vs. the MCP ecosystem.
- [docs/ROADMAP.md](docs/ROADMAP.md) and
  [docs/secret-brokering.md](docs/secret-brokering.md) — direction and design
  gates.
