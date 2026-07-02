import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readLockfileDigest } from "./plan.js";
import { readPolicyDigest } from "./policy.js";
import { canonicalJson } from "./canonicalJson.js";
import { isRecord } from "./util.js";

export interface LockSignatureEnvelope {
  schema: "dev.toolpin.lock-signature";
  version: 2;
  algorithm: "ed25519";
  lockfileDigest: string;
  policyDigest?: string;
  publicKeyFingerprint: string;
  signedAt: string;
  signature: string;
}

export interface SignatureVerificationReport {
  ok: boolean;
  lockfileDigest: string;
  signatureDigest?: string;
  policyDigest?: string;
  publicKeyFingerprint?: string;
  message: string;
}

export async function signLockfile(
  lockfilePath = "mcp-lock.json",
  privateKeyPath: string,
  signaturePath = "mcp-lock.sig",
  options: { policyPath?: string } = {},
): Promise<LockSignatureEnvelope> {
  const lockfileDigest = await readLockfileDigest(lockfilePath);
  const policyDigest = options.policyPath ? await readPolicyDigest(options.policyPath) : undefined;
  const key = createPrivateKey(await readFile(privateKeyPath, "utf8"));
  const publicKeyFingerprint = keyFingerprint(createPublicKey(key));
  const payload = signingPayload({
    lockfileDigest,
    policyDigest,
    publicKeyFingerprint,
    signedAt: new Date().toISOString(),
  });
  const signature = sign(null, Buffer.from(canonicalJson(payload), "utf8"), key).toString("base64");
  const envelope: LockSignatureEnvelope = {
    schema: "dev.toolpin.lock-signature",
    version: 2,
    algorithm: "ed25519",
    lockfileDigest,
    ...(policyDigest ? { policyDigest } : {}),
    publicKeyFingerprint,
    signedAt: payload.signedAt,
    signature,
  };
  await writeFile(signaturePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  return envelope;
}

export async function verifyLockfileSignature(
  lockfilePath = "mcp-lock.json",
  publicKeyPath: string,
  signaturePath = "mcp-lock.sig",
  options: { policyPath?: string } = {},
): Promise<SignatureVerificationReport> {
  const actualDigest = await readLockfileDigest(lockfilePath);
  const actualPolicyDigest = options.policyPath ? await readPolicyDigest(options.policyPath) : undefined;
  const envelope = await readSignatureEnvelope(signaturePath);
  if (envelope.lockfileDigest !== actualDigest) {
    return {
      ok: false,
      lockfileDigest: actualDigest,
      signatureDigest: envelope.lockfileDigest,
      message: `Lockfile digest mismatch: signature covers ${envelope.lockfileDigest}, current lockfile is ${actualDigest}`,
    };
  }
  if (envelope.policyDigest !== actualPolicyDigest) {
    return {
      ok: false,
      lockfileDigest: actualDigest,
      signatureDigest: envelope.lockfileDigest,
      policyDigest: actualPolicyDigest,
      message: `Policy digest mismatch: signature covers ${envelope.policyDigest ?? "no policy"}, current policy is ${actualPolicyDigest ?? "no policy"}`,
    };
  }

  const key = createPublicKey(await readFile(publicKeyPath, "utf8"));
  const actualFingerprint = keyFingerprint(key);
  if (envelope.publicKeyFingerprint !== actualFingerprint) {
    return {
      ok: false,
      lockfileDigest: actualDigest,
      signatureDigest: envelope.lockfileDigest,
      policyDigest: actualPolicyDigest,
      publicKeyFingerprint: actualFingerprint,
      message: `Public key fingerprint mismatch: signature requires ${envelope.publicKeyFingerprint}, provided key is ${actualFingerprint}`,
    };
  }

  const payload = signingPayload({
    lockfileDigest: envelope.lockfileDigest,
    policyDigest: envelope.policyDigest,
    publicKeyFingerprint: envelope.publicKeyFingerprint,
    signedAt: envelope.signedAt,
  });
  const valid = verify(null, Buffer.from(canonicalJson(payload), "utf8"), key, Buffer.from(envelope.signature, "base64"));
  return {
    ok: valid,
    lockfileDigest: actualDigest,
    signatureDigest: envelope.lockfileDigest,
    policyDigest: actualPolicyDigest,
    publicKeyFingerprint: actualFingerprint,
    message: valid ? "Signature valid." : "Signature verification failed.",
  };
}

async function readSignatureEnvelope(path: string): Promise<LockSignatureEnvelope> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid lock signature JSON in ${path}: ${error.message}`);
    }
    throw error;
  }
  return parseSignatureEnvelope(parsed, path);
}

function parseSignatureEnvelope(value: unknown, path: string): LockSignatureEnvelope {
  if (!isRecord(value)) throw new Error(`Invalid lock signature schema in ${path}: expected object`);
  if (value.schema !== "dev.toolpin.lock-signature") throw new Error(`Invalid lock signature schema in ${path}: unsupported schema`);
  if (value.version !== 2) throw new Error(`Invalid lock signature schema in ${path}: unsupported version`);
  if (value.algorithm !== "ed25519") throw new Error(`Invalid lock signature schema in ${path}: unsupported algorithm`);
  if (typeof value.lockfileDigest !== "string" || !value.lockfileDigest.startsWith("sha256-")) {
    throw new Error(`Invalid lock signature schema in ${path}: invalid lockfileDigest`);
  }
  if (value.policyDigest !== undefined && (typeof value.policyDigest !== "string" || !value.policyDigest.startsWith("sha256-"))) {
    throw new Error(`Invalid lock signature schema in ${path}: invalid policyDigest`);
  }
  if (typeof value.publicKeyFingerprint !== "string" || !value.publicKeyFingerprint.startsWith("sha256-")) {
    throw new Error(`Invalid lock signature schema in ${path}: invalid publicKeyFingerprint`);
  }
  if (typeof value.signedAt !== "string") throw new Error(`Invalid lock signature schema in ${path}: invalid signedAt`);
  if (typeof value.signature !== "string" || !value.signature) throw new Error(`Invalid lock signature schema in ${path}: invalid signature`);
  return {
    schema: "dev.toolpin.lock-signature",
    version: 2,
    algorithm: "ed25519",
    lockfileDigest: value.lockfileDigest,
    policyDigest: value.policyDigest,
    publicKeyFingerprint: value.publicKeyFingerprint,
    signedAt: value.signedAt,
    signature: value.signature,
  };
}

function signingPayload(input: {
  lockfileDigest: string;
  policyDigest?: string;
  publicKeyFingerprint: string;
  signedAt: string;
}): Omit<LockSignatureEnvelope, "signature"> {
  return {
    schema: "dev.toolpin.lock-signature",
    version: 2,
    algorithm: "ed25519",
    lockfileDigest: input.lockfileDigest,
    ...(input.policyDigest ? { policyDigest: input.policyDigest } : {}),
    publicKeyFingerprint: input.publicKeyFingerprint,
    signedAt: input.signedAt,
  };
}

function keyFingerprint(key: KeyObject): string {
  const der = key.export({ type: "spki", format: "der" });
  return `sha256-${createHash("sha256").update(der).digest("base64")}`;
}

export async function readPublicKeyFingerprint(publicKeyPath: string): Promise<string> {
  return keyFingerprint(createPublicKey(await readFile(publicKeyPath, "utf8")));
}
