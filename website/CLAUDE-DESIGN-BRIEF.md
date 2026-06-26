# ToolPin — Website Design Brief for Claude Design

> **Single source of truth.** This is the canonical input to generate the ToolPin marketing + docs website. On any conflict between sections, the **"Canonical Verified Facts"** block below wins — it is checked against the actual codebase. Every command, filename, version, and data shape in this document must match it verbatim. **Do not invent features. If unsure, omit rather than overclaim.**

---

## How to use this brief

Read sections 01–10 in order. Sections 01–02 set positioning and brand; 03–04 set structure and the homepage; 05–08 give page-by-page content; 09 is the buildable design system; 10 is paste-ready copy, SEO, and the final build spec. Where a section draft contradicts the facts below, the facts below are correct (reconciliation notes follow).

---

## Canonical Verified Facts (authoritative)

- **Name & binary:** ToolPin · npm package `toolpin` · short alias `tpn` · license **Apache-2.0** (not MIT) · status **v0.1.0, npm-publish-pending** · requires **Node.js 22+**.
- **One-liner:** the review gate between MCP registries and the AI clients that run MCP servers with your credentials. It is **not** a catalog, hosted gateway, runtime sandbox, or secret vault.
- **The loop:** review install plan → generate exact client config → commit `mcp-lock.json` → `toolpin ci` fails PRs on drift.
- **Clients (12, exact):** `claude, cursor, vscode, codex, opencode, windsurf, cline, continue, gemini, zed, roo, generic` (plus an `all` fan-out selector — `all` is **not** a 13th client).
- **Registry sources:** `official` (MCP Registry), `docker` (Docker MCP Catalog), `all`, plus arbitrary custom registry ids via `.toolpin/registries.json`. Flag form: `--source official|docker|all|<custom-id>`.
- **Install (canonical, full server name):**
  `toolpin install io.github.github/github-mcp-server --client claude --scope project --live --verify --update-lock`
- **GitHub Action (canonical):**
  `- uses: proofofwork-agency/toolpin@v0.1.0` with `live: "true"`, `file: mcp-lock.json`. Full input set: `working-directory, file, source, live, verify, expect-digest, signature, public-key, toolpin-version, policy, no-policy, timeout, skip-live-verification`.
- **Repo:** `github.com/proofofwork-agency/toolpin`.
- **Trust score:** 0–100, **base 50**, clamped. See section 05 for the exact factor table. `trust` is always an object `{score, badges[], issues[]}` — never `{official, verified}`.
- **Policy `allowedSources`/`deniedSources` enum:** `official | docker | pulse | smithery | glama` — **never** `npm`/`oci`.

### Canonical `mcp-lock.json` v2 shape (use this exactly)

Top level is **`lockfileVersion` + `servers`** (NOT `version` + `entries`). Keys are `<serverName>:<client>`. `integrity` and the whole-lock digest use the **`sha256-<base64>`** form (dash, not colon). The whole-lock digest is **computed** by `toolpin lock digest` — it is **not a field stored in the file**.

```json
{
  "lockfileVersion": 2,
  "generatedAt": "2025-06-25T12:00:00.000Z",
  "updatedAt": "2025-06-25T12:05:00.000Z",
  "servers": {
    "io.github.github/github-mcp-server:claude": {
      "name": "io.github.github/github-mcp-server",
      "version": "0.1.0",
      "client": "claude",
      "selectedTarget": { "kind": "package", "registryType": "npm",
        "identifier": "@modelcontextprotocol/server-github",
        "version": "0.1.0", "transport": "stdio" },
      "trust": { "score": 87,
        "badges": ["source repo", "namespaced", "pinned version", "https remote"],
        "issues": [] },
      "config": { "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<GITHUB_PERSONAL_ACCESS_TOKEN>" } },
      "notes": [],
      "capabilityManifest": {
        "version": 1, "serverName": "io.github.github/github-mcp-server",
        "serverVersion": "0.1.0", "registrySource": "official",
        "packageTypes": ["npm"], "transports": ["stdio"], "remoteHosts": [],
        "secrets": [{ "name": "GITHUB_PERSONAL_ACCESS_TOKEN", "source": "env", "required": true }],
        "generatedAt": "2025-06-25T12:04:00.000Z" },
      "resolvedAt": "2025-06-25T12:04:00.000Z",
      "lockedAt": "2025-06-25T12:05:00.000Z",
      "original":  { "name": "io.github.github/github-mcp-server", "version": "0.1.0", "client": "claude" },
      "resolved":  { "source": "official", "name": "io.github.github/github-mcp-server", "version": "0.1.0" },
      "locked":    { "selectedTarget": { "kind": "package", "registryType": "npm",
                     "identifier": "@modelcontextprotocol/server-github",
                     "version": "0.1.0", "transport": "stdio" } },
      "integrity": "sha256-<base64>"
    }
  }
}
```

- `integrity` is a per-entry canonical sha256 over `name, version, client, selectedTarget, trust, config, capabilityManifest, resolved, original, locked` (timestamps, `notes`, and `integrity` itself are excluded).
- Whole-lock digest (`toolpin lock digest` / `ci --expect-digest`): `sha256-<base64>` over `{lockfileVersion, servers:{key: integrityPayload}}` — excludes `generatedAt`/`updatedAt`. It is **not** a signature/sigstore.

---

## Reconciliation notes (corrections vs the section drafts below)

A few section drafts drifted from the codebase. They are already corrected where they appear in this document; the deltas are listed here so there is no ambiguity:

1. **Filename:** the lockfile is **`mcp-lock.json`** — never `toolpin.lock`. (Fixed in 02, 09.)
2. **Lockfile shape:** drafts in 05/06/08 used `{version, entries}` / `integrity: "sha256:…"` (colon) / `locked: true` / a stored `digest` field / `trust:{official,verified}`. **All replaced** with the verified `{lockfileVersion, servers}` shape, `sha256-<base64>` integrity, `trust:{score,badges,issues}`, and no stored digest field.
3. **Policy sources:** draft in 05 used `allowedSources: ["npm","oci"]`. **Replaced** with the real enum (`official|docker|pulse|smithery|glama`).
4. **License:** draft in 03 said "MIT/Apache-2.0". It is **Apache-2.0 only**.
5. **Palette:** drafts in 04/06 used orange `#FF6B35` + green `#16A34A`. The brand spec (02) and design system (09) define the canonical palette — **Provenance Blue `#1C4FD6` + Pin Teal `#0E9F8E`** (+ light/dark tokens in 09). 04/06 color references below are mapped onto those tokens.
6. **Trust gauge factors:** the gauge tooltip (09) lists the real factors (repository, namespace, package type, pinning, OCI digest, MCPB hash, HTTPS, streamable-http, secrets, SSE, remote) rather than placeholder labels.
7. **`toolpin lock` signature:** it requires a server + client — `toolpin lock <server> --client <c>` — not a bare `toolpin lock`. (Fixed in the CLI reference table in 08.)

---

## Table of contents

1. Positioning & Messaging
2. Brand & Visual Identity
3. Information Architecture & Sitemap
4. Homepage Spec
5. Feature Pages
6. How It Works
7. Comparison & Security
8. Docs & Getting Started
9. Design System & Components
10. Copy Bank, SEO & Build Spec

---
---

# 01 — Positioning & Messaging

## Product name & one-line positioning

**ToolPin** — the review gate between MCP registries and the AI clients that run MCP servers with your credentials.

ToolPin is an Apache-2.0 CLI (`toolpin`, binary `tpn`) that gives MCP server installs the dependency-management habits developers already expect from code dependencies: inspect what will run, generate the exact client config, commit a lockfile, and fail CI when the reviewed install drifts.

## Candidate taglines

1. **The lockfile for MCP.**
2. **Review every MCP server before it runs.**
3. **MCP installs you can trust.**
4. **One reviewed plan. Every AI client.**
5. **MCP installs with the discipline of code deps.**

## Core value proposition

Today, adopting an MCP server usually means copy-pasting a config snippet from a README into your AI client. That server then runs with your credentials — your filesystem, your shell, your API keys — with no review step, no reproducibility, and no record of what was approved or by whom. As teams adopt multiple AI coding clients (Claude, Cursor, VS Code, Codex, and a dozen more), the same server gets configured by hand in different formats, drifts across machines, and silently changes whenever a registry updates. There is no "package-lock.json" for MCP — until now.

ToolPin turns MCP install into a normal engineering control. It ingests servers from the official MCP Registry, the Docker MCP Catalog, or custom sources; produces a review plan that shows trust score, verification status, capability manifests, and secret-hygiene flags; and then generates the exact client config for whichever of the 12 supported clients your team uses — one reviewed plan, many output formats. The reviewed decision is committed as `mcp-lock.json`, and a local policy gate plus Ed25519 signing keep the plan authoritative.

The payoff is the loop: **review → generate config → commit lockfile → run `toolpin ci`.** A GitHub Action fails the pull request the moment the installed MCP server drifts from what was reviewed — a version bump, a hash change, a new capability, an added secret sink. ToolPin is not a catalog, not a hosted gateway, not a runtime sandbox, and not a secret vault; it is the repo-level reproducibility and trust layer that sits in between, owned entirely by your repository.

## Audience personas

### The individual developer adopting MCP servers
- **Pain:** Wants the productivity of MCP servers in Claude/Cursor/etc. but is wary of pasting unknown config that runs with their credentials. No easy way to see what a server actually does.
- **What ToolPin gives them:** A full-screen TUI review plan — trust score (0–100), verification and capability manifests, secret-hygiene audit — before anything is installed. They commit a lockfile and move on with confidence.

### The platform / security lead enforcing policy
- **Pain:** Multiple teams are wiring MCP servers into multiple AI clients with no governance. No way to enforce what is approved, no audit trail, no signal when an install drifts.
- **What ToolPin gives them:** A local policy gate that blocks unreviewed or low-trust installs, Ed25519 signing of reviewed plans, and `toolpin ci` in a GitHub Action that fails PRs on drift. Repo-owned and auditable — no hosted control plane to adopt.

### The team lead wanting reproducibility
- **Pain:** The same MCP server is configured by hand in different formats across the team; setups drift between machines and break on onboarding.
- **What ToolPin gives them:** One reviewed plan emitted as the correct config for each of 12 clients, captured in `mcp-lock.json`. New contributors clone the repo and get the exact, reviewed MCP setup.

## Messaging pillars

### Pillar 1 — Reviewed installs
**Claim:** See exactly what an MCP server will do before it ever runs with your credentials.
**Proof:** Review plan surfaces trust score (0–100), verification status, capability manifests, and secret-hygiene audit inside a full-screen TUI.

### Pillar 2 — One lockfile, many clients
**Claim:** Approve an MCP server once; emit the correct config for every AI client your team uses.
**Proof:** Neutral config generation for 12 clients — claude, cursor, vscode, codex, opencode, windsurf, cline, continue, gemini, zed, roo, and a generic fallback — driven by a single reviewed plan.

### Pillar 3 — CI fails on drift
**Claim:** Your reviewed MCP install is enforced in continuous integration, just like a lockfile for code deps.
**Proof:** `toolpin ci` runs in a GitHub Action and fails the pull request when the installed server drifts from the committed `mcp-lock.json` (v2 enforcing lockfile).

### Pillar 4 — Trust you can see
**Claim:** Trust is not a badge — it is a number, a manifest, and a signature you can inspect.
**Proof:** 0–100 trust scoring, verification + capability manifests, and Ed25519 signing of reviewed plans.

### Pillar 5 — Local & repo-owned, not a hosted gateway
**Claim:** ToolPin runs where your code runs: your machine and your repo. No hosted control plane, no runtime proxy, no data leaving your environment.
**Proof:** Apache-2.0 CLI installed via npm (`toolpin`) or source checkout; governance lives in `mcp-lock.json` inside the repository.

## Key differentiators vs the ecosystem

- **vs. Registries & catalogs** (official MCP Registry, Docker MCP Catalog): They list servers; they do not review, lock, or enforce what actually runs in your clients. ToolPin ingests from them and adds the review gate, enforcing lockfile, and CI drift detection they lack.
- **vs. Client marketplaces / in-app install flows:** They configure one client at a time, in that client's format, with no cross-client reproducibility and no record of approval. ToolPin emits one reviewed plan across 12 client formats and commits the decision.
- **vs. Runtime gateways / hosted proxies:** They require you to route MCP traffic through a hosted or runtime-controlled service. ToolPin needs no hosting and no runtime control — it operates entirely at the repo level with a local policy gate, an enforcing lockfile, and CI enforcement.

The combination is the differentiator: **neutral multi-client config generation + repo-owned enforcing lockfile + CI drift detection + local policy gate** — none of which require hosting or runtime control.

## Proof points / factual claims

Feature these factual claims on the site (drawn directly from the product, not invented):

- **Apache-2.0 license**, npm package `toolpin`, binary alias `tpn`.
- **12 MCP clients supported:** claude, cursor, vscode, codex, opencode, windsurf, cline, continue, gemini, zed, roo, generic — neutral config generation from one reviewed plan.
- **Registry ingestion** from the official MCP Registry, Docker MCP Catalog, and custom sources.
- **Trust scoring (0–100)** plus verification and capability manifests for every reviewed server.
- **Enforcing lockfile v2** committed as `mcp-lock.json`.
- **Drift detection in CI** via `toolpin ci`, runnable as a GitHub Action that fails PRs on drift.
- **Local policy gate** that blocks unreviewed or non-compliant installs.
- **Secret hygiene audit** as part of the review plan.
- **Ed25519 signing** of reviewed plans.
- **Full-screen TUI** for reviewing installs before they run.
- **Status:** v0.1.0, Apache-2.0, Node.js 22+. Currently npm-publish-pending — usable via source checkout or the GitHub Action.

### What ToolPin is NOT (state explicitly on the site)
- Not a catalog of MCP servers.
- Not a hosted gateway or runtime proxy.
- Not a runtime sandbox.
- Not a secret vault / secret broker (any such capability is future and design-gated).
# 02 — Brand & Visual Identity

