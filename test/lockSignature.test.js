import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildInstallPlan, writeLockfile } from "../dist/plan.js";
import { signLockfile, verifyLockfileSignature } from "../dist/signing.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist", "cli.js");

test("signLockfile and verifyLockfileSignature round-trip with user-supplied Ed25519 keys", async () => {
  await withSignedLock(async ({ privateKeyPath, publicKeyPath }) => {
    const envelope = await signLockfile("mcp-lock.json", privateKeyPath, "mcp-lock.sig");
    const report = await verifyLockfileSignature("mcp-lock.json", publicKeyPath, "mcp-lock.sig");

    assert.equal(envelope.algorithm, "ed25519");
    assert.equal(report.ok, true);
    assert.equal(report.lockfileDigest, envelope.lockfileDigest);
  });
});

test("verifyLockfileSignature rejects lockfile tampering after signing", async () => {
  await withSignedLock(async ({ publicKeyPath }) => {
    const raw = JSON.parse(await readFile("mcp-lock.json", "utf8"));
    raw.servers["io.github/example:claude"].version = "9.9.9";
    await writeFile("mcp-lock.json", `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const report = await verifyLockfileSignature("mcp-lock.json", publicKeyPath, "mcp-lock.sig");

    assert.equal(report.ok, false);
    assert.match(report.message, /Lockfile digest mismatch/);
  });
});

test("verifyLockfileSignature rejects the wrong public key", async () => {
  await withSignedLock(async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    await writeFile("wrong-public.pem", publicKey.export({ type: "spki", format: "pem" }), "utf8");

    const report = await verifyLockfileSignature("mcp-lock.json", "wrong-public.pem", "mcp-lock.sig");

    assert.equal(report.ok, false);
    assert.equal(report.message, "Signature verification failed.");
  });
});

test("verifyLockfileSignature rejects unexpected algorithms", async () => {
  await withSignedLock(async ({ publicKeyPath }) => {
    const envelope = JSON.parse(await readFile("mcp-lock.sig", "utf8"));
    envelope.algorithm = "none";
    await writeFile("mcp-lock.sig", `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

    await assert.rejects(() => verifyLockfileSignature("mcp-lock.json", publicKeyPath, "mcp-lock.sig"), /unsupported algorithm/);
  });
});

test("verifyLockfileSignature does not trust signedAt for verification decisions", async () => {
  await withSignedLock(async ({ publicKeyPath }) => {
    const envelope = JSON.parse(await readFile("mcp-lock.sig", "utf8"));
    envelope.signedAt = "1999-01-01T00:00:00.000Z";
    await writeFile("mcp-lock.sig", `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

    const report = await verifyLockfileSignature("mcp-lock.json", publicKeyPath, "mcp-lock.sig");

    assert.equal(report.ok, true);
  });
});

test("CLI ci signature verification fails closed on missing signature file", async () => {
  await withSignedLock(async ({ publicKeyPath }) => {
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "ci", "--signature", "missing.sig", "--public-key", publicKeyPath]),
      /ENOENT|no such file/i,
    );
  });
});

test("CLI lock sign and verify-signature use detached signature files", async () => {
  await withTempCwd(async () => {
    const { privateKeyPath, publicKeyPath } = await writeKeys();
    await writeLockfile(buildInstallPlan(packageServer(), "claude"));

    const signResult = await execFileAsync(process.execPath, [CLI, "lock", "sign", "--key", privateKeyPath, "--signature", "mcp-lock.sig"]);
    assert.match(signResult.stdout, /Signed mcp-lock\.json/);

    const verifyResult = await execFileAsync(process.execPath, [CLI, "lock", "verify-signature", "--key", publicKeyPath, "--signature", "mcp-lock.sig"]);
    assert.match(verifyResult.stdout, /OK Signature valid/);
  });
});

async function withSignedLock(fn) {
  await withTempCwd(async () => {
    const { privateKeyPath, publicKeyPath } = await writeKeys();
    await writeLockfile(buildInstallPlan(packageServer(), "claude"));
    await signLockfile("mcp-lock.json", privateKeyPath, "mcp-lock.sig");
    await fn({ privateKeyPath, publicKeyPath });
  });
}

async function withTempCwd(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mpm-lock-signature-"));
  try {
    process.chdir(tempDir);
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPath = "private.pem";
  const publicKeyPath = "public.pem";
  await writeFile(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), "utf8");
  await writeFile(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), "utf8");
  return { privateKeyPath, publicKeyPath };
}

function packageServer() {
  return {
    registrySource: "official",
    name: "io.github/example",
    title: "Example Server",
    description: "Synthetic server",
    version: "1.0.0",
    isLatest: true,
    repositoryUrl: "https://github.com/example/server",
    packageTypes: ["npm"],
    remoteTypes: [],
    transports: ["stdio"],
    requiresSecrets: false,
    raw: {
      name: "io.github/example",
      title: "Example Server",
      description: "Synthetic server",
      version: "1.0.0",
      packages: [
        {
          registryType: "npm",
          identifier: "@example/server",
          version: "1.0.0",
          transport: { type: "stdio" },
        },
      ],
    },
  };
}
