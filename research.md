# ToolPin — Build Report (via ntfy)

This file is a verbatim record of the completion notifications sent to the
`pow-finished-jobs` ntfy.sh channel by opencode (model: glm-5.2).

---

## Notification 1 — "I am going to bed" (completion summary)

**Title:** I am going to bed
**Priority:** high

Completed by opencode (model: glm-5.2) in repo proofofworks/TPN (ToolPin).

TASK: Analyze full code+docs with 10 agents; sync README.md and docs.

WHAT I DID (10 parallel agents -> fixes applied + verified):
- README.md Commands block: added missing commands (test-installed, adopt, update, update --all, version, help, ls/installed aliases), marked --client optional (defaults to generic), added <client> shorthand.
- README.md TUI section: corrected false 'no modal focus trapping' claim (install wizard + delete modal DO trap input), fixed 'click to select/open' -> 'select', added palette actions (:info, :audit, :ci), noted tabs 4/5/6 need a selected server.
- README.md: added 'unknown package types' to trust-signal list; softened advisory 'warnings' -> 'advisory (warning or info)'.
- README.md: scoped registry/action/test status fields to the TUI Installed tab (CLI list prints names only).
- README.md GitHub Actions: added full action.yml inputs table incl. previously-undocumented working-directory + source.
- docs/threat-model.md: replaced stale README line citations (README:74, :143) with section references.
- docs/strategy-and-moat.md: fixed stale README line cites; corrected Glama facts (A/B/C/D -> transparent TDQS, ~48k servers); fixed mcpm org name; fixed install.ts line ref.
- docs/ROADMAP.md: marked verify fail-closed + per-client env syntax as Shipped in v0.1 (were wrongly 'pending'); fixed stale code line refs.
- src/cli.ts: fixed stale 'toolpin ci' help line (added --source/--skip-live-verification/--timeout) and [--json] on lock sign/verify-signature.

VERIFICATION: npm run build clean; npm test = 162/162 pass. Edits committed (by coordinator Codex) in 835d1d6 'Add CLI version parity and install progress polish'.

1 ITEM NEEDS YOUR DECISION (not auto-fixed): repo URL rename. Git remote is proofofwork-agency/toolpin (live/working), but package.json + several docs point to proofofworks/TPN (future name) -> example URLs currently 404. Decide which name is canonical, then I/Codex can standardize all references.

All tasks finished. Sleep well.

---

## Notification 2 — "ToolPin FULL report (10-agent code+docs audit)"

**Title:** ToolPin FULL report (10-agent code+docs audit)
**Priority:** high
**Size:** 6109 bytes

ToolPin — Full Code+Docs Sync Report
Sent by: opencode (model: glm-5.2) | Repo: proofofworks/TPN | Task: 10-agent audit -> sync README + docs

============================================================
PART 1 — METHOD
============================================================
10 parallel read-only explore agents, each auditing one slice of code-vs-docs:
 1. CLI commands & flags        6. CI / drift / digest / signing
 2. TUI hotkeys & features      7. Registry & sources
 3. Client config matrix        8. Verify / scan / SARIF / trust
 4. Policy enforcement          9. Versions / installed / doctor
 5. Secrets audit              10. Docs structure & consistency

============================================================
PART 2 — DISCREPANCIES FOUND AND FIXED
============================================================

[README.md]
FIXED: Commands block was missing test-installed, adopt, update, update --all,
  version, help, and the ls/installed aliases -> all added, grouped logically.
FIXED: --client was shown as REQUIRED for plan/install/policy-check/lock/
  export-config, but code defaults to 'generic' -> marked optional + documented
  the default.
FIXED: TUI claimed "no modal focus trapping" — FALSE. The install wizard (i/I)
  and the Installed delete modal (x) DO trap input. Reworded to state this.
FIXED: TUI "click a result row to select/open it" — click only selects, never
  opens. Corrected to "select it".
FIXED: Added undocumented palette-only actions :info, :audit, :ci.
FIXED: Documented that tabs 4/5/6 (Overview/Install/Config) need a selected
  server, and tab skips them until one is.
FIXED: Trust-signal list omitted 'unknown package types' (a real -8 warning in
  trust.ts) -> added.
FIXED: Advisory scan said findings "are warnings", but 2 codes are severity
  'info' (SARIF 'note') -> reworded to "advisory (warning or info level)".
FIXED: Line attributed registry/action/test status fields to BOTH `toolpin list`
  AND the TUI, but the CLI list only prints names -> scoped status to the TUI
  Installed tab.
FIXED: GitHub Actions section only mentioned live/file/toolpin-version. Added a
  full action.yml inputs table, including the previously-undocumented
  'working-directory' and 'source' inputs.

[docs/threat-model.md]
FIXED: Stale README line citations. "README:74" (was actually the Node.js
  prereq line; the digest claim is far later) and "README:143" (a code fence)
  -> replaced with stable section references (README 'What Exists Now' and
  'Local Policy') so they no longer rot when lines shift.

