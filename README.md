# ToolPin

ToolPin is the trusted install, lockfile, and governance layer for MCP servers. It is intentionally not a new code registry: it reads MCP registry metadata, normalizes package/remotes, scores trust signals, verifies/pins lockfile state, and writes correct client config.

## Quick Start

```bash
npm install
npm run build
node dist/cli.js ingest --pages 3
node dist/cli.js search github --source all --limit 5
node dist/cli.js info io.github.github/github-mcp-server --live
node dist/cli.js verify io.github.github/github-mcp-server --live --skip-live-verification
node dist/cli.js plan io.github.github/github-mcp-server --client claude --live
node dist/cli.js install io.github.github/github-mcp-server --client claude --scope project --live --verify
node dist/cli.js install io.github.github/github-mcp-server --client all --scope project --live
node dist/cli.js policy check io.github.github/github-mcp-server --client claude --live
node dist/cli.js remove io.github.github/github-mcp-server --client claude --scope project
node dist/cli.js ci --live
node dist/cli.js doctor --scope project
node dist/cli.js test io.github.github/github-mcp-server --live
node dist/cli.js lock io.github.github/github-mcp-server --client claude --live
node dist/cli.js export-config io.github.github/github-mcp-server --client claude --live
npm run tui
```

## Commands

```text
toolpin ingest [--source official|docker|all] [--limit 100] [--pages 10]
toolpin search <query> [--source official|docker|all] [--limit 10] [--live]
toolpin info <server-name> [--source official|docker|all] [--json] [--live]
toolpin audit <server-name> [--source official|docker|all] [--live]
toolpin verify <server-name> [--source official|docker|all] [--live] [--json] [--timeout 15000] [--skip-live-verification]
toolpin plan <server-name> --client claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all [--source official|docker|all] [--live]
toolpin install <server-name> --client claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all [--scope project|global] [--source official|docker|all] [--live] [--update-lock] [--verify] [--policy .toolpin/policy.json] [--no-policy]
toolpin policy check <server-name> --client claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all [--scope project|global] [--policy .toolpin/policy.json] [--json] [--source official|docker|all] [--live]
toolpin secrets audit [--file mcp-lock.json] [--scope all|project|global] [--json]
toolpin remove <server-name> [--client claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all] [--scope project|global] [--file mcp-lock.json]
toolpin ci [--file mcp-lock.json] [--expect-digest sha256-...] [--signature mcp-lock.sig --public-key public.pem] [--policy .toolpin/policy.json] [--no-policy] [--source official|docker|all] [--live] [--verify]
toolpin doctor [--file mcp-lock.json] [--scope all|project|global] [--json]
toolpin test <server-name> [--source official|docker|all] [--live] [--timeout 15000]
toolpin lock <server-name> --client claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all [--source official|docker|all] [--file mcp-lock.json] [--live]
toolpin lock digest [--file mcp-lock.json] [--json]
toolpin lock sign --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig] [--json]
toolpin lock verify-signature --key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig] [--json]
toolpin export-config <server-name> --client claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all [--source official|docker|all] [--live]
toolpin tui
```

## What Exists Now

