# Docusaurus Site Design

> Architecture for the public documentation site. Produced from a design pass
> over README, ROADMAP, client-configs, secret-brokering, and package.json.
> Status: the site is scaffolded and live at `website/` (config `website/docusaurus.config.js`,
> docs under `docs/site/`). This file remains the design spec behind it.
> Last reviewed: 2026-06-25.

## Framework

Diátaxis (Tutorials / How-to guides / Reference / Explanation), because the
product maps cleanly: learn to install → operate CI/policy → look up
schemas → understand the threat model.

## Information architecture

Top nav: `[ToolPin] [Docs ▾] [Changelog] [GitHub ↗]` + right-aligned primary
CTA **Quickstart**.

```
docs/
├── intro .................................... Introduction (90s orientation)

├── tutorials/   (learning-oriented; beginner)
│   ├── index ............................... Choose your path (4 audience routes)
│   ├── install-first-server ................ Verified install into detected client
│   ├── lock-a-project ...................... Lock a repo + catch drift in CI
│   ├── write-a-policy ...................... Enforce your first trust policy
│   └── sign-a-lockfile ..................... Sign + verify a lockfile end-to-end

├── how-to/      (task-oriented; assumes basics)
│   ├── index
│   ├── install-to-all-clients .............. --client all fan-out
│   ├── choose-scope ........................ project vs global (and why generic≠real)
│   ├── verify-a-server ..................... run verify + read the report
│   ├── pin-oci-and-mcpb .................... Require digest / fileSha256 pins
│   ├── catch-drift-in-ci ................... toolpin ci in GitHub Actions
│   ├── pin-lock-digest ..................... --expect-digest
│   ├── audit-secrets ....................... secrets audit + reading findings
│   ├── recover-from-drift .................. Resolve an install-drift refusal
│   ├── doctor-reconcile .................... doctor: lock ↔ client config
│   ├── remove-server ....................... remove / uninstall cleanup
│   ├── export-config-only .................. Generate config without installing
│   └── use-the-tui ......................... Full-screen TUI: browse, Installed-tab lifecycle (drift/doctor/update/remove/test), and hotkeys

├── reference/   (information-oriented; factual)
│   ├── index
│   ├── cli .................................. Command reference (all commands + flags)
│   ├── lockfile-schema ...................... mcp-lock.json v2 schema        [NEW]
│   ├── policy-schema ..................... . .toolpin/policy.json schema      [NEW]
│   ├── trust-score .......................... Trust score components + weights [NEW]
│   ├── capability-manifest .................. CapabilityManifest fields
│   ├── advisory-scans ....................... Tool-description advisory rules
│   ├── client-matrix ........................ Per-client support matrix       [NEW]
│   ├── env-placeholder-matrix ............... Per-client secret placeholder syntax
│   ├── exit-codes ........................... CI exit codes
│   ├── registry-cache ....................... .toolpin/registry-cache.json
│   └── meta-extensions ...................... dev.toolpin/* _meta namespaces

├── concepts/    (understanding-oriented; the "why")
│   ├── index
│   ├── what-is-toolpin ...................... What it IS — and isn't
│   ├── trust-explained ...................... How scoring works (+ limits)    [NEW, interactive]
│   ├── threat-model ......................... What ToolPin defends against    [NEW]
│   ├── lockfiles-as-gates ................... Why the lockfile fails closed
│   ├── multi-client-neutral ................. Why we write to every client
│   ├── metadata-is-sensitive ................ Why tool descriptions are untrusted
│   ├── secret-brokering-gate ................ Why we don't resolve secrets at install
│   ├── comparison ........................... vs Smithery / PulseMCP / Glama / Docker [NEW]
│   └── faq .................................. Frequently asked questions      [NEW]

├── governance/  (forward-looking; v0.1 → v1.0)
│   ├── roadmap .............................. Product roadmap (pillars + releases)
│   ├── enterprise-governance ................ Signed registry / Cedar|OPA / audit trail
│   └── stability-and-compat ................. Compatibility + fail-closed principles

└── community/
    ├── contributing
    ├── client-config-research ............... (port of docs/client-configs.md)
    └── security-policy ...................... Reporting vulnerabilities
```

### Mapping existing content → IA

| Source | → Destination |
|---|---|
| README Quick Start | `tutorials/install-first-server` + `reference/cli` |
| README Commands | `reference/cli` |
| README What Exists Now | `concepts/what-is-toolpin` + split into `reference/*` |
| README TUI | `how-to/use-the-tui` |
| README Local Policy | `reference/policy-schema` + `tutorials/write-a-policy` |
| README Secret Hygiene | `how-to/audit-secrets` + `concepts/secret-brokering-gate` |
| README Product Direction | `concepts/what-is-toolpin` + `governance/roadmap` |
| `docs/ROADMAP.md` | `governance/roadmap` |
| `docs/client-configs.md` | `community/client-config-research` (upstream) **+** `reference/client-matrix` (user-facing distillation) |
| `docs/secret-brokering.md` | `concepts/secret-brokering-gate` |
| `docs/threat-model.md` (new) | `concepts/threat-model` |
| `docs/comparison.md` (new) | `concepts/comparison` |
| `docs/strategy-and-moat.md` (new) | internal/`governance` (not public-launch material) |

## Landing page

