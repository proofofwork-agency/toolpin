# ToolPin Roadmap

## Positioning

ToolPin is the **trust, install, and governance layer over the official MCP Registry** —
not a competing catalog. The official registry is deliberately a thin metaregistry:
metadata only, no binaries, no vetting, no ranking, no enforcement. GitHub/Anthropic
own the catalog; the win is being the `brew` / `uv` of MCP.

> ToolPin reads from `registry.modelcontextprotocol.io`, normalizes, and adds the layers
> the registry explicitly omits: supply-chain trust, correct multi-client config,
> enforcing lockfiles, AI-native discovery, and secret brokering.

### ToolPin is
- A trust + install + governance layer over the official registry.
- Wire-compatible with the official `/v0/servers` API; extends via `_meta` namespaces.
- Multi-client neutral: config export and install for 12 clients (Claude, Cursor, VS Code, Codex, OpenCode, Windsurf, Cline, Continue, Gemini CLI, Zed, Roo, plus a Generic sidecar). `--client all` fans out to the verified project/global clients for the selected scope; clients whose path is unverified (e.g. Zed install, Roo global) fail closed until verified. New clients must be added only after schema/path/env research is recorded in `docs/client-configs.md`.

### ToolPin is not
- A competing public catalog (that fight is lost to GitHub MCP Registry + Smithery).
- A runtime host for MCP servers (left to Docker / Smithery Connect / etc.).
- A protocol reimplementation.

## The five pillars

Each pillar maps to a release. They are ordered by leverage: trust and install first,
because nothing else matters if the resolution is unsafe or the config is wrong.

| # | Pillar | Why it wins | Release |
|---|--------|-------------|---------|
| 1 | **Trust as the product** | The spec says tool descriptions are untrusted and offloads all vetting to implementers. Cryptographic attestation + capability manifests defeat tool poisoning, rug pulls, and over-broad access — the attacks no one else stops. | v0.2 |
| 2 | **Own the multi-client config layer** | #1 developer pain: many clients, many incompatible JSON/TOML shapes. A neutral universal `toolpin install X --client all` that writes correct config into every verified client is the moat first-party will never match. | v0.2 |
| 3 | **A lockfile that enforces** | ToolPin now blocks basic install drift, but world-class lockfiles also verify content integrity, hard-error in frozen CI, and split `original`/`locked`. Trust without full enforcement is theater. | v0.2 |
| 4 | **AI-native discovery** | npm ranks human downloads; MCP can rank agent success. Task-first semantic search + eval-gated listings — structurally impossible for a download-count registry. | v0.3 |
| 5 | **Per-server secret brokering** | Plaintext secrets in `mcp.json` is the enterprise blocker. Resolve `op://` / `vault://` / `doppler://` at spawn, scope per server, rotate without editing JSON. | v0.3 |

**Enterprise governance** (signed private registry, Cedar/OPA policy gates, immutable
audit trail) is the paid tier on top of pillars 1-3, targeted at v1.0. It is the SOC 2
evidence layer security teams must buy before agents touch production.

## Current state (public docs and npm package live)

Shipped through v0.2.5:

- Official MCP Registry + Docker catalog ingestion (`src/registry.ts`), local cache.
- Normalized package/remote metadata; multi-source scaffold (pulse/smithery/glama disabled).
- Search ranking over name, title, description, type, transport, repo (`src/search.ts`).
- Metadata trust scoring (`src/trust.ts`) remains triage, not proof: repo, namespace, pinned versions, OCI digests, MCPB hashes, HTTPS, secrets, legacy transports.
- Evidence-gated trust tiers require ToolPin-verified evidence such as OCI registry digest resolution, trusted-host MCPB byte hashing, npm SRI verification, or future verified attestations.
- Config export for all 12 clients (`src/config.ts`): Claude/Cursor `mcpServers`, VS Code `servers`, Codex TOML `[mcp_servers.*]` tables (`src/codexToml.ts`), OpenCode, Windsurf/Cascade, Cline, Continue YAML, Gemini CLI, Zed `context_servers`, Roo, and Generic.
- Install writes + `mcp-lock.json` v2 (`src/plan.ts`, `src/install.ts`) with server/client keys, read validation, preserved creation time, per-entry resolution time, integrity metadata, and install drift refusal.
- Lockfile enforcement exists for local drift, trust downgrade checks, per-entry integrity, whole-lock digest pins, user-supplied-key detached signatures, frozen `toolpin ci`, verified package/remote capability pins, advisory tool-description scans, redacted secret hygiene audits, local JSON policy gates, and client-config reconciliation.
- Public Docusaurus docs and the curated registry mirror are live at `https://proofofwork-agency.github.io/toolpin/`.
- The scoped npm package is published at `@proofofwork-agency/toolpin`; public install examples use the npm-first path, with source checkout reserved for ToolPin development.
- Ink TUI (`src/tui.tsx`).

