# Future ToolPin Cloud Roadmap

This is a planning document, not an active build plan. The near-term product remains
the Apache-2.0 CLI, `mcp-lock.json`, the GitHub Action, local policy, and the
GitHub-hosted curated registry. ToolPin Cloud should exist only if the open
standard starts getting real adoption and users need continuous operation that a
local CLI cannot provide. The strategic clock is still real: if `mcp-lock.json`
does not become a committed, CI-enforced habit within roughly 18-24 months, a
client, registry, or governance vendor can absorb the category.

## Position

ToolPin Cloud would be the continuously running operator for the open ToolPin
standard:

- the CLI checks a repo at install, update, and CI time;
- the cloud checks registries, advisories, provenance, and enrolled repos all the
  time;
- the CLI and lockfile format stay Apache-2.0 so teams, clients, registries, and
  competitors can adopt them without procurement friction;
- paid features live around hosted compute, shared state, audit, org controls,
  and optional runtime services.

The product line is:

```text
Apache core = standard, local enforcement, lockfile, CI, config generation
Paid cloud = continuous monitoring, org governance, evidence, webhooks, audit,
             optional hosted secrets/runtime
```

Do not relicense the core to AGPL/GPL, MIT, BSL, or FSL. Apache-2.0 is still the
right license for a trust standard because it maximizes enterprise adoption and
keeps the explicit patent grant. If a hosted product appears later, keep the CLI,
lockfile schema, curated registry schema, GitHub Action, and local policy engine
Apache-2.0. License the hosted service, datasets, enterprise UI, audit system,
and optional gateway separately.

Also protect the identity separately from the code. Add a trademark policy for
`ToolPin`, `toolpin`, and `tpn` before broad adoption so modified or incompatible
builds cannot present themselves as the trusted upstream release.

## Trusted Package Path

The current trusted registry path is:

```text
registry/v0/servers
website/static/registry/v0/servers
```

The raw registry URL is:

```text
https://raw.githubusercontent.com/proofofwork-agency/toolpin/main/registry/v0
```

The future website registry URL is:

```text
https://toolpin.dev/registry/v0
```

ToolPin appends `/servers` to those base URLs. `registry/v0/servers` is a JSON
file with a `servers` array, not a directory. A trusted package entry is appended
to that `servers` array today, then mirrored to
`website/static/registry/v0/servers` for the static site. A future SaaS can
ingest the same entries into a database, but the GitHub JSON should remain the
auditable source of curated truth until there is a strong reason to change it.

Curation status should be staged, evidence-gated, and reversible. This is
separate from the shipped code's `TrustTier` values (`verified`, `conditional`,
`unverified`, `blocked`) used by `src/trust.ts`.

| Stage | Name | How it is earned | What can revoke it |
|---|---|---|---|
| 0 | Discovered | Auto-indexed from the official registry, Docker catalog, or configured directories. | Source disappears, malformed metadata, duplicate identity. |
| 1 | Verified publisher | Namespace ownership is tied to registry identity, repository ownership, DNS/HTTP proof, or another documented publisher proof. | Ownership proof fails, repo transfer, package namespace dispute. |
| 2 | Provenance-attested | Signed metadata, pinned artifact digests, SLSA/sigstore/cosign evidence, SBOM, and key identity are verified rather than merely declared. | Key rotation without continuity, signature failure, artifact digest mismatch, missing provenance. |
| 3 | Curated / recommended | Human-reviewed PR to the ToolPin curated registry plus machine verification that the project enforces ToolPin in protected CI. | CI enforcement removed, branch protection/ruleset changes, maintainer concern, stale package, advisory. |
| Downrank | Delisted / vetoed | Any stage can fall here when evidence is lost or risk becomes unacceptable. | Re-review and fresh evidence. |

The important rule is that trust decays. A curated package is not permanently
trusted because a PR merged once. The registry should periodically re-check the
evidence and demote entries when enforcement, signatures, provenance, branch
protection, or advisory state changes.

## What ToolPin Cloud Would Do

### 1. Registry Intelligence

This is the first cloud layer because it reuses the existing trust, registry,
verification, and drift machinery.

- Continuously ingest official registry, Docker catalog, ToolPin curated registry,
  and configured ecosystem directories.
- Score every known server with the ToolPin trust model plus cloud-only signals:
  age, download/use signals where available, advisory history, release cadence,
  maintainer continuity, provenance validity, and enforcement history.
- Verify evidence centrally: branch protection/rulesets, required ToolPin status
  checks, package ownership, signatures, SBOMs, SLSA provenance, OCI digests, MCPB
  hashes, GHSA/OSV advisories.
