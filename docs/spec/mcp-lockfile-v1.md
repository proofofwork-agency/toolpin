# MCP Install Lockfile Specification v1.0 (Draft)

**Status:** Draft for review — not yet frozen.
**File name:** `mcp-lock.json`
**Spec identifier:** `mcp-lock/1`
**Editors:** ToolPin maintainers.
**License:** This specification text is Apache-2.0, like the reference implementation.

This document specifies a vendor-neutral file format for recording, verifying,
and enforcing the installation state of MCP (Model Context Protocol) servers.
It exists so that *any* tool — not only ToolPin — can write, read, and enforce
the same lockfile. ToolPin's shipped `lockfileVersion: 2` format predates this
specification and is documented separately as an implementation profile; this
spec does not change v2 semantics.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119.

---

## 1. Purpose and threat model

An MCP client that connects to a server trusts three distinct things:

1. **The artifact** — the package bytes that will run (npm tarball, OCI image,
   MCPB bundle, remote endpoint).
2. **The declared surface** — the tools, resources, and prompts the server
   presents to the agent at connection time. Tool descriptions and input
   schemas steer agent behavior and are read live on every connection.
3. **The generated client configuration** — what was actually written into the
   client's config file (command, args, env names, URLs).

Published guidance (NSA CSI *Model Context Protocol: Security Considerations*,
OWASP MCP Top 10, OWASP MCP Security Cheat Sheet) prescribes pinning all three
and alerting on drift, because each is attackable independently:

- a registry entry can be re-published with different bytes (supply-chain swap);
- a server can keep its artifact stable but mutate its declared tool surface
  after approval (the "rug pull" — takes effect with no change on the consumer
  side);
- a config writer can be tricked into writing something other than what was
  reviewed.

A lockfile that pins only files does not cover threat 2. This specification
therefore treats the **declared surface pin** as a first-class citizen next to
artifact integrity.

Out of scope: runtime behavior enforcement (gateways/proxies), static code
scanning, secret storage. A conforming lockfile never contains secret values.

## 2. Document structure

A lockfile is a single UTF-8 encoded JSON document:

```json
{
  "specVersion": 1,
  "generatedAt": "2026-07-07T12:00:00.000Z",
  "updatedAt": "2026-07-07T12:00:00.000Z",
  "entries": [ /* Entry objects, see §3 */ ],
  "extensions": { /* namespaced, see §7 */ }
}
```

| Field | Type | Required | Covered by whole-lock digest (§8.3) |
|---|---|---|---|
| `specVersion` | integer | MUST | yes |
| `generatedAt` | RFC 3339 timestamp | MAY | **no** |
| `updatedAt` | RFC 3339 timestamp | MAY | **no** |
| `entries` | array of Entry | MUST (may be empty only in a newly initialized file; enforcers treat an empty lock as failure, §9) | yes |
| `extensions` | object | MAY | yes |

Top-level timestamps are informational metadata: two locks that differ only in
`generatedAt`/`updatedAt` are the same lock. Every other byte of the document
is security-relevant.

## 3. Entry

One Entry records one reviewed decision: "this server, resolved to this target,
for this client, produced this configuration."