## Release v0.2 — Trust & Install Foundation (shipped)

**Goal:** make resolution reviewable, enforceable, and hard to drift silently.
This release shipped pillars 1, 2, and 3, while leaving runtime brokering,
sigstore transparency, and enterprise policy engines for later releases.

### Feature 1 — Trust as the product

| Task | File | Detail |
|------|------|--------|
| Add capability + attestation types | `src/types.ts` | `CapabilityManifest`, `Attestation`, `ToolDescriptionHash`. Carry via existing `_meta` (`types.ts:58`) under `dev.toolpin/capabilities`, `dev.toolpin/attestations`. |
| Capability derivation | **new** `src/capabilities.ts`, `src/tester.ts` | Normalize a `CapabilityManifest` from a `NormalizedServer`: declared env vars, transport, remote URL host (egress target), package type, secrets required. For package and remote launch targets, build the tool-description hash from a live MCP probe (`initialize` → `tools/list`) rather than static registry metadata. |
| Metadata and artifact evidence gates | `src/verify.ts` | Fails closed when an OCI target is not digest-pinned or an MCPB target lacks declared `fileSha256`; resolves OCI registry manifest digests when reachable; recomputes MCPB SHA-256 only from code-allowlisted HTTPS artifact hosts; verifies npm tarballs against `registry.npmjs.org` SRI. Full OCI image byte recomputation, PyPI/NuGet/Cargo artifact integrity, and sigstore/cosign remain later verification work. |
| Extend trust report | `src/trust.ts` | Keep heuristic `scoreServer`; add attestation-derived badges (`sigstore-signed`, `provenance`, `sbom`, `capability-pinned`). |
| CLI surface | `src/cli.ts` | `toolpin verify <server>`; `--verify` flag on `install` and `lock`. |

**Acceptance:** `toolpin verify` fails closed on mutable OCI tags and MCPB packages missing
declared `fileSha256`; trusted evidence can include reachable OCI manifest digest
resolution, trusted-host MCPB byte hashing, npm SRI verification, and capability
manifests recorded in the lockfile. Remote capability pins require a successful MCP
`tools/list` probe; unreachable servers fail verification unless the user explicitly
skips live verification.

### Feature 2 — Own the multi-client config layer

| Task | File | Detail |
|------|------|--------|
| Fix Codex (TOML) | `src/config.ts`, `src/install.ts`, `src/tui.tsx`, `src/codexToml.ts` | Codex uses `~/.codex/config.toml` and trusted project `.codex/config.toml` with `[mcp_servers.<id>]`. Format-aware writer/merger, export output, install paths, and TUI labels are shipped in current code. |
| Research next-wave clients | `docs/client-configs.md` | Completed for Windsurf, Cline, Continue, Gemini CLI, Zed, and Roo Code. The document records each target's config path, schema key, local/remote transport shape, env interpolation syntax, and any implementation caveats before code support is added. |
| Add verified clients | `src/config.ts`, `src/install.ts`, `src/cli.ts`, `src/tui.tsx` | Shipped for Windsurf/Cascade global, Cline global, Continue global YAML, Gemini CLI project/global, Roo Code project, and Zed config export. Zed install paths, Roo global path discovery, and unverified project/profile paths remain open. |
| Per-client env syntax | `src/config.ts` | Per-client placeholder interpolation (`src/config.ts` `placeholderFor`): `${env:NAME}` (Windsurf), `${NAME}` (Gemini), `${{ secrets.NAME }}` (Continue), `<NAME>` (Roo/Cline/Zed). **Shipped in v0.1.** |
| Multi-client fan-out | `src/cli.ts`, `src/install.ts`, `src/tui.tsx` | Keep `toolpin install <server> --client all` as the primary verb; `--client all` writes every detected verified client without clobbering unrelated keys. |

**Acceptance:** round-trip install produces spec-correct config for every verified client,
including Codex TOML; `--client all` detects installed clients and writes each without
clobbering unrelated keys.

### Feature 3 — A lockfile that enforces

