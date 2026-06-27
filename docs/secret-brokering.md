# Secret Brokering Design Gate

ToolPin must not resolve secret-manager references during install.

Install-time resolution writes plaintext credentials into client config files, which is
the exact failure mode secret brokering is meant to avoid. The supported behavior today
is reference generation and pass-through: ToolPin writes client-appropriate placeholders such
as `<TOKEN>`, `${env:TOKEN}`, `${TOKEN}`, or `${{ secrets.TOKEN }}` and leaves actual
resolution to the client/runtime environment.

## Shipped Guardrail

`toolpin secrets audit` is a read-only advisory check. It reads `mcp-lock.json`, locates
matching client config entries across all supported project/global config locations by
default, and reports likely plaintext secrets without printing the secret value.

The audit is intentionally conservative:

- It treats registry `isSecret` env/header metadata as the primary signal.
- It also flags a small set of well-known secret prefixes in env/header fields.
- It does not use entropy scoring.
- It does not block install, CI, or policy by default.
- It never resolves `op://`, `vault://`, or `doppler://` references.
- It reports file, server, client, variable name, and a redacted value only.

## Rejected For Now

- **Install-time secret resolution**: rejected because it writes plaintext credentials to
  disk.
- **Implicit runtime brokering**: rejected because ToolPin currently writes config; it does
  not spawn MCP servers for clients.
- **Plaintext-secret blocking policy**: deferred. ToolPin 0.2.0 shipped the
  opt-in `denyRequiredSecrets` policy rule for installs whose selected target
  declares required secrets. A broader `denyPlaintextSecrets` rule that blocks
  actual plaintext values in client config remains future work after the
  read-only audit has proven useful.
- **Merge-time placeholder preservation**: deferred. Preserving a user's edited
  reference across reinstall is useful, but it changes config merge semantics and needs a
  separate review.

## Future Runtime Model

Real brokering requires a deliberate launcher model. A future ToolPin-managed spawn shim could
resolve `op://`, `vault://`, or `doppler://` at process start, inject values into the child
environment, and keep plaintext out of client config files. That is a product/runtime
decision, not a package-install side effect.