ToolPin is a governance and reproducibility layer, not a marketplace. Every visual decision should reinforce: *this is precise engineering infrastructure you can trust*. Aesthetic reference set: npm/Cargo lockfiles, Dependabot, Sigstore, GitHub Actions checks — terminal-forward, clean, and quietly credible.

## Brand Personality & Tone of Voice

**Five adjectives:** Precise · Engineering-credible · Neutral · Security-aware · Calm

| Do | Don't |
|---|---|
| Use exact, factual language ("pin to `@1.2.3`", "verified against provenance") | Overclaim ("bulletproof", "unhackable", "100% secure") |
| Show the mechanism (lockfile diffs, checksums, gate states) | Fear-monger about supply-chain risk to sell |
| Stay client-neutral and registry-neutral | Play favorites among MCP clients or registries |
| Write like a senior platform engineer writing an RFC | Use hype, emoji-salads, or growth-hacker exclamation |
| Lead with the artifact (lockfile, check, audit log) | Lead with vague "AI" or "ecosystem" benefits |

Voice is the tone of `cargo`, `npm audit`, and a well-written SIGSTORE attestation: direct, low-adjective, high-information.

## Logo Direction

Three concept families; the wordmark `ToolPin` is constant, concepts vary the **mark/glyph**.

**A. The Pushpin (primary recommendation).** A geometric pushpin/thumbtack where the pin needle is drawn as a version-spike driven through a flat "stack" line. The "pin" = pinning a version. Mark sits in a 1:1 grid, stroke 2px, optically centered. Wordmark `ToolPin` set in Inter Bold, tracking −1.5%, with the `Pin` portion in accent color to reinforce the verb.

**B. The Lockfile Lock.** A padlock whose shackle terminates in a small chevron-down, suggesting both a lock *and* a diff/dropdown. Subtle, formal — leans heavily into "trust/verification." Best for security-team-facing pages; risks overlapping with generic "security" lock iconography.

**C. The Checkpoint/Gate.** Two vertical bars (a gate) with a circular node pinned at the crossing — a literal "pin at the gate." Reads as CI check + version pin simultaneously. Most conceptually accurate to governance; most abstract to a first-time viewer.

**Wordmark:** `ToolPin`, Inter Bold 700, lowercase x-height emphasized. The alias **`tpn`** appears only in mono contexts (terminal, code, command prompts) in JetBrains Mono 600, always lowercase, optionally prefixed with `$ ` and never set as a logo. Never style `tpn` as a wordmark — it is a command, not a mark.

**Clear space** = cap height of "T" on all sides. Minimum mark size 24px. Lockup: mark left, wordmark right, vertically centered, 0.5× gap.

## Color Palette

Light mode is primary surface; dark mode is first-class (see Design Principles). All text/background pairs meet WCAG AA (4.5:1 body, 3:1 large); the `✓` pairs below hit AAA.

**Brand**
- `Provenance Blue` `#1C4FD6` — primary actions, links, active states
- `Pin Teal` `#0E9F8E` — "verified/pinned/locked" accent, success-adjacent
- `Governance Violet` `#6D28D9` — used sparingly for advanced/governance features only

**Light mode**
- Background `#FFFFFF` · Surface `#F6F8FA` · Surface elevated `#EEF2F6`
- Border `#D9DEE5` · Border strong `#B8C0CC`
- Text primary `#0E1726` ✓ · Text secondary `#5A6677`
- Success `#15803D` · Warning `#B45309` · Danger `#C81E1E`

**Dark mode**
- Background `#0B1120` · Surface `#111A2E` · Surface elevated `#16203A`
- Border `#243049` · Border strong `#33415C`
- Text primary `#E6ECF5` ✓ · Text secondary `#94A3B8`
- Primary brightened to `#3B82F6` on dark · Accent `#2DD4BF`
- Success `#22C55E` · Warning `#F59E0B` · Danger `#F87171`

Contrast notes: `Provenance Blue` on white = 6.4:1 (AA). On dark surfaces use the brightened `#3B82F6` to clear 4.5:1. Never place `Pin Teal` under body-weight text below 16px.

## Typography

**Stack:** `Inter` for headings and body (fallback: `-apple-system, system-ui, sans-serif`). **Mono:** `JetBrains Mono` for all CLI/code (fallback: `ui-monospace, SFMono-Regular, Menlo, monospace`). Geist is an acceptable substitute for Inter; Geist Mono for JetBrains Mono.

**Scale (rem / px @ 16 base), weight, line-height:**
- Display `3rem / 48px` · 700 · 1.10
- H1 `2.5rem / 40px` · 700 · 1.15
- H2 `2rem / 32px` · 700 · 1.20
- H3 `1.5rem / 24px` · 600 · 1.30
- H4 `1.25rem / 20px` · 600 · 1.40
- Body `1rem / 16px` · 400 · 1.60
- Small `0.875rem / 14px` · 400 · 1.50
- Mono (inline + blocks) `0.875rem / 14px` · 400 regular, 600 for prompts · 1.60

Headings tracking −0.01em; mono blocks `tab-size: 2`. No italics in UI; reserve bold for emphasis and H3+.

## Iconography & Illustration

**Feature icons:** 24px, 2px stroke, uniform line style (single-weight outline), rounded joins — match Lucide/Phosphor "duotone off" family. One accent color (Pin Teal) allowed per icon at 100% opacity, rest in current-color. No filled/multi-color illustration sets.

**The 12 MCP clients:** render as real, current client logos in monochrome (single token, current-color or `#5A6677` / `#94A3B8` on dark) inside a uniform rounded-`8px` chip at equal size — never invent or stylize. Treat them as a neutral "supported by" grid, not endorsements. Provide alt text naming each.

**Lockfile/trust concepts:** depict the actual artifacts — a rendered `mcp-lock.json` block (mono, syntax-tinted with the brand palette), a green check node on a gate, a diff with `+`/`−` gutters. Illustration = real UI fragments, never metaphor mascots or isometric scenes.

## Design Principles

1. **Code is the hero.** Every section features a real lockfile/CLI snippet before any prose.
2. **Show the lockfile.** Make the verification artifact visible; trust is demonstrated, not claimed.
3. **Fail closed visibly.** Deny/gate states are unmistakable — red node, clear message, no ambiguity.
4. **Dark-mode first.** Design surfaces dark, then derive light; terminal-native audience.
5. **Accessible by default.** AA minimum, focus rings always visible, motion respects `prefers-reduced-motion`.

## Motion & Feel

Motion is functional, never decorative — 150–220ms, `cubic-bezier(0.4, 0, 0.2, 1)`. Three sanctioned moments only: (1) the lock shackle *snaps* closed in one frame on a "pinned" state; (2) a drift diff reveals line-by-line on scroll-into-view (`+`/`−` gutter fade); (3) a gate check node flips from neutral to green on intersection. No parallax, no hero shader loops, no count-ups. All motion disabled under `prefers-reduced-motion`.
# 03 — Information Architecture & Sitemap

## 3.1 Site Goals & Success Metrics

ToolPin's marketing site has one job: **turn a curious AI-app developer into a locked-down, signed MCP supply chain in under 5 minutes**, while giving platform/security leads the evidence they need to mandate it.

| Goal | Why it matters | Success metric |
|---|---|---|
| Drive GitHub Action install | Lowest-friction entry path; creates the lockfile on first run | ≥40% of home-page visitors click "Add the Action"; ≥15% reach the post-install success screen |
| Make the lockfile legible | The lockfile is the artifact teams share/audit; if it's not understood, adoption stalls | ≥60% scroll-depth on `/docs/reference/lockfile-schema`; lockfile page in top-3 exits |
| Earn trust on the security model | Platform leads gate on this; without it there's no enterprise path | ≥25% of `/security` visitors proceed to `/docs/concepts/trust-explained` |
| Position vs. alternatives | Devs comparison-shop before adopting a supply-chain tool | `/compare` bounce rate <30%; time-on-page >2m |
| Grow the contributor base | Open-source governance needs maintainers and registry curators | GitHub star→issue conversion tracked; ≥5 external PRs/quarter (P2) |

---

## 3.2 Primary Navigation (Top-Level Menu)

Six items, ordered left-to-right by the typical discovery → decision → reference journey.

1. **Home** (`/`) — the 5-second pitch + primary install CTA. Justification: most traffic lands here; must convert, not inform.
2. **Features** (`/features`) — capability-led browse (lockfile, trust scoring, signing, CI drift, TUI). Justification: feature-first mental model matches how devs search ("does it do X?").
3. **How it works** (`/how-it-works`) — the end-to-end workflow (ingest → verify → lock → CI gate). Justification: reduces "what is this actually doing?" anxiety before install.
4. **Security** (`/security`) — trust model, threat model, signing, disclosure policy. Justification: dedicated surface for the platform-lead persona; separate from marketing voice.
5. **Docs** (`/docs`) — the reference home. Justification: returning users dominate long-tail traffic; needs a stable, predictable home.
6. **GitHub** (external) — repo, issues, action marketplace listing. Justification: social proof + the actual install target.

*Pricing is intentionally not top-level* — ToolPin is free/OSS; a `/pricing` stub exists only to surface the "free & MIT/Apache" positioning and is linked from the footer + home.

---

## 3.3 Full Sitemap

```
/  (Home)
├── /features                          (Features index)
│   ├── /features/lockfile             (Lockfile v2 + drift detection)
│   ├── /features/trust-scoring        (Trust scoring + capability manifests)
│   ├── /features/signing              (Ed25519 signing & verification)
│   ├── /features/registry             (Curated registry ingest/search)
│   ├── /features/policy               (Local policy + CI gate)
│   ├── /features/secret-audit         (Secret scanning on install)
│   └── /features/tui                  (Terminal UI)
├── /how-it-works                      (End-to-end workflow)
│   └── /how-it-works/github-action    (5-min Action quickstart)
├── /compare                           (ToolPin vs alternatives)
├── /security                          (Trust + threat model summary)
│   └── /security/disclosures          (Coordinated disclosure / CVE policy)
├── /install                           (Getting-started hub: CLI, Action, npm)
├── /pricing                           (Free & open-source note)
├── /blog   (P2, optional)
├── /roadmap (P2, optional)
└── /docs                              (Docs root)
    ├── /docs/intro
    ├── /docs/quickstart               (Install-first-server tutorial)
    ├── /docs/concepts
    │   ├── /docs/concepts/trust-explained
    │   ├── /docs/concepts/threat-model
    │   └── /docs/concepts/comparison
    ├── /docs/how-to
    │   ├── /docs/how-to/catch-drift-in-ci
    │   └── /docs/how-to/toolpin-curated-registry
    └── /docs/reference
        ├── /docs/reference/cli
        ├── /docs/reference/client-matrix   (12 AI clients)
        ├── /docs/reference/lockfile-schema
        └── /docs/reference/policy-schema
```

---

## 3.4 URL Structure Conventions

