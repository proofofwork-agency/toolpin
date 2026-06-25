# MPM Roadmap

## Positioning

MPM is the **trust, install, and governance layer over the official MCP Registry** —
not a competing catalog. The official registry is deliberately a thin metaregistry:
metadata only, no binaries, no vetting, no ranking, no enforcement. GitHub/Anthropic
own the catalog; the win is being the `brew` / `uv` of MCP.

> MPM reads from `registry.modelcontextprotocol.io`, normalizes, and adds the layers
> the registry explicitly omits: supply-chain trust, correct multi-client config,
> enforcing lockfiles, AI-native discovery, and secret brokering.

### MPM is
- A trust + install + governance layer over the official registry.
- Wire-compatible with the official `/v0/servers` API; extends via `_meta` namespaces.
- Multi-client neutral: current targets are Claude, Cursor, VS Code, Codex, and OpenCode; next-wave targets must be added only after schema/path/env research is recorded.

### MPM is not
- A competing public catalog (that fight is lost to GitHub MCP Registry + Smithery).
- A runtime host for MCP servers (left to Docker / Smithery Connect / etc.).
- A protocol reimplementation.

## The five pillars

Each pillar maps to a release. They are ordered by leverage: trust and install first,
because nothing else matters if the resolution is unsafe or the config is wrong.

| # | Pillar | Why it wins | Release |
|---|--------|-------------|---------|
| 1 | **Trust as the product** | The spec says tool descriptions are untrusted and offloads all vetting to implementers. Cryptographic attestation + capability manifests defeat tool poisoning, rug pulls, and over-broad access — the attacks no one else stops. | v0.2 |
| 2 | **Own the multi-client config layer** | #1 developer pain: many clients, many incompatible JSON/TOML shapes. A neutral universal `mpm install X --client all` that writes correct config into every verified client is the moat first-party will never match. | v0.2 |
| 3 | **A lockfile that enforces** | MPM now blocks basic install drift, but world-class lockfiles also verify content integrity, hard-error in frozen CI, and split `original`/`locked`. Trust without full enforcement is theater. | v0.2 |
| 4 | **AI-native discovery** | npm ranks human downloads; MCP can rank agent success. Task-first semantic search + eval-gated listings — structurally impossible for a download-count registry. | v0.3 |
| 5 | **Per-server secret brokering** | Plaintext secrets in `mcp.json` is the enterprise blocker. Resolve `op://` / `vault://` / `doppler://` at spawn, scope per server, rotate without editing JSON. | v0.3 |

**Enterprise governance** (signed private registry, Cedar/OPA policy gates, immutable
audit trail) is the paid tier on top of pillars 1-3, targeted at v1.0. It is the SOC 2
evidence layer security teams must buy before agents touch production.

## Current state (baseline)

Shipped in v0.1:

- Official MCP Registry + Docker catalog ingestion (`src/registry.ts`), local cache.
- Normalized package/remote metadata; multi-source scaffold (pulse/smithery/glama disabled).
- Search ranking over name, title, description, type, transport, repo (`src/search.ts`).
- **Heuristic** trust scoring only (`src/trust.ts`) — repo, namespace, pinned versions, OCI digests, MCPB hashes, HTTPS, secrets, legacy transports.
- Config export for claude/cursor/vscode/codex/opencode (`src/config.ts`); Codex now emits TOML-compatible `[mcp_servers.*]` config via `src/codexToml.ts`.
- Install writes + `mcp-lock.json` v2 (`src/plan.ts`, `src/install.ts`) with server/client keys, read validation, preserved creation time, per-entry resolution time, integrity metadata, and install drift refusal.
- Lockfile enforcement is **partial**: local drift, trust downgrade checks, per-entry integrity, whole-lock digest pins, user-supplied-key detached signatures, frozen `mpm ci`, verified remote capability pins, advisory tool-description scans, redacted secret hygiene audits, local JSON policy gates, and client-config reconciliation exist; sigstore/transparency, runtime secret brokering, and enterprise policy controls are still open.
- Ink TUI (`src/tui.tsx`).

## Known-defect fix backlog

Concrete defects in the v0.1 lockfile/install path, each with the fix, release, and
current status. Rows already surfaced in the v0.2 feature tables are marked (→ Fn);
closed rows stay listed so the roadmap preserves the security history.

