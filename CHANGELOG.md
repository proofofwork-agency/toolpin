# Changelog

## 0.5.1

- Internal launch preparation work (promotion strategy, candidate discovery, and outreach templates) executed locally. These materials are not published in the public repository.
- Full release gate verified (355 tests, self:doctor, self:ci, docs:check, docusaurus build, registry, audit clean).

## 0.5.0

- Breaking runtime baseline: ToolPin now requires Node.js 24 or newer. The
  GitHub Action sets up Node 24 for itself, so repositories whose app/test jobs
  still run on Node 18, 20, or 22 can keep those jobs unchanged and run ToolPin
  in a separate CI job or final CI step.
- Runtime dependency lane adopted for issue #7: `undici` moves to 7.28.0,
  `@types/node` to 24.13.3, and TypeScript to 6.0.3. CI, release workflow, and
  composite Action runtime setup now use Node 24.
- `safeFetch` keeps the DNS-pinned undici dispatcher behavior while narrowing
  the Node ambient `fetch` / direct undici type mismatch at a single adapter
  boundary. The injected `fetch?: typeof fetch` test seam is unchanged.
- Detached lock-signature key fingerprints now explicitly normalize to public
  SPKI DER bytes before hashing, satisfying the stricter TypeScript 6 / Node 24
  crypto types without changing signature semantics.
- Dependabot policy now tracks the adopted lanes: minor and patch updates keep
  flowing for undici 7, Node 24 types, and TypeScript 6, while future
  incompatible majors (`undici >=8`, `@types/node >=25`, TypeScript >=7) stay
  deferred to an explicit runtime-upgrade lane.
- Launch docs now include an evidence-backed, opt-in-only adoption candidate
  list. ToolPin must not be auto-added to third-party repositories without org
  ownership or explicit maintainer approval.

## 0.4.0

- Tool-surface pinning (rug-pull defense): `capabilityManifest` gains an
  additive `toolSurfaceHash` — sha256 over canonical
  `{name, description?, inputSchema?}` records per tool — so live drift
  detection now covers tool input schemas, not just names and descriptions.
  When present, the surface hash owns live-surface drift (schema changes,
  coverage downgrades, unrefreshable pins fail closed); legacy
  `toolDescriptionHash`/`toolManifestHash` locks keep working with a non-fatal
  CI advisory to re-lock. Legacy-only pins report `needs-review: input schemas
  not pinned`. `lockfileVersion` stays 2.
- Three-verdict trust output: public output collapses internal trust tiers to
  `verified` / `needs-review` / `blocked`, each with a reason; `--explain`
  restores tier/profile/evidence/capability detail. JSON output keeps every
  existing field and adds `verdict`; the TUI legend matches. Fatal contexts
  (`verify`/`install`/`ci`/`policy` failures) escalate weak-pin criticals to
  `blocked` while passive browsing keeps them `needs-review`.
- `toolpin init ci`: one command takes a repo from nothing to protected — it
  writes a minimal least-privilege GitHub workflow (`contents: read`, checkout
  pinned to a commit SHA) plus a starter policy when `mcp-lock.json` exists,
  and prints fail-closed guidance when it doesn't. Idempotent; `--dry-run` writes nothing; refuses partial setup when a
  conflicting workflow exists. `policy init --recommended` writes the starter
  policy on its own (conditional minimum tier, OCI digest + MCPB sha256 pins
  required, verified-evidence requirement off so fresh repos can lock first and
  tighten later).
- CI gate output: `toolpin ci` gains `--json` (`ok` / `checkedEntries` /
  `failures[]` with remediation hints) and a per-protection checklist in human
  output; a policy that silently applied no rules now reports `SKIPPED`.
