# Plan — Unblock Glama & Smithery MCP installs
*opencode (glm-5.2) · 26 Jun 2026 · companion to analysis-4.md*

Goal: let users **install** servers discovered via Glama/Smithery — safely, with independent proof — instead of today's "look, don't touch." Both are currently blocked by one line: `registry.ts:933` forces `installable=false` whenever the source is `mode:"discovery"`.

---

## Step 0 — Safety prerequisite (do first, from analysis-4)
Before opening any install path, ship the trust-anchoring work:
- `src/verificationTrust.ts` — OCI registry allowlist + canonical parser.
- `src/safeFetch.ts` — https-only, private-IP block, timeouts, size caps, no redirect.
- `verified` = 3 anchors (provenance ∧ trusted-host artifact evidence ∧ freshness).

**Why first:** the whole point of discovery-gating was "don't run arbitrary code from a third-party list pointed at any host." You only remove the gate once verification can carry that load. Skip this and unblocking = remote code execution from strangers.

---

## Step 1 — The shared mechanism (one code change unblocks both)
Flip the gate from **source-based** to **target + verification-based**.

`registry.ts:933` today:
```ts
const installable = registryMode === "installable" && hasInstallTarget;
```
becomes target-based:
```ts
const installable = hasVerifiedInstallTarget(packages, remotes);  // by TYPE, not by source
```
Extend `verifiedInstallTarget` (`registry.ts:1184`) to classify each target by what can be proven about it:

| Target type | Verifier | Status today | Tier it can reach |
|---|---|---|---|
| OCI image | allowlist + manifest digest | ✅ built | `verified` |
| MCPB bundle | byte recompute vs `fileSha256` | ✅ built | `verified` |
| **npm package** | packument + tarball `sha512` | ❌ **missing** | `verified` (once built) |
| PyPI package | per-file hashes | ❌ missing | `verified` (once built) |
| remote HTTP | URL + tool-desc-hash pin only | partial | `conditional` forever (honest) |

A discovery entry with **no verifiable target** stays non-installable with reason `"no verifiable install target"`. Discovery entries are never blanket-trusted; each target earns its own tier.

**Tier 1 bonus (free):** source precedence in `dedupeRegistryEntries` already ranks official > docker > directory. So a Glama/Smithery hit that matches an official registry entry is auto-installed from the **official** record — Glama/Smithery used only for discovery. No new code.

---

## Step 2 — Smithery (lowest effort, fast win)
1. Set `SMITHERY_API_KEY` (already wired at `registry.ts:426`) → fuller data + rate limits.
2. **Do a live fetch and inspect** what the API returns per server: MCPB bundle + `fileSha256`? hosted remote URL? npm pointer? *(This is the one unknown — confirm before building.)*
3. **If MCPB + hash** → wire Smithery targets to the **existing** MCPB verifier (`verify.ts:245`). Zero new verification code. Unblock.
4. **If hosted-URL only** → installable but capped at `conditional` (can't hash a live service). Honest.
5. **If npm pointer** → falls under Step 3 (needs the npm check).

Strategic note: Smithery *wants* to own the install. ToolPin's role is the **neutral independent checker** ("you found it on Smithery; here's proof it's safe"). Valuable, not theoretical — Smithery had a published path-traversal exploit (GitGuardian).

---

## Step 3 — Glama (the big unblock — most MCP servers are npm)
Glama is public (no key). Its entries mostly point at **npm** packages.
1. Build `src/packageIntegrity.ts` — mirror the Docker/MCPB pattern for npm:
   - fetch the npm packument (`registry.npmjs.org/<pkg>`);
   - pin exact version + read `dist.tarball` + `dist.integrity` (`sha512-…`);
   - download the tarball, hash it, compare. ~50 LOC.
2. Glama npm targets now verify → installable + can reach `verified`.
3. Glama OCI targets → reuse the allowlist + manifest digest.
4. Glama remote-only targets → `conditional` forever.

This single function unblocks the **majority** of Glama servers (and any Smithery servers that point at npm).

---

## Step 4 — PyPI (Python servers), same pattern
Per-file hashes via the PyPI JSON API. Mirrors Step 3. Unblocks Python MCP servers from both directories.

---

## Step 5 — Curated promotion (the high-trust tier)
Servers (from any source) that pass human review get a `registry/v0/servers` entry (the seeded curated registry) with real GitHub-enforcement verification (the `validateGithubEnforcement` machinery already exists, dormant). This is the top tier above `verified` — review + enforcement, not just cryptographic pinning.

---

## Suggested order & effort
| Phase | What | Effort | Effect |
|---|---|---|---|
| 0 | analysis-4 allowlist + safeFetch + 3-anchor verified | ~1 day | makes unblocking safe |
| 1 | gate flip to target-based (shared) | ~half day | mechanism for both |
| 2 | Smithery: inspect API + wire MCPB | ~half day | Smithery unblocked |
| 3 | npm `packageIntegrity.ts` | ~1 day | **majority of Glama** + npm-Smithery |
| 4 | PyPI integrity | ~1 day | Python servers |
| 5 | curated promotion workflow | ongoing | top trust tier |

## What we will NOT do
- Never blanket-trust a directory because it has a "verified badge." Verification is independent, per-target, ToolPin-controlled.
- Never install from a non-allowlisted host as `verified`. Unknown hosts → `declared`.
- Never claim a remote-only server is `verified` (no bytes to hash) — it's honestly `conditional`.

*— opencode (glm-5.2), unblock plan.*