- Publish cached verdicts through an API so the CLI can ask for cloud evidence
  without every installation hammering GitHub, registries, or transparency logs.

This is a supporting asset, not the moat by itself. The real moat is
`mcp-lock.json` adoption as the committed, CI-enforced standard. Registry
intelligence makes that standard more valuable and harder to replace, but a
dataset alone is easier for Anthropic, Stacklok, Docker, or another registry
operator to absorb.

### 2. Drift-as-a-Service

This is the hero paid workflow.

- Enroll a repo and watch its committed `mcp-lock.json`.
- Re-run the equivalent of `toolpin ci --live` continuously, not only when a pull
  request runs CI.
- Send GitHub statuses, Checks API annotations, Slack/webhook events, and issue
  comments when locked servers drift.
- Alert when a publisher rotates keys, tool descriptions change, an advisory lands,
  registry metadata changes, required branch protection disappears, or a curated
  package is demoted.

The local CLI can check at build time. The cloud can check at 03:00 when nobody
has opened a PR. That is the structural SaaS value.

### 3. Org Governance And Audit

This is where enterprise money is.

- Central org policy mapped to local `.toolpin/policy.json` and future signed
  policy bundles.
- Fleet inventory: which repos use which MCP servers, clients, package types,
  remotes, secrets, shipped trust tiers, and curation stages.
- Approval workflows for exceptions, with expiration and reviewer identity.
- Immutable audit log for install, update, lockfile change, policy override,
  advisory acknowledgement, and secret grant.
- SSO/SAML, SCIM, RBAC, audit exports, SARIF aggregation, SBOM/evidence exports,
  and compliance reports.

The local policy file should remain complete enough for open-source use. The
cloud sells coordination, evidence, reporting, and enforcement at org scale.

### 4. Secret Brokering And Optional Gateway

Build this later, if ever. It has higher operational cost and liability.

- The CLI continues to write placeholders, not plaintext secrets.
- A hosted broker could hold or broker real credentials and inject them at
  runtime through a deliberate launcher/shim model.
- A managed gateway could add per-tool ACLs, OAuth/OIDC token exchange, egress
  policy, call logging, and SIEM export.

Do not start here. Secret custody and runtime traffic turn ToolPin into critical
infrastructure. The reputation, drift, and governance business does not require
that risk on day one.

### 5. Publisher Programs And Marketplace

This is last, after the trust dataset matters.

- Verified publisher pages.
- Paid verification assistance.
- Sponsored or featured placement only with strict labeling.
- Publisher analytics for drift, adoption, advisories, and failed installs.

Do not let publisher revenue compromise the trust model. If recommendations can
be bought, the trust product loses credibility.

## How It Can Make Money

Keep the lockfile and CLI free. Charge for hosted operations and org-scale
evidence.

| Tier | Buyer | Paid value |
|---|---|---|
| Free OSS | Individual developers and open-source repos | CLI, lockfile, local CI, local policy, public curated registry, basic GitHub Action. |
| Team Cloud | Small teams using MCP in multiple repos | Continuous drift alerts, repo enrollment, hosted evidence cache, GitHub Checks, Slack/webhooks, simple org policy, team dashboard. |
| Enterprise | Platform/security teams | SSO/SAML, SCIM, RBAC, audit logs, compliance exports, signed policy bundles, exception workflows, fleet inventory, private registry mirrors, support/SLA. |
| Publisher | MCP server maintainers | Optional verified publisher workflow, evidence checks, analytics, and labeled placement after trust quality is established. |
| Runtime Add-on | Security-sensitive orgs | Hosted secret broker, managed gateway, per-tool ACLs, SIEM export, runtime logs. Build only after the lower-capex layers prove demand. |

Pricing can be by enrolled repo, active developer seat, org, or monitored
lockfile. For enterprise, charge for org controls and evidence retention, not for
access to the open standard. The sales wedge is the same as the OSS wedge:
Apache-2.0 and repo-resident enforcement create less legal and runtime friction
than AGPL marketplace installers, hosted-only gateways, or Docker/Kubernetes-first
governance.

## Pre-Work To Do Now

These are useful even if SaaS is never built.

1. Keep the Apache-2.0 license and add a trademark policy for `ToolPin`, `toolpin`,
   and `tpn`.
2. Publish the npm package and tag the GitHub Action so the open standard can
   actually spread.
3. Populate the curated registry with a small number of high-quality entries; an
   empty registry cannot become a trust anchor.
4. Turn curation evidence from self-attestation into machine verification:
   GitHub API checks for branch protection or rulesets, required status checks,
   workflow file existence, and lockfile presence.
5. Add a CLI consumer for `_meta["dev.toolpin/curation"]` so curated status,
   enforcement evidence, and demotion reasons affect local audit output instead
   of being registry-only metadata.
