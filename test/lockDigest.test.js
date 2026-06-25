import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildInstallPlan, computeLockfileDigest, readLockfile, writeLockfile } from "../dist/plan.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist", "cli.js");

test("CLI lock digest prints the canonical whole-lock digest", async () => {
  await withTempCwd(async () => {
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude"));
    const expected = computeLockfileDigest(await readLockfile());

    const { stdout } = await execFileAsync(process.execPath, [CLI, "lock", "digest"]);

    assert.equal(stdout.trim(), expected);
  });
});

test("CLI ci --expect-digest fails closed on digest mismatch", async () => {
  await withTempCwd(async () => {
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude"));

    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "ci", "--expect-digest", "sha256-not-the-lock"]),
      /Lockfile digest mismatch/,
    );
  });
});

async function withTempCwd(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-lock-digest-"));
  try {
    process.chdir(tempDir);
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
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