| Task | File | Detail |
|------|------|--------|
| Fix the key collision | `src/plan.ts`, `src/cli.ts`, `src/tui.tsx` | Key entries by `name + client`, not `name`. **Shipped in current code.** |
| Runtime validation on read | `src/plan.ts` | Replace `JSON.parse(raw) as Lockfile` with a real `parseLockfile()` validator. **Shipped in current code.** |
| Add integrity fields | `src/plan.ts` | Per entry: `sha256-...` integrity, `resolved` source, `original`/`locked` split (manifest spec vs resolved pin). Bump `lockfileVersion` to 2. **Implemented in current code.** |
| Frozen install | `src/cli.ts`, **new** `src/ci.ts` | New `toolpin ci`: manifest↔lock drift = hard error; verify integrity metadata at install; never mutate the lock. Wire the command into the CLI switch and help text. **Implemented in current code.** |
| Drift + downgrade detection | `src/cli.ts`, `src/tui.tsx` | Compare resolved server against existing lock; refuse if version, target, generated config, or trust score changed unless `--update-lock` is used. **Base gate shipped; policy exceptions still open.** |

**Acceptance:** a tampered lockfile (downgraded version / stripped digest) is rejected;
`lock → install → lock` is idempotent; `toolpin ci` fails on drift where `toolpin install` would patch it.

### v0.2 out of scope
- Semantic / task-first search (v0.3).
- Secret broker integrations — 1Password / Vault / Doppler (v0.3).
- OCI image byte recomputation, broad non-npm package artifact integrity, and full sigstore/cosign implementation.
- Policy-as-code engine, private registry, audit log (v1.0).

### v0.2 implementation order (historical)
`src/plan.ts`, `src/config.ts`, `src/install.ts`, `src/cli.ts`, and `src/tui.tsx` share
the lock/config contracts and must change together. Implement in this order:
types/capability metadata, client serializers and paths, lockfile v2, CLI/TUI command
surface, then verification/CI modules.

### v0.2 exit criteria (met)
1. `toolpin verify` enforces syntactically valid MCPB `fileSha256` and OCI digest pins; trust report carries evidence and attestation labels.
2. Correct config generation for every verified client, including Codex TOML.
3. `mcp-lock.json` v2 keyed by `name+client`, validated on read, enforced by `toolpin ci`.
4. Every shipped v0.2 lockfile/install defect has a regression test covering the fixed behavior.

## Release v0.3 — Discovery & Secrets (pillars 4, 5)

- **Task-first semantic search**: embed registry metadata; `toolpin find "read Postgres and summarize"` returns ranked matches with confidence.
- **Eval-gated listings**: optional per-server agent-eval pass rates published as a trust input — the signal npm structurally cannot offer.
- **Secret brokering**: real `op://`, `vault://`, or `doppler://` resolution remains design-gated. Install-time resolution is rejected because it writes plaintext to disk; spawn-time resolution requires a ToolPin launcher/runtime model.
- **Full sigstore/cosign** verification for OCI + provenance attestations.
- **Local policy hardening**: `.toolpin/policy.json` is shipped as the first enforcement gate; future work should add richer predicates and signed policy bundles without breaking the local JSON format.

### v0.3 design gates

- **Sigstore/transparency lock provenance**: detached signatures cover local/user-managed trust roots. Public transparency logs, identity-bound signing, and provenance attestations still need a separate sigstore design.
- **Secret brokering**: resolving `op://`, `vault://`, or `doppler://` safely requires a runtime launcher/spawn model. Resolving secrets during install and writing plaintext to client config would defeat the purpose of secret brokering.
- **Merge-time secret reference preservation**: preserving user-edited secret references across reinstall is a separate config-merge behavior change and should not be bundled with runtime brokering.

## Release v1.0 — Enterprise governance (paid tier)

- Signed **private registry** + curated mirrors; wire-compatible official API + `/owners`, `/advisories`, `/policy/evaluate`.
- **Policy-as-code** per invocation: Cedar (preferred — provable for auditors) or OPA. Principal = agent/user, action = tool, resource = server. Local JSON policy gates are the shipped precursor, not the enterprise engine.
- **Immutable audit trail** for install, update, secret grant, tool invocation, policy override.
- Org allowlists/deny rules by publisher, namespace, risk, license, package type, provenance.

## Principles

1. **Compatible, not competing.** Mirror the official registry API byte-for-byte; extend only via `_meta` namespaces and additive endpoints.
2. **Enforce, don't just record.** A lockfile or trust score that isn't checked at install is decoration.
3. **Fail closed on ambiguity.** Tampered, malformed, or drifting state errors out rather than auto-resolving.
4. **Multi-client neutral.** No client gets preference; the value is writing correctly to all of them.
5. **Metadata is security-sensitive.** Tool descriptions influence agent behavior — treat them as untrusted input by default.
