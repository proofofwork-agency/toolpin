// Regenerates the normative spec fixtures and test vectors in test/fixtures/spec/.
// Deterministic by construction: fixed timestamps, fixed vector key seed.
// Run: node scripts/gen-spec-vectors.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalize,
  digest,
  entryIntegrity,
  publicKeyFingerprint,
  signEnvelope,
  surfaceHash,
  vectorKeyPair,
  wholeLockDigest,
} from "./spec-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = join(root, "test", "fixtures", "spec");
const T0 = "2026-07-07T12:00:00.000Z";
const T1 = "2026-07-07T11:59:58.120Z";
const T2 = "2026-07-07T11:59:59.000Z";

function finalizeEntry(entry) {
  return { ...entry, integrity: entryIntegrity(entry) };
}

function lockDocument(entries, extensions) {
  const doc = { specVersion: 1, generatedAt: T0, updatedAt: T0, entries };
  if (extensions !== undefined) doc.extensions = extensions;
  return doc;
}

// --- Positive fixtures ---
const packageEntry = finalizeEntry({
  name: "io.github.example/postgres",
  version: "1.4.2",
  client: "claude-code",
  scope: "project",
  source: { registry: "https://registry.modelcontextprotocol.io", id: "io.github.example/postgres" },
  target: {
    type: "package",
    registryType: "npm",
    identifier: "@example/postgres-mcp",
    version: "1.4.2",
    transport: "stdio",
    artifact: { digest: "sha256-P1lpO2u6UWTeF0Y0Y8aTL6TX8O0Q9jc7W3m4G5h6I7k=", method: "npm-sri" },
  },
  configDigest: "sha256-4rLmVYm0eXBg4dp2v9O4t2c1FQnb0m9uS0T5b8n7hVQ=",
  resolvedAt: T1,
  lockedAt: T0,
});

const sampleTools = [
  {
    name: "query",
    description: "Run a read-only SQL query.",
    inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
  },
  {
    name: "list_tables",
    description: "List tables in the connected database.",
    inputSchema: { type: "object", properties: {} },
  },
];
const coverage = ["name", "description", "inputSchema"];

const remoteEntry = finalizeEntry({
  name: "com.example/search",
  version: "2.0.0",
  client: "cursor",
  scope: "project",
  source: { registry: "https://registry.modelcontextprotocol.io", id: "com.example/search" },
  target: {
    type: "remote",
    transport: "streamable-http",
    url: "https://mcp.example.com/v1",
    headerSecretNames: ["EXAMPLE_API_KEY"],
  },
  surface: { hash: surfaceHash(sampleTools, coverage), coverage, toolCount: 2, capturedAt: T2 },
  verification: [
    { code: "remote-probe", status: "passed", verifier: "toolpin/0.4.0", method: "tools-list", anchor: "mcp.example.com", verifiedAt: T2, required: true },
    { code: "artifact-integrity", status: "unavailable" },
  ],
  extensions: { "dev.toolpin": { trust: { tier: "verified", score: 92 } } },
  configDigest: "sha256-mmi7cVjkzcOQ0i3q4dY0S3h1p9c8b7a6Z5x4W3v2U1t=",
  resolvedAt: T1,
  lockedAt: T0,
});

const minimalPackageDoc = lockDocument([packageEntry]);
const remoteWithSurfaceDoc = lockDocument([remoteEntry], { "dev.toolpin": { source: "curated" } });
const unknownMemberEntry = finalizeEntry({ ...structuredClone(packageEntry), integrity: undefined, futureOptionalField: "tolerated-and-hashed" });
const unknownMemberDoc = lockDocument([unknownMemberEntry]);
const emptyLockDoc = lockDocument([]);

