---
title: CLI Reference
---

# CLI reference

The main binary is `toolpin`. `tpn` is the short alias for the same CLI.

```text
toolpin version | --version | -v        Print the ToolPin version.
toolpin upgrade [--target latest|<version>] [--package-manager npm|pnpm|yarn|bun] [--dry-run] [--json]
tpn upgrade                              Upgrade the globally installed ToolPin npm package.
toolpin help | --help | -h              Print top-level usage.
```

`list` has the alias `ls`. `remove` and `uninstall` are interchangeable aliases
for the same cleanup action.

## Discovery

```text
toolpin ingest [--source toolpin|official|docker|all|custom-id] [--limit 100] [--pages 10]
toolpin registry list [--json]
toolpin registry enable <source-id>
toolpin registry disable <source-id>
toolpin sources [--json]
toolpin search <query> [--source toolpin|official|docker|all|custom-id] [--limit 10] [--live] [--json]
toolpin interactive [query] [--source id|all] [--live] [--limit 10] [--client <client|all>] [--scope project|global] [--version <server-version>] [--verify] [--require-verified] [--timeout 15000] [--policy .toolpin/policy.json] [--no-policy] [--no-input] [--color auto|always|never]
toolpin i [query] [same options]
toolpin info <server-name> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--json] [--live]
toolpin audit [--scope all|project|global] [--client all] [--policy .toolpin/policy.json] [--verify [--require-verified] [--skip-live-verification | --skip-live-verify] [--timeout 15000]] [--json]
toolpin audit server <server-name> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live] [--json]
toolpin scan <server-name> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--sarif] [--timeout 15000]
toolpin versions <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--limit 10] [--json]
```

## Review and install

```text
toolpin verify <server-name> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--sarif] [--timeout 15000] [--skip-live-verification | --skip-live-verify]
toolpin test <server-name> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live] [--timeout 15000] [--json]
toolpin test-installed <server-name> --client <client> --scope project|global [--timeout 15000] [--json]
toolpin plan <server-name> --client <client|all> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live]
toolpin install <server-name> --client <client|all> [--version <server-version>] [--scope project|global] [--source toolpin|official|docker|all|custom-id] [--live] [--update-lock] [--verify [--skip-live-verification | --skip-live-verify] [--timeout 15000]] [--policy .toolpin/policy.json] [--no-policy]
toolpin adopt <installed-name> --client <client> --scope project|global [--source toolpin|official|docker|all|custom-id] [--live] [--file mcp-lock.json] [--verify] [--policy .toolpin/policy.json] [--no-policy] [--dry-run] [--json]
toolpin update <server-name> --client <client> --scope project|global [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live] [--file mcp-lock.json] [--verify] [--policy .toolpin/policy.json] [--no-policy] [--dry-run] [--json]
toolpin update --all [--scope all|project|global] [--client <client|all>] [--source toolpin|official|docker|all|custom-id] [--live] [--file mcp-lock.json] [--dry-run] [--json]
toolpin export-config <server-name> --client <client|all> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--live]
```

`scan` runs advisory description checks against registry metadata and, with
`--live`, the returned `tools/list` descriptions when the probe succeeds.
Findings do not make `scan` fail. `verify` checks registry metadata and, unless
skipped, live MCP tool metadata for the selected package or remote launch
target. For packages, OCI verification requires a valid digest
pin and best-effort resolves the registry manifest digest when reachable; MCPB
verification requires a valid `fileSha256` and best-effort recomputes bytes when
the bundle is available from a code-allowlisted HTTPS artifact host. npm package
targets are checked against `registry.npmjs.org` packument `dist.integrity` and
trusted npm tarball bytes. PyPI, NuGet, and Cargo targets are checked for
declared exact versions and drift only; ToolPin does not verify their artifact
bytes in this release.

Human-readable `search`, `info`, and `install` output separates trust tier from
metadata/profile completeness. If the evidence-gated `overallScore` is capped,
the output includes a `cap` line explaining why, for example that automated
evidence is incomplete because artifact proof is missing. Human-facing numeric
ranking uses the profile score inside the evidence tier, so conditional entries
do not all collapse to a visible 69%. A 69% cap means the entry has trusted
provenance and usable metadata, but ToolPin has not yet verified artifact proof
such as npm integrity, OCI digest, or MCPB hash evidence.

Use `toolpin versions <server-name>` to list known registry/cache versions. Any
server command that accepts `--version <server-version>` targets that exact known
version instead of the latest one, matching the TUI install version picker.

`test-installed` reads the installed client config entry and performs the MCP
handshake against that target directly. `adopt` is the explicit unlocked-alias
path; `update` only updates locked entries and can explicitly relock one entry
to a selected `--version`. `update --all` stays latest-only, skips unlocked
adoptable rows, and reports them separately.