[docs/strategy-and-moat.md]
FIXED: Stale README line citation "lines 69, 74, 75, 143, 155" -> section refs.
FIXED: Glama row contradicted the corrected comparison.md. Said "A/B/C/D grades"
  and "10k+ servers" / "opaque grading" -> corrected to transparent TDQS
  (Tool Definition Quality Score, 1-5 across six dims) and ~48k servers.
FIXED: mcpm project identity '@khanglvm/mcpm' -> 'pathintegral-institute/mcpm'
  to match the current comparison.md.
FIXED: Stale 'install.ts:182' line ref -> 'src/install.ts, generic global case'.

[docs/ROADMAP.md]
FIXED: 'Metadata pin enforcement' claimed verify fail-closed was "v0.2, currently
  only scored" — WRONG, verify.ts ALREADY fails closed -> marked Shipped in v0.1,
  fixed stale trust.ts line refs.
FIXED: 'Per-client env syntax' listed as a TODO but placeholderFor() already
  implements ${env:NAME}/${NAME}/${{ secrets.NAME }}/<NAME> -> marked Shipped.

[src/cli.ts]  (help text, not just docs)
FIXED: 'toolpin ci' help line was missing --source, --skip-live-verification,
  and --timeout (all implemented + in README) -> added.
FIXED: 'lock sign' / 'lock verify-signature' help lines missing [--json] (the
  handlers support it) -> added.

============================================================
PART 3 — VERIFIED ACCURATE (no action needed)
============================================================
- Client matrix: exactly 12 clients; README list matches ALL_CLIENTS 1:1.
- All per-client troubleshooting claims (Claude global fail-closed, Cursor paths,
  Zed fail-closed, Roo global fail-closed, Windsurf/Cline/Continue global-only,
  Codex TOML table form, generic ~/.config/toolpin sidecar) match install.ts.
- docs/client-configs.md paths/root-keys/transport shapes all current.
- Policy: all 12 fields match policy.ts; enforcement at install/ci/policy-check/
  TUI all genuine; unknown keys rejected; example JSON validates.
- Secrets: all 7 placeholder patterns present; read-only/redacted guarantee holds.
- CI/digest/signing: Ed25519, fail-closed-before-resolution, timestamp-insensitive
  canonical digest, never-mutates — all match code + tests.
- Registry: official/docker/custom sources, official-compatible vs http-json
  defaults, .toolpin/registries.json, cache fallback — all match.
- SARIF 2.1.0 from scan/verify/ci verified; verify rejects mutable OCI + MCPB
  without fileSha256; install --verify persists capability manifest.
- Doctor read-only reconciliation + Codex TOML inline/dotted limitation confirmed.

============================================================
PART 4 — VERIFICATION
============================================================
- npm run build : CLEAN
- npm test      : 162/162 PASS
- Edits committed (by coordinator agent Codex) in commit 835d1d6
  "Add CLI version parity and install progress polish", plus 7409746
  "Add TUI sources view".

============================================================
PART 5 — STILL OPEN (needs human / in-progress)
============================================================
REPO URL RENAME: git remote is proofofwork-agency/toolpin (LIVE, working).
  But package.json + docs/how-to/* + registry/README.md point to
  proofofworks/TPN (the future name) -> those example URLs currently 404.
  Decision required: standardize on which canonical name.
  (Handled next under 'full control' — see follow-up.)

NOTE: A coordinator agent (Codex) is concurrently editing this repo
  (TUI features). My doc fixes merged cleanly with its work; both committed.

— end of full report —

---

## Notification 3 — "ToolPin — ALL TASKS COMPLETE" (final, after URL fix)

**Title:** ToolPin — ALL TASKS COMPLETE
**Priority:** default

opencode (glm-5.2) signing off — everything is finished.

FINAL BATCH (repo-URL dead-ends resolved under full control):
The curated-registry how-tos showed the post-rename URL (proofofworks/TPN) which 404s today. Decision: did NOT mass-flip ~30 URLs (would fight the documented rename intent + touch npm/SARIF identity). Instead added the WORKING current URL inline so no user hits a silent 404, while keeping the rename target intact.
- docs/how-to/toolpin-curated-registry.md : + current working URL
- docs/how-to/custom-registries.md        : + current working URL note
- registry/README.md                      : + current working URL
- docs/site/how-to/toolpin-curated-registry.md : + current working URL
- docs/site/how-to/custom-registries.md   : + current working URL note
Left deliberately (human-gated, tied to rename): package.json npm identity, src/sarif.ts help URIs.

VERIFICATION: npm run registry:check = OK; npm run build = CLEAN; npm test = 162/162 PASS.

STATUS OF ALL TASKS:
[x] 10-agent code+docs audit
[x] README.md synced (commands, TUI, trust signals, list status, action inputs)
[x] docs/*.md synced (threat-model, strategy-and-moat, ROADMAP citations/facts)
[x] cli.ts stale help text fixed
[x] Broken curated-registry URLs given working current mirror
[x] Full report delivered to this channel
Earlier edits already committed by coordinator (Codex) in 835d1d6.

Repo is consistent: build green, tests green, docs match code. Sleep well — opencode out.
