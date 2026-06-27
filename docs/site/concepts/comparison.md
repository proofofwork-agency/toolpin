---
title: Ecosystem Comparison
---

# ToolPin vs. the MCP Ecosystem

> Honest comparison of ToolPin against the registries, marketplaces, installers,
> and runtime-governance vendors in the MCP ecosystem. Last reviewed: 2026-06-27.
> Counts, release dates, and product claims are point-in-time and fluctuate;
> self-reported figures are marked **(self-reported)** where the vendor has not
> been independently audited.

ToolPin is **the trust, install, lockfile, and governance layer over the
official MCP Registry** — not a competing catalog. The distinction matters:
every other tool here either *is* a catalog/marketplace, *is* a
runtime/gateway, or *is* a single-purpose installer. ToolPin is the layer that
sits between the registry and your MCP clients, turning unverified metadata into
pinned, policy-checked, drift-checked, signed installs.

The claim to test is narrow and factual: ToolPin should be the
`package-lock.json` plus CI gate for MCP installs. If another product already
gives a team neutral multi-client config, install-time review, an enforcing
lockfile, and CI drift detection in one repo-owned workflow, that product is the
direct replacement. Today the strongest alternatives solve adjacent layers:
discovery, hosted installation, runtime gateways, or enterprise policy.

## The one-table view

Legend: ✅ native · (✅) partial/indirect · ❌ absent · — N/A.

| Capability | ToolPin | Official Registry | Smithery | Glama | Docker | Stacklok ToolHive | Pillar / Lasso / Snyk-Invariant |
|---|---|---|---|---|---|---|---|
| **What it is** | Install + lock layer | Metaregistry (metadata + fingerprint) | Marketplace + installer | Catalog + gateway + quality scoring | Catalog + runtime governance | Enterprise MCP platform | Runtime security vendors |
| **Install MCP servers** | ✅ | ❌ | ✅ | (✅) via gateway | ✅ | ✅ | ❌ |
| **Multi-client config writer** | ✅ | ❌ | (✅) own routing | (✅) one gateway URL | ✅ many clients | (✅) gateway/portal | ❌ |
| **Client neutrality** | ✅ | — | ❌ (Smithery-locked) | ✅ | (✅) | ✅ | — |
| **Committed lockfile / reproducibility** | ✅ `mcp-lock.json` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Trust scoring (normalized signals)** | ✅ | ❌ | badge only | ✅ TDQS 1–5 × 6 (transparent) | ❌ allow/deny | (✅) via Cedar | (✅) runtime scanning |
| **Cryptographic install verification** | (✅) partial install-time integrity gates: OCI registry digest resolution, trusted-host MCPB byte hashing, and npm SRI are best-effort; broader artifacts are not verified | ❌ | ❌ | ❌ | (✅) image signing + SBOM | ✅ Sigstore provenance | ✅ runtime |
| **Ed25519 lockfile signing** | ✅ | ❌ | ❌ | ❌ | ❌ | (✅) Cosign (not Ed25519) | ❌ |
| **Policy / governance** | (✅) local JSON gate | ❌ | (✅) per-token `--policy` | ✅ gateway ACLs | ✅ custom engine + RBAC | ✅ **Cedar** | ✅ runtime guardrails |
| **Secret management** | (✅) audit only | ❌ | ✅ `agent.pw` vault | ✅ managed OAuth | ✅ credential governance | ✅ encrypted + token exchange | ✅ |
| **Runtime sandbox / enforcement** | ❌ | ❌ | ❌ | (✅) Firecracker (build-time) | ✅ microVM | ✅ container/K8s isolation | ✅ |
| **Open source** | ✅ Apache-2.0 | ✅ (Go, in-repo LICENSE) | ✅ AGPL-3.0 CLI | ✅ TDQS scoring OSS; gateway closed | ❌ closed | ✅ Apache-2.0 | ❌ closed |
| **Enterprise readiness** | v1.0 target | infra | mid | high | very high | very high | very high |
| **Distribution** | Docusaurus docs + TUI + composite Action; scoped npm package pending | hosted API (`registry.modelcontextprotocol.io`) | npm CLI + SaaS | SaaS | Docker Desktop ($24/user/mo Business) | K8s operator + Portal | SaaS / VPC |

