import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicKey } from "node:crypto";
import {
  canonicalize,
  digest,
  entryIntegrity,
  parseLockJson,
  publicKeyFingerprint,
  surfaceHash,
  validateLockDocument,
  verifyEnvelope,
  wholeLockDigest,
  DIGEST_RE,
} from "../scripts/spec-lib.mjs";

const specDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "spec");
const read = (relative) => readFileSync(join(specDir, relative), "utf8");
const vectors = JSON.parse(read("vectors.json"));

test("spec: every positive fixture parses and passes reader validation", () => {
  for (const file of readdirSync(join(specDir, "positive"))) {
    const raw = read(join("positive", file));
    const doc = parseLockJson(raw);
    const violations = validateLockDocument(doc);
    assert.deepEqual(violations, [], `${file} should have no violations, got ${JSON.stringify(violations)}`);
  }
});

test("spec: every negative fixture fails for the rule it is named after", () => {
  for (const file of readdirSync(join(specDir, "negative"))) {
    const rule = file.replace(/\.json$/, "");
    const raw = read(join("negative", file));
    if (rule === "nfc-duplicate-key") {
      assert.throws(() => parseLockJson(raw), /duplicate member name after NFC/, `${file} must be rejected at parse time`);
      // JSON.parse silently keeps both members — exactly the hazard the parser rule closes.
      const naive = JSON.parse(raw);
      assert.equal(Object.keys(naive.entries[0].extensions["dev.example"]).length, 2);
      continue;
    }
    const doc = parseLockJson(raw);
    const violations = validateLockDocument(doc);
    assert.ok(violations.length > 0, `${file} must produce violations`);
    const codesAsRules = violations.map((violation) => violation.code.replaceAll(":", "-"));
    assert.ok(
      codesAsRules.some((code) => code === rule || code.startsWith(rule) || rule.startsWith(code)),
      `${file} must include violation code "${rule}", got ${JSON.stringify(codesAsRules)}`,
    );
  }
});

test("spec: unknown optional members are tolerated and covered by integrity", () => {
  const doc = parseLockJson(read("positive/unknown-optional-member.json"));
  const entry = doc.entries[0];
  assert.equal(entry.futureOptionalField, "tolerated-and-hashed");
  assert.equal(entryIntegrity(entry), entry.integrity);
  const tampered = { ...entry, futureOptionalField: "changed" };
  assert.notEqual(entryIntegrity(tampered), entry.integrity, "unknown members must be tamper-evident");
});

test("spec: canonicalization vectors reproduce byte-for-byte", () => {
  for (const { input, canonical } of vectors.canonicalization) {
    assert.equal(canonicalize(input), canonical);
  }
  assert.throws(() => canonicalize({ bad: Number.NaN }), /non-finite/);
});

test("spec: surface hash vector reproduces (sorted by name, coverage-projected)", () => {
  const { tools, coverage, hash } = vectors.surface;
  assert.equal(surfaceHash(tools, coverage), hash);
  assert.match(hash, DIGEST_RE);
  const reordered = [...tools].reverse();
  assert.equal(surfaceHash(reordered, coverage), hash, "tool order must not affect the hash");
  const mutatedSchema = structuredClone(tools);
  mutatedSchema[0].inputSchema.properties.sql.type = "number";
  assert.notEqual(surfaceHash(mutatedSchema, coverage), hash, "inputSchema changes must change the hash");
});

test("spec: entry integrity and whole-lock digest vectors reproduce", () => {
  const doc = parseLockJson(read("positive/minimal-package.json"));
  const entry = doc.entries[0];
  const { integrity: _omitted, ...payload } = entry;
  assert.equal(canonicalize(payload), vectors.entryIntegrity.canonicalPayload);
  assert.equal(entryIntegrity(entry), vectors.entryIntegrity.integrity);

  const remoteDoc = parseLockJson(read("positive/remote-with-surface.json"));
  assert.equal(wholeLockDigest(remoteDoc), vectors.wholeLockDigest.digest);
  const withoutTimestamps = { specVersion: remoteDoc.specVersion, entries: remoteDoc.entries, extensions: remoteDoc.extensions };
  assert.equal(wholeLockDigest(withoutTimestamps), vectors.wholeLockDigest.digest, "top-level timestamps must not affect the digest");
});

test("spec: signature envelope vector verifies and rejects tampering", () => {
  const { envelope, publicKeySpkiDerBase64, signingPayloadCanonical } = vectors.signature;
  const publicKey = createPublicKey({ key: Buffer.from(publicKeySpkiDerBase64, "base64"), format: "der", type: "spki" });
  assert.equal(publicKeyFingerprint(publicKey), envelope.publicKeyFingerprint);
  const { signature: _sig, ...payload } = envelope;
  assert.equal(canonicalize(payload), signingPayloadCanonical, "signing payload must be the canonical envelope minus signature");
  assert.equal(verifyEnvelope(envelope, publicKey), true);
  assert.equal(verifyEnvelope({ ...envelope, signedAt: "2027-01-01T00:00:00.000Z" }, publicKey), false, "signedAt is inside the signed payload");
  assert.equal(verifyEnvelope({ ...envelope, lockfileDigest: digest({ tampered: true }) }, publicKey), false);
});

test("spec: published JSON Schemas are well-formed and agree on the digest format", () => {
  const lockSchema = JSON.parse(readFileSync(join(specDir, "..", "..", "..", "schemas", "mcp-lockfile-v1.schema.json"), "utf8"));
  const signatureSchema = JSON.parse(readFileSync(join(specDir, "..", "..", "..", "schemas", "mcp-lock-signature-v1.schema.json"), "utf8"));
  assert.equal(lockSchema.properties.specVersion.const, 1);
  assert.equal(signatureSchema.properties.version.const, 1);
  for (const schema of [lockSchema, signatureSchema]) {
    const pattern = new RegExp(schema.$defs.digest.pattern);
    assert.ok(pattern.test(digest({ sample: true })), "schema digest pattern must accept spec-lib digests");
    assert.ok(!pattern.test("sha256:deadbeef"), "schema digest pattern must reject non-SRI digests");
  }
});
