# Security Policy

ToolPin is a trust and install-time governance tool for MCP servers. Please do
not disclose suspected vulnerabilities in public issues until they have been
triaged.

## Supported Versions

| Version | Supported |
|---|---|
| `0.4.x` | Yes (current) |
| `0.3.x` | Limited |
| `< 0.3.0` | No |

Pre-1.0 releases may change lockfile, policy, and CLI behavior. Security fixes
will be released on the latest minor line unless a backport is explicitly
announced.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting when it is available for this
repository. If private reporting is not available, email the maintainer listed
for the project and include `ToolPin security report` in the subject.

Please include:

- A concise description of the issue and affected command or file.
- Reproduction steps, preferably against a minimal `mcp-lock.json` or registry
  fixture.
- The expected security boundary and the observed bypass.
- Whether any secrets, signatures, lockfiles, or client configs were exposed.

Do not include live secrets, private signing keys, or production client config
files. Redact values before attaching logs.

## Response Targets

- Initial acknowledgement: 5 business days.
- Triage decision: 10 business days after enough reproduction detail is
  available.
- Coordinated disclosure target: 30 days for accepted high-impact issues, or a
  mutually agreed timeline when a fix needs upstream coordination.

## Security Scope

In scope:

- Lockfile integrity or signature verification bypasses.
- `toolpin ci` false positives that allow drift or tampering to pass.
- Policy enforcement bypasses in `install`, `ci`, or TUI install flows.
- Plaintext secret disclosure in logs, reports, or generated config.
- Registry metadata parsing bugs that lead to unsafe config generation.

Out of scope unless they lead to one of the above:

- Prompt-injection bypasses of advisory text scans.
- Vulnerabilities in third-party MCP servers installed through ToolPin.
- Runtime sandbox escapes after an MCP server is already running.
- Social engineering, spam, or denial-of-service against public infrastructure.

See `docs/threat-model.md` for the current security model and non-goals.
