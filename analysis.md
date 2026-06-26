# ToolPin — Full Audit & Competitive Intelligence Report
*Compiled by opencode (glm-5.2) · 26 Jun 2026 · 5 parallel code agents + live competitor research*

---

## TL;DR VERDICT

ToolPin is a **surprisingly mature v0.1.0** — clean DAG architecture, strict TypeScript, 161/161 tests green, 0 production-dependency vulnerabilities, and docs more honest than most shipping security tools. Its **three core pillars — a committed lockfile, hash-pinned trust, and CI drift detection — are essentially uncontested as a product** in the MCP ecosystem (demand is real and vocal, but no competitor ships it). **The strategic window is open, but closing:** Stacklok ToolHive Enterprise and Docker AI Governance are converging on the same vocabulary from the enterprise side.

**However:** the product rests on **one cryptographic landmine** (a non-canonical serializer undermines the entire integrity/signature model) and ships with **several self-inflicted disasters** (a `--help` flag that secretly runs CI; a VS Code path that silently writes an unreadable file on macOS — the maintainer's own OS; a "moat" curated registry that is empty; `outdated` that lies due to broken semver). **Fix these before you publish; publish fast once you do.**

---

## 1. THE GOOD — genuine strengths

- **Clean architecture.** A proper dependency DAG with **zero circular imports**. `types.ts`/`canonicalJson.ts`/`version.ts` are leaves; pure domain modules compose; `cli.ts` is the thin dispatcher. `FetchLike` and a resolver callback are dependency-injected for testability.
- **Strict TypeScript discipline.** `strict:true`, **zero** `@ts-ignore`/`@ts-expect-error`, **zero** non-null assertions, only **2** `any` (isolated Docker YAML parsing). `npm run build` is clean.
- **Fail-closed is the consistent default.** Verification, policy, CI, secrets, doctor all set `process.exitCode=1` on failure (10+ consistent sites); top-level `main().catch` avoids mid-flush `process.exit()`.
- **Correct cryptography (in structure).** Ed25519 raw signing/verifying is the right mode; verification compares claimed-vs-actual digest **before** the crypto check (no replay window); algorithm pinned; layered SHA-256 over per-entry integrity → whole-lock digest → detached signature.
- **Secrets genuinely never leak.** `redact()` is a constant; secret values only ever flow into `RegExp.test()` — never into messages, SARIF, or JSON. README claim verified.
- **Honest docs.** `docs/threat-model.md` maps every defense to a file:line and explicitly states non-goals. `docs/comparison.md` has a "Differentiation that does NOT hold" section — rare and healthy.
- **Lean, safe runtime deps.** Only 4 production deps (`@modelcontextprotocol/sdk`, `ink`, `react`, `yaml`); `npm audit --omit=dev` = **0 vulns**.
- **Strong, behavior-driven tests.** 23 files, 161 tests; the lockfile/signature tests actively tamper versions, swap keys, downgrade algorithms. `policy.test.js` asserts install fails-closed *before* writing config.
- **Multi-client config generation is real.** Codex TOML table-quoting, Continue YAML list-merge preserving user fields, per-client secret-placeholder specialization (`${env:}`/`${{ secrets. }}`).
- **Uncontested product niche.** "MCP lockfile" returns **zero** Hacker News results — the vocabulary is unclaimed. ToolPin can own it.

---

## 2. THE BAD — weaknesses

- **`cli.ts` is a 1,249-line god-module** mixing 24-command dispatch + hand-rolled arg parsing + ANSI output helpers. `"mcp-lock.json"` is a magic string appearing **41 times**.
- **Hand-rolled arg parsing has no unknown-flag detection.** Typos like `--scoep global` are silently ignored (you get the default scope). No `--scope=global` syntax; only space-separated.
- **Duplicated validation.** The scope-check guard is copy-pasted **8 times**; the verify→capability→policy pipeline is reimplemented in both `install()` and the `ci()` resolver.
- **Trust score is gameable via self-declared metadata.** Every positive input (`repositoryUrl` +8, `/` in name +6, `@sha256:` substring +8, truthy `fileSha256` +8) is attacker-controllable. A malicious publisher can trivially hit the high-80s with fabricated signals. README lists these as "trust signals" without disclosing they are all unverified.
- **Policy is not covered by the lockfile signature.** An insider PR can silently lower `minTrustScore` or delete a deny rule and the signature still verifies. `.toolpin/policy.json` is unsigned; the committed `public.pem` is rotatable in a PR.
- **Pinning is presence-only, not byte-level.** `identifier.includes("@sha256:")` and `if (pkg.fileSha256)` grant badges — no artifact is fetched, no digest recomputed. Badges are literally named `*-declared`, which is honest, but drifts from where MCP (signed MCPB, sigstore) is heading.
- **`integrityPayload` excludes `notes` and timestamps.** Post-sign tampering of advisory text (e.g. injecting "Reviewed and approved by security") is invisible to integrity, digest, and signature.
- **Rug-pull defense is opt-in and asymmetric.** Tool-description hashes are only compared when **both** locked and current manifests carry a hash, captured only under `--verify` with a live probe. A non-`--verify` reinstall silently drops out of comparison.
- **`doctor --scope all` masks global drift.** It passes whenever *any* scope has the entry — verified: this repo's lockfile passes scope=all but fails scope=global with 4 missing entries.
- **Cache has no freshness/TTL.** A week-old cache is used silently without `--live`; `outdated` against a stale-but-present cache returns stale comparisons with no warning.
- **TUI hotkey overload + no modal focus-trapping.** ~30 bindings; `g` means source in Browse but scope in Installed. While Help/Overview is open, `x`/`w`/`s` still fire on the selected server — a user reading help can silently trigger a lockfile write.

---

## 3. THE UGLY

- **PulseMCP / Smithery / Glama "adapters" are sentinels that throw.** They are declared in `registry list` as `enabled:false, type:"known"` with **no fetch adapter**. README/marketing implies ToolPin "ingests from" these — it cannot. They are aspirational.
- **Docker adapter is network-fragile and silently lossy.** It fires N concurrent unauthenticated `raw.githubusercontent.com` fetches (concurrency 12, 1 retry). GitHub rate-limits unauth at ~60/min; failed entries are dropped by `.filter(Boolean)` with **no count reported** — a partial catalog is cached as if complete.
- **Custom `http-json` adapter casts rather than validates.** A malformed `packages`/`remotes` shape flows straight into trust scoring and install planning.
- **Docker "version" is a git SHA or branch name, never semver.** `compareVersionish` returns `0` for two SHAs, so `outdated`/`latestOnly` can never reliably report updates for Docker-sourced servers.
- **Repo hygiene landmines.** `opencode-main/` (a vendored copy of opencode source), `TPN-UI/`, `.codex/`, `.vscode/`, and an untracked root `mcp-lock.json` are all **one `git add .` away** from being committed. None are in `.gitignore`.

---

## 4. TOTAL DISASTERS — fix before publishing

| # | Disaster | Why it matters | Fix |
|---|---|---|---|
| **D1** | **`canonicalJson.ts:14` uses `localeCompare` — the "canonical" digest is NOT canonical.** | **This is the single most dangerous finding.** `localeCompare` is locale- and ICU-dependent; the same lockfile yields different `sha256-…` digests across machines/Node builds/`LC_ALL`. The entire integrity + signature model — the product's core promise of "this is still the lockfile we approved" — rests on this and **breaks across environments for non-malicious reasons.** | Sort by UTF-16 code unit (or UTF-8 bytes), NFC-normalize string keys. ~15 LOC + a cross-locale regression test. |
| **D2** | **`ci --help` and `doctor --help` silently RUN the command.** | Violates the universal CLI contract. Verified: `node dist/cli.js ci --help` exits 0 with "Frozen install OK" — and can trigger live registry resolution as a side-effect of *asking for help*. Erodes trust on first contact. | Hoist `isHelp(rest)` into `main()` before dispatch; ideally migrate the hand-rolled parser to `citty`/`commander`. |
| **D3** | **VS Code global path is Linux-only with zero platform detection.** | `install.ts:165` hardcodes `~/.config/Code/User/mcp.json`. On macOS (**the maintainer's own OS**) VS Code reads `~/Library/Application Support/Code/User/`; on Windows `%APPDATA%\Code\User\`. ToolPin writes an unreadable file, records it as installed, and `doctor` passes — a **silent false-positive**. No `process.platform` anywhere in `src/`. | Add platform branching to `resolveConfigTarget`; per-OS unit tests. |
| **D4** | **`compareVersionish` is semver-wrong.** | `"v1.2.3"` vs `"1.2.3"` → -1 (the leading-`v` case is extremely common); prereleases mis-ordered. `outdated` — the command literally designed to surface updates — can report `current`/`ahead-of-registry` when an update exists. **User-misleading.** | Add `semver`; classify non-semver versions as `unknown` rather than guessing. |
| **D5** | **The curated registry is empty (`count: 0`) yet marketed as the moat.** | `registry/v0/servers` is empty; `toolpinEnforcement` status is self-attested in JSON (the script never queries the GitHub API to confirm branch protection). The raw URL will 404 until the repo rename completes. Pure overhead + credibility hazard today. | Seed a first batch of reviewed servers, verify branch protection via the GitHub API, or downgrade docs to "planned." |
| **D6** | **Repo-identity mismatch blocks a correct publish.** | Real remote = `proofofwork-agency/toolpin`, but `package.json` homepage/bugs/repository **and** `docusaurus.config.js` org/project all point to `proofofworks/TPN`. Publishing now ships broken links; the website has dead GitHub/security URLs. Only the README CI badge is correct. | Unify on `proofofwork-agency/toolpin` across package.json + docusaurus; re-run `check-publish-target.mjs`. |
| **D7** | **opencode install clobbers the user's `$schema`.** | `mergeClientConfig` shallow-merges, so every install overwrites a user's custom `opencode.json` `$schema` with the default — silently, on every install. | Deep-merge: only overwrite the chosen root key; preserve `$schema`/`name`/`version`. |
| **D8** | **Docker ingest can silently cache a partial catalog** as authoritative. | A poisoned/incomplete `.toolpin/registry-cache.json` is then trusted by every subsequent non-`--live` run. | Report dropped entries; distinguish ENOENT (→live) from parse/permission errors (→throw). |

---

## 5. COMPETITORS — who they are & who to defeat

### Tier 1 — Highest threat (must differentiate hard)
- **Stacklok ToolHive Enterprise** (`1.9k★`, Apache-2.0, Go, v0.31.0) — **your closest security/governance rival.** Already markets *"semantically versioned, supply-chain-attested distribution,"* **Sigstore Cosign signing + SBOM + SLSA provenance**, **Cedar policy-as-code**, IdP/Okta/Entra mapping, claims Fortune-500/Global-2000 deployments. *Same buyer, same vocabulary (provenance, attestation, drift).*
  - **Why they don't kill you:** they are K8s/gateway/server-side, heavy, annual-subscription sales-led.
  - **Your wedge: "ToolHive for the repo, not the cluster."** Zero-infra, dev-local, works with any client.
- **Docker AI Governance** (rebranded from "MCP Toolkit", GA May 2026, Business tier $24/user/mo) — *distribution* threat: every dev already has Docker Desktop; bundles agent + MCP governance. Joined the Athena supply-chain coalition.

### Tier 2 — Feature-creep risk
- **Smithery** (`smithery.ai`, CLI 774★ AGPL, 11,505+ MCPs, top server "39.92k uses") — de-facto registry/installer. Owns the install surface + `.mcpb` packaging. *If they add `smithery lock`/trust-pinning, they absorb ToolPin's layer natively.* Gripes: GitGuardian documented a real path-traversal→supply-chain exploit against Smithery hosting; Bawbel scan flagged **22/100 top servers** for tool-description injection.
- **Glama** (48,672 servers, 50k+ devs, 1M+ calls/mo, $9–80/mo SaaS) — owns runtime governance (per-tool ACL, managed OAuth, call logs). Could extend to repo-declared policy.

### Tier 3 — Meme/mindshare threats (not feature threats yet)
- **Conductor** (native macOS app, **9-client** config sync, MIT, local) — the most direct *multi-client config* rival. Differentiate on trust/lockfile, not client-count.
- **mcpm** (MCP-Club, 107★ AGPL) — owns the "npm-for-MCP" *phrase* despite being **Claude-App-only**. Watch for a multi-client v2.
- **Scanners:** Invariant Labs MCP-Scan, Bawbel (AVE standard), mcpshark "Smart Scan" (CI/CD overlap), NineSuns mighty-security. Mostly noisy/false-positive-prone — ToolPin's *declared-config diff* approach is inherently low-FP.

### The upstream ally, not a competitor
- **Official MCP Registry** (`modelcontextprotocol/registry`, 7k★) — a **metaregistry** (metadata only). ToolPin should consume `server.json` + the namespace-ownership model, not fight it. Smithery/PulseMCP are explicitly "subregistries" that ETL from it.

### Scorecard — ToolPin's three pillars are uncontested

| Capability | Smithery | Glama | ToolHive Ent | Docker AI Gov | mcpm | Conductor | **ToolPin** |
|---|---|---|---|---|---|---|---|
| Multi-client install | partial | via gateway | yes | Docker-only | Claude-only | 9 | **12** |
| Trust/pin (hash) | ❌ | ❌ | signing | sandbox | ❌ | ❌ | **✅ core** |
| Lockfile (integrity) | ❌ | ❌ | attestation | ❌ | ❌ | ❌ | **✅ core** |
| CI drift detection | ❌ | ❌ | Cedar policy | ❌ | ❌ | ❌ | **✅ core** |

---

## 6. WHAT TO ADOPT (from the market)

1. **Own the word "lockfile" now.** "MCP lockfile" has **zero** HN results. Publish the canonical "what is an MCP lockfile" piece; become the reference implementation that Invariant Labs' *"pin with hash/checksum"* recommendation points to.
2. **Adopt Ed25519 signed-manifest verification** per [GH discussion #2913](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2913) + SEP 2828. ToolPin is perfectly placed to be the *client-side verifier*.
3. **Emit/verify SLSA + Sigstore (Cosign) provenance** the way ToolHive Enterprise does — but at **repo/CI granularity**, not container distribution. Lets you claim enterprise supply-chain posture without K8s.
4. **Build the `npm audit` for MCP** that Bawbel/HN explicitly say is missing (`audit`/`scan` against installed servers' tool descriptions). Highest-demand unmet need.
5. **Lead with CI drift detection as the hero use case** — none of the competitors market "diff your MCP config vs. lockfile in CI."
6. **Add `--registry` flag** to pull from official/Smithery/Glama/PulseMCP subregistries. Don't fight the metaregistry; sit on top of it.
7. **EMA-aware trust:** let a lockfile entry declare "requires IdP-managed (EMA)" so enterprise buyers see ToolPin as complementary to Okta/Entra, not competing.
8. **Market precision over noise.** The loudest complaint about MCP scanners is false positives. ToolPin's declared-config diff is inherently low-FP — say so explicitly.
9. **License-friendliness watch-out:** Smithery CLI + mcpm are AGPL-3.0. Lead with Apache-2.0 for enterprise inclusion.
10. **Make "12 clients" the supporting bullet, not the headline.** Conductor (9) + EMA momentum prove client-count alone won't differentiate. **Trust + lockfile + drift is the headline.**

---

## 7. WHAT YOU MUST ABSOLUTELY IMPROVE — prioritized roadmap

### P0 — Block publish (do now)
1. **Fix `canonicalJson.ts`** (D1) — the whole product's trust promise depends on it. UTF-16/UTF-8 ordering + NFC + cross-locale test.
2. **Unify repo identity** (D6) — `proofofworks/TPN` → `proofofwork-agency/toolpin` in package.json + docusaurus.
3. **Fix `--help`** (D2) — universal flag; stops `ci --help` from running CI.
4. **Fix VS Code global path** (D3) — add `process.platform` branching.
5. **Fix `compareVersionish`** (D4) — real semver; stop `outdated` from lying.

### P1 — Credibility (next sprint)
6. **Re-label/bind the trust score** (D-adjacent) — rename to "metadata-completeness score" OR incorporate verifiable signals (publisher signing key, sigstore provenance, download reputation). At minimum disclose inputs are self-declared.
7. **Move artifact verification from presence to bytes** — fetch + recompute SHA-256 for OCI/MCPB; wire `Attestation.verified`.
8. **Bind `policy.json` + public-key fingerprint into the signed payload** so insider weakening is detectable.
9. **Seed or downgrade the curated registry** (D5) — empty + self-attested undermines the trust narrative.
10. **Stop clobbering opencode `$schema`** (D7) — deep-merge.

### P2 — Scale & polish
11. **Split `cli.ts`** into argparse + output + per-command modules.
12. **Add a CHANGELOG + OIDC `npm publish --provenance` release workflow.**
13. **Make Docker ingest lossless** — report dropped entries, honor `GITHUB_TOKEN`, surface cache staleness.
14. **Add at least one live integration smoke test** (every test today is synthetic).
15. **Fix `doctor --scope all` semantics** + TUI modal focus-trapping + broaden `.gitignore`.

---

## BOTTOM LINE

**ToolPin has a genuine, uncontested product (repo-resident MCP lockfile + hash-pinned trust + CI drift) built on unusually clean, well-tested, honest code.** The threats (Stacklok, Docker) are converging from the enterprise/runtime side, not the repo side — **your window is "be the npm-audit + lockfile for MCP, for every team that doesn't run Kubernetes," and it is open today.**

**But you are currently one `localeCompare` away from a silently-broken trust model, and you ship `--help` flags that run CI and VS Code paths that silently fail on macOS.** Fix the P0 list (≈2–3 days of work) and publish fast — before the incumbents claim the vocabulary you can still own.

*— opencode (glm-5.2), end of report.*
