import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyFrozenInstall } from "../dist/ci.js";
import {
  buildInstallPlan,
  computeLockfileDigest,
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
    assert.equal(locked.trust.tier, "conditional");
    assert.deepEqual(locked.trust.gatedBy, []);
    assert.ok(locked.trust.evidence.some((entry) => entry.code === "package_pin" && entry.status === "declared" && entry.verifiedByToolPin === false));
    assert.ok(locked.trust.evidence.some((entry) => entry.code === "lock_integrity" && entry.status === "passed" && entry.verifiedByToolPin === true));
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

test("computeLockfileDigest ignores top-level metadata timestamps but covers entry timestamps", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeLockfile(buildInstallPlan(packageServer({ name: "io.github/one" }), "claude"), lockfilePath);
    await writeLockfile(buildInstallPlan(packageServer({ name: "io.github/two" }), "cursor"), lockfilePath);

    const lockfile = await readLockfile(lockfilePath);
    const digest = computeLockfileDigest(lockfile);
    const topLevelChurned = {
      ...lockfile,
      generatedAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-02T00:00:00.000Z",
    };
    assert.equal(computeLockfileDigest(topLevelChurned), digest);

    const entryChurned = {
      ...lockfile,
      servers: Object.fromEntries(
        Object.entries(lockfile.servers).map(([key, entry]) => [
          key,
          {
            ...entry,
            resolvedAt: "2030-01-03T00:00:00.000Z",
            lockedAt: "2030-01-04T00:00:00.000Z",
            capabilityManifest: { ...entry.capabilityManifest, generatedAt: "2030-01-05T00:00:00.000Z" },
            locked: {
              ...entry.locked,
              capabilityManifest: { ...entry.locked.capabilityManifest, generatedAt: "2030-01-06T00:00:00.000Z" },
            },
          },
        ]),
      ),
    };

    assert.notEqual(computeLockfileDigest(entryChurned), digest);
  });
});

test("computeLockfileDigest changes when the lockfile set changes", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeLockfile(buildInstallPlan(packageServer({ name: "io.github/one" }), "claude"), lockfilePath);
    const one = await readLockfile(lockfilePath);
    const oneDigest = computeLockfileDigest(one);

    await writeLockfile(buildInstallPlan(packageServer({ name: "io.github/two" }), "cursor"), lockfilePath);
    const two = await readLockfile(lockfilePath);
    const twoDigest = computeLockfileDigest(two);
    assert.notEqual(twoDigest, oneDigest);

    const removed = { ...two, servers: { ...two.servers } };
    delete removed.servers["io.github/two:cursor"];
    assert.equal(computeLockfileDigest(removed), oneDigest);

    const substituted = { ...two, servers: { ...two.servers } };
    substituted.servers["io.github/one:claude"] = {
      ...substituted.servers["io.github/one:claude"],
      version: "9.9.9",
    };
    assert.notEqual(computeLockfileDigest(substituted), twoDigest);
  });
});

test("buildInstallPlan can persist a verified tool-description hash", () => {
  const server = packageServer();
  const capabilityManifest = {
    version: 1,
    serverName: server.name,
    serverVersion: server.version,
    registrySource: server.registrySource,
    packageTypes: ["npm"],
    transports: ["stdio"],
    remoteHosts: [],
    secrets: [{ name: "EXAMPLE_TOKEN", source: "env", required: true }],
    generatedAt: "2026-01-01T00:00:00.000Z",
    toolDescriptionHash: {
      algorithm: "sha256",
      value: "abc123",
      toolCount: 2,
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
  };

  const plan = buildInstallPlan(server, "claude", { capabilityManifest });

  assert.equal(plan.capabilityManifest.toolDescriptionHash.value, "abc123");
  assert.equal(plan.locked.capabilityManifest.toolDescriptionHash.value, "abc123");
  assert.equal(plan.integrity, computePlanIntegrity(plan));
});

test("buildInstallPlan refuses discovery-only registry entries", () => {
  const server = {
    ...packageServer(),
    registrySource: "glama",
    registryMode: "discovery",
    installable: false,
    installableReason: "registry source is discovery-only",
  };

  assert.throws(
    () => buildInstallPlan(server, "claude"),
    /Cannot install io\.github\/example@1\.0\.0: registry source is discovery-only/,
  );
});

test("verifyAgainstLockfile rejects missing current tool-description hash", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude", { capabilityManifest: capabilityManifest(server, "old-hash") }), lockfilePath);

    const verification = await verifyAgainstLockfile(buildInstallPlan(server, "claude"), lockfilePath);

    assert.equal(verification.ok, false);
    assert.ok(verification.messages.includes("tool-description hash pin could not be refreshed"));
  });
});

test("verifyAgainstLockfile rejects missing current tool pin even when scan metadata is advisory", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude", { capabilityManifest: capabilityManifest(server, "same-hash", "agent_hidden_behavior") }), lockfilePath);

    const verification = await verifyAgainstLockfile(buildInstallPlan(server, "claude"), lockfilePath);

    assert.equal(verification.ok, false);
    assert.ok(verification.messages.includes("tool-description hash pin could not be refreshed"));
  });
});

test("verifyAgainstLockfile rejects rechecked tool-description hash drift", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude", { capabilityManifest: capabilityManifest(server, "old-hash") }), lockfilePath);

    const verification = await verifyAgainstLockfile(buildInstallPlan(server, "claude", { capabilityManifest: capabilityManifest(server, "new-hash") }), lockfilePath);

    assert.equal(verification.ok, false);
    assert.ok(verification.messages.includes("tool-description hash changed"));
  });
});

