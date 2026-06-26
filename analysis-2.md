# ToolPin — Re-Audit (Post-Fix) & Delta vs analysis.md
*opencode (glm-5.2) · 26 Jun 2026 · 5 parallel agents re-run against current HEAD `df41bdf` · `npm test` 183/183 green (+22)*

The team shipped fixes (notably `fb89575 "Fix lock integrity and release readiness issues"`). This report is a **diff against `analysis.md`**: what got fixed, what's still open, and what regressed.

---

## VERDICT AT A GLANCE

| Disaster | Status | Notes |
|---|---|---|
| **D1** canonicalJson non-canonical (CRITICAL) | ✅ **RESOLVED** | UTF-16 + NFC + collision-throw; **proven stable across 9 locales** |
| **D2** `--help` silently runs command | ⚠️ **PARTIAL** | `ci`/`doctor` fixed; **`search <q> --help` STILL silently runs** (relocated bug); 7 commands error on `--help` |
| **D3** VS Code path Linux-only | ✅ **RESOLVED** | darwin/win32/linux branching added |
| **D4** `compareVersionish` semver-wrong | ✅ **RESOLVED** | real semver; `outdated` no longer lies |
| **D5** curated registry empty/self-attested | ❌ **STILL PRESENT** | `count:0`, CI **blesses emptiness**, enforcement still self-attested |
| **D6** repo-identity mismatch (BLOCKER) | ✅ **RESOLVED** | unified to `proofofwork-agency/toolpin` + regression guard |
| **D7** opencode `$schema` clobbered | ✅ **RESOLVED** | deep-merge preserves user `$schema` + test |
| **D8** Docker silent partial cache | ⚠️ **PARTIAL** | network errors now throw; still unauth/no-count/no-TTL |

