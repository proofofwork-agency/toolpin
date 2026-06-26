# ToolPin — Re-Analysis #4 (HEAD `ff16d03`)
*opencode (glm-5.2) · 26 Jun 2026 · 5 agents + my own reproduction · tests 209/209 (+7)*

Two new commits since analysis-3: `80ce655 Harden trust artifact evidence gates` + `ff16d03 Harden ToolPin trust evidence`. They directly targeted the escape hatch I proved.

---

## THE TWIST — they closed the string hole and opened a network hole

**The exact bypass I flagged (fake `@sha256:deadbeef` → verified/86) is genuinely closed.** I reproduced it: `deadbeef` → unverified/45; a valid-format fabricated digest → conditional/69 (not verified). They added `src/integrity.ts` (format check `@sha256:[a-f0-9]{64}$`) and a **real** `verifyOciDigest` (verify.ts:289) that fetches `/v2/<repo>/manifests/<digest>` and compares `Docker-Content-Digest`. MCPB now does **real byte recompute** (verify.ts:245-264). `verified` now strictly requires `status:"passed" && verifiedByToolPin===true` artifact evidence (trust.ts:123,381-383). `unavailable` correctly does **not** grant `verified`. This is real progress — naive forgery is dead.

**But the hardening traded a string oracle for a network oracle the publisher controls** — so the adversarial guarantee *still* doesn't hold:

- `verifyOciDigest` builds the fetch URL **entirely from the publisher-declared identifier**, with **no registry allowlist** (grep for `allowlist|docker.io|ghcr` → zero). A malicious entry `evil.attacker.com/x@sha256:H` just needs its own registry to echo `Docker-Content-Digest: H` back → `passed` → **`verified`, uncapped**. And `verified` skips provenance entirely (`classifyTrust` never checks it), so even a `discovery`/glama source can reach it. **The bypass moved from a declared string to a publisher-chosen network peer.**
- **SSRF surface (NEW):** `fetchBearerToken` follows the server's `www-authenticate` `realm=` with no scheme/host validation or timeout (verify.ts:332-350) → can hit `169.254.169.254`/internal hosts. The localhost check (verify.ts:292) *explicitly allows cleartext HTTP to localhost/127.0.0.1* — a package identifier can drive ToolPin at internal endpoints.
- **LFI/hash-oracle (NEW):** `readArtifactBytes` (verify.ts:266-274) feeds a publisher-controlled identifier into `fetch(http)` / `readFile(file://)` / `readFile(<arbitrary path>)` with no validation, size cap, or timeout.
- **Docker Hub is silently broken:** `parseOciIdentifier` splits on the *first* slash (verify.ts:318-330), so `library/nginx@…` → registry=`library` → DNS fail → `unavailable`; bare `nginx@…` → `unsupported`. The dominant registry can **never reach `verified`** — it stalls at conditional. Fails safe, but the feature is quietly broken for the common case.
- **OCI mismatch path untested** (verify.ts:312) — the most security-critical negative case has zero coverage; only the happy-path + unreachable are tested. No timeouts on any fetch (DoS); unbounded `arrayBuffer()` (OOM).

**Net:** for an *honest* publisher on a *real* registry, verification is now meaningful. Against an *active adversary* who runs an HTTP endpoint, `verified` is still earnable, and they get SSRF/LFI as a bonus. "Resolvable ≠ proven."

---

## Everything else advanced (the good news)

- **D5 no longer empty** — `registry/v0/servers` now has **5 seed entries** with full curation schema (all `metadata-only`/`not-verified`, but the GitHub-API enforcement verifier is now fully implemented and would fire on the first `enforced` claim).
- **D8 fully resolved** — `as unknown as`/`as any` = **0** repo-wide; strict type guards everywhere; Docker honors `GITHUB_TOKEN`; cache TTL fail-loud; http-json parse-report is strict.
- **Source adapters real** — Glama/Smithery/PulseMCP all fetch (Glama: 300 accepted, 0 malformed); discovery-gated structurally.
- **Policy hardened** — new fields `minTrustTier`, `requireToolPinVerifiedEvidence`, `denyRemoteEndpoints`, `denyRequiredSecrets`, all validated, enforced **fail-closed** across install/ci/lifecycle/tui.
- **Docs are accurate and non-overclaiming** — `trust-explained.md` explicitly says "`verified` means automated evidence checks passed, not that a server is safe"; lists verification boundaries (no blob re-hash, no sigstore identity). README scopes OCI/MCPB as conditional ("when reachable"). This is publication-grade honesty.
- **CLI/UX stable** — universal `--help`, typo detection, doctor scope fix, TUI focus-trap all still hold (re-verified empirically); 12-client matrix unchanged; cli.ts flat at 1536; no new duplication.
- **Tests 209/209**, build clean; the new verified-tier gate test (`trust.test.js:153`) is strong.

---

## My opinion

The team is iterating **fast and in the right direction** — they closed the exact hole I named within ~30 min of my report, plus seeded the registry, zeroed the unsafe casts, and kept docs honest. That responsiveness is the most encouraging signal in the whole audit.

