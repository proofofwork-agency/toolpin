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

Raw GitHub URL after merge to `main`:

```text
https://raw.githubusercontent.com/proofofwork-agency/toolpin/main/registry/v0
```

GitHub Pages / Docusaurus URL after the website is deployed:

```text
https://toolpin.dev/registry/v0
```

ToolPin appends `/servers`, so configure the registry URL without the trailing
`/servers`.

## Built-In CLI Source

Current ToolPin versions expose this registry as the built-in `toolpin` source.
The CLI fetches the raw GitHub `/servers` file first and uses the packaged
`registry/v0/servers` file only as an offline fallback snapshot.

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
      "evidenceTier": "metadata-only",
      "riskNotes": [],
      "testedClients": ["claude"],
      "toolpinEnforcement": {
        "status": "not-verified",
        "notes": "Branch protection and ToolPin CI enforcement have not been verified."
      }
    }
  }
}
```

Do not add hosted-only, source-missing, stale, duplicate, non-installable, or
unreviewed entries to this registry. `evidenceTier` must be honest:
`metadata-only` for reviewed metadata, `digest-pinned` for immutable pins,
`byte-verified` only when ToolPin recomputed or resolved artifact bytes, and
`provenance-attested` only when provenance verification is implemented. Use
`toolpinEnforcement.status: "enforced"` only when the ToolPin check is required
by branch protection or rulesets and can be validated; otherwise use
`not-verified` with notes. Use discovery registries for broad search.
