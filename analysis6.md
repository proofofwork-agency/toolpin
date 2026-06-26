# ToolPin — Re-Analysis #6 (HEAD `ff16d03` + uncommitted allowlist/safeFetch work)
*opencode (glm-5.2) · 26 Jun 2026 · 5 agents + live attacker-server probes · tests 213/213 (with 1 flake)*

The team implemented analysis-4's Phase 0 recommendation as **uncommitted** new files: `src/verificationTrust.ts` (allowlist + canonical parser), `src/safeFetch.ts` (SSRF guard), plus mods to verify.ts/trust.ts/policy.ts/plan.ts/cli.ts + a new `audit` supercommand + `--require-verified` gate + a doc-consistency CI check. This is a direct, fast response to analysis-4.

---

## 🔴→🟢 THE analysis-4 SPOOF IS DEAD (verified empirically)

Multiple agents ran **live attacker-registry probes** (a `127.0.0.1` echo server that mirrors any requested digest back in `Docker-Content-Digest` — the exact analysis-4 attack):

| analysis-4 gap | Status | How |
|---|---|---|
| **Spoof** (publisher host, no allowlist → verified) | ✅ **CLOSED** | `verifyOciDigest` checks `trustedOciRegistry()` **before any fetch** (verify.ts:331-339). Non-allowlisted host → `unavailable`, `trustedAnchor:false`, **never contacted**. Even the live echo server is rejected pre-fetch. |
| **SSRF** (www-authenticate realm + cleartext localhost) | ✅ **CLOSED** | Realm host pinned to `trustedOciAuthHosts`; `safeFetch` is https-only, `redirect:"error"`, `AbortSignal.timeout`, private-IP block. Localhost HTTP gone. |
| **LFI** (`readArtifactBytes` arbitrary paths) | ✅ **CLOSED** | `readArtifactBytes` + all `readFile`/`fileURLToPath` **deleted** from verify.ts. |
| **"verified" skips provenance** | ✅ **CLOSED** | `verified` is now a **3-anchor conjunction** (trust.ts:131): `verifiedProvenance && hasUsablePinEvidence && hasFreshTrustedArtifactEvidence`, where trusted evidence requires `trustedAnchor===true` + 7-day freshness. |
| **Docker Hub parse** (first-slash bug) | ✅ **CLOSED** | `canonicalizeOciRef` handles `nginx`→`docker.io/library/nginx`, `host:port`, `registry-1.docker.io`. |

**"Resolvable ≠ verified" is finally true.** A discovery/Glama source (non-official/docker) can no longer reach `verified` at all. This is the decisive improvement — `verified` is now defensible against an active adversary for the OCI path.

---

## 🟡 NEW: MCPB verification was DISABLED to close the LFI — and the docs now overclaim it

To kill the LFI, they deleted `readArtifactBytes` entirely. Side effect: **`verifyMcpbSha256` now returns `unavailable` for every input** (verify.ts:273-310) — local file, http, https, all. Tests explicitly assert `status === "unavailable"` (verify.test.js:59,80,97). So:

- **MCPB packages can never reach `verified`** today. Only reachable-OCI can. The two package types are **no longer symmetric** behind one `verified` label (analysis-4 called MCPB "the strong half" — that's no longer true).
- It's **fail-safe** (never a false `passed`) — so not a security hole, but a **capability regression**: the right fix was a `TRUSTED_MCPB_SOURCES` allowlist (analysis-4 #4), not turning it off.
- **Worse — the docs overclaim it.** 4 docs now say "MCPB byte hashing works when a local file or HTTP URL is reachable," but the code returns `unavailable`. And the **new `scripts/check-doc-consistency.mjs` *bans* the accurate "presence-only" language and *requires* the "bytes recomputed" language** — i.e. a drift-guard enforcing drift in the wrong direction. This must be fixed before publish: either re-implement MCPB behind an allowlist, or correct the docs + the consistency script.

## 🟡 NEW (latent, not reachable today): safeFetch IPv6 + DNS-rebinding holes

- **IPv6 private-range bypass** (safeFetch.ts:112-124): Node canonicalizes `[::ffff:127.0.0.1]` to hex `[::ffff:7f00:1]`, which the dotted-quad regex misses. Empirically ALLOWED: `::ffff:127.0.0.1`, `::ffff:169.254.169.254` (**metadata IP**), `::127.0.0.1`. 
- **DNS-rebinding TOCTOU**: `lookup()` validates, then `fetch()` re-resolves independently — a rebindable host passes the check then dials private.
- **Not reachable today** (the allowlist gates before safeFetch, and OCI hosts are domain names), so no live `verified` bypass. But `safeFetch`/`assertSafeUrl` are exported as the *general* SSRF backstop and are silently incomplete — any future caller (e.g. re-enabling MCPB remote fetch, a liveness probe) makes the metadata-IP SSRF live. **Fix:** block hex-form mapped/compatible ranges + pin the resolved IP into the dial.

## 🟡 NEW: a flaky test (real CI-red risk)

Test 16 `CLI test --json emits pipe-friendly failure JSON` (test/cli.test.js:246) **failed on the first of 4 runs** (`Unexpected end of JSON input` = empty stdout from the spawned `toolpin test … --json` child), then passed 3×. It's a spawned-process stdout race under `node --test` parallelism. The "213/213" headline is true **only on a clean run** — cite with the flake caveat. Not from this work, but `release:check`/`prepublishOnly` will intermittently block publish.

## Still open from analysis-4
- **OCI digest-mismatch negative test STILL missing** (verify.ts:360 `failed` branch untested). `verifyOciDigest` uses module-level `safeFetch` with no DI seam, so it can't be mocked. Same gap as analysis-4.
- **policy.json signature default-asymmetry** — `policyDigest` bound only when `--policy` passed to *both* sign+verify; by default a policy relaxation isn't signature-detected.
- **`signedAt`** is tamper-evident (inside signed payload) but not freshness-enforced (no expiry).

## 🟢 Other real gains
- **`audit` repurposed** into a true governance supercommand (lockfile + inventory + doctor + secrets + policy + verify, severity-ranked) — caught a real malformed local VS Code mcp.json in testing. Old behavior → `audit server <name>` with a deprecation shim. `--require-verified` is now a single enforceable gate across verify/install/ci/adopt/update.
- **Verification strength is now visible to users**: tier is meaningful (trusted+fresh anchor required), `method:` + `via <anchor>` lines make the mechanism legible, 3-state `verified/incomplete/failed`.
- CLI/UX resolved items all **still hold** (universal `--help`, typo detection, doctor scope, TUI focus-trap) — no regression.
- D1 (canonicalJson) intact; secrets never leak; 0 unsafe casts; cache TTL fail-loud; D8 clean.

## Structural
- `cli.ts` 1536 → **1677** (+141, audit body + `--require-verified` wiring duplicated ~6×). God-module grew; the audit refactor was the moment to split and wasn't taken.
- D5 still 5 metadata-only entries; GitHub-API enforcement dormant.
- **Glama/Smithery STILL hard-gated** — `registry.ts:933` unchanged; `hasVerifiedInstallTarget` not implemented; `packageIntegrity.ts` (npm) **still missing**; MCPB disabled. So the unlock (unlock.md) has NOT executed — only the safety foundation (Step 0) landed. The Smithery "easy win" path is currently blocked because MCPB is off.

---

## NET DELTA vs analysis-4

**Strongly positive on security.** The headline CRITICAL (verified earnable by any HTTP echo) is **dead** — proven against a live attacker server that never gets contacted. SSRF and LFI are closed. `verified` is a defensible 3-anchor conjunction. Docker Hub works. This is exactly the analysis-4 Phase 0 work, implemented correctly and fast.

**But two new problems, both worth fixing before publish:**
1. **MCPB was disabled (not allowlisted) → capability regression + doc overclaim codified by a consistency script.** Either re-enable MCPB behind a `TRUSTED_MCPB_SOURCES` allowlist, or correct the 4 docs + flip the consistency script's banned/required phrases.
2. **safeFetch's IPv6/DNS-rebinding holes** make the general SSRF backstop silently incomplete — tighten before any new caller relies on it.

**Remaining honest gap to Stacklok:** sigstore/cosign identity proof (build-time *who*, not runtime *what*) — still on the roadmap (pre-work #8), correctly the next tier up.

### Priority before publish
1. **Fix MCPB doc overclaim** (or re-enable MCPB behind an allowlist) + correct `check-doc-consistency.mjs`.
2. **CHANGELOG** — it's silent on the allowlist/safeFetch/manifest-resolution change (trust-sensitive; must be documented).
3. **Stabilize the flaky test 16** (spawned-stdout race).
4. **Tighten safeFetch** (IPv6 hex forms + pin resolved IP) so the backstop is real.
5. **Add the OCI mismatch negative test** (inject a fetch seam).
6. Public-site threat-model drifted stale ("Presence check only" now wrong); document the 8-registry allowlist restriction (transparency).

*— opencode (glm-5.2), analysis-6. Note: file named analysis6.md per request; some agents referenced "analysis-5" internally — this is the same 5-agent round.*
