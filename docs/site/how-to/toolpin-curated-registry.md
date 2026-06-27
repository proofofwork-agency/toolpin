---
title: ToolPin Curated Registry
---

# ToolPin Curated Registry

ToolPin hosts a first-party curated registry without running any custom
infrastructure. The registry is versioned JSON in GitHub, reviewed through pull
requests, fetched from raw GitHub at runtime, and bundled in the npm package as
an offline fallback snapshot.

Use it for servers ToolPin maintainers are willing to recommend because the
metadata is installable, reviewable, lockable, and documented. Do not use it as
a broad directory.

The registry is deliberately small. Broad directories are useful for discovery;
the curated registry is for entries ToolPin can safely turn into install plans.

## URLs

Raw GitHub source of truth, no site deploy required:

```text
https://raw.githubusercontent.com/proofofwork-agency/toolpin/main/registry/v0/servers
```

GitHub Pages / Docusaurus static mirror:

```text
https://proofofwork-agency.github.io/toolpin/registry/v0/servers
```

For custom `official-compatible` registries, ToolPin appends `/servers`
automatically when configured with a base URL.

## How the Registry Is Maintained

The source of truth is committed in this repository:

```text
registry/v0/servers
```

The same payload is copied to the Docusaurus static directory:

```text
website/static/registry/v0/servers
```

That second copy makes the registry available on the published documentation
site at `https://proofofwork-agency.github.io/toolpin/registry/v0`. CI rejects
the change if the two files drift.

Maintainers review registry changes like code:

- every addition or update goes through a pull request;
- `npm run registry:check` validates schema, curation metadata, and install targets;
- normal CI runs the full test suite and Docusaurus build;
- reviewers check whether the entry is actually installable and useful enough
  to recommend;
- entries can be removed or demoted when they become stale, duplicated,
  source-missing, or platform-only.

ToolPin does not automatically promote scraped directory results into this
registry. A server belongs here only after a maintainer can explain why it is
worth recommending.

## Built-In Source

ToolPin ships this registry as the built-in `toolpin` source: a hosted curated
registry with bundled fallback. It is first in the source list, enabled by
default, and pinned. Users can filter to another source, but `toolpin` cannot be
disabled through `.toolpin/registries.json`, `toolpin registry disable`, or the
TUI source selector.

Then:

```sh
toolpin registry list
toolpin ingest --source toolpin
toolpin search github --source toolpin
```

## Add Your Server by PR

Open a pull request that edits both files:

```text
registry/v0/servers
website/static/registry/v0/servers
```

They must stay identical. Run this locally before opening the PR:

```sh
npm run registry:check
npm test
```

Each entry must be installable and include curation metadata. Use this shape as
a starting point:

```json
{
  "server": {
    "name": "io.github.example/server",
    "title": "Example MCP Server",
    "description": "What this server does and why it is useful.",
    "version": "1.0.0",
    "repository": {
      "url": "https://github.com/example/server",
      "source": "github"
    },
    "packages": [
      {
        "registryType": "npm",
        "identifier": "@example/server",
        "version": "1.0.0",
        "transport": {
          "type": "stdio"
        }
      }
    ]
  },
  "_meta": {
    "dev.toolpin/curation": {
      "status": "reviewed",
      "reviewedAt": "2026-06-25",
      "reviewedBy": "toolpin-maintainers",
      "reason": "Why ToolPin recommends this server.",
      "evidenceTier": "metadata-only",
      "riskNotes": [],
      "testedClients": ["claude"],
      "toolpinEnforcement": {
        "status": "not-verified",
        "notes": "Branch protection and ToolPin CI enforcement have not been verified."
      }
    },
    "dev.toolpin/clientSupport": {
      "default": "unsupported",
      "clients": {
        "codex": {
          "status": "toolpin-installable",
          "installMode": "mcp-config",
          "requirements": ["node>=22"],
          "setupCommands": [],
          "notes": "ToolPin can write this as a normal Codex MCP server."
        },
        "claude": {
          "status": "toolpin-installable",
          "installMode": "mcp-config",
          "requirements": ["node>=22"],
          "setupCommands": [],
          "notes": "ToolPin can write this as a project MCP server."
        }
      }
    }
  }
}
```