- GitHub Action hardening: `doctor` input is `auto|true|false` (protects
  committed client config), new `strict` preset (`--verify
  --require-verified`, never blanket-skips live verification), `sarif` input +
  `sarif-path` output, Marketplace branding, tri-state
  `verify`/`require-verified` with fail-closed conflict handling, `source`
  defaulting to the lockfile-recorded source, and all inputs env-mediated.
- MCP Install Lockfile specification v1.0 (draft): vendor-neutral lockfile spec
  at `docs/spec/mcp-lockfile-v1.md` — RFC 8785 canonicalization with NFC
  duplicate-key rejection, `(name, client, scope)` entry identity, typed
  package/remote target union, tool-surface pins covering input schemas,
  generic verification evidence, namespaced extensions, detached ed25519
  signature envelope, conformance classes, versioning policy — plus
  machine-readable JSON Schemas (`schemas/`), positive/negative fixtures with
  byte-exact vectors, and conformance tests wired into `npm test`. The spec and
  schemas ship in the npm tarball. ToolPin's v2 lockfile is documented as a
  predecessor profile; no breaking shipped-format changes (the only lockfile
  addition in this release is the optional `toolSurfaceHash` above).
- Docs: README rewritten around the lockfile + CI drift gate positioning with a
  complete command overview, TUI key/panel documentation, a CI Gate chapter
  with the full Action input matrix, and a Lockfile Standard section; docs site
  updated from description-only pin language to input-schema surface pinning;
  CLI `--help`, npm description, and site taglines aligned.
- Release hygiene: the repository's own GitHub workflows SHA-pin their actions,
  Dependabot keeps npm and Actions dependencies updated weekly, and the release
  gate now checks that the git tag matches `package.json`, that the changelog's
  top versioned heading matches the package version, and that `SECURITY.md`
  lists the current release line.
- Internal: `src/cli.ts` split into focused command modules under
  `src/commands/` (zero behavior change); `src/version.ts` is generated from
  `package.json` at build time.
- Security (probe env isolation): live `test`/`verify` probes now spawn MCP
  servers with a minimal environment allowlist plus the server's declared env
  vars, instead of the caller's full `process.env`. Probing an untrusted package
  can no longer read `GITHUB_TOKEN`, npm, or cloud credentials. Non-secret
  infrastructure vars (Docker daemon config, CA cert paths) stay in the
  allowlist; set `TOOLPIN_SPAWN_ENV_ALLOW=VAR1,VAR2` to explicitly pass extra
  variables (e.g. `HTTPS_PROXY`) through to spawned servers when needed.
- Security (SSRF): registry ingestion now goes through the `safeFetch` firewall
  and non-loopback remote MCP probe transports go through the matching pinned
  fetch — both HTTPS-only, both refusing redirects, both restricted to public
  addresses (loopback probe targets stay available for local development). This
  blocks cloud-metadata (`169.254.169.254`) and private-host access via
  registry-declared remote URLs or a repo-supplied `.toolpin/registries.json`,
  including a public endpoint that tries to 3xx-redirect the probe to a private
  IP literal. Self-hosted registries can opt back in with `allowHttp` /
  `allowPrivateHosts`.
- Security (execution opt-in): verification never executes package targets
  implicitly anymore. `verify`, `lock --verify`, `install --verify`,
  `ci --verify`, `audit --verify`, and the guided interactive flow run network
  artifact checks and remote probes only; spawning the package for live
  `tools/list` hashing (`npx`, `uvx`, `docker run`, ...) now requires the
  explicit `--allow-execute` flag (action input `allow-execute: "true"`).
  Without it, reports carry a `package_execution_skipped` warning and the live
  capability pin is `unavailable`; `ci` refuses up front to re-verify live
  capability pins on package entries. `toolpin scan --live` is gated the same
  way: a live scan of a package target needs `--allow-execute`, otherwise the
  live tool-description scan is skipped and only the metadata scan runs.
  `toolpin test` remains an explicit execution command and now prints the exact
  command and env var names before launching.