- **Trailing slashes off**, lowercase, hyphenated (`/features/secret-audit`, never `/Features/Secret_Audit/`).
- **Route prefixes encode audience**: `/features/*` = marketing (benefit-led, screenshot-heavy), `/docs/*` = reference (task-led, versioned, searchable), `/how-it-works/*` = narrative explainer.
- **Depth ≤ 3** everywhere except `/docs/reference/*` (depth 4 acceptable for schema pages — they're indexed destinations).
- **Stable doc IDs**: doc slugs (`trust-explained`, `lockfile-schema`) are permanent identifiers; never rename — redirects only. Docusaurus versioning mounts under `/docs/<version>/...` when toggled.
- **Anchors** for sub-sections (`/docs/reference/cli#pin`), used by the TUI's "copy link" affordance.

---

## 3.5 Footer Structure

- **Product** — Features, How it works, Install, Security
- **Docs** — Intro, Quickstart, CLI reference, Client matrix, Lockfile schema, Policy schema
- **Community** — GitHub repo, GitHub Issues, Contributing guide, Roadmap
- **Legal/Trust** — Security policy, Disclosure process, License (Apache-2.0), npm package
- **CTA band** (full-width above footer, every page): "Add the ToolPin Action →" linking to `/how-it-works/github-action`.
- **Badge row**: version badge (from `package.json`, auto-injected), license badge, build/status badge, "12 clients supported" badge.

---

## 3.6 User Journeys

**(a) Developer → install in <5 min**
`/` (hero CTA) → `/how-it-works/github-action` (copy Action YAML) → GitHub Action runs → `/docs/reference/lockfile-schema` (interpret the generated lockfile) → bookmark `/docs/reference/cli`. *Success = committed lockfile + verified first server.*

**(b) Platform/security lead → mandate policy gate**
`/security` (threat model summary) → `/docs/concepts/trust-explained` (trust scoring methodology) → `/docs/reference/policy-schema` (write the org policy) → `/docs/how-to/catch-drift-in-ci` (enforce in CI). *Success = policy file merged as a gating check.*

**(c) Team evaluator → lockfile value vs. alternatives**
`/compare` (feature matrix vs. raw `mcp install`, manual pinning, etc.) → `/features/lockfile` (drift detection demo) → `/docs/concepts/comparison` (detailed rationale) → `/` CTA. *Success = decision-maker shares the compare link internally.*

---

## 3.7 Page Priority Matrix

| Priority | Pages | Rationale |
|---|---|---|
| **P0 (launch)** | `/`, `/features`, `/features/lockfile`, `/how-it-works/github-action`, `/install`, `/security`, `/docs/intro`, `/docs/quickstart`, `/docs/reference/cli`, `/docs/reference/client-matrix`, `/docs/reference/lockfile-schema` | The minimum that satisfies all three journeys end-to-end. |
| **P1 (fast-follow)** | `/compare`, `/features/trust-scoring`, `/features/signing`, `/features/policy`, `/docs/concepts/trust-explained`, `/docs/concepts/threat-model`, `/docs/concepts/comparison`, `/docs/how-to/catch-drift-in-ci`, `/docs/reference/policy-schema`, `/pricing` | Completes the security/evaluator story; needed before any enterprise outreach. |
| **P2 (later)** | `/features/registry`, `/features/secret-audit`, `/features/tui`, `/docs/how-to/toolpin-curated-registry`, `/blog`, `/roadmap`, `/security/disclosures` | Depth, community, and content-marketing surfaces; ship once P0/P1 traffic patterns are validated. |
# 04 — Homepage Spec

One scroll-driven landing page: from "what is this" to "give me the command." Tone: precise, dry, confident. Tokens: JetBrains Mono (commands/JSON), Inter (prose); brand tokens from §02/§09 — primary Provenance Blue `#1C4FD6`, accent Pin Teal `#0E9F8E`, success green, danger red; dark-mode-first per §09.

---

## 1. Nav bar

**Purpose:** Wayfinding + always-available CTA. Sticky; blurs after 80px. Mobile → hamburger.

- Logo: `ToolPin` + pin glyph (📎-as-lock).
- Links: `How it works` · `Features` · `Lockfile` · `Clients` · `Docs`
- GitHub: `★ {live count}` → CTA: **`Get started →`**

---

## 2. Hero

**Headlines (recommended A):**
- **A.** `Review what runs — before it runs.`
- **B.** `The lockfile for MCP servers.`
- **C.** `Every MCP install, reviewed, locked, CI-checked.`

**Subhead:** ToolPin is the missing review gate between MCP registries and the AI clients that run servers with your credentials. One lockfile. Twelve clients. Zero drift.

**CTAs:** Primary **`Install the GitHub Action`** (→ §10) · Secondary **`Read the 90-second tour →`** (→ §5)

**Hero visual — split panel:**
- **Left:** looping terminal recording — `toolpin install io.github.github/github-mcp-server --client claude --scope project --live --verify --update-lock` → install plan (capabilities, `trust 87/100`, `secrets ✓`) → `✓ wrote mcp-lock.json`.
- **Right:** animated `mcp-lock.json` card snaps into place (spark on landing), then a green ✓ CI badge stamps below: `toolpin ci · passed · 1 server · 0 drift`. JSON is real, hoverable (preview of §7).

---

## 3. Social proof / trust bar

**Purpose:** Credibility in one glance.

> **Open source · Apache-2.0 · 12 MCP clients · GitHub Action · Node 22+**

**Client logo strip:** monochrome row, fades at edges: `claude · cursor · vscode · codex · opencode · windsurf · cline · continue · gemini · zed · roo · generic`. Hover → color, tooltip "Generates config for {client}." Trailing chip: `+ generic (any stdio client)`.

---

## 4. Problem statement

**Purpose:** Reframe what an MCP install does (README framing).

**Headline:** `Installing an MCP server isn't installing a theme.`
**Subhead:** It can give an agent tools, local process access, network access, and your credentials. There's no review step between the registry and the client that runs it. **ToolPin is that step.**

**Visual:** Three amber "permission cards" slide in on scroll — `🔧 tools` · `🖥 process` · `🌐 network` · `🔑 credentials` — turning green in §5.

---

## 5. The 4-step solution loop

**Headline:** `One loop. Four steps. Reviewed by default.`

**Flow (horizontal desktop / vertical mobile), 4 nodes with looping arrow:**
1. **Review** — Browse, search, read capability manifest + trust score before anything is written. *🔎*
2. **Generate** — Emit exact config (JSON/TOML/YAML) for the client you actually use. *{ }*
3. **Lock** — Commit `mcp-lock.json`: sha256 integrity + capability manifest per `server:client`. *📌*
4. **CI drift** — `toolpin ci` fails the PR the moment a running config drifts from lock. *✓*

Each node expands on tap: Review → `trust: 87/100`; Generate → `claude.json`; Lock → `sha256-…`; CI → `exit 1`.

---

## 6. Feature highlights grid

**Purpose:** Indexable surface area. 8 tiles, 4×2 desktop / 2×4 mobile. Tiles lift 2px + accent border on hover; icons in ToolPin orange.

**Headline:** `What's in the box.`

| Tile | Title | Description |
|---|---|---|
| 🔒 | **Enforcing lockfile** | `mcp-lock.json` is source of truth; clients read it, CI enforces it. → `/features/lockfile` |
| 🧩 | **12-client config gen** | JSON/TOML/YAML for 12 clients + `generic`. → `/features/clients` |
| 📊 | **Trust scoring 0–100** | One comparable number per server, from verification + signing + hygiene. → `/features/trust` |
| 🛡 | **Verification & capability manifests** | Tools/resources/prompts a server declares, before it runs. → `/features/manifests` |
| 🚦 | **CI drift detection** | `toolpin ci` fails PRs the instant a client config drifts. → `/features/ci` |
| ⚙️ | **Local policy gate** | Per-repo rules: allowed scopes, trust floor, banned capabilities. → `/features/policy` |
| 🧼 | **Secret hygiene audit** | Catches credentials in args, env, or config before commit. → `/features/hygiene` |
| ✍️ | **Ed25519 signing** | Verify releases against publisher keys; reject unsigned drift. → `/features/signing` |

**Visual:** 1px hairline tiles.

---

## 7. Show the lockfile

**Headline:** `Meet mcp-lock.json.`
**Subhead:** Versioned, integrity-checked, capability-aware. The one file your repo owns.

```json
{
  "lockfileVersion": 2,                            // ① schema pin
  "servers": {
    "io.github.github/github-mcp-server:claude": { // ② server:client key
      "original": "io.github.github/github-mcp-server", // ③ requested ref
      "resolved": "github-mcp-server@0.1.0",       // ④ pinned resolution
      "locked": { "version": "0.1.0",              // ⑤ exact version
                  "source": "oci://ghcr.io/github/github-mcp-server:0.1.0" },
      "capabilityManifest": {                      // ⑥ declared tools/resources/prompts
        "tools": ["issues.create", "prs.review"],
        "resources": ["repo:*"], "prompts": [] },
      "integrity": "sha256-9f2c3e…"                // ⑦ content integrity
}}}
```

**Callouts (right rail, click → highlights matching line):**
- ① `lockfileVersion: 2` — schema-pinned; ToolPin refuses unknown versions.
- ② Keyed `server:client` — one lock, many clients.
- ③ `original` — what the human asked for (reproducibility).
- ④ `resolved` — the exact artifact ToolPin will run.
- ⑤ `locked` — immutable; the only field CI trusts.
- ⑥ `capabilityManifest` — surfaced before install, auditable in review.
- ⑦ `integrity` — sha256 over the resolved artifact; tampering fails CI.

---

## 8. Comparison / why strip

**Headline:** `Not a catalog. Not a gateway. Not a sandbox. A review gate.`
**Subhead:** ToolPin fits between registries/marketplaces and your clients — without taking over runtime.

| | Registry/Marketplace | Gateway | **ToolPin** |
|---|---|---|---|
| Multi-client config | ✗ one per registry | ~ routes traffic | ✓ **JSON/TOML/YAML for 12** |
| Lockfile you own | ✗ | ✗ | ✓ **committed to your repo** |
| CI drift detection | ✗ | partial | ✓ **`toolpin ci`** |
| Local policy gate | ✗ | partial | ✓ **per-repo rules** |
| Runs your servers | — | ✓ | ✗ **(that's the point)** |

**Visual:** ToolPin column has accent border + pin glyph header.

---

## 9. TUI showcase

**Headline:** `A full-screen TUI. Because this is a CLI.`
**Subhead:** Browse, install, govern without leaving the terminal. Built in Ink.

**Mockup:** macOS-chrome terminal, JetBrains Mono, 3×2 grid of panels:
- **Browse** — server list + trust scores.
- **Installed** — `mcp-lock.json` entries with ✓/✗ integrity badges.
- **Overview** — `4 servers · 3 clients · 0 drift · avg trust 84`.
- **Install** — live install plan for the GitHub MCP server, blinking cursor.
- **Config** — generated `claude` JSON, syntax-highlighted.
- **Help** — keybindings (`j/k` · `i` install · `l` lock · `q` quit).

Button **`▶ Play interactive tour`** opens a hosted asciinema in a modal.

---

## 10. GitHub Action CTA

**Headline:** `Add it to CI in 30 seconds.`
**Subhead:** One step in your workflow. Every PR reviewed for MCP drift.

```yaml
- uses: proofofwork-agency/toolpin@v0.1.0
  with:
    live: "true"
    file: mcp-lock.json
```

> `live: "true"` runs ToolPin against your actual client configs. `file:` points at the lockfile in your repo. Drift = red ✗ on the PR.

**CTAs:** **`Copy the workflow →`** (copy button flashes ✓) · **`Read CI docs`** → `/docs/ci`. Side panel: `toolpin ci / passed in 4s · 1 server · 0 drift`.

**Small print (mono):** `v0.1.0 · npm-publish-pending · source checkout or this GitHub Action · Node 22+ · Apache-2.0`

---

## 11. FAQ teaser + final CTA band

**Headline:** `Quick answers.` (accordion)
1. **Is ToolPin a catalog or gateway?** No — a review gate. It generates client config and a repo-owned lockfile; it doesn't run your servers or host a marketplace.
2. **Which clients?** Twelve: claude, cursor, vscode, codex, opencode, windsurf, cline, continue, gemini, zed, roo, `generic`.
3. **How do I install it?** v0.1.0 is npm-publish-pending. Use the GitHub Action (`proofofwork-agency/toolpin@v0.1.0`) or build from source on Node 22+.

**Final CTA band** (full-width dark ink, accent border):
- Headline: `Review what runs. Before it runs.`
- Subhead: `Commit your first mcp-lock.json today.`
- Buttons: **`Get started →`** · **`Star on GitHub ★`**.

---

## 12. Footer

**4 columns:**
- **Product:** `How it works` · `Features` · `Lockfile spec` · `Clients` · `Changelog`
- **Developers:** `Docs` · `GitHub Action` · `TUI` · `CLI reference` · `Contributing (Apache-2.0)`
- **Resources:** `Capability manifests` · `Trust scoring` · `Policy gate` · `Ed25519 signing` · `Status`
- **Project:** `README` · `Issues` · `Discussions` · `Code of Conduct` · `Security`

**Bottom bar (muted):** `ToolPin · v0.1.0 · Apache-2.0 · Node 22+ · npm-publish-pending · Built for MCP` + pin glyph/wordmark. Right: `Not affiliated with Anthropic, GitHub, or any client vendor.`

---

*End of section 04 — Homepage Spec.*
# 05 — Feature Pages

This section specifies the long-form **feature pages** that sit one level below the marketing home. Each page owns a single capability, is self-contained, and links back to docs and adjacent features. Copy is written to ToolPin's voice: precise, honest about tradeoffs, anti-hype.

---

## The Enforcing Lockfile (`mcp-lock.json` v2)

**URL slug:** `/features/lockfile`
**Page title:** The Enforcing Lockfile — `mcp-lock.json` v2

### Hero
**Headline:** Your MCP install is now a fact, not an opinion.
**Subhead:** `mcp-lock.json` v2 pins every server/client pair to an exact resolved target, generated config, capability manifest, tool-description hashes, and integrity digest — then refuses to drift in CI.

### What it is
The lockfile is the single source of truth for what is installed where, at what version, with what config, exposing what capabilities. It is keyed by `server:client`, so the same server can resolve differently per client without ambiguity.

### Why it matters
MCP servers evolve fast, registries reshuffle, and a "minor" bump can quietly widen a tool surface. The lockfile turns "works on my machine" into "verified on every machine" by failing closed on the changes that actually matter.

### How it works
On install, ToolPin records `original`, `resolved`, `locked`, an optional `capabilityManifest`, and a `sha256-...` integrity field per entry. Drift checks fail on changes to version, selected target, generated config, capability manifest, tool-description hash, or any trust decrease — until you run `--update-lock` or `toolpin lock`. `toolpin ci` re-resolves, verifies integrity, rejects drift, and **never mutates** the lockfile. v1 entries must be regenerated.

### Snippet
```json
{
  "lockfileVersion": 2,
  "servers": {
    "io.github.github/github-mcp-server:claude": {
      "original":  { "name": "io.github.github/github-mcp-server", "version": "0.1.0" },
      "resolved":  { "source": "official", "name": "io.github.github/github-mcp-server", "version": "0.1.0" },
      "locked":    { "selectedTarget": { "kind": "package", "registryType": "npm",
                       "identifier": "@modelcontextprotocol/server-github", "version": "0.1.0" } },
      "trust":              { "score": 87, "badges": ["pinned version", "https remote"], "issues": [] },
      "capabilityManifest": { "packageTypes": ["npm"], "transports": ["stdio"] },
      "integrity": "sha256-<base64>"
    }
  }
}
```

```bash
toolpin ci --expect-digest "$(toolpin lock digest)"
```

### Proof points
- Keyed by `server:client` — per-client resolution without collisions.
- Drift fails on version, target, generated config, capability manifest, tool-description hash, and any trust decrease.
- `toolpin ci` is read-only by design: re-resolve, verify, reject, never write.
- Whole-lock digest pinning via `toolpin lock digest` + `ci --expect-digest` is a timestamp-insensitive canonical sha256.
- v1 lockfiles are not auto-upgraded — they must be regenerated.

### Limitations / what it's not
The `--expect-digest` digest is **not** a signature, **not** Sigstore, and **not** self-protection. It is only meaningful when the expected digest arrives from a trusted out-of-band source; otherwise it is theater. ToolPin will not pretend a hash is a signature.

### Related links
- `/features/ci-drift` — CI drift detection
- `/features/capability-manifests` — Verification & capability manifests
- `/docs/lockfile/v2` — Lockfile schema reference

---

## Neutral Client Config Generation (12 Clients)

**URL slug:** `/features/client-config`
**Page title:** One Pin, Twelve Clients

### Hero
**Headline:** Write your intent once. Ship to every MCP client.
**Subhead:** ToolPin generates correct config for Claude, Cursor, VS Code, Codex, OpenCode, Windsurf, Cline, Continue, Gemini, Zed, Roo, and a generic target — project or global, fail-closed where it can't verify.

### What it is
A config emitter that understands each client's schema and writes the right shape into the right file at the right scope.

### Why it matters
Client config formats are inconsistent and undocumented. Hand-maintained configs drift, leak across scopes, and silently break. ToolPin makes "install once, run anywhere" literal.

### How it works
Each client has a known format: Claude/Cursor-style `mcpServers`, VS Code `servers`, Codex `[mcp_servers.*]` TOML, OpenCode `mcp`, Continue `config.yaml`, Zed `context_servers`. Project and global scopes are both supported. Where a path can't be verified, ToolPin **fails closed** rather than guessing.

### Snippet
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${{ secrets.GITHUB_TOKEN }}" }
    }
  }
}
```

```bash
toolpin install github --client all
```

### Proof points
- 12 targets: claude, cursor, vscode, codex, opencode, windsurf, cline, continue, gemini, zed, roo, generic.
- `--client all` fans out to every applicable target.
- Fail-closed where the install path is unverified (Zed install, Roo global).
- Windsurf/Cline/Continue are global-only; Claude global uses `claude mcp add-json`.
- Generated config is itself part of the lockfile integrity — tampering is drift.

### Limitations / what it's not
ToolPin will refuse to write where it cannot verify, instead of writing "probably right" config. If a client invents a new scope or path convention, you'll get an error, not a guess.

### Related links
- `/features/lockfile` — how generated config is pinned
- `/docs/clients` — per-client format reference

---

## Trust Scoring (0–100)

**URL slug:** `/features/trust-score`
**Page title:** Trust Scoring — A Number You Can Defend

### Hero
**Headline:** Not every server deserves your agent. Now you have a number.
**Subhead:** A transparent 0–100 score built from observable facts — OCI digests, MCPB hashes, namespacing, pinning, transports — not vibes.

### What it is
A deterministic scoring model that starts at 50 and adjusts per evidence, so two people looking at the same server see the same score.

### Why it matters
"Pinned" and "trusted" are doing too much work in MCP discussions. The score decomposes trust into factors you can read, challenge, and gate on.

### How it works
Positive factors raise the score; penalties lower it. The model rewards verifiability (digests, hashes, HTTPS, streamable-http) and penalizes mutability, missing metadata, and insecure remotes.

### Snippet
```
github@1.2.3
  base                          50
  repository present             +8
  namespaced name                +6
  supported package type         +5
  pinned version                 +5
  OCI digest                     +8
  HTTPS remote                   +6
  streamable-http                +4
  ─────────────────────────────────
  trust score                   92
