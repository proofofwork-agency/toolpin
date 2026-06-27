# Threat Model

> What ToolPin defends against, what it deliberately does not, and where each
> defense begins and ends. Audience: security reviewers, enterprise
> evaluators, and contributors. Status: scoped to v0.2.5 — future capabilities
> (sigstore, Cedar, runtime brokering) are noted as roadmap, not claims.
> Last reviewed: 2026-06-27.

This document consolidates the security scope statements scattered across the
README (Highlights, Usage, Safety Model, What Exists Now, and Roadmap) and the
Docusaurus documentation into one authoritative reference. It is intentionally
honest about gaps.

---

## 1. Assets

| Asset | Why it matters |
|---|---|
| **Agent credentials & environment** | MCP servers run with the user's OS permissions and frequently with their API tokens, OAuth sessions, and filesystem access. A malicious server is arbitrary code execution in the user's context. |
| **The agent's tool surface** | Tool descriptions and names are read by the LLM and influence its behavior. Tampering with them is a prompt-injection vector. |
| **`mcp-lock.json`** | The committed governance artifact. If it can be silently mutated, every guarantee below is void. |
| **`.toolpin/policy.json`** | The local enforcement gate. If it can be weakened via PR, the gate is decorative. |
| **CI exit codes** | If `toolpin ci` can be made to pass on a mutated lockfile, supply-chain assurance is lost. |

## 2. Adversaries

| Adversary | Capability | Likelihood |
|---|---|---|
| **Malicious publisher** | Publishes a server to the official registry / Docker catalog with crafted metadata, a tool-poisoning description, or a mutable OCI tag they later swap. | High — registration is open and metadata is self-declared. |
| **Compromised publisher** | A previously-trusted publisher rug-pulls their server (mutates tool descriptions after clients approved them) or has their registry namespace hijacked. | Medium. |
| **Insider with commit access** | Submits a PR that lowers `minTrustScore`, deletes deny rules, rotates `public.pem` + `mcp-lock.sig` together, or edits `mcp-lock.json` directly. | Medium — depends on branch protection. |
| **Network attacker** | MITM on registry fetch, or DNS rebinding on a remote MCP server. | Low for HTTPS-only; the official registry and Docker raw.githubusercontent are HTTPS. |
| **Confused deputy (the agent itself)** | Tricked by a poisoned tool description into exfiltrating secrets or invoking tools it shouldn't. | High in the general case — see §4. |

## 3. What ToolPin defends against (in scope)

