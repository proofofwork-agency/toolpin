// Reference helpers for the MCP Install Lockfile spec (docs/spec/mcp-lockfile-v1.md).
// Self-contained on purpose: a third-party implementer should be able to port this
// file alone and reproduce every vector in test/fixtures/spec/vectors.json.
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";

// --- RFC 8785 (JCS) canonicalization (spec §8.2) ---
// Covers the JSON value domain a lockfile uses. Rejects values JSON cannot
// represent instead of silently coercing them.
export function canonicalize(value) {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "boolean") return value ? "true" : "false";
  if (kind === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number is not canonicalizable");
    return JSON.stringify(value); // ECMAScript number serialization, as JCS requires
  }
  if (kind === "string") return JSON.stringify(value); // JSON.stringify escaping matches JCS §3.2.2.2
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item === undefined ? null : item)).join(",")}]`;
  if (kind === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // UTF-16 code unit order (JCS §3.2.3)
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error(`value of type ${kind} is not canonicalizable`);
}

export function digest(value) {
  return `sha256-${createHash("sha256").update(canonicalize(value), "utf8").digest("base64")}`;
}

// --- Entry integrity and whole-lock digest (spec §8.2, §8.3) ---
export function entryIntegrity(entry) {
  const { integrity: _omitted, ...covered } = entry;
  return digest(covered);
}

export function wholeLockDigest(document) {
  const payload = { specVersion: document.specVersion, entries: document.entries };
  if (document.extensions !== undefined) payload.extensions = document.extensions;
  return digest(payload);
}

// --- Surface pin hashing (spec §5) ---
export function surfaceHash(tools, coverage) {
  const records = [...tools]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((tool) => {
      const record = {};
      for (const field of coverage) if (tool[field] !== undefined) record[field] = tool[field];
      return record;
    });
  return digest(records);
}

// --- Strict JSON parsing with post-NFC duplicate member rejection (spec §8.2) ---
// RFC 8785 does not defend against member names that collide after Unicode
// normalization; the spec makes rejecting them mandatory for readers.
export function parseLockJson(text) {
  const parser = { text, at: 0 };
  skipWs(parser);
  const value = parseValue(parser);
  skipWs(parser);
  if (parser.at !== text.length) throw new Error(`trailing characters at offset ${parser.at}`);
  return value;
}

function fail(parser, message) {
  throw new Error(`${message} at offset ${parser.at}`);
}

function skipWs(parser) {
  while (parser.at < parser.text.length && " \t\n\r".includes(parser.text[parser.at])) parser.at += 1;
}

function parseValue(parser) {
  const ch = parser.text[parser.at];
  if (ch === "{") return parseObject(parser);
  if (ch === "[") return parseArray(parser);
  if (ch === '"') return parseString(parser);
  if (ch === "-" || (ch >= "0" && ch <= "9")) return parseNumber(parser);
  if (parser.text.startsWith("true", parser.at)) { parser.at += 4; return true; }
  if (parser.text.startsWith("false", parser.at)) { parser.at += 5; return false; }
  if (parser.text.startsWith("null", parser.at)) { parser.at += 4; return null; }
  fail(parser, "unexpected character");
}

function parseObject(parser) {
  parser.at += 1; // {
  const result = {};
  const seenNfc = new Set();
  skipWs(parser);
  if (parser.text[parser.at] === "}") { parser.at += 1; return result; }
  for (;;) {
    skipWs(parser);
    if (parser.text[parser.at] !== '"') fail(parser, "expected member name");
    const rawName = parseString(parser);
    const nfcName = rawName.normalize("NFC");
    if (seenNfc.has(nfcName)) throw new Error(`duplicate member name after NFC normalization: ${JSON.stringify(nfcName)}`);
    seenNfc.add(nfcName);
    skipWs(parser);
    if (parser.text[parser.at] !== ":") fail(parser, "expected ':'");
    parser.at += 1;
    skipWs(parser);
    result[rawName] = parseValue(parser);
    skipWs(parser);
    if (parser.text[parser.at] === ",") { parser.at += 1; continue; }
    if (parser.text[parser.at] === "}") { parser.at += 1; return result; }
    fail(parser, "expected ',' or '}'");
  }
}

function parseArray(parser) {
  parser.at += 1; // [
  const result = [];
  skipWs(parser);
  if (parser.text[parser.at] === "]") { parser.at += 1; return result; }
  for (;;) {
    skipWs(parser);
    result.push(parseValue(parser));
    skipWs(parser);
    if (parser.text[parser.at] === ",") { parser.at += 1; continue; }
    if (parser.text[parser.at] === "]") { parser.at += 1; return result; }
    fail(parser, "expected ',' or ']'");
  }
}

function parseString(parser) {
  parser.at += 1; // opening quote
  let out = "";
  for (;;) {
    if (parser.at >= parser.text.length) fail(parser, "unterminated string");
    const ch = parser.text[parser.at];
    if (ch === '"') { parser.at += 1; return out; }
    if (ch === "\\") {
      const esc = parser.text[parser.at + 1];
      parser.at += 2;
      if (esc === '"') out += '"';
      else if (esc === "\\") out += "\\";
      else if (esc === "/") out += "/";
      else if (esc === "b") out += "\b";
      else if (esc === "f") out += "\f";
      else if (esc === "n") out += "\n";
      else if (esc === "r") out += "\r";
      else if (esc === "t") out += "\t";
      else if (esc === "u") {
        const hex = parser.text.slice(parser.at, parser.at + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(parser, "invalid \\u escape");
        out += String.fromCharCode(Number.parseInt(hex, 16));
        parser.at += 4;
      } else fail(parser, "invalid escape");
      continue;
    }
    if (ch.charCodeAt(0) < 0x20) fail(parser, "unescaped control character");
    out += ch;
    parser.at += 1;
  }
}

function parseNumber(parser) {
  const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(parser.text.slice(parser.at));
  if (!match) fail(parser, "invalid number");
  parser.at += match[0].length;
  return Number(match[0]);
}

// --- Reader-conformance validation (spec §2–§8, §9 Reader class) ---
export const DIGEST_RE = /^sha256-[A-Za-z0-9+/]+={0,2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const CLIENT_RE = /^[a-z0-9][a-z0-9-]*$/;
const EXT_NAMESPACE_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const SURFACE_FIELDS = new Set(["name", "description", "inputSchema"]);

export function validateLockDocument(doc) {
  const violations = [];
  const bad = (code, path) => violations.push({ code, path });
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return [{ code: "not-an-object", path: "$" }];
  if (doc.specVersion !== 1) bad("unsupported-spec-version", "$.specVersion");
  if (!Array.isArray(doc.entries)) { bad("missing-entries", "$.entries"); return violations; }
  if (doc.extensions !== undefined) checkExtensions(doc.extensions, "$.extensions", bad);

  const identities = new Set();
  doc.entries.forEach((entry, i) => {
    const path = `$.entries[${i}]`;
    if (typeof entry !== "object" || entry === null) { bad("entry-not-object", path); return; }
    for (const field of ["name", "version", "client", "source", "target", "configDigest", "resolvedAt", "lockedAt", "integrity"]) {
      if (entry[field] === undefined) bad(`missing-field:${field}`, `${path}.${field}`);
    }
    if (typeof entry.client === "string" && !CLIENT_RE.test(entry.client)) bad("bad-client-identifier", `${path}.client`);
    if (entry.scope !== undefined && entry.scope !== "project" && entry.scope !== "user") bad("bad-scope", `${path}.scope`);
    for (const field of ["configDigest", "integrity"]) {
      if (typeof entry[field] === "string" && !DIGEST_RE.test(entry[field])) bad("bad-digest-format", `${path}.${field}`);
    }
    for (const field of ["resolvedAt", "lockedAt"]) {
      if (typeof entry[field] === "string" && !TIMESTAMP_RE.test(entry[field])) bad("bad-timestamp", `${path}.${field}`);
    }
    if (entry.target !== undefined) checkTarget(entry.target, `${path}.target`, bad);
    if (entry.surface !== undefined) checkSurface(entry.surface, `${path}.surface`, bad);
    if (entry.verification !== undefined) checkVerification(entry.verification, `${path}.verification`, bad);
    if (entry.extensions !== undefined) checkExtensions(entry.extensions, `${path}.extensions`, bad);

    const identity = `${entry.name} ${entry.client} ${entry.scope ?? "project"}`;
    if (identities.has(identity)) bad("duplicate-entry-identity", path);
    identities.add(identity);

    if (typeof entry.integrity === "string" && DIGEST_RE.test(entry.integrity)) {
      try {
        if (entryIntegrity(entry) !== entry.integrity) bad("integrity-mismatch", `${path}.integrity`);
      } catch {
        bad("integrity-uncomputable", `${path}.integrity`);
      }
    }
  });
  return violations;
}

function checkTarget(target, path, bad) {
  if (typeof target !== "object" || target === null) { bad("target-not-object", path); return; }
  if (target.type === "package") {
    if (typeof target.registryType !== "string" || target.registryType.length === 0) bad("missing-field:registryType", `${path}.registryType`);
    if (typeof target.identifier !== "string" || target.identifier.length === 0) bad("missing-field:identifier", `${path}.identifier`);
    if (target.registryType === "oci" && typeof target.identifier === "string" && !/@sha256:[0-9a-f]{64}$/.test(target.identifier)) {
      bad("oci-mutable-identifier", `${path}.identifier`);
    }
    if (target.artifact !== undefined) {
      if (typeof target.artifact?.digest !== "string" || !DIGEST_RE.test(target.artifact.digest)) bad("bad-digest-format", `${path}.artifact.digest`);
      if (typeof target.artifact?.method !== "string" || target.artifact.method.length === 0) bad("missing-field:artifact.method", `${path}.artifact.method`);
    }
  } else if (target.type === "remote") {
    if (typeof target.transport !== "string" || target.transport.length === 0) bad("missing-field:transport", `${path}.transport`);
    if (typeof target.url !== "string" || !target.url.startsWith("https://")) bad("remote-url-not-https", `${path}.url`);
    if (target.headerSecretNames !== undefined) {
      if (!Array.isArray(target.headerSecretNames) || target.headerSecretNames.some((name) => typeof name !== "string" || !SECRET_NAME_RE.test(name))) {
        bad("header-secret-not-a-name", `${path}.headerSecretNames`);
      }
    }
  } else {
    bad("unknown-target-type", `${path}.type`);
  }
}

function checkSurface(surface, path, bad) {
  if (typeof surface !== "object" || surface === null) { bad("surface-not-object", path); return; }
  if (typeof surface.hash !== "string" || !DIGEST_RE.test(surface.hash)) bad("bad-digest-format", `${path}.hash`);
  if (!Array.isArray(surface.coverage) || !surface.coverage.includes("name") || !surface.coverage.includes("description")
    || surface.coverage.some((field) => !SURFACE_FIELDS.has(field))) {
    bad("surface-coverage-invalid", `${path}.coverage`);
  }
  if (!Number.isInteger(surface.toolCount) || surface.toolCount < 0) bad("bad-tool-count", `${path}.toolCount`);
}

function checkVerification(verification, path, bad) {
  if (!Array.isArray(verification)) { bad("verification-not-array", path); return; }
  verification.forEach((record, i) => {
    if (typeof record?.code !== "string" || record.code.length === 0) bad("missing-field:code", `${path}[${i}].code`);
    if (!["passed", "failed", "declared", "unavailable"].includes(record?.status)) bad("bad-evidence-status", `${path}[${i}].status`);
  });
}

function checkExtensions(extensions, path, bad) {
  if (typeof extensions !== "object" || extensions === null || Array.isArray(extensions)) { bad("extensions-not-object", path); return; }
  for (const namespace of Object.keys(extensions)) {
    if (!EXT_NAMESPACE_RE.test(namespace)) bad("bad-extension-namespace", `${path}.${namespace}`);
  }
}

// --- Deterministic ed25519 for test vectors only (spec §8.4) ---
// The fixed seed makes vectors reproducible. NEVER use this key for anything
// but conformance testing.
const VECTOR_SEED_HEX = "6d63702d6c6f636b2d737065632d763120746573742d766563746f722d6b6579"; // "mcp-lock-spec-v1 test-vector-key"
const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420";

export function vectorKeyPair() {
  const pkcs8 = Buffer.concat([Buffer.from(PKCS8_ED25519_PREFIX, "hex"), Buffer.from(VECTOR_SEED_HEX, "hex")]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function publicKeyFingerprint(publicKey) {
  const spki = publicKey.export({ format: "der", type: "spki" });
  return `sha256-${createHash("sha256").update(spki).digest("base64")}`;
}

export function signEnvelope(envelope, privateKey) {
  const { signature: _omitted, ...payload } = envelope;
  const bytes = Buffer.from(canonicalize(payload), "utf8");
  return cryptoSign(null, bytes, privateKey).toString("base64");
}

export function verifyEnvelope(envelope, publicKey) {
  const { signature, ...payload } = envelope;
  const bytes = Buffer.from(canonicalize(payload), "utf8");
  return cryptoVerify(null, bytes, publicKey, Buffer.from(signature, "base64"));
}