| Defect | Location | Fix | Release | Status |
|--------|----------|-----|---------|--------|
| **Silent key collision** — locking same server for claude then cursor destroys the claude entry | `src/plan.ts`, `src/cli.ts`, `src/tui.tsx` | Key entries by `name + client` (→ F3) | v0.2 | Closed in current code |
| **Unsafe cast on read** — `JSON.parse(raw) as Lockfile` accepts any hand-edited shape | `src/plan.ts` | Real `parseLockfile()` validator; reject malformed entries (→ F3) | v0.2 | Closed in current code |
| **Records but never enforces** — `install` re-resolves and overwrites the lock without diffing | `src/cli.ts`, `src/tui.tsx`, `src/ci.ts` | Diff resolved vs locked; refuse install on drift unless explicitly updating lock; add frozen `mpm ci` (→ F3) | v0.2 | Closed in current code |
| **Trust snapshot is cosmetic** — nothing blocks a downgrade | `src/plan.ts`, `src/cli.ts`, `src/tui.tsx`, `src/policy.ts` | Compare locked trust against resolved trust; refuse when resolved trust decreases; add optional local policy gates for trust/source/client/server/package/transport rules | v0.2 | Closed for install and local policy gates; Cedar/OPA still open |
| **Remote targets have no integrity pin** — remote entry is just `{kind, type, url}` | `src/plan.ts`, `src/tester.ts`, `src/verify.ts` | Reuse the MCP probe path (`initialize` → `tools/list`) to pin a tool-description hash + capability manifest; diff on install because no content digest exists for a URL (→ F1) | v0.2 | Closed for verified installs |
| **No remove / unlock** — servers only accumulate; cleanup means hand-editing JSON | `src/cli.ts`, `src/plan.ts`, `src/install.ts`, `src/tui.tsx` | Add `mpm remove <server> [--client <c>]` that deletes from lock and client config | v0.2 | Closed in current code |
| **`generatedAt` is global and overwritten** — original creation time and per-server provenance are lost | `src/plan.ts` | Preserve `generatedAt`, add top-level `updatedAt`, add per-entry resolution timestamp | v0.2 | Closed in current code |
| **Lockfile has no self-integrity** — a tampered lock (downgraded version, stripped digest) is trusted verbatim | `src/plan.ts`, `src/cli.ts`, `src/signing.ts` | Per-entry integrity, whole-lock digest pins, and detached Ed25519 signatures with user-supplied keys are shipped; sigstore transparency/provenance remains open | v0.3 | Closed for local/user-managed trust roots |
| **Duplicated config drifts from client file** — `config` field in lock can diverge from the real client config | `src/plan.ts`, `src/install.ts`, `src/doctor.ts` | Add `mpm doctor` to reconcile lock ↔ client config and report drift | v0.3 | Closed in current code |

Exit rule: a defect stays "open" until it has both a failing test (reproducing the bad
behavior) and a passing test after the fix. v0.2 ships when every v0.2-row defect is closed.

## Release v0.2 — Trust & Install Foundation

**Goal:** make resolution provably safe and the install layer undeniably the best.
Ships pillars 1, 2, and 3. This is the release that makes MPM credible.

### Feature 1 — Trust as the product

| Task | File | Detail |
|------|------|--------|
| Add capability + attestation types | `src/types.ts` | `CapabilityManifest`, `Attestation`, `ToolDescriptionHash`. Carry via existing `_meta` (`types.ts:58`) under `dev.mpm/capabilities`, `dev.mpm/attestations`. |
| Capability derivation | **new** `src/capabilities.ts`, `src/tester.ts` | Normalize a `CapabilityManifest` from a `NormalizedServer`: declared env vars, transport, remote URL host (egress target), package type, secrets required. For remotes, build the tool-description hash from a live MCP probe (`initialize` → `tools/list`) rather than static registry metadata. |
| Metadata pin enforcement | **new** `src/verify.ts` | v0.2 fails closed when an OCI target is not digest-pinned or an MCPB target lacks declared `fileSha256` (currently only scored in `trust.ts:108,122`). Byte-level MCPB/image verification and full sigstore/cosign are later verification work. |
| Extend trust report | `src/trust.ts` | Keep heuristic `scoreServer`; add attestation-derived badges (`sigstore-signed`, `provenance`, `sbom`, `capability-pinned`). |
| CLI surface | `src/cli.ts` | `mpm verify <server>`; `--verify` flag on `install`. |

**Acceptance:** `mpm verify` fails closed on mutable OCI tags and MCPB packages missing
declared `fileSha256`; a clean server produces a capability manifest recorded in the
lockfile. Remote capability pins require a successful MCP tools/list probe; unreachable
servers fail verification unless the user explicitly skips live verification.

### Feature 2 — Own the multi-client config layer

| Task | File | Detail |
|------|------|--------|
| Fix Codex (TOML) | `src/config.ts`, `src/install.ts`, `src/tui.tsx`, `src/codexToml.ts` | Codex uses `~/.codex/config.toml` and trusted project `.codex/config.toml` with `[mcp_servers.<id>]`. Format-aware writer/merger, export output, install paths, and TUI labels are shipped in current code. |
| Research next-wave clients | `docs/client-configs.md` | Completed for Windsurf, Cline, Continue, Gemini CLI, Zed, and Roo Code. The document records each target's config path, schema key, local/remote transport shape, env interpolation syntax, and any implementation caveats before code support is added. |
| Add verified clients | `src/config.ts`, `src/install.ts`, `src/cli.ts`, `src/tui.tsx` | Shipped for Windsurf/Cascade global, Cline global, Continue global YAML, Gemini CLI project/global, Roo Code project, and Zed config export. Zed install paths, Roo global path discovery, and unverified project/profile paths remain open. |
| Per-client env syntax | `src/config.ts` | Replace generic placeholder emission (`config.ts:90-96`) with per-client interpolation syntax. |
| Multi-client fan-out | `src/cli.ts`, `src/install.ts`, `src/tui.tsx` | Keep `mpm install <server> --client all` as the primary verb; `--client all` writes every detected verified client without clobbering unrelated keys. |

