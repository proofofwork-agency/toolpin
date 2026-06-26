# ToolPin — Re-Analysis #7 (HEAD `ff16d03` + uncommitted)
*opencode (glm-5.2) · 26 Jun 2026 · 5 agents + live npm-verify probe · tests 225/225 (+12, flake gone)*

The team executed analysis6's two fixes *and* the unlock plan's npm step. All four analysis6 problems were addressed. But the headline outcome is a twist: **the Glama/Smithery unblock is fully built in code but doesn't reach the user**, and there's a new publish blocker.

---

## ✅ analysis6's problems — fixed

| analysis6 issue | Status | How |
|---|---|---|
| **P1: MCPB disabled + docs overclaim** | ✅ **FIXED** | `verifyMcpbSha256` re-enabled behind `TRUSTED_MCPB_SOURCES` allowlist (`registry.modelcontextprotocol.io`, `github.com`, `*.githubusercontent.com`); local/`file://`/http → `unavailable` (fail-safe, no LFI). 4 docs + `check-doc-consistency.mjs` corrected (script now bans the overclaim, requires accurate wording, wired into `release:check`). |
| **P2: safeFetch IPv6 bypass** | ✅ mostly **FIXED** | `::ffff:7f00:1`, `::ffff:169.254.169.254`, `::ffff:a9fe:a9fe`, `::127.0.0.1` — all **blocked now** (empirically). Residual: NAT64 `64:ff9b::/96`, `fec0::/16`, DNS-rebinding TOCTOU still open (latent — allowlist gates first; low-med). |
| **OCI mismatch test missing** | ✅ **FIXED** | `verify.test.js:170` asserts `oci_digest_mismatch` (critical) when a trusted registry returns a different digest. `verifyOciDigest` now has a DI seam. |
| **Flaky test 16** | ✅ **stabilized** | 0 failures across 3 full-suite runs (was 1/4). |
| **Silent CHANGELOG** | ✅ **FIXED** | 4 substantive bullets (safeFetch IPv6, OCI digest+mismatch, MCPB re-enable, npm SRI). |

Plus the **npm verifier shipped** (`src/packageIntegrity.ts`, 200 LOC) — and is **proven working live**: `verify ai.adeu/adeu@1.7.1 --live` against the real npm registry returned `npm_integrity_verified` (passed, `trustedAnchor:true`, `registry.npmjs.org`). Sound: exact-version pin, packument host allowlist, separate tarball-host allowlist, size caps, sha512 recompute, no execution.

## 🔴 THE TWIST — the unblock is built but Glama/Smithery still can't be installed

The gate **was** flipped to target-based (`registry.ts:932-934`):
```ts
const hasVerifiableTarget = hasVerifiableInstallTarget(server);
const installable = hasInstallTarget && (registryMode === "installable" || hasVerifiableTarget);
```
…and the npm + MCPB verifiers are wired and reach `verified` for official/docker sources. **But the directory adapters don't surface any install targets.** Multiple agents confirmed: **all 300 cached Glama entries and all Smithery entries have `packages: none, remotes: none`** — the directory APIs don't return package/remote coordinates, and `directoryItemToEntry` only extracts a target if upstream carries those fields.

```
$ plan clawmemory-mcp --source glama --client claude
Error: Cannot install clawmemory-mcp@directory: registry entry has no verifiable package or HTTPS remote target.
```

So **`install <glama-server>` still fails** — just with a *different* message than in analysis6 ("no verifiable target" instead of "discovery-only"). The bouncer is built, the door unlocked — **but the shops are shipping empty boxes.** The unblock mechanism landed; the directory *funnel* did not.

**The fix is the last mile:** the Glama/Smithery adapters need to map their upstream package/remote fields into `packages`/`remotes`, OR (more likely) those public APIs genuinely don't expose install coordinates — in which case **Smithery's MCPB-bundle route** (unlock.md Step 2, the original "easy win") is the real path, and it needs Smithery's API to return bundle URLs.

## 🔴 NEW publish blocker — untracked functional files break clean builds

