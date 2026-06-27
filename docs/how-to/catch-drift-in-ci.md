# Catch Drift in CI

Use `toolpin ci` when `mcp-lock.json` is committed to a repository and pull
requests should fail if registry metadata, generated client config, policy, or
optional signatures no longer match the reviewed lockfile.

`toolpin ci` is read-only. It re-resolves locked entries, rebuilds install
plans, checks lock integrity, enforces policy unless bypassed, and exits
non-zero on drift. It does not update `mcp-lock.json`.

`toolpin ci --sarif` emits SARIF 2.1.0 JSON to stdout and still exits non-zero
on drift:

```bash
toolpin ci --file mcp-lock.json --live --sarif > toolpin.sarif
```

Automatic GitHub code-scanning upload is not wired into the composite action in
this pass; add an explicit upload step after reviewing the desired repository
permissions.

## Basic GitHub Action

After the repository is public and tagged, call the composite action from your
workflow. The action installs ToolPin from the action source by default, so it
does not require npm publish:

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
      - uses: proofofwork-agency/toolpin@v0.2.5
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

## Direct CLI Workflow

Use this form when you want the workflow to install the npm package directly
instead of using the composite Action:

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
`npm run dev -- ci --file mcp-lock.json --live`.

## Digest Pin

`--expect-digest` compares the whole-lock digest against a value provided by
CI. Store the expected digest outside the pull request being checked, for
example as a GitHub Actions variable or secret.

Generate the digest after reviewing a lockfile change:

```bash
toolpin lock digest --file mcp-lock.json
```

Use it in CI:

```yaml
- uses: proofofwork-agency/toolpin@v0.2.5
  with:
    file: mcp-lock.json
    live: "true"
    expect-digest: ${{ vars.TOOLPIN_LOCK_DIGEST }}
```

Do not commit the expected digest next to `mcp-lock.json`; a PR that changes
both files would defeat the check.

## Detached Signature

ToolPin can verify a detached Ed25519 signature before registry resolution:

```bash
toolpin lock sign --policy .toolpin/policy.json --key private.pem --file mcp-lock.json --signature mcp-lock.sig
toolpin lock verify-signature --policy .toolpin/policy.json --key public.pem --file mcp-lock.json --signature mcp-lock.sig
```

Then in CI:

```yaml
- uses: proofofwork-agency/toolpin@v0.2.5
  with:
    file: mcp-lock.json
    live: "true"
    signature: mcp-lock.sig
    public-key: public.pem
```

Commit `mcp-lock.sig` and the public key only after review. Never commit the
private key. A signature is meaningful only when the private key and public
trust root are controlled outside the PR path.

## Policy and Live Verification

To enforce a non-default policy path:

```yaml
- uses: proofofwork-agency/toolpin@v0.2.5
  with:
    policy: security/toolpin-policy.json
```

To make CI skip policy enforcement explicitly:

```yaml
- uses: proofofwork-agency/toolpin@v0.2.5
  with:
    no-policy: "true"
```

To re-run verification before comparing locked plans, use the stricter CI
posture:

```yaml
- uses: proofofwork-agency/toolpin@v0.2.5
  with:
    live: "true"
    verify: "true"
    timeout: "15000"
```

`verify: "true"` can require network access, local runtimes, and server
credentials for live MCP probes. Use `skip-live-verification: "true"` when you
want artifact/metadata verification without live `tools/list` probing. Treat
that as a conscious downgrade: it skips capability hashing and CI rejects it for
entries that already have live capability pins.

## What Fails the Build

CI exits non-zero when:

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
