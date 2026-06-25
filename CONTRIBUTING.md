# Contributing

Thanks for improving ToolPin. This project is intentionally conservative:
security-sensitive commands should fail closed, write the minimum config needed,
and avoid overstating what ToolPin verifies.

## Development Setup

Requirements:

- Node.js 22 or newer.
- npm 10.9.2 or compatible npm 10.

```bash
npm ci
npm test
```

Useful commands:

```bash
npm run build
node dist/cli.js help
node dist/cli.js search github --limit 3 --live
node dist/cli.js ci --file mcp-lock.json --live
```

Do not commit `node_modules/`, `dist/`, local cache files under `.toolpin/`, or
private signing keys. Commit `mcp-lock.json` when the lockfile is the intended
review artifact.

## Project Conventions

- TypeScript ESM, built with `tsc`.
- Tests use Node's built-in `node:test`.
- Keep CLI output stable enough for humans and tests; put machine-readable
  behavior behind `--json`.
- Prefer exact, explicit error messages for security failures.
- Treat registry metadata and MCP tool descriptions as untrusted input.
- Keep install, CI, and policy checks fail-closed. A missing integrity field,
  failed signature, rejected policy, or lock drift should stop the operation.

## Pull Requests

Before opening a PR:

1. Run `npm test`.
2. Update README or docs when command behavior, install paths, lockfile
   semantics, policy behavior, or security claims change.
3. Add or update tests for security-sensitive behavior.
4. Call out any intentional compatibility break in the PR description.

Security-sensitive PRs should state:

- Which boundary changed.
- How the failure mode is handled.
- Whether `toolpin ci`, `toolpin install`, TUI installs, or generated client
  config are affected.

## Documentation Standard

Be precise about guarantees:

- "Verifies" means ToolPin checked exactly what the code checks.
- Presence checks are not byte-level verification.
- Advisory scans are not prompt-injection detection.
- `toolpin ci --expect-digest` is only meaningful when the expected digest
  comes from a trusted source outside the PR being checked.
- Detached signatures are only as trustworthy as the private key and public
  trust root handling.

## Coordinating With Agents

This repository may have multiple agents working in parallel. Read
`AGENTS.md`, stay inside your assigned scope, and never revert unrelated dirty
work. If another agent has modified the same file, adapt to the current file
contents and keep your diff narrow.
