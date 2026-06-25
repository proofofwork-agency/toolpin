import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { doctorLockfile } from "../dist/doctor.js";
import { installServerConfig } from "../dist/install.js";
import { buildInstallPlan, writeLockfile } from "../dist/plan.js";

test("doctorLockfile passes when JSON config matches the lock", async () => {
  await withTempCwd(async () => {
    const server = packageServer("io.github/example");
    await installServerConfig(server, "claude", "project");
    await writeLockfile(buildInstallPlan(server, "claude"));

    const report = await doctorLockfile("mcp-lock.json", "project");

    assert.equal(report.ok, true);
    assert.equal(report.checked, 1);
    assert.deepEqual(report.issues, []);
  });
});

test("doctorLockfile reports missing config entries", async () => {
  await withTempCwd(async () => {
    const server = packageServer("io.github/example");
    await writeLockfile(buildInstallPlan(server, "claude"));

    const report = await doctorLockfile("mcp-lock.json", "project");

    assert.equal(report.ok, false);
    assert.equal(report.issues[0].kind, "missing");
    assert.equal(report.issues[0].key, "io.github/example:claude");
  });
});

test("doctorLockfile reports config drift", async () => {
  await withTempCwd(async () => {
    const server = packageServer("io.github/example");
    await installServerConfig(server, "claude", "project");
    await writeLockfile(buildInstallPlan(server, "claude"));
    const config = JSON.parse(await readFile(".mcp.json", "utf8"));
    config.mcpServers["io.github/example"].args = ["-y", "@example/other@1.0.0"];
    await writeFile(".mcp.json", `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const report = await doctorLockfile("mcp-lock.json", "project");

    assert.equal(report.ok, false);
    assert.equal(report.issues[0].kind, "drift");
  });
});

test("doctorLockfile parses Codex TOML config entries", async () => {
  await withTempCwd(async () => {
    const server = packageServer("io.github/example");
    await installServerConfig(server, "codex", "project");
    await writeLockfile(buildInstallPlan(server, "codex"));

    const report = await doctorLockfile("mcp-lock.json", "project");

    assert.equal(report.ok, true);
    assert.equal(report.checked, 1);
  });
});

test("doctorLockfile does not report drift when Codex omits empty env tables", async () => {
  await withTempCwd(async () => {
    const server = packageServer("io.github/no-env", { env: false });
    await installServerConfig(server, "codex", "project");
    await writeLockfile(buildInstallPlan(server, "codex"));

    const report = await doctorLockfile("mcp-lock.json", "project");

    assert.equal(report.ok, true);
    assert.equal(report.checked, 1);
  });
});

test("doctorLockfile reports unreadable JSON configs", async () => {
  await withTempCwd(async () => {
    const server = packageServer("io.github/example");
    await writeLockfile(buildInstallPlan(server, "claude"));
    await writeFile(".mcp.json", "{not-json}\n", "utf8");

    const report = await doctorLockfile("mcp-lock.json", "project");

    assert.equal(report.ok, false);
    assert.equal(report.issues[0].kind, "unreadable");
  });
});

async function withTempCwd(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mpm-doctor-"));
  try {
    process.chdir(tempDir);
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

function packageServer(name, options = {}) {
  const identifier = `@example/${name.split("/").at(-1)}`;
  const environmentVariables = options.env === false ? [] : [{ name: "EXAMPLE_TOKEN", isRequired: true, isSecret: true }];
  return {
    registrySource: "official",
    name,
    title: "Example Server",
    description: "Synthetic server",
    version: "1.0.0",
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
      version: "1.0.0",
      packages: [
        {
          registryType: "npm",
          identifier,
          version: "1.0.0",
          transport: { type: "stdio" },
          environmentVariables,
        },
      ],
    },
  };
}