- Security (shell preview): the TUI/interactive command previews single-quote
  untrusted server names and query text so a copied command cannot trigger
  `$(...)`, backtick, or `$VAR` expansion.
- Security (trust model): evidence carried in registry metadata is now read as
  a claim, never proof. A curated-registry `_meta` entry declaring
  `passed`/`verifiedByToolPin` artifact evidence is downgraded to `declared`
  with `verifiedByToolPin: false` on ingestion, so the `verified` tier,
  `requireToolPinVerifiedEvidence`, and fresh-artifact gates are only satisfied
  by this installation's own recompute (`toolpin verify`, `--verify` flows).
  Behavior note: curated entries now show `conditional`/`REVIEW` until locally
  re-verified — matching the documented meaning of `REVIEW` — and a lockfile
  entry locked at tier `verified` needs `toolpin ci --verify` (which recomputes
  artifact proof) to avoid a tier-downgrade drift finding in CI. Compatibility:
  existing lockfiles are not rewritten in place, so evidence already recorded as
  ToolPin-verified in `mcp-lock.json` stays honored until it goes stale or you
  re-verify/re-lock — the change hardens fresh ingestion, it does not
  retroactively invalidate committed lock evidence.
- Fix (data loss): `install`/`remove` refuse to overwrite an existing client
  config that is not valid JSON, instead of silently replacing it with only the
  new entry.
- Fix (lockfile stability): a default `install` no longer rewrites a matching
  `mcp-lock.json` entry, so signed / `--expect-digest` lockfiles stay valid.
- Fix (OCI verify): live OCI probes pass declared env vars via `-e`, matching the
  installed launcher.
- Fix (CLI parsing): value flags reject a missing or flag-like value and numeric
  flags reject non-integers rather than silently falling back.
- Security (DNS rebinding): ToolPin-initiated HTTP(S) connections now pin the
  vetted DNS answer into the socket. `safeFetch` routes through an `undici`
  dispatcher whose connect-time lookup re-validates every resolved address, and
  remote MCP probe transports (SSE / streamable HTTP) use the same pinned fetch
  for non-loopback targets. A hostname whose DNS answer flips from a public to
  a private/metadata address between the preflight check and the connection is
  refused when the socket is built, closing the rebinding TOCTOU in the
  private-address firewall. (Servers spawned for live probes still perform
  their own networking; that surface is governed by the probe env isolation
  above, not by this firewall.)

## 0.3.2

- TUI trust labels: clarify that `REVIEW` means missing, stale, unavailable, or only-declared ToolPin-verified npm, OCI, or MCPB artifact proof.
- TUI overview: label the upper metadata block as a registry summary and separate it from verification gates.
- Docs: surface `toolpin interactive` / `tpn i` in the Docusaurus introduction and document the TUI evidence/status meanings explicitly.
- Release hygiene: version bump 0.3.1 -> 0.3.2 for the public-launch clarity pass.

## 0.3.1

- Packaging: normalize the npm `bin` paths for the `toolpin` and `tpn`
  executables so global installs link both commands correctly.
- Release hygiene: version bump 0.3.0 -> 0.3.1.

## 0.3.0

- Interactive CLI: add the guided `toolpin interactive` / `tpn i` flow
  (`src/interactive.tsx`, `src/interactive/workflow.ts`) for search →
  recommendation → install/lock in one screen.
- Terminal styling: add a shared ANSI color layer (`src/terminalStyle.ts`,
  `--color auto|always|never`) used across CLI output.
- Docs/tests: document the interactive command and cover the interactive
  workflow and terminal styling with tests.

## 0.2.5

- Release hygiene: version bump 0.2.4 -> 0.2.5 for the post-release TUI polish.
- TUI UX: give trust legend swatches horizontal spacing, add vertical breathing room to the footer hotkey row, and anchor the trust legend at the bottom-right of the footer.
- Dogfood: keep the release pipeline gated by `toolpin ci` against this repo's own `mcp-lock.json`.