Use `metadata-only` for reviewed registry metadata. Reserve `digest-pinned`,
`byte-verified`, and `provenance-attested` for entries where those checks really
exist. Use `toolpinEnforcement.status: "enforced"` only when branch protection or
rulesets require the ToolPin check; otherwise use `not-verified` with notes.

The container file (`registry/v0/servers`) wraps entries in a `servers` array plus
a `metadata` block. If `metadata.count` or `metadata.total` is present, it must
equal `servers.length`, or `npm run registry:check` fails. Package targets
require `registryType`, `identifier`, and `transport.type`; remote targets
require an `https://` URL.

`dev.toolpin/clientSupport` is ToolPin-owned metadata:

- `toolpin-installable`: ToolPin can generate the client MCP config directly.
- `external-setup`: the client is supported, but setup needs documented steps
  outside ToolPin, such as plugins, daemons, project initialization, or
  instruction-file writes.
- `unsupported`: ToolPin must not offer that client as an install target.

Use `requirements` for runtimes, CLIs, API-key prerequisites, OAuth support, or
other normal setup constraints. Use `setupCommands` only for documented external
steps; ToolPin does not run external setup commands from registry metadata.

For ContextRelay specifically, Codex is `toolpin-installable` through a normal
MCP config that runs package arguments equivalent to `contextrelay codex-mcp
server`. Claude is `external-setup`: install ContextRelay globally, run
`ctxrelay init --instructions project`, and use the generated Claude
plugin/setup. ToolPin must not run `ctxrelay init` until an explicit external
setup flow exists because it writes project files and plugin state.

The PR description should include:

- what the server does;
- why it belongs in the curated registry;
- upstream repository or package URL;
- how you tested it;
- required environment variables or secrets;
- supported clients, if known;
- the required ToolPin status check name and protected branch;
- risk notes such as network access, filesystem access, write operations, or
  hosted-service dependency.

Reviewers should reject entries that are hosted-only, source-missing,
non-installable, stale, duplicate, or not useful enough to recommend. Use
`evidenceTier` and `toolpinEnforcement.status` honestly: `metadata-only` and
`not-verified` are valid for seed entries; reserve stronger labels for checks
ToolPin can actually verify.

## Curation Gates

An entry is eligible for the curated registry when ToolPin can normalize it into
a reviewable install plan. In practice that means:

- it has a stable `server.name`, `title`, `description`, and `version`;
- it has a package target or HTTPS remote target;
- package entries include registry type, identifier, version, and transport;
- remote entries use HTTPS;
- it has a repository URL when source is available;
- required secrets are represented as metadata, not committed plaintext values;
- it includes `_meta["dev.toolpin/curation"]`;
- the curation status is `reviewed`;
- `evidenceTier` records the strongest evidence ToolPin can honestly support;
- `toolpinEnforcement.status` is either `not-verified` with notes or
  `enforced` with workflow path, required status-check name, protected branch,
  and lockfile path recorded;
- risk notes and tested clients are explicit, even when the arrays are empty.

Running ToolPin CI is not enough for the `enforced` label. The ToolPin check
must be required by branch protection or repository rulesets, so a failing
lockfile check can block merges. Until that is verified, use `not-verified`.

These are not popularity gates. A small server can be accepted if it is useful,
maintained, and installable. A popular server can still be rejected if the
metadata is not enough for ToolPin to review, lock, and enforce.

## What Happens After Merge

After the PR lands, users can add the registry URL to `.toolpin/registries.json`
and ingest it:

```sh
toolpin ingest --source toolpin --live
toolpin search postgres --source toolpin
```

The lockfile records the resolved source metadata, so CI can later re-resolve
against the same source and detect drift.

## What This Registry Is Not

The curated registry is not a marketplace, gateway, hosted connector platform,
or scrape of every MCP-related GitHub repository. It is a small list of servers
ToolPin maintainers are comfortable helping users install through ToolPin.

Use [Custom Registries](./custom-registries.md) when you want to add broader
directories, company registries, private GitHub-hosted lists, or discovery-only
indexes.