```json
{
  "name": "io.github.example/postgres",
  "version": "1.4.2",
  "client": "claude-code",
  "scope": "project",
  "source": { "registry": "https://registry.modelcontextprotocol.io", "id": "io.github.example/postgres" },
  "target": { /* §4 */ },
  "surface": { /* §5 */ },
  "configDigest": "sha256-4rL...=",
  "verification": [ /* §6 */ ],
  "resolvedAt": "2026-07-07T11:59:58.120Z",
  "lockedAt": "2026-07-07T12:00:00.000Z",
  "extensions": { /* §7 */ },
  "integrity": "sha256-Qm9...="
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | MUST | Server identity as published (reverse-DNS form when the source registry uses it). |
| `version` | MUST | Resolved version string. |
| `client` | MUST | Lower-kebab client identifier (e.g. `claude-code`, `cursor`, `vscode`, `generic`). Not an enum: readers MUST accept unknown client identifiers. |
| `scope` | MAY | `project` (default) or `user`. |
| `source` | MUST | Where resolution happened: `registry` (URL) and `id`, or `{"registry": "manual"}` for hand-added entries. |
| `target` | MUST | Typed target union, §4. |
| `surface` | SHOULD | Declared-surface pin, §5. Enforcers MUST treat a missing `surface` as reduced coverage, not as failure, unless policy requires it. |
| `configDigest` | MUST | SHA-256 (§8.1) of the canonical generated client config fragment. The config itself is not part of the neutral core (it may contain machine-specific paths); implementations MAY store it under `extensions`. |
| `verification` | MAY | Evidence array, §6. |
| `resolvedAt` | MUST | When the target was resolved. Covered by `integrity`. |
| `lockedAt` | MUST | When the entry was (re)written. Covered by `integrity`. |
| `extensions` | MAY | §7. Covered by `integrity`. |
| `integrity` | MUST | §8.2. The only entry field excluded from its own computation. |

**Entry identity** is the tuple `(name, client, scope)`. A document MUST NOT
contain two entries with the same identity tuple. (This replaces map keying by
`"<name>:<client>"`, which is ambiguous when names contain `:`.)

## 4. Target union

`target.type` discriminates. Readers MUST reject entries whose `target.type`
they do not recognize (an unknown target type cannot be meaningfully enforced).

### 4.1 `package`

```json
{
  "type": "package",
  "registryType": "npm",
  "identifier": "@example/postgres-mcp",
  "version": "1.4.2",
  "transport": "stdio",
  "artifact": { "digest": "sha256-…=", "method": "npm-sri" }
}
```

- `registryType`: `npm`, `oci`, `mcpb`, `pypi`, `nuget`, or a reverse-DNS
  extension value. `identifier` semantics follow the registry type (OCI
  identifiers MUST carry an immutable `@sha256:` digest reference).
- `artifact.digest`: content digest of the artifact in §8.1 format, when the
  producer verified bytes. `artifact.method` names how (`npm-sri`,
  `oci-manifest-digest`, `mcpb-sha256`, extension values allowed).
  If the producer could not verify bytes it MUST omit `artifact` rather than
  copy a publisher-declared value into it; declared values belong in
  `verification` with `status: "declared"` (§6).

### 4.2 `remote`

```json
{
  "type": "remote",
  "transport": "streamable-http",
  "url": "https://mcp.example.com/v1",
  "headerSecretNames": ["EXAMPLE_API_KEY"]
}
```

- `url` MUST be `https:`. `headerSecretNames` records *names only*; a document
  containing a secret value anywhere is non-conforming.

## 5. Surface pin

The declared-surface pin defends against post-approval mutation of what the
agent sees.

```json
{
  "hash": "sha256-t9X…=",
  "coverage": ["name", "description", "inputSchema"],
  "toolCount": 12,
  "capturedAt": "2026-07-07T11:59:59.000Z"
}
```

- `hash`: §8.1 digest of the canonical form (§8) of the ordered array of tool
  records captured from a live `tools/list` response. Each tool record contains
  exactly the fields named in `coverage`, in that field order, tools sorted by
  `name` (UTF-16 code unit order).
- `coverage`: which fields are pinned. Conforming producers MUST support at
  least `["name", "description"]`; SHOULD include `"inputSchema"`. Readers MUST
  compare hashes only when coverage matches, and MUST treat a coverage
  *downgrade* (e.g. an update removing `inputSchema` from coverage) as drift.
- `capturedAt` is metadata and is excluded from the hashed tool records but
  included in entry `integrity` (the pin's own provenance is reviewable).

## 6. Verification evidence

Evidence records *who verified what, how* — without baking any vendor into the
format:

```json
{ "code": "artifact-integrity", "status": "passed", "verifier": "toolpin/0.4.0",
  "method": "npm-sri", "anchor": "registry.npmjs.org", "verifiedAt": "…", "required": true }
