---
title: Catch Drift in CI
---

# Catch drift in CI

Use `toolpin ci` when `mcp-lock.json` is committed and pull requests should fail
if reviewed MCP installs drift against registry metadata, generated install-plan
config, policy, signatures, or verification inputs.

`toolpin ci` is read-only. It re-resolves locked entries, rebuilds install
plans, checks lock integrity, enforces policy unless bypassed, and exits
non-zero on drift. It does not update `mcp-lock.json`.

Use `toolpin doctor --scope project` as a separate gate when project client
config files are committed and must match `mcp-lock.json`. `doctor` reads files
such as `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, and
`.codex/config.toml`; `ci` does not read local client config files.

`toolpin ci --sarif` emits SARIF 2.1.0 JSON to stdout and still exits non-zero
on drift:

```bash
toolpin ci --file mcp-lock.json --live --sarif > toolpin.sarif
```

Automatic GitHub code-scanning upload is not wired into the composite action in
this pass; add an explicit upload step after reviewing the desired repository
permissions.

## Project config and lockfile workflow

Use this workflow when project client config files are committed and should
match `mcp-lock.json`:

```yaml
name: ToolPin

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  mcp-lock:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g @proofofwork-agency/toolpin
      - run: toolpin doctor --file mcp-lock.json --scope project
      - run: toolpin ci --file mcp-lock.json --live
```

Omit the `doctor` step only when the repository does not commit project client
config files.

## Composite action for lockfile-only CI

The composite action installs ToolPin from the action source by default, so it
does not require npm publish. Use it when you only need `mcp-lock.json`
enforcement:

```yaml
name: ToolPin

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  mcp-lock:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: proofofwork-agency/toolpin@v0.3.2
        with:
          file: mcp-lock.json
          live: "true"
```

The action builds ToolPin from `$GITHUB_ACTION_PATH` and runs:

```bash
toolpin ci --file mcp-lock.json --source all --live --policy .toolpin/policy.json
```

When `.toolpin/policy.json` is absent, the current CLI treats policy enforcement
as a no-op.

## Direct CLI

Install the CLI directly from npm when you only need lockfile enforcement:

```yaml
name: ToolPin

on:
  pull_request:

permissions:
  contents: read

jobs:
  mcp-lock:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g @proofofwork-agency/toolpin
      - run: toolpin ci --file mcp-lock.json --live
```

For unreleased source-checkout development, run `npm ci`, `npm test`, and
`npm run dev -- ci --file mcp-lock.json --live`. Add
`npm run dev -- doctor --file mcp-lock.json --scope project` before `ci` when
project client config files are committed.

## Digest pin

`--expect-digest` compares the whole-lock digest against a value from outside
the pull request.

```bash
toolpin lock digest --file mcp-lock.json
```

Store the digest as a CI variable or secret, then run:

```yaml
- uses: proofofwork-agency/toolpin@v0.3.2
  with:
    file: mcp-lock.json
    live: "true"
    expect-digest: ${{ vars.TOOLPIN_LOCK_DIGEST }}
```

Do not commit the expected digest next to `mcp-lock.json`; a pull request could
change both.

## Signature check

```bash
toolpin lock sign --policy .toolpin/policy.json --key private.pem --file mcp-lock.json --signature mcp-lock.sig
toolpin lock verify-signature --policy .toolpin/policy.json --key public.pem --file mcp-lock.json --signature mcp-lock.sig
```

Then in CI:

```yaml
- uses: proofofwork-agency/toolpin@v0.3.2
  with:
    file: mcp-lock.json
    live: "true"
    signature: mcp-lock.sig
    public-key: public.pem
```

The private key and trust root must be managed outside the pull request path.

## Policy and live verification

To enforce a non-default policy path:

```yaml
- uses: proofofwork-agency/toolpin@v0.3.2
  with:
    policy: security/toolpin-policy.json
```

To make CI skip policy enforcement explicitly:

```yaml
- uses: proofofwork-agency/toolpin@v0.3.2
  with:
    no-policy: "true"
```

To re-run verification before comparing locked plans, use the stricter CI
posture:

```yaml
- uses: proofofwork-agency/toolpin@v0.3.2
  with:
    live: "true"
    verify: "true"
    timeout: "15000"
```

`verify: "true"` may require network access, local runtimes, and server
credentials for live MCP probes. Use `skip-live-verification: "true"` when you
want artifact/metadata verification without a live `tools/list` probe. Treat
that as a conscious downgrade: it skips capability hashing and CI rejects it for
entries that already have live capability pins. The signature/public-key pair
(`signature` + `public-key`) must always be passed together; the action fails
closed if only one is supplied.

## What fails

CI exits non-zero when:

- `toolpin doctor --scope project` is included and a committed project client
  config entry is missing, unreadable, or different from `mcp-lock.json`.
- `mcp-lock.json` is missing, empty, malformed, or has an unsupported version.
- Per-entry lock integrity is missing or invalid.
- A locked server/client no longer resolves to the reviewed install plan
  (version, target, trust, generated config, or capability manifest drifted).
- The whole-lock digest (`--expect-digest`) does not match.
- Detached signature verification fails, or `signature` and `public-key` are not
  supplied as a pair.
- The selected policy rejects a locked entry.
- `--verify` finds critical verification findings.
- `--sarif` changes the output format only; it does not make failing checks
  advisory.

Use `toolpin install --update-lock` or `toolpin lock <server> --client <client>`
only after reviewing the drift locally. CI should not update the lockfile.