**Acceptance:** round-trip install produces spec-correct config for every verified client,
including Codex TOML; `--client all` detects installed clients and writes each without
clobbering unrelated keys.

### Feature 3 — A lockfile that enforces

| Task | File | Detail |
|------|------|--------|
| Fix the key collision | `src/plan.ts`, `src/cli.ts`, `src/tui.tsx` | Key entries by `name + client`, not `name`. **Shipped in current code.** |
| Runtime validation on read | `src/plan.ts` | Replace `JSON.parse(raw) as Lockfile` with a real `parseLockfile()` validator. **Shipped in current code.** |
| Add integrity fields | `src/plan.ts` | Per entry: `sha256-...` integrity, `resolved` source, `original`/`locked` split (manifest spec vs resolved pin). Bump `lockfileVersion` to 2. **Implemented in current code.** |
| Frozen install | `src/cli.ts`, **new** `src/ci.ts` | New `mpm ci`: manifest↔lock drift = hard error; verify integrity metadata at install; never mutate the lock. Wire the command into the CLI switch and help text. **Implemented in current code.** |
| Drift + downgrade detection | `src/cli.ts`, `src/tui.tsx` | Compare resolved server against existing lock; refuse if version, target, generated config, or trust score changed unless `--update-lock` is used. **Base gate shipped; policy exceptions still open.** |

**Acceptance:** a tampered lockfile (downgraded version / stripped digest) is rejected;
`lock → install → lock` is idempotent; `mpm ci` fails on drift where `mpm install` would patch it.

### v0.2 out of scope
- Semantic / task-first search (v0.3).
- Secret broker integrations — 1Password / Vault / Doppler (v0.3).
- Byte-level MCPB/image verification and full sigstore/cosign implementation (metadata pin enforcement only in v0.2; full verification in v0.3).
- Policy-as-code engine, private registry, audit log (v1.0).

### v0.2 implementation order
`src/plan.ts`, `src/config.ts`, `src/install.ts`, `src/cli.ts`, and `src/tui.tsx` share
the lock/config contracts and must change together. Implement in this order:
types/capability metadata, client serializers and paths, lockfile v2, CLI/TUI command
surface, then verification/CI modules.

### v0.2 exit criteria
1. `mpm verify` enforces MCPB `fileSha256` presence + OCI digest pins; trust report carries attestation badges.
2. Correct config generation for every verified client, including Codex TOML.
3. `mcp-lock.json` v2 keyed by `name+client`, validated on read, enforced by `mpm ci`.
4. Every v0.2 row in the [Known-defect fix backlog](#known-defect-fix-backlog) is closed (failing test → passing test).

## Release v0.3 — Discovery & Secrets (pillars 4, 5)

- **Task-first semantic search**: embed registry metadata; `mpm find "read Postgres and summarize"` returns ranked matches with confidence.
- **Eval-gated listings**: optional per-server agent-eval pass rates published as a trust input — the signal npm structurally cannot offer.
- **Tool-description scan**: deterministic advisory scans for agent-directed instructions, hidden/control characters, and tool-name shadowing in server-supplied and verified live tool descriptions. Shipped as warnings for human review, not as prompt-injection detection or an install blocker.
- **Secret hygiene audit**: `mpm secrets audit` is shipped as a read-only advisory guardrail. It flags likely plaintext env/header secrets in installed config using registry `isSecret` metadata and known token prefixes, and never prints raw secret values.
- **Secret brokering**: real `op://`, `vault://`, or `doppler://` resolution remains design-gated. Install-time resolution is rejected because it writes plaintext to disk; spawn-time resolution requires an MPM launcher/runtime model.
- **Full sigstore/cosign** verification for OCI + provenance attestations.
- **Local policy hardening**: `.mpm/policy.json` is shipped as the first enforcement gate; future work should add richer predicates and signed policy bundles without breaking the local JSON format.
- **Whole-lock digest pins**: `mpm lock digest` and `mpm ci --expect-digest` provide a timestamp-insensitive set-level lockfile pin for CI systems holding the expected digest out-of-band. This is not signing or provenance.
- **User-supplied-key lock signatures**: `mpm lock sign`, `mpm lock verify-signature`, and `mpm ci --signature ... --public-key ...` provide detached Ed25519 signatures over the canonical whole-lock digest. MPM does not generate or store keys; security depends on the private key and public trust root being managed outside the repo/lockfile trust path.

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