```

- `status`: `passed` | `failed` | `declared` | `unavailable`.
- `declared` means copied from publisher/registry metadata without independent
  verification. Producers MUST NOT report publisher claims as `passed`.
- `verifier` is free-form `tool/version`. `anchor` names the trust anchor
  consulted (registry host, transparency log, key fingerprint).

## 7. Extensions

All vendor- and tool-specific data lives under `extensions` objects keyed by
reverse-DNS namespace:

```json
"extensions": { "dev.toolpin": { "trust": { "tier": "verified", "score": 92 } } }
```

- Readers MUST ignore extension namespaces they do not understand.
- Extension content IS covered by `integrity` and the whole-lock digest —
  unknown data is still tamper-evident.
- Nothing in the neutral core may require any particular extension. A document
  with zero extensions is fully conforming.

## 8. Canonical form, hashing, and signatures

### 8.1 Digest format

All digests in this specification are written `sha256-<base64>` — the SHA-256
of the canonical bytes, standard base64 with padding (SRI-style). One format
everywhere; future algorithms would arrive as a new prefix in a new spec minor.

### 8.2 Canonicalization and entry integrity

Canonical form is **RFC 8785 (JSON Canonicalization Scheme)** applied to the
value, encoded as UTF-8. In addition, before canonicalization, readers and
producers MUST reject any JSON object (anywhere in the document) that contains
two member names that are equal after Unicode NFC normalization — this closes
homograph/duplicate-key smuggling, which RFC 8785 alone does not address.

`integrity` = §8.1 digest of the canonical form of the Entry object **with the
`integrity` member removed**. Every other member, including unknown members and
`extensions`, is covered.

### 8.3 Whole-lock digest

The whole-lock digest = §8.1 digest of the canonical form of:

```json
{ "specVersion": …, "entries": […], "extensions": … }
```

i.e. the top-level document with `generatedAt` and `updatedAt` removed (and
`extensions` omitted from the reconstruction when absent). Entries retain their
`integrity` members here. The digest is not stored inside the lockfile; it is
computed on demand and carried in CI variables or signature envelopes.

### 8.4 Detached signature envelope

Signing is OPTIONAL. A signature is a detached JSON document (`mcp-lock.sig`):

```json
{
  "schema": "mcp-lock-signature",
  "version": 1,
  "algorithm": "ed25519",
  "lockfileDigest": "sha256-…=",
  "policyDigest": "sha256-…=",
  "publicKeyFingerprint": "sha256-…=",
  "signedAt": "2026-07-07T12:00:01.000Z",
  "signature": "<base64>"
}
```

- Signing payload = canonical form (§8.2) of the envelope **with the
  `signature` member removed**. `signedAt` is inside the payload by design:
  a valid signature binds its own claimed time.
- `publicKeyFingerprint` = §8.1 digest of the SPKI DER encoding of the public key.
- `policyDigest` optionally binds a policy document to the same review.
- `algorithm` is `ed25519` in v1; verifiers MUST reject unknown algorithms.

## 9. Conformance classes

**Producer** — writes conforming documents: resolves targets, captures surface
pins from live `tools/list`, computes `configDigest` and `integrity`, never
reports declared evidence as verified, never writes secret values.

**Reader** — parses and validates: enforces §2–§8 structural rules, entry
identity uniqueness, NFC duplicate rejection, and recomputes `integrity` before
trusting any entry.

**Enforcer** — a Reader that additionally gates: given a lockfile and the
current resolvable state, it MUST fail (non-zero exit / failed check) when any
of the following hold:

1. the lockfile is missing, empty, malformed, or any entry fails `integrity`;
2. re-resolution of an entry's `source` yields a different `target`;
3. a captured surface hash differs from the pinned `surface.hash`
   (or coverage was downgraded);
4. the generated config for an entry no longer matches `configDigest`;
5. a provided whole-lock digest or signature fails to verify.

Enforcers MUST NOT mutate the lockfile. Enforcers SHOULD emit machine-readable
output (JSON and/or SARIF) naming the failed condition and the entry identity.

## 10. Versioning policy

- `specVersion` is a major version. Readers MUST reject documents whose major
  version they do not support.
- Within a major version, later spec revisions may add OPTIONAL fields. Readers
  MUST accept (and hash — §8.2 covers all bytes) member names they do not
  recognize in Entry, `target`, `surface`, evidence records, and the top level.
  Strict tooling MAY warn. Readers MUST NOT reject a document solely because it
  contains an unknown optional member outside `extensions`.
- Semantics of existing fields never change within a major version.

## 11. Relationship to the ToolPin v2 lockfile (informative)

ToolPin's shipped `lockfileVersion: 2` format is the reference implementation's
predecessor profile. Differences a migrator will meet: v2 keys entries by
`"<name>:<client>"` map keys; requires ToolPin trust tiers inline; uses a
custom canonicalization (NFC-normalized keys, lexicographic sort) rather than
RFC 8785; stores generated client config inline; and mixes hex and SRI-style
digests. A migration path (v2 → spec v1 with `dev.toolpin` extensions) will be
specified separately before this draft freezes.

## 12. Test vectors

Normative test vectors live in `test/fixtures/spec/` in the reference
repository: positive documents, negative documents (each named for the rule it
violates), and digest/signature vectors (input → canonical bytes → digest →
envelope). A conforming implementation reproduces every vector byte-for-byte.