```

### Proof points
- Rewards: repo (+8), namespaced (+6), supported type (+5), strong OCI/MCPB (+4), pinned (+5), OCI digest (+8), MCPB fileSha256 (+8), HTTPS (+6), streamable-http (+4).
- Penalizes: no install target (−35), missing repo (−8), unsupported type (−8), unpinned (−6), mutable OCI tag (−10), missing MCPB hash (−12), secrets required (−6), legacy SSE (−4), insecure/invalid remote (−15).
- Base 50 — every server earns or loses trust from a neutral midpoint.
- Fully deterministic; no machine learning, no heuristics that can't be audited.
- Composes with policy gates (see `/features/policy-gate`).

### Limitations / what it's not
The score measures **verifiability**, not "is this server safe to run." A malicious server can still score well if it pins a digest and ships a manifest. Use the score as a floor, not a verdict.

### Related links
- `/features/policy-gate` — enforce `minTrustScore`
- `/features/capability-manifests` — what the score rewards

---

## Verification & Capability Manifests

**URL slug:** `/features/capability-manifests`
**Page title:** Know What A Server Can Do — Before It Does It

### Hero
**Headline:** Derive the surface. Verify the surface. Pin the surface.
**Subhead:** ToolPin derives a capability manifest, surfaces registry attestations, rejects mutable and unhashed targets, and optionally live-probes tool descriptions.

### What it is
A verification pipeline that turns a server into a pinned, reviewable capability manifest before it ever touches your agent.

### Why it matters
Agents act on tools. If the tool set changes unnoticed, your agent's behavior changes unnoticed. Verification makes the capability surface a first-class, pinned artifact.

### How it works
ToolPin derives the manifest, surfaces any registry attestations, rejects mutable OCI targets and MCPB without `fileSha256`, and optionally runs a live `tools/list` probe to pin remote tool-description hashes. `install --verify` persists the manifest so future drift is detectable.

### Snippet
```json
{
  "capabilityManifest": {
    "tools": [
      { "name": "search_repos", "descriptionHash": "sha256:1a2b..." },
      { "name": "create_issue", "descriptionHash": "sha256:3c4d..." }
    ]
  }
}
```

### Proof points
- Rejects mutable OCI targets outright.
- Rejects MCPB packages lacking `fileSha256`.
- Optional live `tools/list` probe pins remote tool-description hashes.
- Advisory scans (agent-directed instructions, hidden/control chars, duplicate tool names, cross-tool instructions) are **warnings**, not blockers.
- `install --verify` persists the manifest for CI drift detection.

### Limitations / what it's not
Advisory tool-description scans are **not** prompt-injection detection. They flag patterns humans should review; they do not classify intent. Anyone claiming "prompt-injection blocking" is overselling.

### Related links
- `/features/trust-score` — scoring rewards these verifications
- `/features/lockfile` — manifest is pinned in the lockfile

---

## CI Drift Detection & GitHub Action

**URL slug:** `/features/ci-drift`
**Page title:** Drift Dies In CI

### Hero
**Headline:** If the lockfile is a fact, CI is the courtroom.
**Subhead:** `toolpin ci --live` re-resolves, verifies integrity, rejects drift, and never mutates — wired into a first-party GitHub Action.

### What it is
A read-only CI mode plus a maintained GitHub Action that runs the same checks developers run locally.

### Why it matters
A lockfile only protects you if something enforces it. CI is where "it built locally" meets "it shipped to prod."

### How it works
The action wraps `toolpin ci` with typed inputs. Failures block merges; nothing is rewritten silently. Live verification re-contacts registries on each run for freshness.

### Snippet
```yaml
- uses: proofofwork-agency/toolpin@v0.1.0
  with:
    live: "true"
    file: mcp-lock.json
    verify: "true"
    expect-digest: ${{ vars.TOOLPIN_LOCK_DIGEST }}
    signature: ${{ secrets.TOOLPIN_LOCK_SIG }}
    public-key: ${{ secrets.TOOLPIN_PUBLIC_KEY }}
    policy: .toolpin/policy.json
    timeout: 120
    toolpin-version: "0.x"
    working-directory: .
```

### Proof points
- Action inputs: `live`, `file`, `source`, `verify`, `expect-digest`, `signature`, `public-key`, `policy`, `no-policy`, `timeout`, `skip-live-verification`, `toolpin-version`, `working-directory`.
- `toolpin ci` never mutates the lockfile — it can only pass or fail.
- `--live` re-resolves against registries for drift that survives pinned digests.
- Composes with signature, digest, and policy gates in one step.

### Limitations / what it's not
CI can only check what's checked in. A server installed outside ToolPin, or a config hand-edited after generation, is invisible to the lockfile.

### Related links
- `/features/lockfile` — what CI verifies
- `/features/policy-gate` — policy as a CI gate
- `/features/lockfile-signing` — signatures in CI

---

## Local Policy Gate (`.toolpin/policy.json`)

**URL slug:** `/features/policy-gate`
**Page title:** Policy As A File, Not A Feeling

### Hero
**Headline:** Codify "what we allow" once. Enforce it everywhere.
**Subhead:** A single checked-in policy gates installs, CI, and the TUI on trust score, sources, clients, package types, transports, and remotes.

### What it is
A declarative allow/deny policy file that ToolPin reads on install, `ci`, `policy check`, and inside the TUI.

### Why it matters
Teams need a shared floor: minimum trust, approved registries, banned transports. A file you can review in a PR beats a wiki page no one reads.

### How it works
Policy keys are strictly validated — unknown keys are rejected, not ignored. Deny rules win over allow rules; exact-host matching includes ports.

### Snippet
```json
{
  "minTrustScore": 80,
  "allowedSources": ["official", "docker"],
  "deniedClients": ["generic"],
  "deniedTransports": ["sse"],
  "deniedRemoteHosts": ["example.evil:443"],
  "requireDigestPinnedOci": true,
  "requireMcpbSha256": true
}
```

### Proof points
- Supports `minTrustScore` (0–100), `allowed/deniedSources`, `allowed/deniedClients`, `deniedServers`, `deniedPackageTypes`, `deniedTransports`, `deniedRemoteHosts`, `requireDigestPinnedOci`, `requireMcpbSha256`.
- Unknown keys are **rejected** — typos fail loudly.
- Enforced on install, `ci`, `policy check`, and TUI.
- `deniedRemoteHosts` matches exact host including port.
- `--no-policy` exists for explicit, auditable opt-out in CI.

### Limitations / what it's not
Policy is advisory-by-default enforced — it blocks ToolPin's own operations, not the agent at runtime. A server that passes policy can still do harm once it runs. Defense in depth still applies.

### Related links
- `/features/trust-score` — what `minTrustScore` reads
- `/features/ci-drift` — policy as a CI gate

---

## Secret Hygiene Audit

**URL slug:** `/features/secret-audit`
**Page title:** Catch Leaked Tokens Before The Agent Does

### Hero
**Headline:** Plaintext tokens in MCP config are an incident waiting to happen.
**Subhead:** A read-only audit flags secret-expected fields that look like raw tokens instead of placeholders or secret-store references — and never prints your secrets.

### What it is
An advisory scanner that recognizes placeholder syntaxes and known token prefixes, then warns when a value looks like a live secret.

### Why it matters
MCP configs ship to repos and CI logs. A leaked GitHub or OpenAI key in `env` is the most preventable breach in this stack.

### How it works
ToolPin compares secret-expected fields against a placeholder vocabulary and known token prefixes. Anything that matches neither is flagged. Output never echoes raw values.

### Snippet
```
config.yaml — env.GITHUB_TOKEN
  ⚠ looks like a raw secret, expected a placeholder or store ref
  ✓ accepted: ${GITHUB_TOKEN} | op:// | vault:// | doppler://
  ✓ prefixes detected: github_pat_, sk-, AKIA, xoxb-, AIza
```

### Proof points
- Recognized placeholders: `<TOKEN>`, `${env:TOKEN}`, `${TOKEN}`, `${{ secrets.TOKEN }}`, `op://`, `vault://`, `doppler://`.
- Recognized prefixes: GitHub, OpenAI, AWS, Slack, Google, PEM.
- Read-only and advisory — never mutates config.
- Never prints raw secret values in any output.
- Flags both "plaintext-looking" values and known token prefixes.

### Limitations / what it's not
This is hygiene, not a secret scanner like TruffleHog. It will not enumerate every provider's token format, and it cannot prove a value is a secret — only that it looks like one.

### Related links
- `/features/client-config` — where secrets live
- `/features/policy-gate` — combine with deny rules

---

## Ed25519 Lockfile Signing

**URL slug:** `/features/lockfile-signing`
**Page title:** Sign The Lockfile. Verify The Lockfile.

### Hero
**Headline:** Digests prove what shipped. Signatures prove who shipped it.
**Subhead:** Ed25519 signing and verification for `mcp-lock.json`, with fail-closed CI checks that run before registry resolution.

### What it is
A bring-your-own-key signing flow: you sign, CI verifies, and ToolPin never touches your private key.

### Why it matters
A digest from a trusted source is strong; a signature binds that digest to an identity and protects the verification channel itself.

### How it works
`lock sign --key` produces a signature; `verify-signature --key` checks it; `ci --signature --public-key` fails closed **before** any registry resolution, so a missing or bad signature short-circuits the run.

### Snippet
```bash
toolpin lock sign --key ed25519.key
toolpin ci --signature sig.json --public-key ed25519.pub
```

### Proof points
- `lock sign --key`, `verify-signature --key`, `ci --signature --public-key`.
- Signature verification runs **before** registry resolution — fail-closed by construction.
- Ed25519 — small keys, fast verification, well-supported.
- ToolPin **never** generates or stores your keys.

### Limitations / what it's not
ToolPin is not a KMS, not a key manager, and will not generate keys for you. Lose your private key and you lose the ability to sign; ToolPin cannot recover it.

### Related links
- `/features/lockfile` — what gets signed
- `/features/ci-drift` — signatures in CI

---

## Full-Screen TUI

**URL slug:** `/features/tui`
**Page title:** A Terminal You Can Actually Drive

### Hero
**Headline:** Browse, install, govern — without leaving the terminal.
**Subhead:** An Ink/React full-screen TUI with Browse, Installed, Overview, Install, Config, and Help panels, full hotkey and mouse support, and the installed-server lifecycle one keystroke away.

### What it is
The interactive surface for everything ToolPin does non-interactively on the CLI.

### Why it matters
Not every workflow is a one-liner. Exploring registries, reviewing installed drift, running a doctor check, or testing a server benefits from a real UI — in the terminal where you already work.

### How it works
Built on Ink/React, the TUI exposes panels for browsing, installed servers, an overview, install flow, generated config, and help. Hotkeys and mouse both work. Installed servers expose drift, doctor, update, remove, and test actions inline.

### Snippet
```
┌ Installed ─────────────────────────────────────────┐
│ github:claude      1.2.3   ✓ locked   score 92     │
│ filesystem:cursor  0.5.1   ⚠ drift     score 78     │
│                                                    │
│ [u] update  [r] remove  [t] test  [d] doctor       │
└────────────────────────────────────────────────────┘
```

### Proof points
- Panels: Browse, Installed, Overview, Install, Config, Help.
- Full hotkey and mouse support.
- Installed lifecycle inline: drift, doctor, update, remove, test.
- Policy is enforced inside the TUI, not bypassed by it.
- Shares the same engine as the CLI — no second code path.

### Limitations / what it's not
The TUI is a convenience layer, not a sandbox. Running a server under "test" still runs the server; the TUI cannot contain a malicious tool.

### Related links
- `/features/client-config` — Config panel
- `/features/policy-gate` — enforced in TUI