- Official MCP Registry and Docker MCP Catalog ingestion, with combined or source-specific views.
- Known registry notes for PulseMCP, Smithery, and Glama; adapters are disabled until stable unauthenticated access or credentials are configured.
- Local cache at `.toolpin/registry-cache.json`.
- Normalized package and remote metadata.
- Search ranking over name, title, description, package type, transport, and repository.
- Trust scoring for repository presence, namespace shape, pinned versions, OCI digests, MCPB hashes, HTTPS remotes, secrets, legacy transports, and missing install targets.
- Verification reports that derive a capability manifest, surface registry attestations, reject mutable OCI targets, reject MCPB packages without `fileSha256`, and optionally pin remote tool descriptions via a live MCP `tools/list` probe.
- Advisory tool-description scans flag deterministic review signals: agent-directed instructions, hidden/control characters, and tool-name shadowing in registry descriptions and verified live `tools/list` descriptions. These are warnings for human review, not prompt-injection detection, sandboxing, or an install blocker.
- `toolpin install --verify` persists the verified capability manifest in `mcp-lock.json`, including remote tool-description hashes when the live probe succeeds.
- Config export for Claude/Cursor-style `mcpServers`, VS Code-style `servers`, Codex `config.toml` `[mcp_servers.*]` tables, OpenCode `mcp`, Windsurf/Cascade, Cline, Continue `config.yaml`, Gemini CLI, Zed `context_servers`, and Roo Code.
- Install plans and `mcp-lock.json` v2 writes keyed by server/client, with per-entry `original`, `resolved`, `locked`, capability manifest, and `sha256-...` integrity metadata.
- Install drift checks: if an existing lock entry changes version, target, trust score, or generated client config, install refuses until the lock is reviewed and updated with `toolpin lock` or `toolpin install --update-lock`.
- Whole-lock digest pinning via `toolpin lock digest` and `toolpin ci --expect-digest`: computes a timestamp-insensitive canonical `sha256-...` over the complete lockfile server/client set. This is useful only when CI or another verifier gets the expected digest from a trusted out-of-band source; it is not a signature, provenance, sigstore, or self-protecting lockfile.
- Detached lockfile signing via user-supplied Ed25519 keys: `toolpin lock sign --key private.pem` signs the canonical whole-lock digest into `mcp-lock.sig`, `toolpin lock verify-signature --key public.pem` verifies it, and `toolpin ci --signature mcp-lock.sig --public-key public.pem` fails closed before registry resolution. ToolPin does not generate or store keys; verification is meaningful only when the private key and public trust root are managed outside the repo/lockfile trust path.
- Frozen lockfile checks via `toolpin ci`: re-resolves every locked server/client entry, verifies lock integrity, rejects drift, and never mutates the lockfile.
- Local policy gate via optional `.toolpin/policy.json`: `toolpin install`, `toolpin ci`, TUI installs, and `toolpin policy check` can enforce trust minimums, source/client/server deny rules, denied package/transport/remote-host rules, and OCI/MCPB pin requirements.
- Read-only secret hygiene via `toolpin secrets audit`: reports likely plaintext env/header secrets in installed client config files using registry `isSecret` metadata and known token prefixes. Findings are advisory and redacted; ToolPin does not resolve or print secret values.
- Lockfile v1 entries must be regenerated before enforcement; missing v2 integrity fails closed. Use `--live` in CI when you need registry drift detection instead of local-cache validation.
- `toolpin remove` cleanup for supported client config files and matching lockfile entries, including Codex TOML table removal.
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
tab / 1-5       Switch Browse and selected-server panels
/               Search
up/down or j/k  Move selection
enter           Open selected-server overview
r               Refresh current source
i               Ingest live registry data into cache
g               Cycle registry source: all, official, Docker
G               Toggle install scope: project or global
t               Test selected server by connecting and listing tools
I               Install selected server into active scope and lockfile
x               Remove selected server from active config and lockfile (press twice)
l               Toggle live/cache source
c               Cycle client target, including all
o               Jump to opencode target
w               Write selected server to mcp-lock.json
s               Save selected client config under .toolpin/
h or ?          Help
q / ctrl-c      Quit
```

## Local Policy

When `.toolpin/policy.json` exists, `toolpin install`, `toolpin ci`, and TUI installs enforce it
before writing config or accepting a frozen lock. Use `--policy <file>` to point at a
different policy file or `--no-policy` for an explicit local bypass.

```json
{
  "version": 1,
  "minTrustScore": 70,
  "allowedSources": ["official", "docker"],
  "deniedClients": ["generic"],
  "deniedServers": ["io.github/example/unsafe-server"],
  "deniedPackageTypes": ["cargo"],
  "deniedTransports": ["sse"],
  "deniedRemoteHosts": ["untrusted.example.com"],
  "requireDigestPinnedOci": true,
  "requireMcpbSha256": true
}
```

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