But this round illustrates the **core risk of the product**: verification is a moving target, and closing a bypass by adding network fetches *creates* bypasses (spoofing, SSRF, LFI) if you don't constrain who you trust. Right now the OCI path trusts **whatever host the publisher named**. That's the one design choice that must flip before any "verified = audited" marketing: **`verified` for OCI should require a registry on an allowlist (docker.io/ghcr.io/gcr.io/mcr/…) and a verified provenance signal, not "some host echoed the digest."** Until then, OCI `verified` = "resolvable," MCPB `verified` = genuinely byte-checked — the two halves have different strength, and the UI prints them as the same tier.

### The fix that matters most (in priority order)
1. **OCI registry allowlist** — reject unknown hosts as `declared`, not `verified`. (1 file, kills the spoof.)
2. **Validate `www-authenticate` realm + add `AbortSignal` timeouts + size caps** everywhere in verify.ts (kills SSRF + DoS/OOM).
3. **Add the OCI digest-mismatch negative test** (registry reachable, returns different digest → `failed`/`ok:false`).
4. **Fix `parseOciIdentifier` for Docker Hub** (the common case is silently broken).
5. **Gate `verified` on provenance too**, not just artifact evidence — and treat remote-URL MCPB as `declared` (it has the same spoof class as OCI).

Do #1–#4 and `verified` becomes a defensible claim for OCI; #5 closes MCPB's remote-URL spoof. Then the remaining honest gap to Stacklok is **sigstore/cosign identity proof** — already on the roadmap (pre-work #8), correctly the next tier up.

*— opencode (glm-5.2), analysis-4.*

---

# How I'd solve it — concrete design

The root cause of the new bypass is one design choice: **the publisher supplies both *what* to verify (the digest) and *who* verifies it (the registry host).** That can never be secure — the party being assessed cannot also be the assessor. Every fix below follows one principle:

> **The publisher may declare *what* (digest, version, source). ToolPin decides *who* verifies it, from a trust anchor ToolPin controls.** Never fetch from a host the publisher named unless that host is on a ToolPin-controlled allowlist.

This collapses the spoof, the SSRF, the LFI, and the "verified skips provenance" gap into one coherent model. Five changes, in dependency order.

---

## 1. A `verificationTrust` module — the allowlist + canonical parser

New file `src/verificationTrust.ts`. This is the single source of truth for "which registries may grant `verified`."

```ts
// ToolPin-controlled. Publisher input cannot add to this.
const TRUSTED_OCI_REGISTRIES = new Set([
  "docker.io", "registry-1.docker.io",   // the default; must be canonicalized
  "ghcr.io", "gcr.io", "mcr.microsoft.com",
  "public.ecr.aws", "registry.k8s.io", "quay.io",
]);

// Proper OCI ref parser — fixes Docker Hub (currently broken on first-slash split).
export function canonicalizeOciRef(id: string): { host: string; repo: string; digest: string } | null {
  const at = id.lastIndexOf("@sha256:");
  if (at === -1) return null;
  const image = id.slice(0, at);
  const digest = "sha256:" + id.slice(at + "@sha256:".length);
  if (!/^[a-f0-9]{64}$/.test(digest.slice(7))) return null;        // format gate (reuse integrity.ts)
  const firstSlash = image.indexOf("/");
  if (firstSlash === -1) return { host: "docker.io", repo: "library/" + image, digest }; // "nginx" -> docker.io/library/nginx
  const head = image.slice(0, firstSlash);
  const isHost = head === "localhost" || /[:.]/.test(head);        // host:port or has a dot
  if (isHost) return { host: head, repo: image.slice(firstSlash + 1), digest };
  return { host: "docker.io", repo: image, digest };               // "foo/bar" -> docker.io/foo/bar
}

export function trustedVerificationHost(ref): string | null {
  return TRUSTED_OCI_REGISTRIES.has(ref.host) ? ref.host : null;    // null => declared, NEVER verified
}
```

