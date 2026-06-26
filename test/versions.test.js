import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildInstallPlan, writeLockfile } from "../dist/plan.js";
import { compareLockedToLatest, compareVersionStatus, compareVersionish, knownVersions } from "../dist/versions.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist", "cli.js");

test("CLI prints the ToolPin version", async () => {
  const long = await execFileAsync(process.execPath, [CLI, "--version"]);
  const short = await execFileAsync(process.execPath, [CLI, "-v"]);

  assert.match(long.stdout.trim(), /^toolpin \d+\.\d+\.\d+/);
  assert.equal(short.stdout, long.stdout);
});

test("knownVersions sorts versions newest first and exposes older releases", () => {
  const servers = [
    packageServer({ version: "1.0.0" }),
    packageServer({ version: "1.2.0", isLatest: true }),
    packageServer({ version: "1.1.0" }),
    packageServer({ name: "io.github/other", version: "9.9.9", isLatest: true }),
  ];

  const versions = knownVersions(servers, "io.github/example");

  assert.deepEqual(versions.map((entry) => entry.version), ["1.2.0", "1.1.0", "1.0.0"]);
  assert.equal(versions[0].isLatest, true);
});

test("knownVersions uses semver ordering including prereleases and leading v", () => {
  const servers = [
    packageServer({ version: "v1.0.0-beta.2" }),
    packageServer({ version: "1.0.0" }),
    packageServer({ version: "1.0.0-alpha.10" }),
    packageServer({ version: "1.0.0-alpha.2" }),
    packageServer({ version: "v1.1.0-alpha.1" }),
  ];

  const versions = knownVersions(servers, "io.github/example");

  assert.deepEqual(versions.map((entry) => entry.version), [
    "v1.1.0-alpha.1",
    "1.0.0",
    "v1.0.0-beta.2",
    "1.0.0-alpha.10",
    "1.0.0-alpha.2",
  ]);
});

test("compareVersionish compares valid semver and ignores build metadata", () => {
  assert.equal(compareVersionish("v1.0.0", "1.0.0"), 0);
  assert.equal(compareVersionish("1.0.0+build.2", "1.0.0+build.1"), 0);
  assert.equal(compareVersionish("1.0.0-rc.1", "1.0.0-beta.11"), 1);
  assert.equal(compareVersionish("1.0.0-alpha", "1.0.0-alpha.1"), -1);
});

test("compareVersionStatus exposes unknown non-semver comparisons", () => {
  assert.equal(compareVersionStatus("20f7c0f0dbe3", "9fceb02d0ae5"), undefined);
  assert.equal(compareVersionStatus("1.2.0", "9fceb02d0ae5"), undefined);
  assert.equal(compareVersionStatus("v1.2.0", "1.0.0"), 1);
});

test("compareLockedToLatest reports update availability", () => {
  const servers = [
    packageServer({ version: "1.0.0" }),
    packageServer({ version: "1.3.0", isLatest: true }),
    packageServer({ version: "1.2.0" }),
  ];

  const comparison = compareLockedToLatest("io.github/example", "1.0.0", servers);

  assert.equal(comparison.lockedVersion, "1.0.0");
  assert.equal(comparison.latestVersion, "1.3.0");
  assert.equal(comparison.status, "update-available");
  assert.deepEqual(comparison.previousVersions.map((entry) => entry.version), ["1.2.0", "1.0.0"]);
});

test("compareLockedToLatest reports unknown for non-semver comparisons", () => {
  const servers = [
    packageServer({ version: "9fceb02d0ae5" }),
    packageServer({ version: "20f7c0f0dbe3", isLatest: true }),
  ];

  const comparison = compareLockedToLatest("io.github/example", "9fceb02d0ae5", servers);

  assert.equal(comparison.lockedVersion, "9fceb02d0ae5");
  assert.equal(comparison.latestVersion, "20f7c0f0dbe3");
  assert.equal(comparison.status, "unknown");
});

