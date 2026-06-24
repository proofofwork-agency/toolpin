import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyFrozenInstall } from "../dist/ci.js";
import {
  buildInstallPlan,
  computePlanIntegrity,
  readLockfile,
  verifyAgainstLockfile,
  writeLockfile,
} from "../dist/plan.js";

test("writeLockfile writes v2 entries with stable integrity metadata", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    const server = packageServer();
    const plan = buildInstallPlan(server, "claude");

    const lockfile = await writeLockfile(plan, lockfilePath);
    const key = "io.github/example:claude";
    const locked = lockfile.servers[key];

    assert.equal(lockfile.lockfileVersion, 2);
    assert.ok(locked.integrity.startsWith("sha256-"));
    assert.equal(locked.integrity, computePlanIntegrity(locked));
    assert.deepEqual(locked.resolved, {
      source: "official",
      name: "io.github/example",
      version: "1.0.0",
    });
    assert.deepEqual(locked.original, {
      name: "io.github/example",
      version: "1.0.0",
      client: "claude",
    });
    assert.ok(locked.locked.selectedTarget);
    assert.ok(locked.locked.config);
    assert.equal(locked.locked.capabilityManifest.serverName, "io.github/example");
    assert.equal(locked.locked.capabilityManifest.generatedAt, locked.resolvedAt);

    const reread = await readLockfile(lockfilePath);
    assert.equal(reread.servers[key].integrity, locked.integrity);
  });
});

test("verifyAgainstLockfile ignores timestamp churn but rejects missing integrity", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude"), lockfilePath);

    const sameResolvedLater = buildInstallPlan(server, "claude");
    const clean = await verifyAgainstLockfile(sameResolvedLater, lockfilePath);
    assert.equal(clean.ok, true);
    assert.deepEqual(clean.messages, []);

    const raw = JSON.parse(await readFile(lockfilePath, "utf8"));
    delete raw.servers["io.github/example:claude"].integrity;
    await writeFile(lockfilePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const tampered = await verifyAgainstLockfile(buildInstallPlan(server, "claude"), lockfilePath);
    assert.equal(tampered.ok, false);
    assert.ok(tampered.messages.includes("lock integrity is missing"));
  });
});

test("verifyAgainstLockfile rejects tampered locked contents", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude"), lockfilePath);

    const raw = JSON.parse(await readFile(lockfilePath, "utf8"));
    raw.servers["io.github/example:claude"].locked.selectedTarget.version = "0.9.0";
    await writeFile(lockfilePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const verification = await verifyAgainstLockfile(buildInstallPlan(server, "claude"), lockfilePath);
    assert.equal(verification.ok, false);
    assert.ok(verification.messages.includes("locked entry integrity does not match its contents"));
  });
});

test("verifyFrozenInstall fails on resolved drift and never mutates the lockfile", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeLockfile(buildInstallPlan(packageServer({ version: "1.0.0" }), "claude"), lockfilePath);
    const before = await readFile(lockfilePath, "utf8");

    const report = await verifyFrozenInstall(lockfilePath, async () => buildInstallPlan(packageServer({ version: "2.0.0" }), "claude"));

    assert.equal(report.ok, false);
    assert.equal(report.checked, 1);
    assert.equal(report.issues[0].key, "io.github/example:claude");
    assert.ok(report.issues[0].messages.some((message) => message.includes("version changed 1.0.0 -> 2.0.0")));
    assert.equal(await readFile(lockfilePath, "utf8"), before);
  });
});

test("readLockfile rejects malformed existing lockfiles", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeFile(lockfilePath, '{"lockfileVersion":2,"generatedAt":"now","servers":[]}\n', "utf8");

    await assert.rejects(() => readLockfile(lockfilePath), /Invalid lockfile schema/);
  });
});

test("verifyFrozenInstall rejects an empty lockfile", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeFile(lockfilePath, '{"lockfileVersion":2,"generatedAt":"2026-01-01T00:00:00.000Z","servers":{}}\n', "utf8");

    const report = await verifyFrozenInstall(lockfilePath, async () => {
      throw new Error("should not resolve empty lockfiles");
    });

    assert.equal(report.ok, false);
    assert.equal(report.checked, 0);
    assert.deepEqual(report.issues[0].messages, ["lockfile has no server entries"]);
  });
});

test("verifyFrozenInstall reports every resolver failure", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeLockfile(buildInstallPlan(packageServer({ name: "io.github/one" }), "claude"), lockfilePath);
    await writeLockfile(buildInstallPlan(packageServer({ name: "io.github/two" }), "cursor"), lockfilePath);

    const report = await verifyFrozenInstall(lockfilePath, async (locked) => {
      throw new Error(`missing ${locked.name}`);
    });

    assert.equal(report.ok, false);
    assert.equal(report.checked, 2);
    assert.deepEqual(
      report.issues.map((issue) => issue.key).sort(),
      ["io.github/one:claude", "io.github/two:cursor"],
    );
    assert.ok(report.issues.some((issue) => issue.messages.includes("missing io.github/one")));
    assert.ok(report.issues.some((issue) => issue.messages.includes("missing io.github/two")));
  });
});

async function withTempDir(fn) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mpm-lockfile-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function packageServer(overrides = {}) {
  const name = overrides.name ?? "io.github/example";
  const version = overrides.version ?? "1.0.0";
  return {
    registrySource: "official",
    name,
    title: "Example Server",
    description: "Synthetic server",
    version,
    isLatest: true,
    repositoryUrl: "https://github.com/example/server",
    packageTypes: ["npm"],
    remoteTypes: [],
    transports: ["stdio"],
    requiresSecrets: true,
    raw: {
      name,
      title: "Example Server",
      description: "Synthetic server",
      version,
      packages: [
        {
          registryType: "npm",
          identifier: "@example/server",
          version,
          transport: { type: "stdio" },
          environmentVariables: [{ name: "EXAMPLE_TOKEN", isRequired: true, isSecret: true }],
        },
      ],
    },
  };
}
