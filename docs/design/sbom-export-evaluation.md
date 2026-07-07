# Evaluation: `toolpin lock export --format cyclonedx|spdx`

Status: evaluated 2026-07 — **defer to post-launch fast-follow.** This doc
records the mapping so implementation is mechanical when demand shows up.

## Why considered

Microsoft APM ships SBOM export from its lockfile (CycloneDX/SPDX), and the
standard-setting research favors anchoring to existing formats. Enterprise
inventory pipelines ingest CycloneDX.

## Why defer

- Zero design partners have asked; the wedge KPI is CI adoption, not export
  breadth. Pre-launch scope discipline wins.
- CycloneDX minimal JSON is hand-rollable dependency-free (~100 LOC), but SPDX
  is fussier; shipping one format "for parity" invites a half-standard.
- The lockfile already IS the inventory; `toolpin ci --json` (lane 4) covers
  dashboard ingestion for now.

## Mapping (for the fast-follow)

One CycloneDX `component` per lock entry:

| Lock entry field | CycloneDX |
|---|---|
| `name` / server name | `component.name` |
| resolved version | `component.version` |
| npm target | `purl: pkg:npm/<identifier>@<version>` |
| OCI target | `purl: pkg:oci/<name>@sha256:<digest>` |
| MCPB target | `purl: pkg:generic/...` + external reference to artifact URL |
| remote target | `component.type: "service"`, `externalReferences[{type:"api", url}]` |
| entry integrity / artifact digest | `hashes[{alg:"SHA-256", content}]` |
| client | `properties[{name:"toolpin:client", value}]` |
| trust tier / verdict | `properties[{name:"toolpin:verdict"}]` |
| tool-surface hash | `properties[{name:"toolpin:tool-surface-sha256"}]` |

`metadata.tools` names toolpin + version; `bomFormat: CycloneDX`,
`specVersion: "1.6"`, `serialNumber: urn:uuid:<deterministic from whole-lock
digest>` so re-export of the same lock is byte-stable.

## Trigger to implement

Any of: a design partner asks for SBOM ingestion; an enterprise checklist
requires it; APM's SBOM story starts appearing in MCP-governance comparisons.