---

## Versions & Outdated

**URL slug:** `/features/versions`
**Page title:** Know What's Locked, What's Latest, What's Next

### Hero
**Headline:** Stop guessing whether you're on the old version.
**Subhead:** ToolPin shows locked vs. latest, flags updates, and surfaces recent previous versions — so upgrades are a decision, not an accident.

### What it is
A version view that compares the pinned `resolved` target against upstream and shows the recent history.

### Why it matters
With pinning, "outdated" becomes invisible unless something surfaces it. This view turns invisible into actionable.

### How it works
On demand, ToolPin queries the source, compares against the lockfile, marks `update-available`, and lists recent previous versions for context.

### Snippet
```
github (claude)
  locked:    1.2.3
  latest:    1.3.0   ⬆ update available
  previous:  1.2.2, 1.2.1, 1.2.0, 1.1.4
```

### Proof points
- Locked vs. latest comparison, sourced from the same resolver as install.
- Explicit `update-available` flag.
- Recent previous versions for upgrade/downgrade decisions.
- Updates flow through `toolpin lock` / `--update-lock` — never silent.
- Version changes are drift until explicitly accepted.

### Limitations / what it's not
"Latest" reflects the registry at query time. A registry that yanks or republishes versions can still shift the picture; pinning is your anchor, not the registry.

### Related links
- `/features/lockfile` — version is part of the lock
- `/features/ci-drift` — version change is drift

---
# 06 — How It Works

The **workflow narrative + lifecycle** for the *How it works* page: one loop, seven steps, two entry points (CLI + TUI), one ending — a committed `mcp-lock.json` that fails CI on drift. Voice: precise, dry, anti-hype. Tokens: JetBrains Mono (commands/JSON), Inter (prose); brand tokens from §02/§09 — primary Provenance Blue `#1C4FD6`, accent Pin Teal `#0E9F8E`; dark-mode-first per §09.

---

## 1. The Review Loop

The README frames the whole product as one loop: **inspect what will run → write the exact client config → commit a lockfile → fail CI on drift → re-review → update the lock.** The page should open on this loop as the hero visual.

**Visual concept — a closed ring of four nodes with one feedback arrow:**

```
        ┌───────────────────────────────────────────────────────┐
        │                                                       ▼
  [1 INSPECT] ──► [2 WRITE CONFIG] ──► [3 COMMIT LOCK] ──► [4 CI GATE]
  audit/verify      install           mcp-lock.json        toolpin ci
  plan              .mcp.json         git commit           fail on drift
        ▲                                                       │
        └─────────── drift detected? re-review + --update-lock ──┘
```

- **Node 1 — Inspect:** `audit`, `verify`, `plan`. Nothing is written yet.
- **Node 2 — Write config:** `install` generates the exact client config and the lock entry in one atomic step.
- **Node 3 — Commit lock:** `git add mcp-lock.json` — the artifact teammates and CI inherit.
- **Node 4 — CI gate:** `toolpin ci` re-resolves, verifies integrity, rejects drift, **never mutates**.
- **Feedback arrow:** when CI finds drift it does not "fix" anything — it sends the human back to Node 1 to re-review, then `--update-lock`.

**Designer note:** the feedback arrow is the soul of the loop — render it dashed/orange, distinct from the forward arrows. It reads as *the system refusing to drift silently*.

---

## 2. Step-by-step narrative

Seven steps, each rendered as a card: **what you do → what happens → artifact → visual.**

### Step 1 — Discover
**Command:** `toolpin search <query> --source all --live` · `toolpin info <server>` · `toolpin ingest`
**What happens:** pulls from the official MCP Registry, Docker MCP Catalog, and any custom `.toolpin/registries.json`, caching to `.toolpin/registry-cache.json`.
**Artifact:** local registry cache.
**Visual:** terminal snippet — `toolpin search github --source all --live`.

### Step 2 — Assess trust
**Commands:** `toolpin audit <server>` (trust 0–100, base 50 + factors) · `toolpin verify <server>`
**What happens:** `verify` reads capability manifest + attestations, rejects mutable OCI and MCPB without `fileSha256`, optionally probes live `tools/list` pinning tool-description hashes, and emits advisory scans.
**Artifact:** trust score + capability manifest.
**Visual:** trust-score gauge (Visual 4).

### Step 3 — Plan (review before write)
**Command:** `toolpin plan <server> --client claude --live`
**What happens:** shows the full install plan — `original` / `resolved` / `locked` — before a byte is written.
**Artifact:** a reviewable plan, not yet committed.
**Visual:** side-by-side card: intent vs. resolution.

### Step 4 — Install + lock
**Command:** `toolpin install <server> --client claude --scope project --live --verify --update-lock`
**What happens:** one command writes the correct client config (`.mcp.json` for Claude project) **and** commits `mcp-lock.json` v2 — keyed by `server:client`, with integrity `sha256-...` and the capability manifest embedded.
**Artifact:** `.mcp.json` + `mcp-lock.json`.
**Visual:** lockfile anatomy (Visual 2).

### Step 5 — Commit
**Command:** `git add mcp-lock.json && git commit`
**What happens:** the lockfile becomes the shared source of truth. Teammates and CI inherit exactly this resolution.
**Artifact:** a git revision of the lockfile.
**Visual:** git log row snapping a green pin next to `mcp-lock.json`.

### Step 6 — CI gate
**Command:** `toolpin ci --live` (or the GitHub Action)
**What happens:** every entry is re-resolved and lock integrity is verified; drift on **version, target, config, capability, or trust** fails the build. Optional flags: `--expect-digest`, `--signature` / `--public-key`, `--policy`. The command is read-only — it never writes.
**Artifact:** a green or red check.
**Visual:** CI drift diff (see Visual 3).

### Step 7 — Maintain
**Commands:** `toolpin doctor` (lock↔config reconciliation) · `toolpin outdated` / `toolpin versions` · `toolpin list` · `toolpin remove` / `uninstall` · `toolpin secrets audit`
**What happens:** detect skew, see what's stale, inventory installs, audit secrets, uninstall cleanly.
**Artifact:** updated lockfile or a clean removal.
**Visual:** lifecycle strip — health → outdated → remove.

---

## 3. Two paths, one lockfile

Both paths end at the same `mcp-lock.json`. Show them as two parallel rails converging on one lockfile icon.

**(a) CLI path** — the seven commands above, in order. Power-user fast path; scriptable; CI-native.

**(b) TUI path** — `npm run tui` opens a terminal UI with panels:

| TUI panel | Replaces (CLI) | Outcome |
|---|---|---|
| **Browse / Search** | `toolpin search` | pick a server |
| **Overview** | `toolpin info` / `audit` / `verify` | trust score, capabilities, attestations |
| **Install** | `toolpin plan` + `install` | choose scope + client → writes config + lock |
| **Installed** | `doctor` / `update` / `remove` / `test` | ongoing lifecycle per server |

**Visual concept:** two rails (CLI glyphs left, TUI panels right) each walking Discover → Assess → Install, funneling into one highlighted `mcp-lock.json` card. Caption: *"Same artifact. Pick your surface."*

---

## 4. The CI lifecycle (mini-sequence)

A four-beat horizontal sequence under the loop:

1. **PR opened** — teammate changes a client config, bumps a version, or the upstream registry ships a new digest.
2. **Action runs** — the ToolPin GitHub Action invokes `toolpin ci --live` on every entry.
3. **Green** — every re-resolved entry matches lock integrity, capability manifest, tool-description hashes, and trust floor. Nothing was written.
4. **Red on drift** — `toolpin ci` prints the offending diff: *version 1.2.3 → 1.2.4*, *target changed*, *generated config differs*, *capability manifest grew (new tool `delete_repo`)*, or *trust dropped 87 → 71*. The fix is always human: re-review → `--update-lock`.

**Visual concept (Visual 3):** a GitHub check row, green on top, red below, with the red one expanded into an annotated diff explaining *what* drifted and *why* the gate refused.

---

## 5. Policy gate insertion point

`.toolpin/policy.json` is the declarative fence. Show it as a gate symbol overlaid at four enforcement points:

- **At install** — `toolpin install --policy` refuses to write config/lock for a server violating trust floor, capability allow/deny list, or client/scope rules.
- **At CI** — `toolpin ci --policy` re-evaluates every entry against policy, in addition to integrity.
- **At explicit check** — `toolpin policy check` validates a lockfile against policy without touching the network.
- **In the TUI** — Install panel shows the policy verdict inline before the install button activates.

**Designer note:** render `.toolpin/policy.json` as a thin orange gate straddling the Node 1 → Node 2 arrow and again at Node 4.

---

## 6. Suggested visuals (numbered)

1. **Review-loop ring** — the four-node loop + feedback arrow (hero of the page).
2. **Lockfile anatomy** — annotated `mcp-lock.json` v2: `server:client` key, `original`/`resolved`/`locked`, `capabilityManifest`, `sha256-...` integrity — callouts pointing at each field.
3. **CI drift diff** — green ✓ check vs. red ✗ check with an expanded diff explaining the refusal.
4. **Trust-score gauge** — semicircle 0–100, base 50, factors as weighted ticks; amber below threshold, lock-green above.
5. **Client fan-out tree** — one `toolpin install` branching to 12 client configs (`.mcp.json`, Cursor, VS Code, Codex, OpenCode, …), each leaf labeled.
6. **Two-rails-to-one-lockfile** — CLI rail + TUI rail converging on a single lockfile card.
7. **Policy gate overlay** — orange gate straddling install and CI arrows.

---

## 7. Worked example — GitHub MCP server

A single end-to-end trace the page can animate. Server: `io.github.github/github-mcp-server`, client: Claude, scope: project.

```bash
# 1. Discover
toolpin search github --source all --live
toolpin info io.github.github/github-mcp-server

# 2. Assess trust
toolpin audit  io.github.github/github-mcp-server   # → trust 87/100
toolpin verify io.github.github/github-mcp-server   # → capability manifest + attestations

# 3. Plan (review before write)
toolpin plan io.github.github/github-mcp-server --client claude --live

# 4. Install + lock (one command, two artifacts)
toolpin install io.github.github/github-mcp-server \
  --client claude --scope project --live --verify --update-lock
# → writes .mcp.json  AND  mcp-lock.json entry "github:claude"

# 5. Commit
git add mcp-lock.json .mcp.json && git commit -m "pin github mcp @1.2.3"

# 6. CI gate (on every PR)
toolpin ci --live    # re-resolves, verifies integrity, rejects drift, never mutates

# 7. Maintain
toolpin doctor        # lock ↔ .mcp.json reconciliation
toolpin outdated      # is 1.2.3 still latest?
toolpin secrets audit # are credentials scoped correctly?
```

The lockfile entry this produces:

```json
{
  "lockfileVersion": 2,
  "servers": {
    "io.github.github/github-mcp-server:claude": {
      "original":  { "name": "io.github.github/github-mcp-server", "version": "0.1.0" },
      "resolved":  { "source": "official", "version": "0.1.0" },
      "locked":    { "selectedTarget": { "kind": "package", "registryType": "oci",
                       "identifier": "ghcr.io/github/github-mcp-server:0.1.0" } },
      "trust":              { "score": 87, "badges": ["pinned version", "https remote"], "issues": [] },
      "capabilityManifest": { "packageTypes": ["oci"], "transports": ["stdio"] },
      "integrity": "sha256-<base64>"
    }
  }
}
```

**Caption for the designer:** the trace the hero terminal should replay on loop — search → audit (gauge fills to 87) → plan → install (`.mcp.json` + `mcp-lock.json` snap in) → `toolpin ci` stamps green ✓. Next iteration, inject one red frame (upstream ships `1.2.4`, manifest gains `delete_repo`) to show the gate refusing — then resolve back to green via `--update-lock`. *That* is the loop.
# 07 — Comparison & Security

## Does this already exist?

Parts of it exist. The combined workflow is the point.

The MCP ecosystem has solved a lot in a short time: discovery, hosting, runtime isolation, client-native settings. ToolPin doesn't compete with any of those layers — it sits *in between*, at the repo, where install plans get reviewed, locked, and enforced before any agent ever runs. That seam is currently unowned, and it's where drift, unreviewed diffs, and "works on my machine" configs quietly accumulate.

This page is meant to be read honestly. If another tool already gives your team neutral multi-client config, install-time review, an enforcing lockfile, and CI drift detection, you should use it.

### Comparison matrix

| Capability | Registries / catalogs¹ | Marketplaces / installers² | Runtime gateways³ | Client-native settings⁴ | **ToolPin** |
|---|:---:|:---:|:---:|:---:|:---:|
| Discovery | ✓ | ✓ | partial | ✗ | partial |
| Easy install | ✗ | ✓ | partial | ✓ | ✓ |
| Runtime control (isolation / auth / ACLs / observability) | ✗ | ✗ | ✓ | partial⁵ | ✗ |
| Neutral, multi-client config | ✗ | ✗ | partial | ✗ | ✓ |
| Repo-owned, enforcing lockfile | ✗ | ✗ | ✗ | ✗ | ✓ |
| CI drift detection | ✗ | ✗ | partial | ✗ | ✓ |
| Local policy gate (before install) | ✗ | ✗ | partial | ✗ | ✓ |

¹ *Official MCP Registry, PulseMCP, Glama* — do discovery + metadata well.
² *Smithery, MCP installers* — easy install + distribution.
³ *Docker MCP Toolkit/Governance, Glama Gateway, Stacklok ToolHive, security vendors* — runtime isolation, auth, ACLs, observability, enterprise features.
⁴ *Claude, Cursor, VS Code, Codex, OpenCode, …* — native runtime integration per client.
⁵ Client-native settings control *what runs*, but only inside that one client.

Cells are marked honestly: **✓** = first-class, **partial** = supported in a limited or client-specific way, **✗** = out of scope. Competitors deserve real credit here — the runtime gateways in particular do hard, valuable work that ToolPin explicitly does not try to reproduce.

## Why ToolPin exists

