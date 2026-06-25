# ToolPin Curated Registry

This directory is the source of the ToolPin Curated MCP Registry.

It is intentionally GitHub-native:

- entries are reviewed through pull requests;
- CI validates the registry shape before merge;
- no database or hosted backend is required;
- the same payload can be served through GitHub Pages or raw GitHub.

## Endpoints

Canonical source file:

```text
registry/v0/servers
```

Raw GitHub URL after merge to `main` and after the public repository has been
renamed to `proofofworks/TPN`:

```text
https://raw.githubusercontent.com/proofofworks/TPN/main/registry/v0
```

GitHub Pages / Docusaurus URL after the website is deployed:

```text
https://toolpin.dev/registry/v0
```

ToolPin appends `/servers`, so configure the registry URL without the trailing
`/servers`.
Until the repository rename is complete, use the matching raw GitHub URL for
the current repository location.

## Local Configuration

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

Then run:

```sh
toolpin registry list
toolpin ingest --source toolpin
toolpin search github --source toolpin
```

## Adding Servers

Add entries to `registry/v0/servers` and mirror the same content to
`website/static/registry/v0/servers`. Run:

```sh
npm run registry:check
npm test
```

Every server entry must be installable: it needs a package or remote target,
version/source metadata, transport, repository URL when available, declared
secrets, and ToolPin curation metadata.

Required curation metadata:

```json
{
  "_meta": {
    "dev.toolpin/curation": {
      "status": "reviewed",
      "reviewedAt": "2026-06-25",
      "reviewedBy": "toolpin-maintainers",
      "reason": "Why this server belongs in the curated registry.",
      "riskNotes": [],
      "testedClients": ["claude"]
    }
  }
}
```

Do not add hosted-only, source-missing, stale, duplicate, or non-installable
entries to this registry. Use discovery registries for broad search.