**4.5 of 8 disasters resolved** — and critically, the team fixed the **highest-severity correctness issues first** (D1, D3, D4, D6, D7). The trust-model **foundation is now sound.** The second-tier trust gaps (#2–#6 from analysis.md) remain.

---

## ✅ RESOLVED — with proof

### D1 — canonical JSON (the critical one) → FIXED
`src/canonicalJson.ts` rewritten: `normalizeKey` (NFC, :25), `compareKeys` (UTF-16 `<`/`>`, :28-32), `ensureUniqueKeys` (throws on post-NFC collisions, :34-42). **Empirically proven:** 3 scrambled key permutations → identical digest; **9 locales (C/en/de/tr/sv/da/zh/ja) → 1 byte-identical digest**; `Café` composed vs decomposed → identical; collision rejected. Backed by `test/lockDigest.test.js:14-55`. The signature model now rests on an actually-canonical digest.

### D3 — VS Code cross-platform → FIXED
`vsCodeGlobalConfigFile()` (`install.ts:212-224`) now branches: darwin → `~/Library/Application Support/Code/User/mcp.json`, win32 → `%APPDATA%\Code\User\`, linux → `~/.config/Code/User/`. `process.platform`/`APPDATA` now present in `src/`.

### D4 — semver → FIXED
`src/versions.ts:69-157` rewritten: leading-`v`, prerelease precedence per-spec, build-metadata ignored, non-semver → `undefined`. All 4 test cases now correct; `outdated` reports `unknown` for Docker SHAs instead of lying. `test/versions.test.js` 11/11.

### D6 — repo identity → FIXED + guarded
All URLs unified to `proofofwork-agency/toolpin` (package.json:14/16/20, docusaurus:12/13/41/58/59). `scripts/check-publish-target.mjs:5-39` now asserts canonical identity → blocks drift.

### D7 — opencode `$schema` → FIXED
`mergeClientConfig` (`install.ts:198-210`) preserves user `$schema`; only seeds the default when none exists. Test `clientConfig.test.js:135`.

### Cache poisoning (D8 network half) → FIXED
`fetchText` throws on non-OK; `readCache` wraps `SyntaxError`/shape-mismatch → `CacheSchemaError` and **re-throws** (`cli.ts:551`), so a corrupt cache fails loud instead of silently recovering.

---

## ⚠️ PARTIAL / RELOCATED

- **D2 — `search <query> --help` silently runs.** `ci`/`doctor` got `isHelp` guards (`cli.ts:837`, `:986`), but there's **no universal `--help`** hoisted into `main()`. Verified: `search github --help` → returns live search results (exit 0). 7 server commands (`install`/`plan`/`info`/`policy`/`lock`/`registry`/`export-config`) print `Error: Usage…` on `--help` (fail-closed, but unhelpful/hostile to a help-seeker).
- **D8 — Docker all-or-nothing fragility.** HTTP errors now abort the whole ingest (good: no silent partial cache; bad: one flaky entry kills the entire catalog). Still unauthenticated (no `GITHUB_TOKEN`), still `.filter(Boolean)` drops nameless entries with no count, still no cache TTL.
- **`doctor --scope all` still masks global drift.** Reproduced: passes scope=all, fails scope=global with 5 issues. Root cause: `InstallPlan` carries no `scope` field, so doctor can't disambiguate intent. (Improvement: per-scope drift + invalid-scope messages now reported.)
- **TUI modal focus-trap — partial.** delete/install/search/command modals now trap focus. **Help view does NOT** — `w` still writes `mcp-lock.json` while Help is open (`app.tsx:1339`).

---

## ❌ STILL PRESENT (unchanged since analysis.md)

- **D5 — curated registry empty + self-attested enforcement.** `registry/v0/servers` = `count:0`; `npm run registry:check` → "OK: 0 entries" (**CI blesses the empty moat**); `check-curated-registry.mjs` still never calls the GitHub API to verify branch protection.
- **Trust score gameable** (`trust.ts:13,25,119,133`) — all +inputs are unverified self-declared publisher metadata.
- **`policy.json` not covered by signature** (`signing.ts:25`) — insider can weaken policy, signature still verifies.
- **Pinning presence-only** (`verify.ts:93,105`) — `@sha256:` substring / truthy `fileSha256`; no bytes fetched/recomputed.
- **`notes`/timestamps outside integrity** (`plan.ts:338-355`) — **amplified:** now also outside the whole-lock digest; post-sign text injection invisible to BOTH per-entry integrity and signature. *MEDIUM.*
- **Rug-pull defense opt-in/asymmetric** (`plan.ts:302`) — requires both manifests to carry a tool-desc hash.
- **Unknown-flag detection / `=`-syntax** — `--scoep global` and `--scope=global` silently dropped.
- **No CHANGELOG, no provenance/OIDC release workflow** (only `ci.yml`).
- **Stray dirs not gitignored** — `.codex/ .vscode/ TPN-UI/ opencode-main/ mcp-lock.json` still one `git add .` from leaking.
- **README still has `OWNER/REPO@v0.1.0` placeholders** (`README.md:198,204,211`) even though `action.yml` was fixed.

---

## 🔻 NEW REGRESSIONS (introduced by the fixes)

1. **`as unknown as` tripled (1 → 3).** Two new ones at `registry.ts:645,647` sit on **untrusted http-json registry data** — a validation gap dressed as a type. High-leverage malformed-registry spot.
2. **`cli.ts` grew +65 lines (1249 → 1314).** God-module got bigger; `"mcp-lock.json"` still 91 literals repo-wide (no constant); scope-guard now **redundantly double-validated** (helper + 6 inline copies).
3. **`search <query> --help` silently runs** — fresh instance of the D2 bug class.
4. **Docker ingest all-or-nothing** — one bad entry aborts the whole catalog (availability regression).
5. **`registry:check` passes on `count:0`** — no minimum-seed assertion; emptiness is CI-green.
6. **`signedAt` freely mutable** (`signing.ts:27` signs only digest bytes) — anyone rewriting `mcp-lock.sig` can back/forward-date the timestamp undetectably. *LOW* (advisory-only).

---

## ✨ NEW STRENGTHS

- **183/183 tests** (was 161); new coverage for canonicalJson/NFC/locale, semver, `ci`/`doctor`/`tui --help`, client-config preservation. Build clean, 0 prod vulns.
- **Pipe-friendly output** — progress to stderr, stdout stays parseable.
- **Honest fail-closed throws** for undocumented client paths (no silent wrong writes); `vscode` project target added.
- **Detached Ed25519 sign/verify** now resting on a *correct* canonical digest; signature tests actively tamper version/algorithm/tool-hash.
- **Registry self-consistency CI** (canonical = website mirror, `metadata.count === servers.length`).
- npm name `toolpin` is **free**; tarball clean (51 files / 97.4 kB); publish-ready on the npm axis.

---

## NET DELTA

**Materially better where it matters most.** The single CRITICAL (D1) — the flaw that invalidated the entire integrity+signature value proposition — is correctly and **provably** fixed. Plus D3, D4, D6, D7 and the corrupt-cache path. Right triage: correctness/crypto debt paid before structure debt.

**But:** 0 of the 5 *structural* code-quality findings fully resolved; `#4` (double-casts) **regressed**; `search --help` re-opened D2; the second-tier **trust-model gaps (#2–#6) are untouched**; and the strategic "moat" curated registry is **still empty and self-blessed**.

**Scorecard:** ~85% better on *trust-model correctness*, ~0% better on *maintainability*, the **publish blocker (D6) is cleared**, name is free, tarball is clean → **npm-publishable now**, but 3 substantive release-readiness gaps remain (stray-dir hygiene, README placeholders, no provenance workflow).

### Updated must-do before v0.1.0 public release (priority order)
1. **Broaden `.gitignore`** for `.codex/.vscode/TPN-UI/opencode-main/mcp-lock.json` (one-liner, prevents leak).
2. **Hoist universal `--help`** into `main()` → kills `search --help` running + 7 hostile error messages.
3. **Replace the 3 `as unknown as`** on untrusted registry data with real validators.
4. **Fix README `OWNER/REPO` placeholders** → `proofofwork-agency/toolpin@v0.1.0`.
5. **Add `.github/workflows/release.yml` with `npm publish --provenance`** — a supply-chain tool shipping without SLSA/sigstore undercuts its own thesis.
6. **Include `notes` in `integrityPayload`** (closes the amplified #5 gap).
7. **Seed or downgrade the curated registry** — empty + self-attested + CI-blessed is a credibility hazard.

*— opencode (glm-5.2), re-audit complete.*