6. Extend `_meta["dev.toolpin/curation"]` with evidence fields that a future cloud
   can reuse:
   - `publisherVerified`
   - `publisherVerificationMethod`
   - `branchProtectionVerifiedAt`
   - `requiredCheckVerifiedAt`
   - `provenanceVerifiedAt`
   - `advisoryCheckedAt`
   - `demotionReason`
   - `evidenceDigest`
7. Add a durable trust/evidence JSON report from CLI commands where it is missing,
   so cloud ingestion can consume the same artifacts users see locally.
8. Add full byte-level verification where feasible: recompute MCPB hashes, verify
   OCI image digests through registry APIs, and validate sigstore/cosign evidence.
9. Broaden advisory integration with OSV and GHSA, while keeping local/offline
   behavior deterministic.
10. Document the Cloud boundary in public docs: the CLI is complete locally; cloud
   is continuous monitoring and org coordination.
11. Avoid adding SaaS-only dependencies, hosted auth assumptions, or remote-required
    checks to core install/CI paths.

## What The Project Lacks Today

- The curated registry is currently scaffolded but empty.
- Curation metadata records `toolpinEnforcement`, but enforcement is still
  self-attested until a checker verifies GitHub branch protection or rulesets.
- The CLI does not yet consume `_meta["dev.toolpin/curation"]`; today it is
  validated by the curated-registry checker rather than reflected in local trust
  or audit output.
- Trust scoring is deterministic but still mostly metadata-based and gameable.
- Attestations are surfaced as declared metadata; ToolPin does not yet fully
  verify sigstore, SLSA, SBOM, or key identity.
- OCI and MCPB verification is not yet byte-level recomputation across the full
  artifact path.
- Tool-description pinning covers names and descriptions, but not full input
  schemas or behavioral semantics.
- There is no public npm release or published action tag yet, so adoption is
  still blocked at distribution.
- There is no trademark policy.
- There is no org identity model, billing model, evidence retention policy, or
  data processing/security posture for a hosted service.
- There is no webhook/event schema for drift notifications.
- There is no private registry mirror, policy bundle signing, or enterprise audit
  trail implementation.
- Secret brokering is intentionally design-gated because ToolPin does not yet
  control process spawn/runtime.

## Build Order If Cloud Becomes Real

### Phase 0: OSS adoption gate

Do not start cloud engineering until the OSS path works in public:

- npm package published;
- GitHub Action tagged and documented;
- at least a few real curated registry entries;
- `toolpin ci` used by external repos;
- clear docs for lockfile, policy, trust, signing, and curated registry;
- trademark policy published.

### Phase 1: Evidence and continuous drift

Build the smallest hosted service that continuously runs the existing trust and
drift checks.

- Repo enrollment through GitHub App.
- Read `mcp-lock.json`.
- Re-resolve locked servers.
- Verify curated registry evidence.
- Post GitHub Checks and webhooks.
- Keep a trust history timeline per server and repo.

### Phase 2: Team governance

Add org-level policy and audit once drift alerts are useful.

- Central policy templates.
- Repo fleet inventory.
- Exception workflow.
- Audit log.
- SSO/RBAC for teams.
- Compliance exports.

### Phase 3: Enterprise registry and evidence

Add private mirrors and stronger supply-chain evidence.

- Signed private registry mirror.
- Advisory sync.
- Provenance/SBOM validation.
- Evidence retention and export.
- SLA/support.

### Phase 4: Runtime services

Only after the trust/governance business is proven:

- secret broker;
- managed gateway;
- per-tool ACLs;
- token exchange;
- runtime logs and SIEM export.

## Things Not To Build Yet

- Do not build a marketplace first.
- Do not build a hosted gateway first.
- Do not make the CLI require cloud.
- Do not put proprietary checks in the lockfile format.
- Do not charge for reading or enforcing `mcp-lock.json`.
- Do not accept paid placement until trust scoring and curation have credibility.
- Do not hold customer secrets until the company is ready for that operational
  and compliance burden.

## Decision Gates

Revisit the SaaS plan on a deliberate 18-24 month adoption clock, and start
cloud implementation only when at least two of these are true:

- external repos are committing `mcp-lock.json`;
- maintainers ask for drift alerts outside PR time;
- platform/security teams ask for fleet visibility across repos;
- MCP servers start publishing provenance evidence ToolPin can verify;
- curated registry entries require ongoing re-verification;
- users ask for central policy or exception workflows;
- enterprises ask for evidence exports or audit logs.

Until then, the best SaaS pre-work is making the open standard credible, adopted,
and evidence-driven.