| Threat | Defense | Limit |
|---|---|---|
| **Mutable OCI tags (rug-pull by tag swap)** | `verify.ts` and `policy.requireDigestPinnedOci` reject OCI identifiers without a valid `@sha256:<64 hex>` digest as `critical: mutable_oci_tag`; `verify` best-effort resolves the registry manifest digest when reachable. | ToolPin does not fetch and recompute OCI image bytes. Unreachable registries produce explicit `unavailable` evidence, not a verified result. |
| **MCPB bundles without integrity** | `verify.ts` and `policy.requireMcpbSha256` reject MCPB packages missing a valid 64-character hex `fileSha256`; `verify` recomputes SHA-256 only when bytes are available from a code-allowlisted HTTPS artifact host. | Local paths, `file://`, HTTP, untrusted hosts, and unavailable bytes produce explicit `unavailable` evidence, not a verified result. |
| **Incomplete automated evidence** | Trust tiers and cap reasons show when metadata is strong but artifact proof is missing. Trusted-source conditional entries are capped at 69% until ToolPin verifies artifact proof such as npm integrity, OCI digest, or MCPB hash evidence. | A cap is a review signal, not runtime containment. It does not prove a server is safe or unsafe. |
| **Insecure remotes** | `trust.ts:149-178` scores non-HTTPS or unparseable remote URLs as `critical: insecure_remote` / `invalid_remote_url`. | None — fail-closed. |
| **Missing install targets** | `trust.ts:33-40` scores servers with no packages and no remotes `critical: no_install_target`. | None. |
| **Tool-description rug-pulls (after verified install)** | When installed with `--verify`, the live `tools/list` descriptions are hashed (`capabilities.ts:31-45`) and the hash is compared on reinstall. The normalized `toolDescriptionHash` is included in per-entry integrity and the signed whole-lock digest when present. | Only enforced when **both** locked and current manifests carry a hash. A non-`--verify` reinstall can still skip live `tools/list` comparison. The hash covers `{name, description}`, not input schemas. |
| **Lockfile tampering** | Per-entry `integrity = sha256-…` over reviewed entry contents, including entry timestamps; `diffInstallPlans` rejects integrity mismatch. Whole-lock digest via `toolpin lock digest` excludes only top-level file timestamps; detached Ed25519 signature via `toolpin lock sign`. | The signature is only as strong as the out-of-band key management. If `public.pem` is committed, an attacker with commit access can rotate both `public.pem` and `mcp-lock.sig` together. |
| **Install drift across team/CI** | `install` refuses when version, target, trust-score decrease, config, or capability manifest differ from the locked entry. `toolpin ci` re-resolves every entry and rejects drift without mutating the lock. | Trust-score *increases* are not flagged. Trust *object* changes (e.g. a newly added badge) fire a generic "lock integrity changed" message. |
| **Plaintext secrets in committed client config** | `toolpin secrets audit` is read-only, redacts all values to `[REDACTED]`, flags declared-secret fields containing non-placeholder values and string values matching known token prefixes (`ghp_`, `sk-`, `AKIA…`, `xox…`, `AIza…`, `BEGIN … PRIVATE KEY`). `.gitignore` also excludes common local secret/key filenames. | Advisory only — no install/CI gate consumes it. `.gitignore` is not a security boundary and does not protect already-tracked files. Secret-pattern coverage is intentionally incomplete and should not be treated as DLP. |
| **Policy violations at install** | `.toolpin/policy.json` enforces `minTrustScore`, source/client/server/package-type/transport/remote-host deny rules, `requireDigestPinnedOci`, `requireMcpbSha256`. Unknown keys are rejected. | `--no-policy` is a one-flag bypass. The policy file itself is unsigned and lives in-repo. `deniedRemoteHosts` is exact-string match — denying `evil.com` does not catch `api.evil.com`. Only the *selected* target is inspected, not all declared packages. |

## 4. What ToolPin deliberately does NOT do (non-goals)

These are explicit design gates, not gaps to be embarrassed about. They are
flagged here so users do not infer stronger guarantees than the code provides.

- **Not prompt-injection detection.** `scan.ts` is a deterministic regex-based
  lint for agent-directed phrasing, hidden/control characters, and tool-name
  shadowing. It is trivially defeated by paraphrase, synonyms, non-English,
  or Unicode outside the listed ranges. It is advisory and never critical.
  See Invariant Labs' "Tool Poisoning Attacks" and Simon Willison's writeups
  for why runtime defense is unsolved.
- **Not sandboxing or runtime enforcement.** ToolPin runs at install/CI time.
  Once a server is running, ToolPin has no further control. Runtime defenses
  require a gateway (Glama, Docker AI Governance, Stacklok ToolHive) or the
  dual-LLM/CaMeL pattern.
- **Not sigstore, provenance, or SLSA.** The whole-lock digest is explicitly
  "not a signature, provenance, sigstore, or self-protecting lockfile" (see
  [docs/site/reference/lockfile-schema.md](site/reference/lockfile-schema.md)).
  Detached Ed25519 signing binds lockfile contents to a user-managed key but
  has no transparency log, no identity binding, and no replay defense. There
  is no SBOM emission (CycloneDX/SPDX) today.
- **Not a Cedar/OPA engine.** `.toolpin/policy.json` is a local JSON gate
  (see [docs/site/reference/policy-schema.md](site/reference/policy-schema.md)).
  It cannot express relational rules ("server A may not co-exist with server B")
  or produce auditable signed policy bundles.
- **Not secret brokering.** ToolPin generates placeholders/references
  (`<TOKEN>`, `${env:TOKEN}`, `op://`, `vault://`, `doppler://`) and never
  resolves them. Runtime brokering is a design-gated future feature
  (`docs/secret-brokering.md`).
- **Not full supply-chain verification.** OCI verification is registry-digest
  resolution, not image byte recomputation. MCPB byte hashing is limited to
  code-allowlisted HTTPS artifact hosts. npm verification checks
  `registry.npmjs.org` `dist.integrity` against trusted npm tarball bytes.
  There is no cosign signature verification, Referrers API walk,
  PyPI/NuGet/Cargo artifact integrity, or provenance attestation verification.