This **kills the spoof** (unknown hosts return `null` → `declared`, never `verified`), **fixes Docker Hub** (the common case that's currently silently broken), and centralizes the trust decision in one auditable place. Allowlist is also extensible via policy (`allowedOciRegistries`) so enterprises can add their internal registry.

## 2. A single `safeFetch` — kills SSRF / DoS / OOM in one place

Every new network call (`verifyOciDigest`, `fetchBearerToken`, `readArtifactBytes`) must go through one helper. Don't sprinkle guards.

```ts
// src/safeFetch.ts
const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^::1$/, /^fc/, /^fe80/];
export async function safeFetch(url, { timeoutMs = 10000, maxBytes = 50 * 1024 * 1024, allowPrivate = false }) {
  const u = new URL(url);
  if (u.protocol !== "https:" && !(allowPrivate && u.host === "localhost")) throw new Error("https required");
  // resolve once, reject private/metadata IPs (blocks 169.254.169.254 and internal hosts)
  const ips = await dns.lookup(u.hostname, { all: true });
  if (!allowPrivate && ips.some(ip => PRIVATE.some(re => re.test(ip.address)))) throw new Error("private host blocked");
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" }); // no redirect following
  if (Number(res.headers.get("content-length")) > maxBytes) throw new Error("too large");
  // stream + cap before buffering (prevents OOM via oversized body)
  return readCapped(res.body, maxBytes);
}
```

Apply `redirect: "error"` and the private-IP block to the `www-authenticate` realm too (the current SSRF vector at verify.ts:332-350) — validate its scheme/host and require it be on the same trusted-host family as the registry. `readArtifactBytes` must use `safeFetch` and **must never `readFile` a `file://` or bare path derived from registry input** — local-file verification becomes an explicit `--verify-local <path>` opt-in only.

## 3. `verified` = three independent anchors, not one

Today `verified` only needs passed artifact evidence and skips provenance (`classifyTrust` never checks it). Make it a conjunction so no single anchor can grant it:

```
verified  ⇔  verifiedProvenance  ∧  passed artifact evidence (from a TRUSTED host)  ∧  fresh(verifiedAt)
```

Concretely in `classifyTrust`/`gateTrust`:
- Evidence objects that came from a non-allowlisted host carry `trustedAnchor: false` and count as `declared`, not `passed`, for the `verified` gate.
- Require `verifiedProvenance` (already computed in `trustPillars`) as a *gate*, not just a cap.
- Add freshness: `verifiedAt` within a configurable window (default 7d). Stale → re-resolve in `ci`, or downgrade to `conditional` offline.

Result: a perfect digest match on `evil.attacker.com` is now `conditional` (not verified) because the host isn't trusted and provenance isn't verified. **The adversarial guarantee finally holds.**

## 4. MCPB parity — same rule for remote-URL bundles

`verifyMcpbSha256`'s byte recompute is genuinely strong, but `readArtifactBytes` currently lets the publisher point it at any URL/path (same spoof class as OCI). Apply the identical anchor rule:
- Remote-URL MCPB may only be fetched from a `TRUSTED_MCPB_SOURCES` allowlist (github.com releases, the official registry's artifact URL, etc.). Off-allowlist → `declared`.
- Never `readFile` from registry input. (`file://`/bare path → reject; the hash-oracle LFI is closed.)
- Size cap + timeout via `safeFetch`.

After this, MCPB and OCI have **the same strength semantics** and the UI's single `verified` tier is finally honest.

## 5. Tests + honesty that match the new guarantees

- **OCI mismatch negative test** (the missing one): trusted registry reachable, returns a *different* digest → `failed` / `ok:false`.
- **Spoof test:** `evil.attacker.com/x@sha256:H` → evidence `declared`, tier ≤ `conditional`.
- **SSRF test:** identifier/realm pointing at `169.254.169.254` → blocked, no fetch.
- **LFI test:** MCPB `file:///etc/passwd` from registry input → rejected.
- **Freshness test:** `verifiedAt` older than window → downgrade to `conditional`.
- Surface the **verification method** in output (e.g. `verified via docker.io manifest digest` / `verified via MCPB byte hash`) so the (now-real) strength difference is visible, not hidden behind one tier label.
- Keep the docs' existing honesty and sharpen the one line: `verified` = "pinned against a trusted registry + verified provenance + recent check" — **not** "built by a known identity." That latter claim is the sigstore tier (roadmap pre-work #8), the next rung up.

---

## Why this ordering, and what it costs

| # | Change | Closes | Effort |
|---|---|---|---|
| 1 | `verificationTrust` allowlist + canonical parser | spoof + Docker-Hub-broken | ~1 file, ~60 LOC |
| 2 | `safeFetch` (timeouts/size/private-IP/redirect) | SSRF + DoS + OOM + LFI | ~1 file, applied at 3 call sites |
| 3 | `verified` = 3 anchors + freshness | "verified skips provenance" + stale-lockfile | ~20 LOC in trust.ts + a policy flag |
| 4 | MCPB allowlist parity | MCPB remote-URL spoof | reuses #1/#2 |
| 5 | tests + method-in-output | confidence + honest UX | ~6 tests |

Phase 1 (1–3, roughly a day) takes `verified` from "resolvable" to **defensible** — an active adversary can no longer earn it, and Docker Hub actually works. Phase 2 (#4) makes MCPB/OCI symmetric. **#1 alone is the single highest-leverage change**: it converts the publisher-named-host fetch from a vulnerability into a trusted-registry lookup, and everything else is hardening around it.

The remaining honest gap to Stacklok after this is **sigstore/cosign identity proof** (build-time *who*, not just runtime *what*) — already pre-work #8 on the roadmap, correctly the next tier up. So the path is: **trusted-registry digest + provenance (this round) → sigstore identity (next round)** — and at each step `verified` means exactly what the code can defend.

*— opencode (glm-5.2), solution addendum to analysis-4.*