- **Hero (recommended):** "The trust layer for MCP."
- **Subhead:** "ToolPin reads the official MCP Registry, scores trust, checks declared integrity pins and lockfile drift, and writes correct config into Claude, Cursor, VS Code, Codex, OpenCode and the rest — without competing with the catalog."
- **Three value props:** (1) Trust as the product — capability manifests, OCI/MCPB pins, advisory scans, fail-closed on mutable tags. (2) One install, every client — spec-correct JSON/TOML/YAML for 12+ clients. (3) Lockfiles that enforce — frozen `toolpin ci` rejects drift/tamper; optional detached Ed25519 signatures.
- **CTAs:** Quickstart (primary) · Install one-liner (secondary, after npm publish) · GitHub (tertiary).
- **Stat strip:** `12 MCP clients · 1 lockfile · 0 plaintext secrets generated by ToolPin`.

## Visual identity

- **Primary metaphor:** the *pin* — dual meaning: pin a version + pushpin (curate). Name does the work.
- **Color:** slate/ink base + **amber/brass accent** (the "brass pin"). Warm, trustworthy, rare among dev-tool security sites (which default to blue). Semantic tokens: green = verified, red = fail-closed, amber = advisory.
- **Logo:** a pushpin whose head is a padlock shackle. Must work monochrome (favicon, terminal).
- **Illustration:** isometric stroke-based blueprint style; recurring motif = lockfile-as-a-chain, each block stamped with `sha256-…`. Avoid cartoon and stock "hacker hoodies."
- **Typography:** monospace-forward for code/digests; clean geometric sans for chrome.

## Plugins / features

| Need | Recommendation |
|---|---|
| Search | `@docusaurus/plugin-search-local` at launch; Algolia DocSearch post-traction. Local search is on-brand (no external deps). |
| Versioning | Enable preset-classic docs versioning **once v0.2 is cut**. Tag `0.2`, `0.3`, `1.0`; keep `next` for in-dev. |
| i18n | Scaffold `i18n/` now, ship English-only at launch. |
| Blog | `plugin-content-blog` branded **"Changelog"** — one post per release + security advisories. RSS out of the box. |
| MDX | (1) Trust-score calculator in `concepts/trust-explained`. (2) `Tabs`/`TabItem` for the 12-client install snippets. (3) Lockfile inspector. (4) Policy playground. |
| API docs | Skip now (no HTTP API). Flag for v1.0 private registry. |
| Analytics | Plausible or Matomo (self-hostable), not GA. On-brand with privacy/trust positioning. |
| Preset | `preset-classic`. |

## Audience prioritization

| Section | Primary | Secondary | Priority |
|---|---|---|---|
| Tutorials | Individual dev | Platform team | Highest — top-of-funnel |
| How-to | Platform team | Individual dev | High — sticky workflows, converts trial → adoption |
| Reference | Platform team + MCP author | All | High — highest long-term SEO traffic |
| Concepts | Enterprise security | MCP author, curious dev | Medium-high — buy-in / credibility pages |
| Governance | Enterprise security | Platform team | Medium now → High at v1.0 |
| Community | MCP author | Contributors | Medium |

## Content production plan

### P0 — ship at launch (~9.5 dev-days)
`intro`, `tutorials/install-first-server`, `reference/cli`, `reference/client-matrix`,
`reference/lockfile-schema`, `concepts/what-is-toolpin`, `concepts/trust-explained`,
`reference/policy-schema`, `concepts/threat-model`, and
`how-to/catch-drift-in-ci`.

Already started in repository docs: `how-to/catch-drift-in-ci`,
`concepts/threat-model`, and `concepts/comparison`.

### P1 — within first month (~12-15 dev-days)
- Tutorials: `lock-a-project`, `write-a-policy`, `sign-a-lockfile`.
- How-to: `install-to-all-clients`, `verify-a-server`, `pin-oci-and-mcpb`, `audit-secrets`, `use-the-tui`, `doctor-reconcile`, `remove-server`, `recover-from-drift`, `choose-scope`, `export-config-only`, `pin-lock-digest`.
- Reference: `trust-score`, `capability-manifest`, `env-placeholder-matrix`, `exit-codes`, `advisory-scans`.
- Concepts: `threat-model`, `lockfiles-as-gates`, `secret-brokering-gate`, `metadata-is-sensitive`, `comparison`, `faq`.
- Changelog: v0.1 + v0.2 release posts.

### P2 — as v0.3+ lands
`reference/meta-extensions`, `reference/registry-cache`, `concepts/multi-client-neutral`,
`how-to/add-new-client`, `governance/enterprise-governance`, `governance/stability-and-compat`,
`community/contributing`, `community/security-policy`, interactive polish (lockfile inspector, policy playground), i18n rollout, Algolia migration.

## URL strategy

- Domain: `toolpin.dev` (or `.io`). Docs under `/docs`.
- Lowercase, kebab-case, no trailing slashes (canonical), no `.md`.
- Verb-led slugs for tutorials/how-to (`/docs/how-to/catch-drift-in-ci`);
  noun-led for reference/concepts (`/docs/reference/lockfile-schema`).
- No version numbers inside slugs (the v1→v2 split is a page concern, not a URL concern).
- Changelog: `/changelog/v0-2`, `/changelog/advisory-<id>` (slug versions as `v0-2`, never `0.2`).
- No date slugs anywhere except advisory IDs.

## Open decisions

1. Domain: `toolpin.dev` vs `.io` vs subdomain of the org.
2. Ship versioning at launch or defer to the v0.2 cut (recommend defer).
3. License the docs CC-BY-4.0 (code Apache-2.0) — standard for OSS doc sites.
