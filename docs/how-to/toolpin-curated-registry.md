# ToolPin Curated Registry

ToolPin can host a first-party curated registry without running any custom
infrastructure. The registry is just versioned JSON in this repository.

Use it for servers ToolPin maintainers are willing to recommend because the
metadata is installable, reviewable, lockable, and documented. Do not use it as
a broad directory.

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
the current repository location:

```text
https://raw.githubusercontent.com/proofofwork-agency/toolpin/main/registry/v0
```

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

## Add a Server by PR

Edit both files:

```text
registry/v0/servers
website/static/registry/v0/servers
```

They must stay identical. CI runs:

```sh
npm run registry:check
```

Each entry must be installable and include curation metadata:

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
      "testedClients": ["claude"],
      "toolpinEnforcement": {
        "status": "enforced",
        "workflow": ".github/workflows/toolpin.yml",
        "requiredCheck": "ToolPin lockfile check",
        "protectedBranch": "main",
        "file": "mcp-lock.json"
      }
    }
  }
}
```

The container file (`registry/v0/servers`) wraps entries in a `servers` array plus a `metadata` block. If `metadata.count` or `metadata.total` is present, it must equal `servers.length`, or `npm run registry:check` fails. Package targets require `registryType`, `identifier`, and `transport.type`; remote targets require an `https://` URL.

Reviewers should reject entries that are hosted-only, source-missing,
non-installable, stale, duplicate, ToolPin-unenforced, or not useful enough to
recommend. Running ToolPin CI is not enough; the ToolPin check must be required
by branch protection or rulesets.