The cell at the intersection of **committed Lockfile = ✅** and **install-time
Client neutrality = ✅**, in an **open-source CLI**, is ToolPin's alone among
products at scale. That is the marketing point, but it is also the product test.
The moment a registry, marketplace, client, or gateway ships a portable lockfile
that can be committed to a repo and enforced across multiple clients in CI,
ToolPin's claim must be re-evaluated.

## Small open-source peers (2026, low adoption — but they narrow the whitespace)

These are not competitive threats today, but they prove the feature set is cheap
to clone and that the "nobody does this" framing no longer holds literally.

| Project | What it does | License | Stars (2026-06) | Why it matters |
|---|---|---|---|---|
| **`mcptrust/mcptrust`** | Lockfile enforcement + drift detection + artifact pinning + **Sigstore/Ed25519 signing** + **CEL policy** + OTel, as a **runtime proxy** across Claude Desktop / LangChain / AutoGen / CrewAI | Apache-2.0 | ~6 | Near-feature-identical to ToolPin's *thesis* — but implemented at the runtime-proxy layer, not as an install-time committed CLI. |
| **`pathintegral-institute/mcpm` (`mcpm.sh`)** | Config writer for ~15 clients (Claude/Cursor/Windsurf/VSCode/Continue/Cline/Roo/OpenCode/Goose/Gemini/Codex/Qwen/Trae/5ire) + Router + Profiles | MIT | ~977 | Fills the "neutral multi-client config writer" cell without locking or verifying. |
| **`nolabs-ai/nono`** | "Sandbox any AI agent" — runtime sandbox + **sigstore** + supply-chain-security | Apache-2.0 (Rust) | ~2,806 | The 2026 breakout runtime-sandbox OSS; could become a substrate ToolPin integrates with. |
| **`sudoviz/driftcop`** | MCP drift detection + tracking via **SigStore** + SAST + enterprise Web UI | (NOASSERTION) | ~11 | Overlaps ToolPin's drift/signing story at a different layer. |
| **Prompt Security "MCP Gateway"** | Runtime gateway: MCP server risk assessment, per-tool enforcement | Proprietary | — | Sells the runtime governance layer to CISOs. |
| **`github/gh-aw-mcpg`** | GitHub's **own** Agentic-Workflows MCP Gateway (Go) | MIT | ~136 | Signals first-party platform interest in owning the gateway layer. |

## What each competitor does *better* than ToolPin

### Official MCP Registry (`modelcontextprotocol/registry`)
The vendor-neutral, community-run catalog and API ToolPin consumes. Go service,
**v1.7.9 (2026-05-12)**, API freeze v0.1 on 2025-10-24, ~6.9k★, pushed daily.
Maintained by a Registry Working Group that includes contributors from PulseMCP,
Stacklok, TeamSpark, Anthropic, and GitHub. `server.json` carries namespaces,
packages (incl. **MCPB `fileSha256`** for integrity), and remotes, and the
registry computes a **deterministic fingerprint** for allowlist matching. **What
it does better:** authoritative, community-owned, the source of truth ToolPin
builds on. **ToolPin's role:** consume it, not compete with it. The **biggest
long-term risk** is here — if the WG ratifies native trust/pinning/lockfile in
the spec, ToolPin's install-time-lockfile moat compresses hard (see Threats
below).

### Smithery (`smithery.ai`)
Dominant consumer marketplace and installer. **~11,479+ MCPs (self-reported)**,
CLI **v1.2.0 (2026-05-31)**, **AGPL-3.0** CLI, `smithery mcp add/search/publish`,
the **MCPB** publishing pipeline, a Skills registry, an encrypted credential
vault (`agent.pw`), "verified" badges and usage counts. **Better at:** polish,
hosted OAuth, the vault, MCPB distribution. **ToolPin wins:** no committed
lockfile, no signing, no org-wide policy engine (only per-token `--policy`
JSON), AGPL-3.0 enterprise friction, and distribution is Smithery-locked
(servers get `*.run.tools` subdomains). Trust is "Smithery says so" — a binary
badge, not normalized signals.