test("compareLockedToLatest reports unknown when only one side is semver", () => {
  const servers = [
    packageServer({ version: "1.2.0", isLatest: true }),
  ];

  const comparison = compareLockedToLatest("io.github/example", "9fceb02d0ae5", servers);

  assert.equal(comparison.latestVersion, "1.2.0");
  assert.equal(comparison.status, "unknown");
});

test("CLI versions lists known current and previous versions", async () => {
  await withTempCwd(async () => {
    await writeCache([
      registryEntry(packageServer({ version: "1.0.0" })),
      registryEntry(packageServer({ version: "1.2.0", isLatest: true })),
      registryEntry(packageServer({ version: "1.1.0" })),
    ]);

    const { stdout } = await execFileAsync(process.execPath, [CLI, "versions", "io.github/example", "--source", "official"]);

    assert.match(stdout, /Known versions: io\.github\/example/);
    assert.match(stdout, /1\.2\.0\s+latest\s+official/);
    assert.match(stdout, /1\.1\.0\s+official/);
    assert.match(stdout, /1\.0\.0\s+official/);
  });
});

test("CLI server commands can select an older known version", async () => {
  await withTempCwd(async () => {
    await writeCache([
      registryEntry(packageServer({ version: "1.0.0" })),
      registryEntry(packageServer({ version: "1.2.0", isLatest: true })),
      registryEntry(packageServer({ version: "1.1.0" })),
    ]);

    const { stdout } = await execFileAsync(process.execPath, [CLI, "info", "io.github/example", "--source", "official", "--version", "1.0.0"]);

    assert.match(stdout, /io\.github\/example@1\.0\.0/);
    assert.doesNotMatch(stdout, /io\.github\/example@1\.2\.0/);
  });
});

test("CLI outdated compares locked and latest registry versions", async () => {
  await withTempCwd(async () => {
    const lockedServer = packageServer({ version: "1.0.0" });
    await writeCache([
      registryEntry(lockedServer),
      registryEntry(packageServer({ version: "1.2.0", isLatest: true })),
      registryEntry(packageServer({ version: "1.1.0" })),
    ]);
    await writeLockfile(buildInstallPlan(lockedServer, "claude"));

    const { stdout } = await execFileAsync(process.execPath, [CLI, "outdated", "--source", "official"]);

    assert.match(stdout, /Outdated check/);
    assert.match(stdout, /locked\s+1\.0\.0/);
    assert.match(stdout, /latest\s+1\.2\.0/);
    assert.match(stdout, /status\s+update available/);
    assert.match(stdout, /previous\s+1\.1\.0, 1\.0\.0/);
  });
});

async function withTempCwd(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-versions-"));
  try {
    process.chdir(tempDir);
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeCache(entries) {
  await mkdir(".toolpin", { recursive: true });
  await writeFile(".toolpin/registry-cache.json", JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2), "utf8");
}

function registryEntry(server) {
  return { source: "official", server: server.raw };
}

function packageServer(overrides = {}) {
  const name = overrides.name ?? "io.github/example";
  const version = overrides.version ?? "1.0.0";
  const isLatest = overrides.isLatest === true;
  return {
    registrySource: "official",
    name,
    title: "Example Server",
    description: "Synthetic server",
    version,
    isLatest,
    repositoryUrl: "https://github.com/example/server",
    packageTypes: ["npm"],
    remoteTypes: [],
    transports: ["stdio"],
    requiresSecrets: false,
    raw: {
      name,
      title: "Example Server",
      description: "Synthetic server",
      version,
      repository: { url: "https://github.com/example/server" },
      packages: [
        {
          registryType: "npm",
          identifier: "@example/server",
          version,
          transport: { type: "stdio" },
        },
      ],
      _meta: {
        "io.modelcontextprotocol.registry/official": { isLatest },
      },
    },
  };
}
