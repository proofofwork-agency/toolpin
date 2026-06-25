---
title: CLI Reference
---

# CLI reference

The main binary is `toolpin`. `tpn` is the short alias for the same CLI.

```text
toolpin version | --version | -v        Print the ToolPin version.
toolpin help | --help | -h              Print top-level usage.
```

`list` and `uninstall` accept the aliases `ls` and `remove` (the reverse is also
true: `remove` and `uninstall` are interchangeable).

## Discovery

```text
toolpin ingest [--source official|docker|all] [--limit 100] [--pages 10]
toolpin search <query> [--source official|docker|all] [--limit 10] [--live]
toolpin info <server-name> [--source official|docker|all] [--json] [--live]
toolpin audit <server-name> [--source official|docker|all] [--live]
toolpin versions <server-name> [--source official|docker|all] [--live] [--limit 10] [--json]
```

## Review and install

```text
toolpin verify <server-name> [--source official|docker|all] [--live] [--json] [--timeout 15000] [--skip-live-verification | --skip-live-verify]
toolpin test <server-name> [--source official|docker|all] [--live] [--timeout 15000]
toolpin plan <server-name> --client <client|all> [--source official|docker|all] [--live]
toolpin install <server-name> --client <client|all> [--scope project|global] [--source official|docker|all] [--live] [--update-lock] [--verify [--skip-live-verification] [--timeout 15000]] [--policy .toolpin/policy.json] [--no-policy]
toolpin export-config <server-name> --client <client|all> [--source official|docker|all] [--live]
```

`verify` checks registry metadata and optional live MCP tool metadata. It does
not perform byte-level OCI image or MCPB bundle verification.

## Inventory and cleanup

```text
toolpin list [--scope all|project|global] [--client <client|all>] [--json]
toolpin doctor [--file mcp-lock.json] [--scope all|project|global] [--json]
toolpin remove <server-name> [--client <client|all>] [--scope project|global] [--file mcp-lock.json]
toolpin uninstall <server-name> [--client <client|all>] [--scope project|global] [--file mcp-lock.json]
```

`doctor` compares the lockfile with current project/global client config. It is
read-only.

## Lock and CI

```text
toolpin lock <server-name> --client <client|all> [--source official|docker|all] [--file mcp-lock.json] [--live]
toolpin lock digest [--file mcp-lock.json] [--json]
toolpin lock sign --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig] [--json]
toolpin lock verify-signature --key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig] [--json]
toolpin ci [--file mcp-lock.json] [--expect-digest sha256-...] [--signature mcp-lock.sig --public-key public.pem] [--policy .toolpin/policy.json] [--no-policy] [--source official|docker|all] [--live] [--verify [--skip-live-verification] [--timeout 15000]]
toolpin outdated [--file mcp-lock.json] [--source official|docker|all] [--live] [--json]
```

`toolpin ci` re-resolves locked entries, checks lock integrity, enforces the
selected policy unless `--no-policy` is used, and exits non-zero on drift. It
does not update `mcp-lock.json`.

## Secret hygiene and TUI

```text
toolpin secrets audit [--file mcp-lock.json] [--scope all|project|global] [--json]
toolpin policy check <server-name> --client <client|all> [--scope project|global] [--policy .toolpin/policy.json] [--json] [--source official|docker|all] [--live]
toolpin tui
```

`secrets audit` is read-only and redacts findings. It is an advisory check, not
a DLP engine.
