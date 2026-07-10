# Catch Drift in CI

Use `toolpin ci` when `mcp-lock.json` is committed and pull requests should
fail if reviewed MCP installs drift against registry metadata, generated
install-plan config, lock integrity, policy, signatures, or verification
inputs.

`toolpin ci` is read-only. It re-resolves locked entries, rebuilds install
plans, checks lock integrity, enforces policy unless bypassed, and exits
non-zero on drift. It does not update `mcp-lock.json`.

## Five-line Setup

After you have at least one reviewed lock entry, initialize CI:

```bash
toolpin init ci
```

This writes:

- `.github/workflows/toolpin.yml`
- `.toolpin/policy.json` when it does not already exist

If `mcp-lock.json` is missing, `init ci` writes nothing and tells you to create
a lock first:

```bash
toolpin install <server> --client <client> --update-lock
# or
toolpin lock <server> --client <client>
```

Commit the workflow, policy, and lockfile together. CI now fails on MCP drift.

The generated workflow uses the composite action:

```yaml
name: ToolPin
on: [pull_request, push]
permissions:
  contents: read
jobs:
  toolpin:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - uses: proofofwork-agency/toolpin@v0.5.3
```

By default the action runs `toolpin ci --file mcp-lock.json --live` and lets the
CLI use each lockfile entry's recorded registry source. Older lockfiles without
a recorded source still fall back to `--source all`.

ToolPin itself requires Node.js 24 or newer. The Action sets up that runtime
inside the composite action, so your application's build and test jobs can
remain on Node 18, 20, or 22. For older app runtimes, run ToolPin in a separate
CI job or as the final CI step after the app-specific Node setup.

## Doctor Mode

The action has a `doctor` input:

| Input | Behavior |
|---|---|
| `doctor: auto` | Default. Runs `toolpin doctor --scope project` when known project MCP config files exist. |
| `doctor: "true"` | Always runs doctor before CI. Doctor failure fails the action. |
| `doctor: "false"` | Never runs doctor. |

`doctor:auto` looks for project config files such as `.mcp.json`,
`.cursor/mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`, `opencode.json`,
`.gemini/settings.json`, and `.roo/mcp.json`.

Use `doctor: "false"` only when project client config files are intentionally
not committed.

## Action Reference

Every input maps to a `--flag` on `toolpin ci` (or `toolpin doctor`). Inputs
reach the script as environment variables and are never shell-interpolated.

| Input | Default | Purpose |
|---|---|---|
| `working-directory` | `.` | Directory that contains the lockfile. |
| `file` | `mcp-lock.json` | Lockfile path, relative to `working-directory`. |
| `source` | (empty) | `--source` registry. Empty uses each entry's recorded source; older locks fall back to all. |
| `live` | `"true"` | Fetch live registry data instead of local cache. |
| `verify` | (empty) | Tri-state. Run verification before comparing locked plans. |
| `require-verified` | (empty) | Tri-state. Require fresh ToolPin-verified evidence; requires `verify`. |
| `strict` | `"false"` | Preset for `verify` + `require-verified`. Conflicting explicit inputs fail closed with exit 2. |
| `doctor` | `auto` | `auto`, `true`, or `false`. Run doctor before ci. |
| `sarif` | `"false"` | Write `toolpin-ci.sarif` and expose the `sarif-path` output. |
| `expect-digest` | (empty) | Expected whole-lock digest from a trusted out-of-band source. |
| `signature` | (empty) | Detached signature path. Must be set with `public-key`. |
| `public-key` | (empty) | Public key path. Must be set with `signature`. |
| `toolpin-version` | (empty) | Install this published npm version instead of building the action source. |
| `policy` | `.toolpin/policy.json` | Policy file path. |
| `no-policy` | `"false"` | Pass `--no-policy` and skip policy enforcement. |
| `timeout` | `"15000"` | Live verification timeout in milliseconds. |
| `skip-live-verification` | `"false"` | Pass `--skip-live-verification` when verify is enabled. |
| `allow-execute` | `"false"` | Let live verification execute package targets. |

| Output | Value |
|---|---|
| `sarif-path` | Path to `toolpin-ci.sarif`, set only when `sarif: "true"`. |

Boolean inputs are validated; malformed values exit 2. `strict`, `live`,
`no-policy`, `skip-live-verification`, `allow-execute`, and `sarif` must be
`true` or `false`; `verify` and `require-verified` also accept empty. `doctor`
must be `auto`, `true`, or `false`.

## Trust Tiers Without `--verify`

A `toolpin ci` run without `--verify` recomputes registry evidence as claims
(`verifiedByToolPin: false`), so it can never re-earn a lock entry's locally
verified tier by itself. The gate therefore accepts a recorded `verified` tier
as long as every locked artifact integrity claim (npm SRI, OCI digest, MCPB
hash) is still declared unchanged by the registry — and fails when a claim
changes or disappears, or when a `--verify` run genuinely demotes the tier.

Two ways to demand more than unchanged claims:

```bash
toolpin ci --verify        # re-hash artifacts and re-earn the tier with local proof
toolpin ci --strict-tier   # refuse claim-backed acceptance; verified-tier entries
                           # fail unless the run also re-earns them with --verify
```

