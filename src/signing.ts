import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readLockfileDigest } from "./plan.js";

export interface LockSignatureEnvelope {
  version: 1;
  algorithm: "ed25519";
  lockfileDigest: string;
  signedAt: string;
  signature: string;
}

export interface SignatureVerificationReport {
  ok: boolean;
  lockfileDigest: string;
  signatureDigest?: string;
  message: string;
}

export async function signLockfile(
  lockfilePath = "mcp-lock.json",
  privateKeyPath: string,
  signaturePath = "mcp-lock.sig",
): Promise<LockSignatureEnvelope> {
  const digest = await readLockfileDigest(lockfilePath);
  const key = createPrivateKey(await readFile(privateKeyPath, "utf8"));
  const signature = sign(null, Buffer.from(digest, "utf8"), key).toString("base64");
  const envelope: LockSignatureEnvelope = {
    version: 1,
    algorithm: "ed25519",
    lockfileDigest: digest,
    signedAt: new Date().toISOString(),
    signature,
  };
  await writeFile(signaturePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  return envelope;
}

export async function verifyLockfileSignature(
  lockfilePath = "mcp-lock.json",
  publicKeyPath: string,
  signaturePath = "mcp-lock.sig",
): Promise<SignatureVerificationReport> {
  const actualDigest = await readLockfileDigest(lockfilePath);
  const envelope = await readSignatureEnvelope(signaturePath);
  if (envelope.lockfileDigest !== actualDigest) {
    return {
      ok: false,
      lockfileDigest: actualDigest,
      signatureDigest: envelope.lockfileDigest,
      message: `Lockfile digest mismatch: signature covers ${envelope.lockfileDigest}, current lockfile is ${actualDigest}`,
    };
  }

  const key = createPublicKey(await readFile(publicKeyPath, "utf8"));
  const valid = verify(null, Buffer.from(actualDigest, "utf8"), key, Buffer.from(envelope.signature, "base64"));
  return {
    ok: valid,
    lockfileDigest: actualDigest,
    signatureDigest: envelope.lockfileDigest,
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
  if (value.version !== 1) throw new Error(`Invalid lock signature schema in ${path}: unsupported version`);
  if (value.algorithm !== "ed25519") throw new Error(`Invalid lock signature schema in ${path}: unsupported algorithm`);
  if (typeof value.lockfileDigest !== "string" || !value.lockfileDigest.startsWith("sha256-")) {
    throw new Error(`Invalid lock signature schema in ${path}: invalid lockfileDigest`);
  }
  if (typeof value.signedAt !== "string") throw new Error(`Invalid lock signature schema in ${path}: invalid signedAt`);
  if (typeof value.signature !== "string" || !value.signature) throw new Error(`Invalid lock signature schema in ${path}: invalid signature`);
  return {
    version: 1,
    algorithm: "ed25519",
    lockfileDigest: value.lockfileDigest,
    signedAt: value.signedAt,
    signature: value.signature,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