Commands that list `--json` or `--sarif` keep the structured payload on stdout
so it can be piped into tools such as `jq` or code-scanning uploaders. Progress,
notes, and errors are written to stderr.

`toolpin interactive` and `toolpin i` provide a scrollback-friendly guided
search/review/install flow separate from the full-screen TUI. It shows the
equivalent one-shot command before writes and requires explicit confirmation for
install or lock actions. It requires a TTY unless `--no-input` is passed; in
`--no-input` mode it prints command guidance and makes no writes. Human color
output respects `NO_COLOR`, `FORCE_COLOR`, and `--color auto|always|never`;
`--json` and `--sarif` output remains uncolored unless color is forced.

The full-screen TUI requires an interactive terminal and fails closed when stdin
or stdout is piped.

## Inventory and cleanup

```text
toolpin list|installed [--scope all|project|global] [--client <client|all>] [--json]
toolpin doctor [--file mcp-lock.json] [--scope all|project|global] [--json]
toolpin remove <server-name> [--client <client|all>] [--scope project|global] [--file mcp-lock.json]
toolpin uninstall <server-name> [--client <client|all>] [--scope project|global] [--file mcp-lock.json]
```

`doctor` compares the lockfile with current project/global client config. It is
read-only.

## Lock and CI

```text
toolpin lock <server-name> --client <client|all> [--version <server-version>] [--source toolpin|official|docker|all|custom-id] [--file mcp-lock.json] [--live] [--verify [--skip-live-verification | --skip-live-verify] [--timeout 15000]]
toolpin lock digest [--file mcp-lock.json] [--json]
toolpin lock sign --policy .toolpin/policy.json --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig] [--json]
toolpin lock verify-signature --policy .toolpin/policy.json --public-key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig] [--json]
toolpin ci [--file mcp-lock.json] [--expect-digest sha256-...] [--signature mcp-lock.sig --public-key public.pem] [--policy .toolpin/policy.json] [--no-policy] [--source toolpin|official|docker|all|custom-id] [--live] [--verify [--skip-live-verification | --skip-live-verify] [--timeout 15000]] [--sarif]
toolpin outdated [--file mcp-lock.json] [--source toolpin|official|docker|all|custom-id] [--live] [--json]
```

`toolpin ci` re-resolves locked entries, checks lock integrity, enforces the
selected policy unless `--no-policy` is used, and exits non-zero on drift. It
does not update `mcp-lock.json`. `scan`, `verify`, and `ci` support SARIF 2.1.0
output with `--sarif`.

## Secret hygiene and TUI

```text
toolpin secrets audit [--file mcp-lock.json] [--scope all|project|global] [--json]
toolpin policy check <server-name> --client <client|all> [--scope project|global] [--policy .toolpin/policy.json] [--json] [--source toolpin|official|docker|all|custom-id] [--live]
toolpin tui
```

`secrets audit` is read-only and redacts findings. It is an advisory check, not
a DLP engine.

The TUI Browse list shows full evidence labels (`REVIEW`, `UNVERIFIED`,
`BLOCKED`, or `EVIDENCE`) next to the meter. Overview separates the evidence
tier, metadata profile score, trust pillars, and cap reason; a red evidence row
beside green profile rows means the metadata is strong but required automated
proof is missing or failed. The TUI help screen calls out the 69% cap for
trusted-source conditional entries.

Browse defaults to source-first ordering: `toolpin`, `official`, `docker`, then
other enabled sources. Press `a` to cycle source-first, alpha A-Z, alpha Z-A,
source-last, and relevance ordering. Press `g` to cycle the exact source filter.
In the search box, exact source IDs such as `toolpin`, `official`, and `docker`
act as source-narrowing terms without changing the exact filter.

## Common options and values

```text
--client, -c <client|all>   Target client config. <client> is one of:
                            claude, cursor, vscode, codex, opencode, windsurf,
                            cline, continue, gemini, zed, roo, generic.
                            Use `all` to fan out across every supported client
                            for the chosen scope.
--scope, -s <scope>         project|global for install/remove/policy check;
                            all|project|global for list/doctor/secrets audit.
--global, -g                Shortcut for --scope global.
--project, -p               Shortcut for --scope project.
--source <id>               Registry source: toolpin, official, docker, all, or
                            a custom registry id configured in .toolpin/registries.json.
                            all means every enabled source.
--live                      Fetch from the registry instead of the local cache.
--json                      Machine-readable output where listed.
--version <server-version>  Target a known server version where supported.
--allow-hosted-directory-targets
                            Opt in to Smithery-hosted directory targets when
                            resolving Smithery entries.
toolpin --version, -v       Print the ToolPin version.
--help, -h                  Print usage.
```

`tpn` is the short binary alias for `toolpin`; every command and flag above
works identically with `tpn`.