`src/verify.ts` now imports `./packageIntegrity.js`, `./safeFetch.js`, `./verificationTrust.js` — **all untracked** (`git ls-files` empty). Same for `scripts/check-doc-consistency.mjs` and the two new tests. **A clean checkout of HEAD `ff16d03` fails `tsc`** → `npm install` (which runs `prepare`→build) breaks → **publish from CI is broken.** The working tree only builds because these files exist locally. **Must commit them** before any release.

## 🟠 NEW security nuance — discovery npm installs execute unverified by default

With the gate flipped, a Glama/Smithery entry that *does* carry an npm target becomes installable. But **install-time verification is opt-in (`--verify`)** (`cli.ts:748`). Without it, a malicious npm package (typosquat / account-takeover) listed on Glama installs and runs (`npx -y <pkg>@<ver>`) with only metadata scoring. 

**Saving grace (holds):** such an entry **cannot reach `verified`** — `verifiedProvenance` is source-gated to `official`/`docker` only (`trust.ts:88`), and `registrySource` is set server-side from the adapter id (an attacker payload can't spoof `official`). So discovery entries cap at `conditional`/59, and `--require-verified` / `policy.minTrustTier:verified` / `requireToolPinVerifiedEvidence` all correctly **block** them. **Recommendation:** discovery-source installs should default to `--require-verified` (or be denied by default), since `conditional` is currently installable + executable.

## 🟡 Other residuals
- **`verified` locked to official/docker provenance** — even a Glama entry with a *passing* npm check caps at `conditional`. More conservative than unlock.md promised (it said npm→`verified`). Defensible; worth a doc note.
- **Public-site doc drift** — `docs/site/concepts/threat-model.md:24` still says "Presence check only" for OCI (stale underclaim) and `:37` lists MCPB byte-verify out-of-scope (contradicts `:25`). `check-doc-consistency.mjs` has no `requiredByFile` entry for this file, so it doesn't catch it.
- **Stale source descriptions** — `registry.ts:72` (Smithery) and `:85` (Glama) still say "Install targets remain disabled until verified metadata is exposed" — now **false** (gate is target-based). Under-claims a restriction that no longer exists.
- **D5 unchanged** — 5 metadata-only entries. **The GitHub-API enforcement verifier does not exist** (grep zero hits) — `unlock.md`/`unblock-plan.md` falsely claim it "already exists, dormant."
- **safeFetch latent holes** — NAT64 `64:ff9b::/96`, `fec0::/16`, DNS-rebinding (resolved IP not pinned into the dial). Low-med; not reachable today.
- `cli.ts` 1677 (flat); `--require-verified` now duplicated 9×. `isFloatingVersion` duplicated in 3 files.
- `website/CLAUDE-DESIGN-BRIEF.md` (114 KB) still tracked. Scratch `.md` files untracked/un-gitignored.

---

## NET DELTA vs analysis6 — strongly positive, with one delivery gap + one publish blocker

**Genuinely fixed this round:** MCPB re-enabled (allowlisted, no LFI) + docs/script corrected; safeFetch IPv6 hex bypass closed; OCI mismatch test + DI seam added; npm SRI verifier built and **live-proven**; flaky test stabilized; CHANGELOG fleshed out; gate flipped to target-based. **Both analysis6 "new problems" are resolved.** The security moat now has real cryptographic teeth (npm SRI + OCI digest + MCPB byte-hash, all source-independent).

**Two things to land before this is shippable/usable:**
1. **Commit the untracked files** (`src/{packageIntegrity,safeFetch,verificationTrust}.ts`, `scripts/check-doc-consistency.mjs`, 2 tests) — clean-build/publish is currently broken.
2. **Wire the directory funnel** — Glama/Smithery adapters must surface install targets (or pivot to Smithery MCPB bundles), otherwise the unblock the user asked for still doesn't work end-to-end.

**Plus (recommended):** default discovery installs to `--require-verified`; fix the 2 stale source descriptions + the public-site threat-model drift; tighten safeFetch (NAT64/fec0/pin-IP).

### Bottom line
The verification layer is now genuinely strong and demonstrable (live npm proof). The honest remaining gaps: **the directory unblock is one adapter-extraction away from actually working**, the **untracked files must be committed or nothing builds from a clean clone**, and discovery installs should fail-closed on verification by default. The sigstore/cosign identity tier vs Stacklok remains the next rung up (on the roadmap).

*— opencode (glm-5.2), analysis-7.*