Most of the stack is covered. Discovery is covered. Hosting and distribution are covered. Runtime sandboxing, auth, and audit are covered — by tools with far more resources than ToolPin has.

What isn't covered is the boring middle: **the repo.** When a teammate adds an MCP server on Tuesday, who reviews the tool descriptions? Who notices when upstream bumps a version on Thursday and the diff now exposes a new tool with broad filesystem access? Who reproduces the exact same install across Claude, Cursor, and Codex on a fresh laptop?

ToolPin exists to own that seam. It produces one reviewed install plan, one committed lockfile, and one set of CI checks — then generates per-client configs from that single source of truth. It's a **local, portable, repo-owned install artifact** that works *before* runtime and *inside* CI, not a replacement for the runtime controls you already trust.

## When to use ToolPin — and when not to

**Use ToolPin if:**
- You commit MCP configs to a repo and want them reviewed like code.
- You run more than one agent client and are tired of per-client config drift.
- You want CI to fail when an MCP server's declared capabilities change.
- You want a gate that runs *before* install, not just *during* runtime.

**Don't use ToolPin if:**
- You only ever use one client and its native settings are enough.
- You need runtime sandboxing, network ACLs, or auth brokering — that's a gateway's job, not ours.
- You want the largest catalog of MCP servers — we are not and will not be that.
- You're looking for prompt-injection detection. We can't do that and won't claim to.

## Security & trust

### Trust score (0–100)

A per-server score summarizing signals we can actually verify — see the feature page (section 05) for the full breakdown. In short, it weighs things like declared capabilities, signing status, changelog/policy presence, and advisory-scan findings.

What it measures: how much *repo-level* risk a server's declared surface adds at install time.
What it does **not** measure: runtime behavior, prompt-injection resistance, or whether a server is "safe." A high score is not an endorsement; a low score is not a verdict. It's one input to a human review.

### Verification & capability manifests

Each install plan records what a server *declares* it can do (capabilities) and what we could *verify* (signatures, manifest presence, policy docs). The two are kept distinct on purpose — "declared" and "verified" are different claims and we never blur them.

### Fail-closed philosophy

ToolPin fails closed rather than guess. If something required for a decision is missing or ambiguous — a signature, a manifest, a policy — the operation stops and says so. It will not silently downgrade to an unsafe path to keep moving.

### Advisory tool-description scans

