# ToolPin Code+Docs Sync Audit — 10-Agent Report

> Scope: verify `README.md` and all `docs/` are fully consistent with the current implementation in `src/`. Find and fix every code-vs-doc drift.
> Method: 10 parallel read-only explore agents, each auditing one slice of the codebase against the docs, then synthesizing and applying fixes. Verified with `npm run build`, `npm test`, and `npm run registry:check`.
> Date: Jun 2026.

---

## TL;DR

The README and docs were **highly accurate** (client matrix, policy, secrets, CI/digest/signing, registry, SARIF, doctor all matched the code 1:1). The defects were concentrated in three areas: a **stale Commands block** (missing lifecycle commands), **overstated TUI claims** (a "no modal focus trapping" line that was false), and **brittle README/src line-citations** in `threat-model.md`, `strategy-and-moat.md`, and `ROADMAP.md`. All were fixed. Build is clean and **162/162 tests pass**.

---

## Method — the 10 agents

| # | Agent | Coverage |
|---|---|---|
| 1 | CLI commands & flags | `src/cli.ts` vs README Commands block |
| 2 | TUI hotkeys & features | `src/tui/**` vs README TUI section |
| 3 | Client config matrix | `src/config.ts`, `docs/client-configs.md`, 12-client claims |
| 4 | Policy enforcement | `src/policy.ts`, enforcement points |
| 5 | Secrets audit | `src/secrets.ts`, placeholder patterns |
| 6 | CI / drift / digest / signing | `src/ci.ts`, `src/signing.ts`, `action.yml` |
| 7 | Registry & sources | `src/registry.ts`, `registry/`, custom-registry docs |
| 8 | Verify / scan / SARIF / trust | `src/verify.ts`, `src/scan.ts`, `src/sarif.ts`, `src/trust.ts` |
| 9 | Versions / installed / doctor | `src/versions.ts`, `src/installed.ts`, `src/doctor.ts` |
| 10 | Docs structure & consistency | all `docs/**`, links, version refs, ROADMAP status |

---

## Discrepancies found and fixed

### README.md

- **Commands block was missing lifecycle commands.** `test-installed`, `adopt`, `update`, `update --all` were advertised in the *What Exists Now* prose but absent from the authoritative Commands code block. The `version`/`--help` entries and the `ls`/`installed` aliases were also missing. **Fixed:** all added, grouped logically.
- **`--client` was shown as required** for `plan`, `install`, `policy check`, `lock`, and `export-config`, but the code (`clientFlag(rest, "generic")`) defaults to `generic` when omitted. **Fixed:** marked optional, documented the default, and introduced a `<client>` shorthand to keep the block readable.
- **"No modal focus trapping" claim was false.** The README stated all hotkeys stay live in every panel with no modal trapping. In reality the install wizard (`i`/`I`) and the Installed delete modal (`x`) **do** trap input (`app.tsx` returns early in both). **Fixed:** reworded to state the two real traps.
- **"Click a result row to select/open it" overstated.** A row click only *selects*; it never opens. **Fixed:** "select it".
- **Undocumented palette-only actions.** `:info`, `:audit`, `:ci` exist in the command palette but were not in the hotkey list. **Fixed:** added, marked as palette-only.
- **Tabs 4/5/6 nuance.** Overview/Install/Config require a selected server; `tab` skips them until one is. **Fixed:** documented.
- **Trust-signal list omitted `unknown package types`.** `src/trust.ts` emits an `unknown_package_type` warning (−8) for package types outside `{npm,pypi,nuget,cargo,oci,mcpb}` — a real score-affecting signal absent from the enumeration. **Fixed:** added.
- **Advisory-scan severity imprecision.** README said findings "are warnings", but `agent_forced_tool_order` and `cross_tool_instruction` are severity `info` (SARIF `note`). **Fixed:** "advisory (warning or info level)".
- **Status fields mis-attributed to `toolpin list`.** The `registry:exact|alias|none` / `action:update|adopt|none` / `test:config|none` trio is computed only in the TUI path (`loadInstalledServerStates`); the CLI `list` prints names only. **Fixed:** scoped the status claim to the TUI Installed tab.
- **GitHub Actions inputs under-documented.** The README mentioned only `live`/`file`/`toolpin-version`; `action.yml` defines 13 inputs, including the completely-undocumented `working-directory` and `source`. **Fixed:** added a full inputs table.

### docs/threat-model.md

- Stale README line citations. "README:74" (actually the Node.js prereq line) and "README:143" (a code-fence close). **Fixed:** replaced brittle line numbers with stable section references (*What Exists Now*, *Local Policy*).

### docs/strategy-and-moat.md

- Stale README line citation ("lines 69, 74, 75, 143, 155"). **Fixed:** section references.
- Glama facts contradicted the corrected `docs/comparison.md`. Said "A/B/C/D grades" + "10k+ servers" + "opaque grading"; the corrected doc establishes transparent **TDQS** (Tool Definition Quality Score, 1–5 across six dimensions) and ~48k servers. **Fixed:** aligned to TDQS.
- `mcpm` project identity (`@khanglvm/mcpm`) differed from the current `pathintegral-institute/mcpm`. **Fixed:** aligned.
- Stale `install.ts:182` line ref. **Fixed:** `src/install.ts` (generic global case).

