# ToolPin — Direct Verification Report (analysis-3)
*opencode (glm-5.2) · 26 Jun 2026 · git log (last 8h: 6 commits by Nillo, 11:45–12:34) + own empirical reproduction*

This complements the 5-agent re-analysis. Here I verify the headline claims **myself**, by reading source and running reproduction scripts. Every finding below was reproduced or disproven directly — not taken on the agents' word.

---

## GIT LOG — last 8 hours (all Nillo, ~50 min burst)

```
5c604c9 12:34 Polish TUI install plan layout            (panels.tsx)
88eba4a 12:28 Polish TUI responsive trust/install rows  (installed.tsx, panels.tsx)
7c319f7 12:21 Merge 'codex/trust-gating-clean'
d0b69e3 12:10 Harden verified trust with evidence checks (trust.ts, verify.ts, plan.ts, policy.ts, tests, docs)
dfd554e 12:09 Add future SaaS roadmap                    (docs/SAAS_ROADMAP.md)
fe04377 11:45 Add source adapters and gated trust scoring (THE BIG ONE — 30+ files)
```

The entire gated-trust engine landed in this window. Heavy, fast work.

---

## 🔴 CONFIRMED BY ME — the "verified" escape hatch (HIGH)

**Reproduced empirically.** A 100% fabricated malicious server reaches the **highest trust tier, uncapped**, using invalid digest strings that are never validated, resolved, or recomputed.

`/tmp/repro-gameable.mjs` → `scoreServer({... oci identifier "ghcr.io/attacker/stealer@sha256:deadbeef" ...})`:
```
TIER        : verified
overallScore: 86   (cap only applies when tier !== "verified" — gateTrust:217-221)
metadataCmp : 96
capReason   : (none — NOT capped)
evidence    : package_pin=passed, digest_present=passed
```

MCPB path too — `/tmp/repro-mcpb.mjs` with `fileSha256: "x"`:
```
MCPB bogus fileSha256='x' => tier: verified | score: 79 | cap: NONE
```

**Root cause (verified in source):**
- `classifyTrust` grants `verified` when `hasPassedPinEvidence && hasPassedArtifactEvidence` (`trust.ts:118`).
- Both predicates flip `passed` on **presence-only** checks: OCI `identifier.includes("@sha256:")` (`trust.ts:260`) and MCPB truthy `fileSha256` (`trust.ts:284`).
- **No format/length validation** (`@sha256:deadbeef` passes), **no registry resolution**, **no byte recomputation** — `grep recompute|verifyDigest|getManifest|pullImage|registry/v2|/manifests/` over `src/` returns **zero** matches.
- `attestation_verified` is listed as a path to `verified` (`trust.ts:342`) but is **never produced** anywhere — a dead/phantom route.

**The policy gate shares the identical hole (verified):**
- `policy.ts:179` `if (!identifier.includes("@sha256:"))` for `requireDigestPinnedOci`
- `policy.ts:189` `if (typeof target.fileSha256 !== "string" || !target.fileSha256)` for `requireMcpbSha256`

So the **last line of defense falls to the same fake string** that games trust. A publisher that defeats the score also defeats policy.

**This is the single most important fact about the codebase right now:** the gated-scoring work added real *caps and vetoes* for non-verified tiers, but the *lock on the verified gate* is still made of declared strings. For a tool whose thesis is trust, `verified` is currently a label, not a guarantee.

---

## ✅ CONFIRMED BY ME — the fixes that genuinely landed

| Claim (from agents) | My verification | Result |
|---|---|---|
| `search <query> --help` no longer runs (D2 relocated bug) | `node dist/cli.js search github --help` → prints usage, exit 0, **does not search** | ✅ FIXED |
| `as unknown as` count 0 (was 3, 2 on untrusted data) | `grep -rn "as unknown as" src/ \| wc -l` → **0** | ✅ FIXED |
| Cache TTL + fail-loud | `registry.ts:20` `DEFAULT_CACHE_TTL_MS=24h`; `ttlMs` persisted (`:784`); `CacheSchemaError` thrown on corrupt (`:830,835`) | ✅ FIXED |
| Real source adapters (Smithery/Glama/PulseMCP) | `fetchGlamaRegistry:406`, `fetchSmitheryRegistry:423`, `fetchPulseMcpRegistry:441` exist; auth headers attached (`:426,460`) | ✅ FIXED (no longer throwing sentinels) |
| Docker honors `GITHUB_TOKEN` | `githubHeaders()` attaches Bearer token | ✅ IMPROVED |
| Universal `--help` dispatcher | `cli.ts:80-86` hoists `isHelp` before dispatch; `--help`/`-h` in `KNOWN_FLAGS` | ✅ FIXED |

---

## ⬇️ DOWNGRADED — the "flaky test" did NOT reproduce

One agent flagged `CLI accepts npm-style -g as global scope` (`test/cli.test.js`) as failing ~1/3 runs and called it a publish blocker. **I could not reproduce it:**
- 6 isolated `node --test test/cli.test.js` runs → **0 fail**.
- 3 full `npm test` runs under suite load → **202/202 pass** every time.

It may be load/timing-sensitive on a heavily loaded machine, but it is **not a confirmed publish blocker** in normal conditions. Treat as "watch, don't block."

---

## NET VERIFIED PICTURE

The last 8 hours of work moved the needle **significantly and in the right direction** — caps/vetoes, evidence modeling, real ecosystem adapters, cache TTL, universal `--help`, zero unsafe casts, policy-gating-by-default, a credible SaaS roadmap. The *enforcement* and *ecosystem* layers are now genuinely strong and release-quality, and I verified the headline fixes myself.

**But the core trust claim is unchanged and I proved it:** `verified` is still earned by *declared strings*, not *verification*. The gated-scoring work made everything *around* "verified" honest and capped, which ironically makes the one unverified escape hatch **more persuasive** — a fake server now prints `verified / 86%` with a clean cap-reason-free row, looking more authoritative than the old raw score.

### The one thing to fix before any "trust" marketing
Make `digest_present`/`file_hash_present` "passed" evidence require **actual artifact proof**:
- OCI: fetch the registry manifest and confirm the digest resolves + matches the tag (`registry/v2/<repo>/manifests/<tag>`).
- MCPB: fetch the `.mcpb` blob and recompute SHA-256 vs `fileSha256`.
- Until then, either (a) implement the fetch, or (b) **rename the tier** — "verified" that isn't verified is the one claim a supply-chain trust tool cannot afford to overclaim. The honest interim label is something like `pinned-declared` (cap-eligible, not cap-immune).

Everything else is publishable now. The escape hatch is the gap.

*— opencode (glm-5.2), direct verification complete.*