## Strict Mode

Use strict mode when CI should require fresh ToolPin-verified artifact proof:

```yaml
- uses: proofofwork-agency/toolpin@v0.5.3
  with:
    strict: "true"
```

`strict: "true"` expands to:

```bash
toolpin ci --verify --require-verified
```

It does not automatically pass `--skip-live-verification`. Remote live pins are
re-probed over the guarded network transport. Package live pins require
execution to re-verify; CI fails with an actionable error unless you opt in:

```yaml
- uses: proofofwork-agency/toolpin@v0.5.3
  with:
    strict: "true"
    allow-execute: "true"
```

Conflicting inputs fail closed. For example, `strict: "true"` with
`verify: "false"` or `require-verified: "false"` exits before running ToolPin.
`require-verified: "true"` also requires `verify: "true"`.

## SARIF

To write SARIF for code scanning, enable `sarif` and upload the file in a
separate step. The composite action does not upload SARIF itself because upload
permissions belong to the caller's workflow.

```yaml
permissions:
  contents: read
  security-events: write

steps:
  - uses: actions/checkout@v4
  - id: toolpin
    uses: proofofwork-agency/toolpin@v0.5.3
    with:
      sarif: "true"
  - uses: github/codeql-action/upload-sarif@v3
    if: always()
    with:
      sarif_file: ${{ steps.toolpin.outputs.sarif-path }}
```

The SARIF file is `toolpin-ci.sarif`.

## Digest Pin

`expect-digest` compares the whole-lock digest against a value from outside the
pull request.

```bash
toolpin lock digest --file mcp-lock.json
```

Store the digest as a CI variable or secret, then run:

```yaml
- uses: proofofwork-agency/toolpin@v0.5.3
  with:
    expect-digest: ${{ vars.TOOLPIN_LOCK_DIGEST }}
```

Do not commit the expected digest next to `mcp-lock.json`; a pull request could
change both.

## Signature Check

```bash
toolpin lock sign --policy .toolpin/policy.json --key private.pem --file mcp-lock.json --signature mcp-lock.sig
toolpin lock verify-signature --policy .toolpin/policy.json --key public.pem --file mcp-lock.json --signature mcp-lock.sig
```

Then in CI:

```yaml
- uses: proofofwork-agency/toolpin@v0.5.3
  with:
    signature: mcp-lock.sig
    public-key: public.pem
```

The `signature` and `public-key` inputs must always be supplied together. The
action fails closed if only one is set. Keep the private key outside the pull
request path.

## Policy

`toolpin init ci` creates a starter `.toolpin/policy.json` if one is absent.
The default policy blocks unsafe entries while allowing `needs-review` entries
so fresh repos can adopt locking before requiring verified proof.

To enforce a non-default policy path:

```yaml
- uses: proofofwork-agency/toolpin@v0.5.3
  with:
    policy: security/toolpin-policy.json
```

To skip policy enforcement explicitly:

```yaml
- uses: proofofwork-agency/toolpin@v0.5.3
  with:
    no-policy: "true"
```

## Direct CLI

Use the CLI directly when you do not want the composite action:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 24
  - run: npm install -g @proofofwork-agency/toolpin
  - run: toolpin doctor --file mcp-lock.json --scope project
  - run: toolpin ci --file mcp-lock.json --live
```

`toolpin ci --json` emits a machine-readable result: `ok`, `checkedEntries`,
and a `failures` array of `{ entryName, client, condition, remediation }`,
plus a per-protection status for lock integrity, registry drift, policy,
verification, signature, and digest. Human output ends with the same
per-protection checklist.
`toolpin ci --sarif` emits SARIF 2.1.0 JSON to stdout and still exits non-zero
on drift.

## What Fails

CI exits non-zero when:

- Doctor runs and a committed project client config entry is missing,
  unreadable, or different from `mcp-lock.json`.
- `mcp-lock.json` is missing, empty, malformed, or has an unsupported version.
- Per-entry lock integrity is missing or invalid.
- A locked server/client no longer resolves to the reviewed install plan
  (version, target, trust, generated config, or capability manifest drifted).
- The live `tools/list` surface hash (`toolSurfaceHash`, covering tool names,
  descriptions, and input schemas) no longer matches the pin, its coverage was
  downgraded ("tool surface coverage downgraded"), or a locked surface pin
  could not be refreshed.
- The whole-lock digest (`expect-digest`) does not match.
- Detached signature verification fails, or `signature` and `public-key` are
  not supplied as a pair.
- The selected policy rejects a locked entry.
- Strict verification or explicit `verify: "true"` finds critical verification
  findings.
- Live package-pin reverification would execute a package and
  `allow-execute: "true"` was not set.

Legacy description-only pins do not fail. ToolPin prints a non-fatal advisory
recommending a re-lock with `--update-lock` to capture input schemas.
Re-verifying a live pin executes the package for package targets (hence
`allow-execute: "true"`) and re-probes remote targets over an SSRF-guarded
transport.

Use `toolpin install --update-lock` or `toolpin lock <server> --client <client>`
only after reviewing the drift locally. CI should not update the lockfile.