### docs/ROADMAP.md

- **Verify fail-closed marked as future.** The "Metadata pin enforcement" row said v0.2 would fail closed and that it was "currently only scored" — but `src/verify.ts` **already fails closed** on mutable OCI / MCPB-missing-`fileSha256`. **Fixed:** marked *Shipped in v0.1*; fixed stale `trust.ts` line refs.
- **Per-client env syntax listed as a TODO** but `placeholderFor` (`src/config.ts`) already implements `${env:NAME}` / `${NAME}` / `${{ secrets.NAME }}` / `<NAME>`. **Fixed:** marked *Shipped in v0.1*.

### src/cli.ts (help text)

- The `toolpin ci` help line omitted `--source`, `--skip-live-verification | --skip-live-verify`, and `--timeout` (all implemented + in README). **Fixed:** added.
- `lock sign` / `lock verify-signature` help lines omitted `[--json]` (handlers support it). **Fixed:** added.

### Curated-registry URLs (dead-ends)

- The how-tos showed an old **post-rename** URL that 404s today, with only a vague "use the matching raw GitHub URL for the current location" caveat that never stated the actual current URL. **Decision:** did not mass-flip ~30 URLs (would fight the documented rename intent and touch npm/SARIF identity). **Fixed:** added the working current URL inline (`proofofwork-agency/toolpin`) to all 5 user-facing docs, preserving the rename target.
  - `docs/how-to/toolpin-curated-registry.md`, `docs/how-to/custom-registries.md`, `registry/README.md`, `docs/site/how-to/toolpin-curated-registry.md`, `docs/site/how-to/custom-registries.md`.

---

## Verified accurate (no action needed)

These claims were checked against the code and matched exactly — no fixes required:

- **Client matrix:** exactly **12 clients**; README list matches `ALL_CLIENTS` 1:1.
- **Per-client troubleshooting:** Claude global fail-closed, Cursor `.cursor/mcp.json`, Zed fail-closed (both scopes), Roo global fail-closed, Windsurf/Cline/Continue global-only, Codex TOML `[mcp_servers.<name>]` table form + inline/dotted limitation, generic `~/.config/toolpin/` sidecar — all match `src/install.ts` and `src/codexToml.ts`.
- **Policy:** all 12 fields match `src/policy.ts`; enforcement at `install`/`ci`/`policy check`/TUI all genuine; unknown keys rejected; example JSON validates.
- **Secrets:** all 7 placeholder patterns present (`<TOKEN>`, `${env:TOKEN}`, `${TOKEN}`, `${{ secrets.TOKEN }}`, `op://`, `vault://`, `doppler://`); read-only + `[REDACTED]` guarantee holds.
- **CI / digest / signing:** Ed25519, fail-closed-before-registry-resolution, canonical digest that excludes top-level file timestamps but covers entry timestamps, never-mutates — all match code + tests.
- **Registry:** official/docker/custom sources, `official-compatible` vs `http-json` defaults, `.toolpin/registries.json`, cache fallback — all match.
- **SARIF 2.1.0** from `scan`/`verify`/`ci`; verify rejects mutable OCI + MCPB without `fileSha256`; `install --verify` persists capability manifest.
- **Doctor** read-only reconciliation + Codex TOML inline/dotted limitation confirmed.
- **Versions/outdated/lifecycle** (`test-installed`, `adopt`, `update`, `update --all`, `--dry-run`) all exist and behave as documented.

---

## Minor nuances flagged (not defects)

- **Secrets audit** also keys off `isRequired` (not only `isSecret`) — `capabilities.ts` uses `isSecret || isRequired`. README slightly understates the trigger; behavior is conservative (safer), so left as-is.
- **`deniedRemoteHosts`** uses Node `URL.host`, which strips default ports (`https://x:443` → `x`). The README's `example.com:443` illustration is therefore not literally matchable; the exact-match/no-suffix claim is otherwise correct.
- **Resolved later:** `cacheHasSource("all")` now checks every enabled source, so a cache lacking an enabled custom source triggers a live fallback under `--source all`.

---

## Verification

- `npm run build` → **clean**
- `npm test` → **162/162 pass**
- `npm run registry:check` → **OK (0 curated entries)**
- Doc-accuracy edits committed (by coordinator agent Codex) in `835d1d6` ("Add CLI version parity and install progress polish").

---

## Open item (human-gated, intentionally deferred)

**Repository URL rename.** Resolved. The git remote, `package.json` homepage/repository/bugs fields, and `src/sarif.ts` help URIs now point to `proofofwork-agency/toolpin` (live). The user-facing how-to dead-ends were already closed inline above.

---

## Note on execution context

A coordinator agent (Codex) was concurrently editing this repository (TUI features) during the audit. The doc-accuracy fixes merged cleanly with its feature work; both were committed. All edits are present in `HEAD`.