// --- Negative fixtures (filename = violated rule) ---
const tamperedEntry = { ...structuredClone(packageEntry), version: "1.4.3" }; // integrity was computed for 1.4.2
const negatives = {
  "unsupported-spec-version": { ...structuredClone(minimalPackageDoc), specVersion: 2 },
  "missing-field-integrity": lockDocument([(() => { const entry = structuredClone(packageEntry); delete entry.integrity; return entry; })()]),
  "bad-digest-format": lockDocument([finalizeEntry({ ...structuredClone(packageEntry), integrity: undefined, configDigest: "sha256:deadbeef" })]),
  "remote-url-not-https": lockDocument([finalizeEntry({ ...structuredClone(remoteEntry), integrity: undefined, surface: undefined, verification: undefined, extensions: undefined, target: { type: "remote", transport: "streamable-http", url: "http://mcp.example.com/v1" } })]),
  "duplicate-entry-identity": lockDocument([packageEntry, structuredClone(packageEntry)]),
  "integrity-mismatch": lockDocument([tamperedEntry]),
  "surface-coverage-invalid": lockDocument([finalizeEntry({ ...structuredClone(remoteEntry), integrity: undefined, surface: { hash: surfaceHash(sampleTools, ["description"]), coverage: ["description"], toolCount: 2 } })]),
  "header-secret-not-a-name": lockDocument([finalizeEntry({ ...structuredClone(remoteEntry), integrity: undefined, target: { type: "remote", transport: "streamable-http", url: "https://mcp.example.com/v1", headerSecretNames: ["Bearer abc123-not-a-name"] } })]),
  "unknown-target-type": lockDocument([finalizeEntry({ ...structuredClone(packageEntry), integrity: undefined, target: { type: "carrier-pigeon", identifier: "x" } })]),
  "oci-mutable-identifier": lockDocument([finalizeEntry({ ...structuredClone(packageEntry), integrity: undefined, target: { type: "package", registryType: "oci", identifier: "ghcr.io/example/mcp:latest" } })]),
};

// NFC duplicate member names: composed U+00E9 vs decomposed e+U+0301 are
// distinct JS strings, so a plain object carries both; conforming parsers must
// reject the document. Escapes (not literals) so editor NFC passes cannot merge them.
const nfcDoc = lockDocument([finalizeEntry({
  ...structuredClone(packageEntry),
  integrity: undefined,
  extensions: { "dev.example": { "caf\u00e9": 1, "cafe\u0301": 2 } },
})]);

// --- Signature vectors ---
const { privateKey, publicKey } = vectorKeyPair();
const envelopeUnsigned = {
  schema: "mcp-lock-signature",
  version: 1,
  algorithm: "ed25519",
  lockfileDigest: wholeLockDigest(remoteWithSurfaceDoc),
  policyDigest: digest({ example: "policy" }),
  publicKeyFingerprint: publicKeyFingerprint(publicKey),
  signedAt: "2026-07-07T12:00:01.000Z",
};
const envelope = { ...envelopeUnsigned, signature: signEnvelope(envelopeUnsigned, privateKey) };

const vectors = {
  description: "Normative vectors for docs/spec/mcp-lockfile-v1.md. A conforming implementation reproduces every value byte-for-byte.",
  canonicalization: [
    { input: { b: 1, a: [true, null, "café"] }, canonical: canonicalize({ b: 1, a: [true, null, "café"] }) },
    { input: { nested: { z: "", y: 0 } }, canonical: canonicalize({ nested: { z: "", y: 0 } }) },
  ],
  surface: {
    tools: sampleTools,
    coverage,
    note: "tools sorted by name (UTF-16 code units); records contain exactly the coverage fields",
    hash: surfaceHash(sampleTools, coverage),
  },
  entryIntegrity: {
    entryName: packageEntry.name,
    canonicalPayload: canonicalize((({ integrity: _i, ...rest }) => rest)(packageEntry)),
    integrity: packageEntry.integrity,
  },
  wholeLockDigest: {
    document: "positive/remote-with-surface.json",
    note: "digest over canonical {specVersion, entries, extensions}; top-level timestamps excluded",
    digest: wholeLockDigest(remoteWithSurfaceDoc),
  },
  signature: {
    publicKeySpkiDerBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    signingPayloadCanonical: canonicalize(envelopeUnsigned),
    envelope,
  },
};

// --- Write everything ---
const writePretty = (relativePath, value) => {
  const path = join(fixturesDir, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${relativePath}`);
};

writePretty("positive/minimal-package.json", minimalPackageDoc);
writePretty("positive/remote-with-surface.json", remoteWithSurfaceDoc);
writePretty("positive/unknown-optional-member.json", unknownMemberDoc);
writePretty("positive/empty-lock.json", emptyLockDoc);
for (const [name, doc] of Object.entries(negatives)) writePretty(`negative/${name}.json`, doc);
writePretty("negative/nfc-duplicate-key.json", nfcDoc);
writePretty("vectors.json", vectors);