### Glama (`glama.ai`)
Catalog **superset of the official registry** plus a **MCP Gateway** reverse
proxy, an in-browser Inspector, and sandboxed analysis. Public methodology is
the transparent **TDQS (Tool Definition Quality Score): 1–5 across six
dimensions** plus Malicious/Risky behavioural tiers — not an opaque A/B/C/D
grade. **~48,443 servers / 50k+ developers / 1M+ tool calls/month
(self-reported, unverified).** Runs build/introspection on **Firecracker
microVMs**. **Better at:** runtime governance, per-tool ACLs, SIEM export,
managed OAuth, transparent quality scoring at scale. **ToolPin wins:** all of
Glama's trust is *runtime/gateway-enforced*, not install-pinned; no committed
lockfile; no cross-client config normalization.

### Docker (MCP Catalog/Toolkit beta 2025-05-05; **AI Governance GA 2026-05-12**)
**The most serious direct competitor.** Docker MCP Catalog ships containerized,
sandboxed servers on Docker Hub. **Docker AI Governance is now GA**, not just
announced: it governs network, filesystem, credentials, and which MCP tools
agents can call — RBAC via SAML/SCIM, SIEM export, **microVM sandbox**, policy
defined once and enforced laptop → CI → K8s. Proprietary, **Docker Business
($24/user/mo)**. Multi-client (Claude, Cursor, Codex, Gemini, Copilot, Warp,
Devin, Kiro). **Better at:** runtime enforcement (Docker *is* the substrate),
brand, distribution via Docker Desktop, partner catalog. **ToolPin wins:** no
committed portable lockfile; Docker-only; declarative install-time pinning is
absent; not all agent runtimes containerize.

### Stacklok ToolHive (`github.com/stacklok/toolhive`, Apache-2.0)
Open-source enterprise MCP platform: Gateway, Registry Server, Runtime, Portal.
**v0.31.0 (2026-06-24)**, very active (~343 releases). **Better at:** real
**Cedar policy engine** (the exact thing ToolPin defers to v1.0), **Sigstore
Cosign** provenance signing, K8s operator, OIDC/OAuth SSO, SIEM-compliant audit
logging, container isolation. Stacklok also **co-chairs the official MCP
Registry Working Group** — they are the most likely to define trust natively in
the spec. **ToolPin wins:** ToolHive is heavy infra (Go services + Postgres +
K8s); no committed lockfile artifact; no desktop-client config writer; ToolPin
is local, portable, and TypeScript-native.

### Pillar Security / Lasso Security / Snyk-Invariant
Runtime security vendors targeting the CISO buyer. **Invariant was acquired by
Snyk.** **Better at:** SOC2, enterprise narrative, runtime guardrails, MCP
scanning (Invariant's MCP-Scan), AI-BOM and AI-SPM (Lasso), "MCP & Tool
Security" + supply-chain governance (Pillar; Gartner 2026 Guardian-Agents
representative vendor). **ToolPin wins:** these are all runtime/gateway
products — none offer install-time/declarative pinning, reproducibility, or
neutral cross-client enforcement. They are *complementary* to ToolPin, not
replacements.

## What the ecosystem still does not do (ToolPin's narrowing green field)

- **No `mcp-lock.json` standard exists** at any adoption scale. The closest peer
  is `mcptrust` (~6★), which implements lockfile + signing + CEL policy + drift
  as a **runtime proxy** rather than a committed install-time CLI. MCP is where
  npm was before `package-lock.json` (2017) and where cargo was before
  `cargo-vet`. The lockfile is ToolPin's to define and win if it is published,
  documented, and adopted beyond this repository.
- **No cross-client config normalizer as a *locking* product.** `mcpm` (~977★)
  writes config for ~15 clients but does not lock or verify; everything else is
  a toy/desktop app.
- **No "sigstore for MCP" standard yet** — but the primitives are landing as
  small OSS: `mcptrust`, `driftcop`, `nono`, `evoila/meho`, `aflock`, `sno-ai/mda`.
  No product binds key material to MCP artifacts via a transparency log at scale.
- **No "SLSA for agents."** SLSA provenance + build verification for agent tool
  calls is still an open category.