## 0.2.4

- Release hygiene: version bump 0.2.3 -> 0.2.4 because 0.2.3 was already published.
- Package hygiene: clean `dist/` before every TypeScript build so removed generated files cannot be packed into npm tarballs.
- TUI command help: align the command palette with the actual broad registry refresh settings and the preferred `toolpin audit server <server-name>` syntax.
- Docs/readme polish: update public Action examples, package-facing README resource links, registry mirror URLs, roadmap/threat-model scope, and README terminal artwork for the live npm release.
- Action metadata: remove pre-publication wording from the `toolpin-version` input description.

## 0.2.3

- Honesty pass: the README "Verification currently covers" line and `docs/site/reference/lockfile-schema.md` now describe attestations as declared metadata, not verified, and `attestation_verified` was removed from the evidence-code list. A `docs:check` regression guard forbids the overclaiming phrasing so it cannot silently return.
- CI self-check (dogfooding): `toolpin ci` now runs against the repository's own `mcp-lock.json` in CI (`npm run self:ci`) and is chained into `release:check`, so the publish gate enforces the product's own drift check on itself.
- Curated-evidence trust seam closed: registry evidence sourced from the ToolPin curated registry may only count toward the `verified` tier when its `trustAnchor` host is on the code allowlist for that evidence code (npm packument/tarball hosts, allowlisted OCI registries, allowlisted MCPB sources). A self-declared `trustedAnchor: true` with a missing or non-allowlisted host is downgraded to `trustedAnchor: false`. Regression test added.
- Policy source normalization: the legacy `pulse` alias in `allowedSources`/`deniedSources` is accepted and normalized to the canonical `pulsemcp`, `toolpin` was added to the source enum, and unknown sources fail closed. Tests added.
- CLI docs: corrected `toolpin lock sign`/`verify-signature` synopses in the CLI reference and the catch-drift how-tos to include the required `--policy` argument and the `--public-key` flag.
- Runtime audits: `npm run audit:runtime` (`npm audit --omit=dev`) added to `release:check`.
- TUI review UX: the default Browse search is empty instead of prefilled with `github`, empty Browse now lists registry entries without a hidden fallback keyword, and the footer includes a compact trust-state legend (`OK`, `REVIEW`, `UNVERIFIED`, `BLOCKED`).
- Repo hygiene: stopped tracking the internal `docs/research/mcp-sentiment.md` positioning brief and the `website/CLAUDE-DESIGN-BRIEF.md` design deck (now gitignored); marked the homepage install demo as an illustrative placeholder and surfaced the pre-1.0 beta status on the landing page; kept npm distribution claims honest before publication.
- Release hygiene: version bump 0.2.2 -> 0.2.3.

## 0.2.2

- Release positioning: mark ToolPin as pre-1.0 beta software in the README while keeping the package on the normal `0.x` semver release track.
- Distribution: switch the npm package target to `@proofofwork-agency/toolpin` while keeping the `toolpin` and `tpn` CLI binaries.
- README/docs: lead with npm-first install and CI examples, call out the `tpn` shortcut, add an animated terminal workflow plus TUI screenshots to the README, and keep source-checkout commands as development-only fallbacks.
- Curated ContextRelay verification: accept ToolPin-owned npm tarball integrity evidence from the curated registry, validate it against `registry.npmjs.org`, and show verified curated entries as evidence-complete without overriding ordinary registry metadata rules.
- Registry cache correctness: invalidate stale built-in ToolPin cache partitions when the bundled curated registry snapshot changes, so users do not keep seeing removed or outdated trusted listings after upgrading.
- Installed inventory: expose stale lock-only rows as deletable in the TUI and remove stale lock entries from the repo lockfile so audit no longer reports servers that are gone from client config.
- ContextRelay install metadata: clarify that Codex support is a stdio MCP registration, not a Codex plugin, and document the upstream `ctxrelay codex-mcp install` path alongside ToolPin's direct Codex config install.
- Contributor workflow: make curated-registry PRs ask explicitly for install targets, runtime/package details, and per-client setup fields.
- Release hygiene: defer the pending npm release from `0.2.1` to `0.2.2` so the evidence, cache invalidation, and install-metadata changes are represented in the published version.

