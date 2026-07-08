---
title: Lockfile Specification
---

# MCP Install Lockfile Specification

ToolPin's long-term position is that MCP install lockfiles should be a
*format*, not a product feature. The **MCP Install Lockfile Specification
v1.0 (draft)** defines that format independently of ToolPin, so other tools
can produce, read, and enforce the same lockfiles.

The canonical specification lives in the repository and ships inside the npm
package:

- Specification:
  [`docs/spec/mcp-lockfile-v1.md`](https://github.com/proofofwork-agency/toolpin/blob/main/docs/spec/mcp-lockfile-v1.md)
- Lockfile JSON Schema:
  [`schemas/mcp-lockfile-v1.schema.json`](https://github.com/proofofwork-agency/toolpin/blob/main/schemas/mcp-lockfile-v1.schema.json)
- Signature JSON Schema:
  [`schemas/mcp-lock-signature-v1.schema.json`](https://github.com/proofofwork-agency/toolpin/blob/main/schemas/mcp-lock-signature-v1.schema.json)
- Fixtures and byte-exact test vectors:
  [`test/fixtures/spec/`](https://github.com/proofofwork-agency/toolpin/tree/main/test/fixtures/spec)

## What the spec defines

- **Entry identity** — a `(name, client, scope)` tuple per entry, instead of
  ambiguous composite keys.
- **Typed install targets** — a package/remote union covering npm, PyPI,
  NuGet, Cargo, OCI, MCPB, and remote endpoints, each with its own integrity
  anchor (SRI digest, image digest, file hash, or pinned URL).
- **Tool-surface pins with declared coverage** — a hash over the tool records
  the agent sees, with an explicit coverage array (`name`, `description`,
  `inputSchema`) so a reader knows what a pin does and does not protect.
- **Deterministic hashing** — RFC 8785 (JCS) canonical JSON with mandatory
  post-NFC duplicate-member-name rejection; SRI-style `sha256-<base64>`
  digests; per-entry integrity plus an optional whole-lock digest.
- **Detached ed25519 signatures** — a signature envelope with `signedAt`
  inside the signed payload and SPKI key fingerprints.
- **Extensions** — vendor data lives under reverse-DNS `extensions`
  namespaces and stays covered by integrity digests, so it is
  tamper-evident without being normative.
- **Versioning for tolerant readers** — unknown members are preserved and
  remain covered by digests; readers reject only what the spec requires them
  to reject.

## Conformance classes

| Class | Obligation |
|---|---|
| Producer | Emits documents that validate against the schema and hash rules. |
| Reader | Parses, validates, and reports drift without modifying the lock. |
| Enforcer | A Reader that also gates an install or CI run on the result. |

A CI tool can be a conformant Enforcer for lockfiles it did not create.

## Relationship to ToolPin's `mcp-lock.json`

ToolPin's current on-disk format (lockfile v2, documented in
[Lockfile schema](./lockfile-schema.md)) predates the spec and is mapped in
the spec as the predecessor profile, including a field-by-field mapping
table. ToolPin will provide a migration path before renaming any fields;
until then, `mcp-lock.json` v2 remains the format ToolPin reads and writes,
and the spec is the target other implementations should build against.

Conformance is tested: `test/specConformance.test.js` validates the shipped
schemas, positive/negative fixtures, and byte-exact digest and signature
vectors on every ToolPin CI run.