## The biggest 2026 threats to ToolPin's thesis

1. **The official Registry absorbs trust/pinning natively.** `modelcontextprotocol/registry`
   is hyperactive and is building server maturity levels, ownership/source
   verification, and the fingerprint. A spec-level lockfile/pinning would compress
   the install-time-lockfile moat the most.
2. **Runtime gateways become the de-facto control plane.** GitHub's own
   `gh-aw-mcpg` plus Pillar/Lasso/Prompt/Invariant sell *runtime* MCP governance;
   enterprises may standardize on a gateway and treat install-time pinning as
   redundant.
3. **`mcptrust` proves the feature set is cheap to clone** — at the runtime-proxy
   layer. The *idea* has low defensible IP; differentiation must come from
   neutrality, UX, registry-grade metadata normalization, and CI drift ergonomics.
4. **MCPB one-click bundles + registry fingerprint** reduce the felt need for a
   separate lockfile (the bundle *is* the pinned artifact). ToolPin should treat
   MCPB as both a threat and an integration target (sign/wrap `.mcpb`).

## How to read this comparison

- **Registries/catalogs** (Official, Smithery, PulseMCP, Glama, mcp.so) are
  *collaborators*, not competitors. They all explicitly defer trust and
  governance. ToolPin's go-to-market is *consuming* their data and layering
  signed pinning + policy on top.
- **Runtime governance vendors** (Docker, Stacklok, Glama Gateway, Pillar,
  Lasso, Invariant, Prompt Security, GitHub's gateway) are the *real fight*, but
  on a different layer. Their argument: "we own the runtime, so policy isn't
  advisory." ToolPin's counter: a **declarative, portable, offline-capable
  lockfile** beats (or complements) a runtime gateway — for CI reproducibility,
  air-gapped and regulated environments, supply-chain attestation for auditors,
  and runtimes Docker doesn't reach.
- **Installer libraries** (`mcpm`, `mcp-installer` [abandoned ~2024],
  `mcp-get` [archived], `mcphost` [archived host]) prove demand. `mcpm` is the
  only active one; none lock or verify. ToolPin should not position as
  "mcp-get but better."

## Differentiation that holds

Lean hardest on the axes where the matrix is empty: **install-time integrity
gates + lockfile/reproducibility + neutral multi-client policy**, delivered as a
committed, repo-owned artifact and CI gate in an open-source CLI. Treat
governance and policy as table-stakes where ToolPin must *integrate* with
Docker/Glama/Pillar rather than out-build them.

## Differentiation that does not hold

Trust scoring (everyone has one — Glama's TDQS is arguably more transparent),
the TUI (polish, not defense), npm distribution (near-zero switch costs), and
the per-client config writer (`mcpm` already covers ~15 clients). These are
table-stakes needed to compete, not moats.

## Source notes

- Official registry version, fingerprint, and Registry WG composition checked
  against `github.com/modelcontextprotocol/registry` (accessed 2026-06-25).
- Docker MCP Catalog/Toolkit beta (2025-05-05) and **Docker AI Governance GA
  (2026-05-12)** checked against Docker's public release material; Business-tier
  pricing from Docker's product page.
- ToolHive license (Apache-2.0), v0.31.0 (2026-06-24), Cedar, and Cosign checked
  against the Stacklok/GitHub public pages and `docs.stacklok.com`.
- Smithery CLI license (AGPL-3.0), v1.2.0 (2026-05-31), and `agent.pw` checked
  against the Smithery CLI repository and docs.
- Glama scale, TDQS methodology, and Firecracker sandboxing checked against the
  public Glama site and methodology page. (An earlier "A/B/C/D grade" claim
  could not be verified; the public system is the numeric TDQS + Malicious/Risky
  tier and has been corrected here.)
- Small-OSS peer star counts and last-push dates pulled from `api.github.com` on
  2026-06-25.
- Academic: arXiv:2510.16558 is "A First Look at Security Issues in the MCP
  Ecosystem" (Li & Gao, DSN 2026 — analyzes ~67k servers, ships MCPInspect);
  arXiv:2504.08623 is "Enterprise-Grade Security for MCP" (Narajala & Habler,
  Accenture). Both are research, not products.
