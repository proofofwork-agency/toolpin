import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { canonicalJson } from "../dist/canonicalJson.js";
import { buildInstallPlan, computeLockfileDigest, readLockfile, writeLockfile } from "../dist/plan.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist", "cli.js");

test("canonical JSON orders accented and non-ASCII keys without locale collation", () => {
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = () => {
    throw new Error("localeCompare must not be used for canonical JSON key ordering");
  };

  try {
    assert.equal(
      canonicalJson({
        "\u00e9": 1,
        z: 2,
        "\u00c4": 3,
        a: 4,
      }),
      '{"a":4,"z":2,"\u00c4":3,"\u00e9":1}',
    );
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test("lock digest normalizes object keys to NFC before hashing", () => {
  const plan = buildInstallPlan(packageServer(), "claude");
  const composed = "io.github/caf\u00e9:claude";
  const decomposed = "io.github/cafe\u0301:claude";

  assert.equal(
    computeLockfileDigest(lockfileWithServerKey(composed, plan)),
    computeLockfileDigest(lockfileWithServerKey(decomposed, plan)),
  );
});

test("canonical JSON rejects object keys that collide after NFC normalization", () => {
  assert.throws(
    () =>
      canonicalJson({
        "io.github/caf\u00e9:claude": 1,
        "io.github/cafe\u0301:claude": 2,
      }),
    /duplicate key after NFC normalization/,
  );
});

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

test("whole-lock digest covers tool-description hashes but ignores hash timestamps", async () => {
  await withTempCwd(async () => {
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude", { capabilityManifest: capabilityManifest(server, "old-hash", "2026-01-01T00:00:00.000Z") }));
    const lockfile = await readLockfile();
    const digest = computeLockfileDigest(lockfile);

    const timestampChurned = {
      ...lockfile,
      servers: {
        "io.github/example:claude": {
          ...lockfile.servers["io.github/example:claude"],
          capabilityManifest: {
            ...lockfile.servers["io.github/example:claude"].capabilityManifest,
            toolDescriptionHash: {
              ...lockfile.servers["io.github/example:claude"].capabilityManifest.toolDescriptionHash,
              generatedAt: "2030-01-01T00:00:00.000Z",
            },
          },
          locked: {
            ...lockfile.servers["io.github/example:claude"].locked,
            capabilityManifest: {
              ...lockfile.servers["io.github/example:claude"].locked.capabilityManifest,
              toolDescriptionHash: {
                ...lockfile.servers["io.github/example:claude"].locked.capabilityManifest.toolDescriptionHash,
                generatedAt: "2030-01-02T00:00:00.000Z",
              },
            },
          },
        },
      },
    };
    assert.equal(computeLockfileDigest(timestampChurned), digest);

    const hashTampered = {
      ...timestampChurned,
      servers: {
        "io.github/example:claude": {
          ...timestampChurned.servers["io.github/example:claude"],
          capabilityManifest: {
            ...timestampChurned.servers["io.github/example:claude"].capabilityManifest,
            toolDescriptionHash: {
              ...timestampChurned.servers["io.github/example:claude"].capabilityManifest.toolDescriptionHash,
              value: "new-hash",
            },
          },
        },
      },
    };
    assert.notEqual(computeLockfileDigest(hashTampered), digest);
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

function capabilityManifest(server, value, generatedAt) {
  return {
    version: 1,
    serverName: server.name,
    serverVersion: server.version,
    registrySource: server.registrySource,
    packageTypes: ["npm"],
    transports: ["stdio"],
    remoteHosts: [],
    secrets: [],
    generatedAt,
    toolDescriptionHash: {
      algorithm: "sha256",
      value,
      toolCount: 1,
      generatedAt,
    },
  };
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

function lockfileWithServerKey(key, plan) {
  return {
    lockfileVersion: 2,
    generatedAt: "2026-01-01T00:00:00.000Z",
    servers: {
      [key]: plan,
    },
  };
}