Tool descriptions influence agent behavior, so ToolPin treats them as security-sensitive and runs **advisory** scans for suspicious patterns (e.g. instructions that look like they're targeting the agent rather than describing the tool).

Honest disclaimer: these scans are **not** prompt-injection detection, **not** sandboxing, and **not** an install blocker. They flag patterns for human review. They will miss things. They will also false-positive. They are one signal, not a guarantee.

### Ed25519 signing

Install plans support detached Ed25519 signatures. Verification fails closed **before** registry resolution — if a signature is required and missing or invalid, ToolPin won't even look up the package. ToolPin itself never generates, stores, or holds signing keys; that's the operator's responsibility.

### Secret hygiene audit (read-only)

`toolpin` can audit a repo for secrets that would leak into generated client configs. The audit is **read-only and advisory**: it never prints raw secret material, and it cannot rotate, broker, or replace anything. Real secret brokering is a future, design-gated feature — not something we'll bolt on.

### Threat model

Full threat model lives with the source. The short version: ToolPin is an install-time and CI-time governance tool. It is not a runtime sandbox, not a secret vault, and not a provenance/identity system (no sigstore, no SLSA provenance).

## What ToolPin is NOT

- Not the largest MCP catalog — and not trying to be.
- Not a hosted gateway or SaaS.
- Not a runtime sandbox, ACL engine, or auth broker.
- Not prompt-injection detection.
- Not a secret vault or secret broker (audit is read-only; brokering is future work).
- Not provenance or sigstore (we sign plans, we don't attest supply chains).

## Trust signals

- **Apache-2.0**, open source.
- **Node 22+** — no unsupported runtimes.
- **Fails closed** at every decision point where evidence is missing.
- **Read-only** secret audit; raw secrets are never printed.
- **No telemetry claims made here** — if we ever add opt-in telemetry, it will be off by default and documented. Until then, this line stays neutral rather than promising something we'd have to keep verifying.
# 08 — Docs & Getting Started

Docs are the conversion surface for the technical buyer. They must be the first hit for "install MCP server safely," answer "does this work with my client?" in one table, and hand over a working `mcp-lock.json` in under five minutes. This section specifies the docs information architecture, the Quickstart, the four core reference pages, and the code/callout styling that makes the whole thing scannable.

---

## 1. Quickstart page

**URL slug:** `/docs/quickstart`
**Goal:** fastest path to a committed, verified `mcp-lock.json`.

### Prerequisites

- **Node.js 22+**, `npm`, `git`
- An MCP client ToolPin writes (see the client matrix; Claude is the default example)
- Network access for `--live`; offline installs fall back to the local cache at `.toolpin/registry-cache.json`

### Path A — Published CLI (after first npm release; today use Path B/C)

```bash
$ npm i -g toolpin
$ toolpin --version          # or: tpn -v
$ toolpin plan github --client claude --live
$ toolpin install github \
    --client claude --scope project --live --verify --update-lock
$ toolpin doctor --scope project
$ git add mcp-lock.json && git commit -m "chore: lock MCP servers"
```

`tpn` is the short alias; every command below accepts it. Scope shorthands: `-p` project, `-g` global; `-c` selects the client.

### Path B — Source checkout (pre-publish / contributors)

```bash
$ npm ci
$ npm test
$ node dist/cli.js plan <server> --client claude --live
$ node dist/cli.js install <server> \
    --client claude --scope project --live --verify --update-lock
$ node dist/cli.js doctor --scope project
$ node dist/cli.js ci --live
```

### Path C — Enforce in CI (GitHub Action)

```yaml
# .github/workflows/toolpin.yml
on: [pull_request]
jobs:
  toolpin:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm i -g toolpin
      - run: toolpin ci --live
```

`toolpin ci` re-resolves, verifies integrity, and **rejects drift** — it never mutates the lockfile, so a failing PR forces an intentional `toolpin install ... --update-lock`.

> **Commit `mcp-lock.json`.** It is the contract. Without it in the repo there is nothing to enforce.

---

## 2. Docs IA / sidebar

Mirror the existing `docs/site/` tree. Two levels, collapsible, with search above the list.

- **Introduction** — what ToolPin is, why MCP needs a lockfile, the 3-minute mental model.
- **Quickstart** — the page above.
- **Tutorials**
  - Install your first server
  - Add a second client (fan-out)
  - Take a project from greenfield to signed lockfile
- **Concepts**
  - Trust explained (scores, `official`, `verified`)
  - Threat model (what ToolPin stops, what it doesn't)
  - Comparison (ToolPin vs. hand-editing, vs. plain registry pinning)
- **How-to**
  - Catch drift in CI
  - Use a custom registry (`--source <custom-id>`)
  - Curate a private/curated registry (`toolpin ingest`)
- **Reference**
  - CLI
  - Client matrix
  - Lockfile schema (`mcp-lock.json` v2)
  - Policy schema (fields defined in §05/§07)

---

## 3. CLI reference page

**URL slug:** `/docs/reference/cli`
Short alias `tpn`; global shorthands `-c` client, `-s` scope, `-g` global, `-p` project, plus `--source official|docker|all|<custom-id>`.

### Discovery

| Command | Signature | Purpose |
|---|---|---|
| `ingest` | `toolpin ingest <source>` | Pull a server spec into a curated/private registry |
| `registry list` | `toolpin registry list` | List configured registries and sources |
| `search` | `toolpin search <query>` | Full-text search across registries |
| `info` | `toolpin info <server>` | Show resolved metadata for one server |
| `audit` | `toolpin audit <server>` | Capability + config surface audit |
| `verify` | `toolpin verify <server> [--skip-live-verification\|--skip-live-verify]` | Live-verify integrity; flags skip network |
| `versions` | `toolpin versions <server>` | Available versions and targets |

### Install & lock

| Command | Signature | Purpose |
|---|---|---|
| `list` | `toolpin list [--scope <s>]` | Show installed servers for a scope |
| `plan` | `toolpin plan <server> -c <client> [--live]` | Dry-run: what *would* be installed |
| `install` | `toolpin install <server> -c <client> -s <s> [--live] [--verify [--skip-live-verification\|--skip-live-verify] [--timeout <ms>]] [--update-lock] [--policy\|--no-policy]` | Install + (optionally) verify and update the lockfile |
| `policy check` | `toolpin policy check` | Evaluate current installs against policy |
| `secrets audit` | `toolpin secrets audit` | Scan configs/env for leaked secrets |
| `remove` | `toolpin remove <server> -c <client>` | Remove a server from a client config |
| `uninstall` | `toolpin uninstall <server> [-c <client>]` | Remove server + drop lockfile entry |
| `lock` | `toolpin lock <server> -c <client>` | Re-resolve and update one server/client lock entry |
| `lock digest` | `toolpin lock digest` | Print the whole-lock digest (timestamps excluded) |
| `lock sign` | `toolpin lock sign --key <key>` | Sign the lockfile |
| `lock verify-signature` | `toolpin lock verify-signature --key <key>` | Verify a signature in CI |
| `export-config` | `toolpin export-config -c <client>` | Emit the generated config block |

### CI & health

| Command | Signature | Purpose |
|---|---|---|
| `ci` | `toolpin ci [--live]` | Drift + integrity gate for CI; non-mutating |
| `outdated` | `toolpin outdated` | List servers with newer targets |
| `doctor` | `toolpin doctor [--scope <s>]` | Diagnose client/config/lockfile health |
| `test` | `toolpin test [<server>]` | Smoke-test installed servers |
| `tui` | `toolpin tui` | Interactive terminal dashboard |

---

## 4. Client matrix page

**URL slug:** `/docs/reference/clients`
The highest-intent page. Render as one table, one row per client. "Status" is **verified** (ToolPin writes and reads the file) or **fail-closed** (ToolPin refuses to write that scope).

| Client | Project path | Global path | Root key | Scope behavior | Status |
|---|---|---|---|---|---|
| Claude | `.mcp.json` | *(none)* | `mcpServers` | project only | project verified · global fail-closed |
| Cursor | `.cursor/mcp.json` | `~/.cursor/mcp.json` | `mcpServers` | both | verified |
| VS Code | `.vscode/mcp.json` | `~/.config/Code/User/mcp.json` | `servers` | both | verified |
| Codex | `.codex/config.toml` | `~/.codex/config.toml` | `mcp_servers` (TOML) | both | verified |
| opencode | `opencode.json` | `~/.config/opencode/opencode.json` | `mcp` | both | verified |
| Windsurf | *(none)* | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` | global only | global verified |
| Cline | *(none)* | `~/.cline/mcp.json` | `mcpServers` | global only | global verified |
| Continue | *(none)* | `~/.continue/config.yaml` | `mcpServers` | global only | verified |
| Gemini | `.gemini/settings.json` | `~/.gemini/settings.json` | `mcpServers` | both | verified |
| Zed | *(export-only)* | *(export-only)* | `context_servers` | both fail-closed | export-config only |
| Roo | `.roo/mcp.json` | *(none)* | `mcpServers` | project only | project verified · global fail-closed |
| Generic | `.mcp.json` | `~/.config/toolpin/<client>-mcp.json` | `mcpServers` | project + sidecar | verified |

> When a global path is marked fail-closed, ToolPin prints the exact reason and never partially writes. `--scope` mismatch is a hard error, not a warning.

---

## 5. Lockfile schema reference

**URL slug:** `/docs/reference/lockfile` — `mcp-lock.json`, `lockfileVersion: 2`.

```json
{
  "lockfileVersion": 2,
  "generatedAt": "2025-06-25T12:00:00.000Z",
  "updatedAt": "2025-06-25T12:05:00.000Z",
  "servers": {
    "io.github.github/github-mcp-server:claude": {
      "name": "io.github.github/github-mcp-server",
      "version": "0.1.0",
      "client": "claude",
      "selectedTarget": { "kind": "package", "registryType": "npm",
        "identifier": "@modelcontextprotocol/server-github",
        "version": "0.1.0", "transport": "stdio" },
      "trust": { "score": 87, "badges": ["pinned version", "https remote"], "issues": [] },
      "config": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<GITHUB_PERSONAL_ACCESS_TOKEN>" }
      },
      "capabilityManifest": { "packageTypes": ["npm"], "transports": ["stdio"], "remoteHosts": [] },
      "resolvedAt": "2025-06-25T12:04:00.000Z",
      "lockedAt": "2025-06-25T12:05:00.000Z",
      "original":  { "name": "io.github.github/github-mcp-server", "version": "0.1.0" },
      "resolved":  { "source": "official", "name": "io.github.github/github-mcp-server", "version": "0.1.0" },
      "locked":    { "selectedTarget": { /* …snapshot of selectedTarget… */ } },
      "integrity": "sha256-<base64>"
    }
  }
}
```

Field-by-field:

- **`lockfileVersion`** — schema version. `2` is current; v1 entries must be regenerated (ToolPin fails closed on pre-v2).
- **`generatedAt` / `updatedAt`** — timestamps; **excluded** from integrity and the whole-lock digest so checks are reproducible.
- **`servers`** — map keyed `<serverName>:<client>` (e.g. `io.github.github/github-mcp-server:claude`), so one server can resolve differently per client.
- **`name` / `version` / `client`** — the entry identity.
- **`selectedTarget`** — the normalized launch target: a package (`{kind:"package", registryType, identifier, version, transport}`) or a remote (`{kind:"remote", type, url}`).
- **`trust`** — `{ score (0–100), badges[], issues[] }`.
- **`config`** — the generated client config block written to the client file.
- **`capabilityManifest`** *(optional)* — `{version:1, serverName, serverVersion, registrySource, packageTypes[], transports[], remoteHosts[], secrets[], generatedAt, toolDescriptionHash?, toolDescriptionScan?}`; present after a successful `install --verify`.
- **`resolvedAt` / `lockedAt`** — timestamps; excluded from integrity.
- **`original`** — the registry input (what was requested).
- **`resolved`** — the normalized plan (which source + resolved name/version).
- **`locked`** — the persisted snapshot (`selectedTarget`, `config`, `capabilityManifest`) used for drift comparison.
- **`integrity`** — per-entry `sha256-<base64>` over `name, version, client, selectedTarget, trust, config, capabilityManifest, resolved, original, locked` (excludes timestamps, `notes`, and `integrity` itself). Verified by `toolpin ci`; missing/mismatched integrity is itself drift.

> **Whole-lock digest** is **not** stored in the file — it is computed on demand by `toolpin lock digest` as `sha256-<base64>` over `{lockfileVersion, servers:{key: integrityPayload}}` (timestamps excluded). Use it with `toolpin ci --expect-digest`. It is **not** a signature or sigstore.

---

## 6. Code-block & callout styling

- **Syntax highlighting per language**: `bash`/`sh`, `json`, `yaml`, `toml`. Never render a fenced block without a language tag.
- **Copy button** on every code block, top-right, with a 1.5s "Copied" state.
- **`$` prompt convention**: shell blocks start with `$ ` in a dimmed/muted color; the copy button strips the leading `$ ` so pasted commands run as-is. Continuation lines use `\ ` and are never prefixed.
- **Annotations**: inline `# comment` for bash; for JSON/YAML use a fenced block followed by a list, never inline JSON comments.
- **Callouts** — four types, each a left-border color + icon, no heavy fill:
  - 📘 **Note** (blue) — context, defaults.
  - 💡 **Tip** (green) — faster / better path.
  - ⚠️ **Warning** (amber) — destructive or fail-closed behavior.
  - 🔴 **Danger** (red) — secret exposure, irreversible.

---

## 7. Common recipes (5)

### R1 — Install the GitHub MCP server into Claude (project)

```bash
$ toolpin install github \
    --client claude --scope project --live --verify --update-lock
```

Writes `.mcp.json` (root `mcpServers`) and adds a `github:claude` entry to `mcp-lock.json`.

### R2 — Fan out one server to every client

```bash
$ for c in claude cursor vscode codex opencode gemini; do
    toolpin install github -c "$c" --scope project --live --update-lock
  done
```

Each `<server>:<client>` key is independent; the same server can land in 6 config files with one loop.

### R3 — Enforce a minimum trust score (policy)

```bash
$ toolpin install <server> -c claude --scope project --policy   # honors policy
$ toolpin install <server> -c claude --scope project --no-policy # one-time bypass
$ toolpin policy check
```

Policy schema fields are specified in §05/§07; `--policy` is on by default, `--no-policy` is the explicit escape hatch.

### R4 — Sign and verify the lockfile in CI

```bash
# maintainer, locally:
$ toolpin lock sign --key "$TOOLPIN_SIGNING_KEY"
# CI, on every PR:
$ toolpin lock verify-signature --key "$TOOLPIN_SIGNING_KEY"
$ toolpin ci --live
```

`lock digest` excludes timestamps, so a re-sign after a clean re-resolve produces the same signature.

### R5 — Audit installed configs for leaked secrets

```bash
$ toolpin secrets audit
$ toolpin audit <server>
```

`secrets audit` scans every generated config and env block across all clients; `audit <server>` reports the capability surface for a single server before you install it.
# 09 — Design System & Components

This section specifies the concrete design system the marketing site must be built on. Reference section 02 for brand rationale; here we give builders tokens and component contracts they can implement directly. The aesthetic is terminal-forward, artifact-led, and quietly credible — every surface should feel like `npm`/`cargo` internals, not a SaaS landing page.

---

## 1. Design Tokens

Tokens are emitted as CSS custom properties on `:root` and overridden under `[data-theme="dark"]`. Dark mode is the **default** (see §6). All color pairs meet WCAG AA per section 02.

### 1.1 Color

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--tp-bg` | `#FFFFFF` | `#0B1120` | Page background |
| `--tp-surface` | `#F6F8FA` | `#111A2E` | Cards, code blocks, sidebar |
| `--tp-surface-elevated` | `#EEF2F6` | `#16203A` | Modals, popovers, sticky headers |
| `--tp-primary` | `#1C4FD6` | `#3B82F6` | Primary CTA, links, active nav |
| `--tp-primary-hover` | `#1740B0` | `#60A5FA` | Primary hover |
| `--tp-accent` | `#0E9F8E` | `#2DD4BF` | "Pinned/verified" accent, success-adjacent |
| `--tp-violet` | `#6D28D9` | `#8B5CF6` | Governance-only features (sparingly) |
| `--tp-success` | `#15803D` | `#22C55E` | Green check, `+` diff, gauge green band |
| `--tp-warning` | `#B45309` | `#F59E0B` | Amber band, drift warning |
| `--tp-danger` | `#C81E1E` | `#F87171` | Red band, gate-fail, `−` diff |
| `--tp-text` | `#0E1726` | `#E6ECF5` | Body text |
| `--tp-muted` | `#5A6677` | `#94A3B8` | Secondary text, captions |
| `--tp-border` | `#D9DEE5` | `#243049` | Hairlines, table rows |
| `--tp-border-strong` | `#B8C0CC` | `#33415C` | Focus-adjacent, active edges |
| `--tp-code-bg` | `#F6F8FA` | `#0E1726` | Inline code, terminal |
| `--tp-diff-add-bg` | `#DCFCE740` | `#16653433` | `+` line gutter |
| `--tp-diff-del-bg` | `#FEE2E240` | `#991B1B33` | `−` line gutter |

Alias semantic tokens (`--tp-cta`, `--tp-link`) onto the above so themes swap in one place.

### 1.2 Spacing, Radius, Shadow, Z-index

Spacing scale (rem): `2xs .25 / xs .5 / sm .75 / md 1 / lg 1.5 / xl 2 / 2xl 3 / 3xl 4`. Base unit **4px**; only scale steps are legal.

Radius: `--tp-r-sm 4px` (chips, inputs) · `--tp-r-md 8px` (cards, code, client chips) · `--tp-r-lg 16px` (hero panels) · `--tp-r-pill 999px` (badges, toggle).

Shadow/elevation:
- `--tp-shadow-1`: `0 1px 2px rgba(14,23,38,.06)` — resting cards
- `--tp-shadow-2`: `0 4px 12px rgba(14,23,38,.08)` — hover lift
- `--tp-shadow-3`: `0 12px 32px rgba(14,23,38,.12)` — modals/dropdowns

Z-index layers: `base 0 · sticky 100 · dropdown 200 · nav 300 · drawer 400 · modal 500 · toast 600`.

### 1.3 Type tokens

Use section 02 scale. Map to tokens: `--tp-font-sans: Inter, -apple-system, system-ui, sans-serif`; `--tp-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`. Code/tab-size: 2. Headings tracking −0.01em.

---

## 2. Layout & Grid

- **Max content width:** `--tp-maxw: 1200px`, centered, `padding-inline: clamp(16px, 5vw, 48px)`.
- **Docs reading width:** `760px` for prose columns; code blocks may bleed to content width.
- **Grid:** 12-col, `gap 24px`; collapse to 6-col at md, 4-col at sm.
- **Section rhythm:** `padding-block: clamp(48px, 8vw, 96px)`; nested element vertical rhythm uses the spacing scale (stacks of 8/12/16).
- **Sticky nav:** `position: sticky; top:0; z-index:300; height 56px; backdrop-filter: blur(8px)` over `--tp-surface-elevated/90`.
- **Docs sidebar:** sticky `top: 72px`, width `280px`, scrolls independently (`overflow-y:auto; max-height: calc(100vh - 72px)`).
- **Docs layout:** sidebar (280) + content (flex) + right TOC (240, hidden below lg).

---

## 3. Component Inventory

### 3.1 Button
Variants: `primary` (filled `--tp-primary`, white text), `secondary` (transparent, `1px solid --tp-border-strong`, token text), `ghost` (no border, hover `--tp-surface`), `danger` (filled `--tp-danger`). Sizes: `sm` (h32, px12, font14), `md` (h40, px16), `lg` (h48, px20, font16). States: hover (darken/`--tp-primary-hover`), focus-visible (`2px` ring `--tp-primary` at `2px` offset), active (translateY 1px), disabled (opacity .5, `cursor:not-allowed`, no hover), loading (spinner replaces label, button non-interactive). Icon-leading optional (16px Lucide). Mono variant for "copy command" affordance.

### 3.2 Code Block / Terminal
The hero component. Anatomy: header bar (`--tp-surface-elevated`, h36) with **language tabs** (JSON/TOML/YAML/Bash, mono, active underline `--tp-primary`) on the left and a **Copy** icon-button on the right; optional filename label (mono, muted, e.g. `mcp-lock.json`). Body: `--tp-code-bg`, `padding 16px`, mono 13–14px, `line-height 1.6`, optional line-number gutter (muted, right-aligned, non-selectable). CLI commands render with a `$` prompt in `--tp-accent` bold, command in `--tp-text`. **Annotations:** numbered pins (① ②) in left margin that map to a callout list beneath. **Diff mode:** gutter column + line bg `--tp-diff-add-bg`/`--tp-diff-del-bg`, `+`/`−` prefix in success/danger. Copy button shows "Copied!" check for 1.5s.

### 3.3 CLI Command Reference Row
A docs primitive: one row per command. Layout: `[ command (mono, copyable, `$ tpn add ...`) ] | [ flags (badges) ] | [ one-line description ]`. Hover reveals full-height copy affordance; click row expands to a full code-block example. Sticky group headers by namespace (`add`, `audit`, `lock`, `verify`).

### 3.4 Trust-Score Gauge
Circular or horizontal meter, 0–100. **Bands:** 0–39 red (`--tp-danger`), 40–69 amber (`--tp-warning`), 70–100 green (`--tp-success`). Display: large mono number (24px, 600) + band label ("Elevated risk" / "Review" / "Low risk") in matching color. Fill animates on scroll-in (§4). **Tooltip** on hover/focus lists the real factor breakdown — repository (+8), namespaced (+6), package type (+5), pinning (+5), OCI digest (+8), MCPB hash (+8), HTTPS remote (+6), streamable-http (+4); penalties: missing target (−35), mutable OCI (−10), missing MCPB hash (−12), insecure/invalid remote (−15), secrets (−6), SSE (−4) — with per-factor mini-bars. Must pass 3:1 contrast on the colored arc against `--tp-surface`; the numeric label always meets 4.5:1.

### 3.5 Feature Tile / Card
`--tp-r-md`, `1px solid --tp-border`, `padding 24px`, hover lifts to `--tp-shadow-2` + border `--tp-primary`. Anatomy: 24px Lucide icon (one accent stroke in `--tp-accent`), H4 title, body (muted), optional embedded mini code-block. Never uses gradient backgrounds.

### 3.6 Client Matrix Table
The 12 MCP clients × capability grid. Sticky header (`--tp-surface-elevated`, `--tp-border`), zebra rows off; row hover `--tp-surface`. Columns sortable (click header, `aria-sort`). Cells: ✓ (`--tp-success`), ✗ (`--tp-danger`, muted), "partial" (● `--tp-warning`). Scope badges (pill) inline. **Responsive:** below md, table → horizontal scroll with sticky first column, or each client becomes a stacked card with capability list.

### 3.7 Lockfile Anatomy Viewer
Annotated `mcp-lock.json` JSON block (uses 3.2). Numbered pins ①–⑥ in the left gutter; hovering or focusing a pin highlights its JSON line and reveals a popover callout explaining the field (e.g. "integrity — sha256 of the packaged tarball"). Pins keyboard-focusable (tab order). The shackle "snap" animation (§4) plays once when the block enters view.

### 3.8 Comparison Matrix
ToolPin vs manual pinning vs unmanaged. Rows = capabilities, columns = tools, cells = ✓/✗/—. ToolPin column tinted `--tp-accent/10` and bordered `--tp-accent` to draw the eye without bragging.

### 3.9 Step / Flow Diagram (Review Loop)
SVG, left-to-right nodes: `add → resolve → score → gate → lock`. Arrows animate on scroll (dash-offset draw). Gate node color-flips neutral→green on intersection (§4). Provide a linear text alternative in an `<details>` for screen readers and a vertical variant below sm.

### 3.10 Callouts, Badges, Tabs, Accordion, Nav, Footer, Search
- **Callouts:** `note` (border-left `--tp-primary`), `info` (accent), `warning` (`--tp-warning`), `danger` (`--tp-danger`). 4px left border, `--tp-surface` bg, icon + title + body.
- **Badges:** pill, font 12/600, variants: `Apache-2.0` (surface, bordered), `v0.1.0` (accent tint), client chips (mono, `--tp-r-md`, current-color logo at 16px).
- **Tabs:** underline style, `gap 32px`, active = `2px` bottom border `--tp-primary`. Used for install paths (GitHub Action / source / npm).
- **Accordion (FAQ):** single-open, chevron rotates 180°, `aria-expanded`, smooth height transition.
- **Nav:** logo left, primary links center, GitHub star count + "Install" primary CTA right. Active link underline.
- **Mobile menu:** full-height drawer (`z-index 400`), slide-in-left, scrim `rgba(11,17,32,.6)`.
- **Footer:** 4-col (Product / Docs / Community / Legal) + logo + Apache notice + status link, `--tp-surface` bg.
- **Search:** `cmdk`-style palette, `⌘K` trigger, fuzzy over docs, keyboard-first.

---

## 4. Motion & Micro-interactions

All motion is functional, **150–220ms**, `--tp-ease: cubic-bezier(0.4,0,0.2,1)`. Durations: `--tp-d-fast 120ms` (hover), `--tp-d 180ms` (default), `--tp-d-slow 320ms` (reveals).

- **Scroll-reveal:** opacity 0→1, translateY 8px→0 on IntersectionObserver (rootMargin `-10%`), stagger ≤80ms between siblings.
- **Hover lift:** cards `translateY(-2px)` + `--tp-shadow-2`, 120ms.
- **Lockfile snap:** the shackle node fills `--tp-accent` in a single frame (1-frame snap, no tween) when the viewer enters the viewport — once.
- **CI check transition:** gate/check node flips neutral→`--tp-success` over 160ms with a short scale pulse (1.0→1.08→1.0).
- **Copy-button feedback:** icon swaps to check + "Copied!" label, revert after 1500ms.
- **Gauge fill:** arc draws over 600ms ease-out on first view; number counts via `requestAnimationFrame` (skip if reduced-motion).

**Accessibility:** wrap every animation in `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }` and reveal final state immediately. No autoplay video, no parallax, no shader loops.

---

## 5. Responsive Breakpoints

`sm 640 · md 768 · lg 1024 · xl 1280`. Mobile-first; use `min-width` queries.

- **sm (≤639):** single column; nav → hamburger drawer; hero code block full-bleed; client matrix → horizontal-scroll with sticky first column; flow diagram → vertical variant; trust gauges stack; stats grid 2-col.
- **md (768):** 2-col feature grids appear; docs right-TOC hidden; footer → 2-col.
- **lg (1024):** full 12-col layouts; sticky docs sidebar + TOC visible; client matrix full table.
- **xl (1280):** max content width holds; extra whitespace, no new columns. Touch targets ≥44×44px at all breakpoints.

---

## 6. Dark Mode

**Dark is the default** (`<html data-theme="dark">`) — terminal-native audience. A toggle in the nav persists to `localStorage`; respects `prefers-color-scheme` on first visit. Token swap is purely via the `[data-theme]` attribute on `:root` — components never hard-code colors. Code blocks use `--tp-code-bg` (`#0E1726` dark) so JSON/TOML/YAML syntax tinting (keys `--tp-primary`, strings `--tp-accent`, numbers `--tp-warning`, comments muted) stays readable in both themes. Verify diff gutters and gauge bands meet contrast on dark surfaces.

---

## 7. Accessibility

Target **WCAG 2.1 AA** (aim AAA where feasible). Focus: every interactive element has a visible `:focus-visible` ring (`2px` `--tp-primary`, `2px` offset); never remove outlines. Keyboard: full tab order, logical roving tabindex in tabs/matrix/menu; Escape closes drawers/modals/popovers; `⌘K` opens search. Semantic landmarks: `<header><nav><main><aside><footer>`, one `<h1>` per page, headings in order. Diagrams: every SVG has `role="img"` + `aria-labelledby` pointing to a hidden descriptive `<text>`; the review-loop and lockfile viewers expose a text equivalent in `<details>`. Trust gauge and matrix cells never rely on color alone — always pair with a glyph (✓/✗/●) or label. Test the gauge amber band and the matrix partial-dot specifically for 3:1 against surface. `prefers-reduced-motion` honored everywhere (§4).

---

## 8. Performance & Technical Notes

- **Framework:** Docusaurus (already in repo) — React + MDX, static export via `docusaurus build`; every marketing/docs route is statically generated. Prefer Next.js app-router only if the team migrates.
- **Fonts:** self-host **Inter** and **JetBrains Mono** as variable fonts (woff2), `font-display: swap`, preloaded; subset to Latin to avoid layout shift. Set explicit `size-adjust`/font metrics so there is zero CLS on swap.
- **Images/diagrams:** SVG only (flow loop, lockfile viewer, gauges); no raster hero art. Inline SVGs for themeability; `<img loading="lazy">` for client logos. Provide `width`/`height` attributes.
- **Icons:** Lucide React (tree-shaken per-icon) at 24px, `stroke-width:2`, `currentColor`.
- **Syntax highlighting:** `shiki` (build-time, theme-aware `github-light`/`github-dark`) for code blocks — zero runtime JS, perfect LCP. Fallback: `prism-react-renderer`.
- **Copy-to-clipboard:** `navigator.clipboard.writeText` with a `try/catch` + legacy `execCommand` fallback; never block the main thread.
- **Bundles:** ship no client-side animation libs — IntersectionObserver + CSS transitions only. Target LCP < 1.5s on the hero code block, total JS < 120KB gzipped marketing pages.
- **Build hygiene:** `prefers-reduced-motion` and `[data-theme]` overrides live in a single critical CSS block inlined in `<head>`.
# 10 — Copy Bank, SEO & Build Spec

Canonical copy bank, SEO spec, asset checklist, and build spec for Claude Design. Every command, version, and fact is verified — use verbatim. Do not paraphrase code or invent features.

---

## 1. Headline & Tagline Bank

**Hero headlines:**
1. The review gate between MCP registries and your AI clients.
2. Lock your MCP servers before your credentials do.
3. Pin. Review. Approve. Then let MCP run.
4. A lockfile for Model Context Protocol servers.
5. Ship MCP servers the way you ship dependencies.

**Subheads:**
1. ToolPin reviews every MCP install, writes a versioned `mcp-lock.json`, and fails PRs on drift — before an AI client runs it with your credentials.
2. The open-source CLI that turns ad-hoc MCP installs into a reviewed, locked, auditable workflow.
3. Twelve AI clients, one source of truth. Generate configs, commit the lockfile, enforce it in CI.
4. Not a catalog, gateway, sandbox, or vault — the governance layer between registries and clients.
5. Apache-2.0. Node 22+. One binary: `tpn`.

**Taglines:**
1. Review gate for MCP. 2. The MCP lockfile. 3. Pin MCP. Approve change. Ship safely. 4. Governance for Model Context Protocol. 5. Twelve clients. One lockfile.

---

## 2. CTA Bank

**Primary:** `Get started` · `Install ToolPin` · `Install via GitHub Action`
**Secondary:** `Read the docs` · `See how it works` · `View on GitHub` · `See the lockfile`
**Tertiary:** `Compare alternatives` · `See supported clients` · `Browse the FAQ` · `Copy install command` · `Read the design brief` · `Star on GitHub`

---

## 3. Section Micro-copy Bank

- **Hero:** The Apache-2.0 CLI that reviews MCP installs, writes a lockfile, and fails PRs on drift.
- **Problem:** AI clients run MCP servers with your credentials — and today those installs happen with no review gate.
- **Solution loop:** Review the plan → generate client config → commit `mcp-lock.json` → `toolpin ci` fails the PR on drift.
- **Features:** One binary, twelve clients, one lockfile. Every install reviewed, pinned, enforced.
- **Lockfile showcase:** `mcp-lock.json` is the single source of truth for which servers run, at which version, in which scope.
- **Trust/security:** ToolPin does not sandbox or detect prompt injection. It makes sure you reviewed the server before it runs.
- **Comparison:** Not a catalog, gateway, sandbox, or vault — the review gate those tools assume exists.
- **TUI:** Approve, reject, inspect installs from a terminal interface — never leave the editor.
- **GitHub Action:** One step; PRs that drift from `mcp-lock.json` fail automatically.
- **FAQ:** Short, honest answers. If ToolPin doesn't do it, we say so.
- **Footer:** Open source. Apache-2.0. Built for the Model Context Protocol.

---

## 4. Feature One-liners

1. **Review gate:** Every MCP install is surfaced for review before it reaches a client.
2. **MCP lockfile:** `mcp-lock.json` pins servers, versions, scopes, and config.
3. **CI drift detection:** `toolpin ci` fails pull requests that drift from the lockfile.
4. **Twelve clients:** Generate native config for twelve AI clients from one command.
5. **Project & user scopes:** Install project-wide or per-user; scope each lock entry.
6. **Live + verify:** `--live` runs the install; `--verify` checks integrity before writing config.
7. **One binary:** Alias `tpn`. Node 22+. No daemon, no gateway to host.
8. **GitHub Action:** A single step enforces the lockfile in every PR.
9. **Open source:** Apache-2.0, source on GitHub.
10. **Honest scope:** Not a catalog, gateway, sandbox, or vault — a governance layer.

---

## 5. FAQ Copy

**Q: What is ToolPin?**
A: An Apache-2.0 CLI that sits between MCP registries and the AI clients that run MCP servers. It reviews installs, writes a `mcp-lock.json`, and fails PRs on drift. Binary alias: `tpn`.

**Q: Is it open source and free?**
A: Yes. Apache-2.0, source at `github.com/proofofwork-agency/toolpin`.

**Q: Do I need to host anything?**
A: No. ToolPin is a local CLI (Node 22+). There is no server, gateway, or registry to run.

**Q: Which clients are supported?**
A: Twelve AI clients. See the supported-clients page for the current list.

**Q: What is an MCP lockfile?**
A: `mcp-lock.json` records which MCP servers run, at which version, in which scope, and with what config — committed to your repo like `package-lock.json`.

**Q: How does CI drift detection work?**
A: Run `toolpin ci` in your GitHub Action. If a PR's MCP installs don't match `mcp-lock.json`, the check fails.

**Q: Does ToolPin sandbox servers or detect prompt injection?**
A: No. ToolPin is a review and lockfile tool, not a sandbox or security scanner. It makes sure you approved the server before it runs.

**Q: How do I install before npm publish?**
A: Clone `github.com/proofofwork-agency/toolpin` (Node 22+), then run:
`node dist/cli.js install io.github.github/github-mcp-server --client claude --scope project --live --verify --update-lock`
Or use the GitHub Action: `- uses: proofofwork-agency/toolpin@v0.1.0` with `live: "true"`, `file: mcp-lock.json`.

**Q: What is v0.1.0 / npm-publish-pending?**
A: ToolPin is at v0.1.0; the npm package is pending. Install from source or the GitHub Action for now.

---

## 6. Footer Copy

**Tagline:** Review gate for Model Context Protocol.
**Links:** Home · Features · Lockfile · Supported clients · GitHub Action · Docs · FAQ · GitHub
**Legal:** © 2025 ToolPin contributors. Licensed Apache-2.0.

---

## 7. SEO / Meta Spec

**Home**
- `<title>`: ToolPin — The MCP Lockfile & Review Gate for AI Clients
- Meta (~155): ToolPin is the Apache-2.0 CLI that reviews MCP installs, writes an mcp-lock.json, and fails PRs on drift. Twelve AI clients. Binary: tpn.
- OG: ToolPin — Review Gate for Model Context Protocol / Pin, review, lock MCP servers before AI clients run them. Apache-2.0.
- Keywords: MCP lockfile, Model Context Protocol, MCP server install, MCP governance, tpn, AI client config, MCP CI, mcp-lock.json

**Features**
- `<title>`: Features — MCP Lockfile, CI Drift, Twelve Clients | ToolPin
- Meta: Review gate, mcp-lock.json, toolpin ci drift detection, project/user scopes, live and verify flags. One binary for twelve clients.
- OG: ToolPin Features — One Lockfile for MCP
- Keywords: MCP lockfile, MCP CI drift, MCP client config, MCP review gate, tpn features

**Lockfile**
- `<title>`: The MCP Lockfile — mcp-lock.json Explained | ToolPin
- Meta: mcp-lock.json pins which MCP servers run, at which version, in which scope. The package-lock.json for Model Context Protocol.
- OG: What is an MCP Lockfile?
- Keywords: mcp-lock.json, MCP lockfile, MCP version pinning, Model Context Protocol lockfile

**Supported clients**
- `<title>`: Supported MCP Clients | ToolPin
- Meta: Generate native config for twelve AI clients from one command. See the supported client list.
- OG: Twelve AI Clients, One Lockfile
- Keywords: MCP clients, supported AI clients, MCP client config, claude client, MCP install

**GitHub Action**
- `<title>`: Enforce the MCP Lockfile in CI | ToolPin GitHub Action
- Meta: One GitHub Action step enforces mcp-lock.json on every PR. toolpin ci fails pull requests that drift from the lockfile.
- OG: MCP Drift Detection in CI
- Keywords: MCP CI, GitHub Action MCP, MCP drift detection, mcp-lock.json CI

**FAQ**
- `<title>`: ToolPin FAQ — Open source? Sandbox? How to install?
- Meta: Honest answers: Apache-2.0, no hosting, twelve clients, mcp-lock.json, CI drift, and how to install before npm publish.
- OG: ToolPin FAQ
- Keywords: MCP FAQ, is MCP open source, how to install MCP, MCP lockfile, tpn

---

## 8. Asset Checklist

The designer/builder must produce:
- **Logo lockups:** "ToolPin" wordmark + `tpn` monogram; favicon + app-icon.
- **OG image:** 1200×630, dark-mode-first, lockfile + pin motif; include tagline.
- **Diagrams (5–6):** review loop, `mcp-lock.json` anatomy, CI drift diff, honesty gauge (does vs. doesn't), client fan-out (one lock → twelve clients), TUI mockup.
- **Client logo set (12):** matched, monochrome + color, current-name labels.
- **Code/JSON theme:** syntax theme for JSON, TOML, YAML, bash; light + dark.
- **Empty states:** no lockfile yet, no pending installs, no drift, unsupported client.
- **Iconography:** pin, lock, gate, diff, check, x — single line-weight family.

---

## 9. Final Build Spec for Claude Design

- **Stack:** Docusaurus (recommended) **or** Next.js + React + Tailwind/CSS variables. Static export required.
- **Dark mode first**, light parity, preference persisted; responsive mobile→desktop; **WCAG 2.1 AA**.
- **Code blocks:** copy-to-clipboard, syntax-highlighted (JSON/TOML/YAML/bash). Every command/JSON must match verified facts verbatim — no edited flags, no invented versions.
- **Single source of truth:** this brief (sections 1–10). On conflict, the brief wins.
- **Accuracy:** never invent features; never name clients beyond "twelve" unless the list is provided; never claim sandboxing, prompt-injection detection, or hosting. ToolPin is **not** a catalog, gateway, sandbox, or vault.
- **Versions:** v0.1.0, npm-publish-pending — all install paths reflect this (source clone or GitHub Action), never `npm i -g`.
- **Repo links:** `github.com/proofofwork-agency/toolpin` only.

> Do not invent features. If unsure, omit rather than overclaim.

---

## 10. Consolidation Note

This brief (sections 1–10) is the canonical input to Claude Design; all copy, commands, facts, and structure derive from it.