## 0.2.1

- Publish readiness: aligned the npm package homepage gate with the public GitHub Pages documentation site.
- Release identity: bumped the package/runtime version past the existing `v0.2.0` tag so the npm artifact can be tagged from the final release commit without moving an old tag.
- Public registry/docs polish: keep the curated registry focused on the ToolPin ContextRelay entry, sync CLI/help examples, and preserve the `release:check` gate as the publish prerequisite.

## 0.2.0

- Gated trust model: separated metadata-completeness from an evidence-gated `verified` tier that requires verified provenance, a pinned install target, and fresh (`verifiedByToolPin`) artifact evidence (≤7 days). Non-verified entries are capped (`conditional`/`unverified`/`blocked`) with a human-readable cap reason.
- Added a code-owned OCI registry allowlist (`verificationTrust.ts`) plus a hardened `safeFetch` (HTTPS-only, private/reserved IPv4 + IPv6 block, timeouts, size caps, `redirect:"error"`). The publisher-controlled-host OCI digest-spoof path is closed: non-allowlisted hosts are rejected before any fetch.
- Artifact verification: OCI registry manifest digest resolution (with critical `oci_digest_mismatch`), MCPB SHA-256 byte recompute for code-allowlisted HTTPS hosts (local/`file://`/HTTP/untrusted stay unavailable), and npm tarball SHA-512 SRI via `registry.npmjs.org` packuments.
- Directory install unblock: discovery sources (Glama, Smithery, PulseMCP) became real adapters. Glama servers install via official-registry re-resolution (canonical repo-URL match, refuse-on-ambiguity). Smithery hosted deployment targets install only with explicit `--allow-hosted-directory-targets` opt-in and are labelled "hosted by Smithery; subject to Smithery terms." Discovery sources are disabled by default and enable via `toolpin registry enable`.
- Policy additions: `minTrustTier`, `requireToolPinVerifiedEvidence`, `denyRemoteEndpoints`, `denyRequiredSecrets`, all enforced fail-closed across install/CI/lifecycle/TUI.
- Governance: `toolpin audit` aggregates lockfile + installed inventory + drift + secrets + policy + optional verification across `--scope all|project|global` (default `all`). Universal `--help`, typo-tolerant flag parsing (`Did you mean ...`), and `--flag=value` support.
- Repo/legal: added `DISCLAIMER.md` (no warranty, liability cap, indemnity), `CLA.md` (Apache-ICLA-based, with transparent relicense clause), `.cla-signatures/`. README leads with a "No warranty — you assume all risk" callout. Release workflow uses `npm publish --provenance`.
- Honest non-goals unchanged: `verified` means automated evidence checks passed, not that a server is safe; no sigstore/cosign identity proof, no full-image byte recompute, no prompt-injection detection.

## 0.1.0

- Initial prerelease hardening track for ToolPin lockfiles, policy checks, registry normalization, CI drift detection, and TUI review workflows.
- Hardened `safeFetch` against IPv4-mapped and IPv4-compatible IPv6 private-address forms before artifact fetches.
- Added trusted OCI registry-digest evidence, including critical mismatch handling for digest-pinned OCI targets.
- Re-enabled MCPB SHA-256 verification for code-allowlisted HTTPS artifact hosts while keeping local paths, `file://`, HTTP, and untrusted hosts unavailable.
- Added npm package integrity verification through `registry.npmjs.org` packuments, exact versions, `dist.integrity`, trusted npm tarball hosts, and SHA-512 SRI comparison.