test("verifyAgainstLockfile rejects tampered locked tool-description hashes", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude", { capabilityManifest: capabilityManifest(server, "old-hash") }), lockfilePath);

    const raw = JSON.parse(await readFile(lockfilePath, "utf8"));
    raw.servers["io.github/example:claude"].capabilityManifest.toolDescriptionHash.value = "tampered-hash";
    await writeFile(lockfilePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const verification = await verifyAgainstLockfile(buildInstallPlan(server, "claude", { capabilityManifest: capabilityManifest(server, "old-hash") }), lockfilePath);

    assert.equal(verification.ok, false);
    assert.ok(verification.messages.includes("locked entry integrity does not match its contents"));
    assert.ok(verification.messages.includes("tool-description hash changed"));
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

test("verifyFrozenInstall reports rechecked tool-description hash drift", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude", { capabilityManifest: capabilityManifest(server, "old-hash") }), lockfilePath);

    const clean = await verifyFrozenInstall(lockfilePath, async () => buildInstallPlan(server, "claude", { capabilityManifest: capabilityManifest(server, "old-hash") }));
    assert.equal(clean.ok, true);

    const drift = await verifyFrozenInstall(lockfilePath, async () => buildInstallPlan(server, "claude", { capabilityManifest: capabilityManifest(server, "new-hash") }));
    assert.equal(drift.ok, false);
    assert.ok(drift.issues[0].messages.includes("tool-description hash changed"));
  });
});

test("readLockfile rejects malformed existing lockfiles", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeFile(lockfilePath, '{"lockfileVersion":2,"generatedAt":"now","servers":[]}\n', "utf8");

    await assert.rejects(() => readLockfile(lockfilePath), /Invalid lockfile schema/);
  });
});

test("readLockfile rejects malformed trust payloads", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeLockfile(buildInstallPlan(packageServer(), "claude"), lockfilePath);
    const raw = JSON.parse(await readFile(lockfilePath, "utf8"));
    raw.servers["io.github/example:claude"].trust = {
      score: 90,
      badges: ["source repo"],
      issues: [{ severity: "critical", code: "unsafe" }],
    };
    await writeFile(lockfilePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    await assert.rejects(() => readLockfile(lockfilePath), /invalid trust\.issues\[0\]\.message/);
  });
});

test("readLockfile preserves legacy trust payloads without deriving new fields", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeLockfile(buildInstallPlan(packageServer(), "claude"), lockfilePath);
    const raw = JSON.parse(await readFile(lockfilePath, "utf8"));
    const entry = raw.servers["io.github/example:claude"];
    delete entry.trust.tier;
    delete entry.trust.gatedBy;
    delete entry.trust.evidence;
    entry.integrity = computePlanIntegrity(entry);
    await writeFile(lockfilePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const parsed = await readLockfile(lockfilePath);
    const locked = parsed.servers["io.github/example:claude"];

    assert.equal(Object.hasOwn(locked.trust, "tier"), false);
    assert.equal(Object.hasOwn(locked.trust, "gatedBy"), false);
    assert.equal(Object.hasOwn(locked.trust, "evidence"), false);
    assert.equal(locked.integrity, computePlanIntegrity(locked));
  });
});

test("readLockfile accepts additive trust tier fields when present", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeLockfile(buildInstallPlan(packageServer(), "claude"), lockfilePath);
    const parsed = await readLockfile(lockfilePath);
    const locked = parsed.servers["io.github/example:claude"];

    assert.equal(locked.trust.tier, "conditional");
    assert.deepEqual(locked.trust.gatedBy, []);
    assert.ok(locked.trust.evidence.some((entry) => entry.code === "lock_integrity" && entry.status === "passed"));
  });
});

test("readLockfile accepts additive trust evidence fields when present", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeLockfile(buildInstallPlan(packageServer(), "claude"), lockfilePath);
    const raw = JSON.parse(await readFile(lockfilePath, "utf8"));
    raw.servers["io.github/example:claude"].trust.evidence.push({
      code: "lock_signature",
      status: "passed",
      message: "Detached lock signature verified.",
      required: true,
    });
    raw.servers["io.github/example:claude"].integrity = computePlanIntegrity(raw.servers["io.github/example:claude"]);
    await writeFile(lockfilePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const parsed = await readLockfile(lockfilePath);
    const locked = parsed.servers["io.github/example:claude"];

    assert.ok(locked.trust.evidence.some((entry) => entry.code === "lock_signature" && entry.status === "passed" && entry.required === true));
    assert.equal(locked.integrity, computePlanIntegrity(locked));
  });
});

test("readLockfile rejects legacy v1 lockfiles in v0.1", async () => {
  await withTempDir(async (tempDir) => {
    const lockfilePath = path.join(tempDir, "mcp-lock.json");
    await writeFile(lockfilePath, '{"lockfileVersion":1,"generatedAt":"2026-01-01T00:00:00.000Z","servers":{}}\n', "utf8");

    await assert.rejects(() => readLockfile(lockfilePath), /Unsupported lockfileVersion 1 in v0\.1/);
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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-lockfile-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function capabilityManifest(server, value, scanCode) {
  return {
    version: 1,
    serverName: server.name,
    serverVersion: server.version,
    registrySource: server.registrySource,
    packageTypes: ["npm"],
    transports: ["stdio"],
    remoteHosts: [],
    secrets: [{ name: "EXAMPLE_TOKEN", source: "env", required: true }],
    generatedAt: "2026-01-01T00:00:00.000Z",
    toolDescriptionHash: {
      algorithm: "sha256",
      value,
      toolCount: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    toolDescriptionScan: scanCode
      ? {
          version: 1,
          generatedAt: "2026-01-01T00:00:00.000Z",
          scannedDescriptions: 1,
          findings: [
            {
              severity: "warning",
              code: scanCode,
              message: "synthetic advisory finding",
              subject: "tool:example",
            },
          ],
        }
      : undefined,
  };
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
