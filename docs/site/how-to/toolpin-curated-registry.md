---
title: ToolPin Curated Registry
---

# ToolPin Curated Registry

ToolPin can host a first-party curated registry without running any custom
infrastructure. The registry is versioned JSON in GitHub, reviewed through pull
requests, and served either from raw GitHub or GitHub Pages.

Use it for servers ToolPin maintainers are willing to recommend because the
metadata is installable, reviewable, lockable, and documented. Do not use it as
a broad directory.

The registry is deliberately small. Broad directories are useful for discovery;
the curated registry is for entries ToolPin can safely turn into install plans.

## URLs

Raw GitHub, no deploy required after the public repository has been renamed to
`proofofworks/TPN`:

```text
https://raw.githubusercontent.com/proofofworks/TPN/main/registry/v0
```

GitHub Pages / Docusaurus, after the site is deployed:

```text
https://toolpin.dev/registry/v0
```

ToolPin appends `/servers` automatically for `official-compatible` registries.
Until the repository rename is complete, use the matching raw GitHub URL for
the current repository location.

## How the Registry Is Maintained

The source of truth is committed in this repository:

```text
registry/v0/servers
```

The same payload is copied to the Docusaurus static directory:

```text
website/static/registry/v0/servers
```

That second copy makes the registry available at `https://toolpin.dev/registry/v0`
after the documentation site is deployed. CI rejects the change if the two files
drift.

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

## Configure ToolPin

Create `.toolpin/registries.json`:

```json
{
  "registries": [
    {
      "id": "toolpin",
      "type": "official-compatible",
      "url": "https://raw.githubusercontent.com/proofofworks/TPN/main/registry/v0",
      "mode": "installable",
      "trust": "curated"
    }
  ]
}
```

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
      "riskNotes": [],
      "testedClients": ["claude"]
    }
  }
}
```

The container file (`registry/v0/servers`) wraps entries in a `servers` array plus
a `metadata` block. If `metadata.count` or `metadata.total` is present, it must
equal `servers.length`, or `npm run registry:check` fails. Package targets
require `registryType`, `identifier`, and `transport.type`; remote targets
require an `https://` URL.

The PR description should include:

- what the server does;
- why it belongs in the curated registry;
- upstream repository or package URL;
- how you tested it;
- required environment variables or secrets;
- supported clients, if known;
- risk notes such as network access, filesystem access, write operations, or
  hosted-service dependency.

The container file (`registry/v0/servers`) wraps entries in a `servers` array plus a `metadata` block. If `metadata.count` or `metadata.total` is present, it must equal `servers.length`, or `npm run registry:check` fails. Package targets require `registryType`, `identifier`, and `transport.type`; remote targets require an `https://` URL.

Reviewers should reject entries that are hosted-only, source-missing,
non-installable, stale, duplicate, or not useful enough to recommend.

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
- risk notes and tested clients are explicit, even when the arrays are empty.

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