- **Not defense against cross-server tool shadowing.** Once a malicious
  server runs alongside a trusted one, ToolPin cannot prevent it rewriting
  the trusted server's tool behavior. This is a runtime concern.

## 5. Trust boundaries

```
[Official MCP Registry] ──HTTPS──▶ [ToolPin ingest/verify/install]
                                            │
                                            ├─ reads/writes .toolpin/registry-cache.json (PR-controllable if committed)
                                            ├─ reads/writes .toolpin/policy.json (PR-controllable)
                                            ├─ writes mcp-lock.json (committed, integrity-hashed)
                                            ├─ writes mcp-lock.sig (committed, Ed25519 over digest)
                                            └─ writes client config files (project + global)
                                                    │
                                                    ▼
                                         [MCP server runtime] ◀── ToolPin has NO control here
```

Three boundaries matter:

1. **Registry → ToolPin.** Trust is *unverified metadata* until ToolPin scores
   it and checks automated evidence. `verified` requires a pinned target plus
   ToolPin-verified evidence such as reachable OCI registry digest resolution,
   MCPB byte hashing, or npm tarball integrity.
2. **ToolPin → lockfile.** Integrity is cryptographically sound *within* the
   lockfile. The lockfile's own trustworthiness depends on branch protection
   + signature key management.
3. **ToolPin → runtime.** None. Once a server is installed, ToolPin is out of
   the trust path.

## 6. Recommended security posture for users

- **Commit `mcp-lock.json`.** It is the reproducibility and review artifact.
- **Run `toolpin ci --live --verify` in CI** on every PR that touches the
  lockfile when CI has the network and credentials needed for live capability
  drift checks.
- **Pin the digest out-of-band**: `toolpin lock digest` → store the expected
  digest in CI secrets (not in the repo) → `toolpin ci --expect-digest …`.
- **Sign and verify**: generate an Ed25519 keypair outside the repo; commit
  only `public.pem`; run `toolpin ci --signature mcp-lock.sig --public-key public.pem`.
- **Install with `--verify`** to capture tool-description hashes; understand
  that `--skip-live-verification` is a downgrade and CI rejects it for entries
  that already have live capability pins.
- **Treat `.toolpin/policy.json` as code**: require PR review, branch
  protection, and ideally bind it into the signature payload.
- **Use `--live` in CI when you need registry drift detection**; without it,
  CI validates against the local cache, which can be stale or PR-influenced.

## 7. Roadmap to industry-grade

Mapped to standards (see `docs/research/` for full citations):

| Capability | Today | Industry-grade target |
|---|---|---|
| Lockfile integrity | SHA-256 + user Ed25519 | + Sigstore keyless (OIDC) so signing identity is bound to GitHub/email |
| Transparency | none | Rekor v2 inclusion proof at signing time |
| Build provenance | none | SLSA L2/L3 provenance attestation verification |
| Step-level chain | none | in-toto / DSSE attestation envelopes |
| Bill of materials | none | CycloneDX (ECMA-424) / SPDX (ISO 5962) SBOM emission per locked server |
| MCPB/OCI/npm content | valid pin checks plus best-effort OCI registry digest resolution, trusted-host MCPB byte hashing, and npm SRI verification | broader artifact integrity + cosign signature on OCI via Referrers API |
| Policy | local JSON gate | Cedar (preferred for provability) or OPA/Rego |
| Tool descriptions | hash of `{name, description}` | ETDI-style enveloped/signed tool descriptions including input schemas |

Lockfile signatures now cover normalized tool-description hashes when those
hashes are present. The next step is broadening the hashed tool payload beyond
descriptions so schema-level tool drift is covered too.

Industry references that justify and shape this roadmap:
MCP spec ("tool descriptions… untrusted, unless obtained from a trusted
server"); Invariant Labs "Tool Poisoning Attacks"; CWE-494 (download without
integrity check) and CWE-1357 (reliance on insufficiently trustworthy
component, mitigated by SBOM); SoK on MCP security (arXiv:2510.16558);
SMCP (arXiv:2504.08623); SLSA v1.0; Sigstore/Cosign/Rekor; Cedar; OPA.

## 8. Reporting vulnerabilities

Do not open public issues for security bugs. Use the process in
`SECURITY.md`, preferably GitHub private vulnerability reporting when it is
available for the repository.
