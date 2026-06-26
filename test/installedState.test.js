import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installServerConfig } from "../dist/install.js";
import { buildInstallPlan, writeLockfile } from "../dist/plan.js";
import { installedViewReducer, loadInstalledServerStates } from "../dist/tui.js";

test("loadInstalledServerStates joins inventory, lockfile, and registry version state", async () => {
  await withTempHomeAndCwd(async () => {
    const lockedServer = packageServer({ version: "1.0.0" });
    const latestServer = packageServer({ version: "1.2.0", isLatest: true });
    await installServerConfig(lockedServer, "claude", "project");
    const lockfile = await writeLockfile(buildInstallPlan(lockedServer, "claude"));

    const rows = await loadInstalledServerStates({
      servers: [lockedServer, latestServer],
      lockfile,
      scope: "all",
    });

    const row = rows.find((entry) => entry.serverName === "io.github/example" && entry.client === "claude");
    assert.ok(row);
    assert.equal(row.scope, "project");
    assert.equal(row.locked, true);
    assert.equal(row.lockedVersion, "1.0.0");
    assert.equal(row.latestVersion, "1.2.0");
    assert.equal(row.updateAvailable, true);
    assert.equal(row.canUpdate, true);
    assert.equal(row.registryStatus, "exact");
    assert.equal(row.lifecycleAction, "update");
    assert.equal(row.testSource, "config");
    assert.equal(row.installableServer.version, "1.0.0");
    assert.equal(row.updateServer.version, "1.2.0");
    assert.equal(row.runningStatus, "stale");
  });
});

test("loadInstalledServerStates leaves non-semver locked updates unknown", async () => {
  await withTempHomeAndCwd(async () => {
    const lockedServer = packageServer({ version: "9fceb02d0ae5" });
    const latestServer = packageServer({ version: "20f7c0f0dbe3", isLatest: true });
    await installServerConfig(lockedServer, "claude", "project");
    const lockfile = await writeLockfile(buildInstallPlan(lockedServer, "claude"));

    const rows = await loadInstalledServerStates({
      servers: [lockedServer, latestServer],
      lockfile,
      scope: "project",
    });

    const row = rows.find((entry) => entry.serverName === "io.github/example" && entry.client === "claude");
    assert.ok(row);
    assert.equal(row.latestVersion, "20f7c0f0dbe3");
    assert.equal(row.updateAvailable, false);
    assert.equal(row.lifecycleAction, "none");
    assert.equal(row.runningStatus, "not_checked");
  });
});

test("installedViewReducer clamps selection across loaded row changes", () => {
  const initial = { rows: [], selected: 0, scope: "all", loading: true };
  const loaded = installedViewReducer(initial, { type: "loaded", rows: [row("one"), row("two")] });
  const moved = installedViewReducer(loaded, { type: "move", delta: 9 });
  const reloaded = installedViewReducer(moved, { type: "loaded", rows: [row("one")] });

  assert.equal(loaded.loading, false);
  assert.equal(moved.selected, 1);
  assert.equal(reloaded.selected, 0);
});

test("loadInstalledServerStates keeps ToolPin-locked rows registry-backed without loaded registry hits", async () => {
  await withTempHomeAndCwd(async () => {
    const lockedServer = packageServer({ version: "1.0.0" });
    await installServerConfig(lockedServer, "claude", "project");
    const lockfile = await writeLockfile(buildInstallPlan(lockedServer, "claude"));

    const rows = await loadInstalledServerStates({
      servers: [],
      lockfile,
      scope: "project",
    });

    const row = rows.find((entry) => entry.serverName === "io.github/example" && entry.client === "claude");
    assert.ok(row);
    assert.equal(row.locked, true);
    assert.equal(row.registryMatch, "exact");
    assert.equal(row.registryStatus, "exact");
    assert.equal(row.latestVersion, "1.0.0");
    assert.equal(row.lifecycleAction, "none");
    assert.equal(row.canUpdate, false);
  });
});

test("loadInstalledServerStates can match unlocked installed aliases to registry packages", async () => {
  await withTempHomeAndCwd(async () => {
    const registryServer = packageServer({
      name: "io.modelcontextprotocol/github",
      title: "GitHub MCP Server",
      identifier: "@modelcontextprotocol/server-github",
      version: "2.0.0",
      isLatest: true,
    });
    await writeFile(".mcp.json", JSON.stringify({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
      },
    }));

    const rows = await loadInstalledServerStates({
      servers: [registryServer],
      scope: "project",
    });

    const row = rows.find((entry) => entry.serverName === "github" && entry.client === "claude");
    assert.ok(row);
    assert.equal(row.locked, false);
    assert.equal(row.canUpdate, true);
    assert.equal(row.canTest, true);
    assert.equal(row.registryMatch, "alias");
    assert.equal(row.registryStatus, "alias");
    assert.equal(row.lifecycleAction, "adopt");
    assert.equal(row.testSource, "config");
    assert.equal(row.latestVersion, "2.0.0");
    assert.equal(row.updateServer.name, "io.modelcontextprotocol/github");
  });
});

test("loadInstalledServerStates labels rows with no registry match", async () => {
  await withTempHomeAndCwd(async () => {
    await writeFile(".mcp.json", JSON.stringify({
      mcpServers: {
        private: {
          command: "node",
          args: ["server.js"],
        },
      },
    }));

    const rows = await loadInstalledServerStates({
      servers: [],
      scope: "project",
    });

    const row = rows.find((entry) => entry.serverName === "private" && entry.client === "claude");
    assert.ok(row);
    assert.equal(row.registryStatus, "none");
    assert.equal(row.lifecycleAction, "none");
    assert.equal(row.testSource, "config");
    assert.equal(row.canUpdate, false);
    assert.equal(row.canTest, true);
  });
});

async function withTempHomeAndCwd(fn) {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-installed-state-"));
  const tempHome = path.join(tempDir, "home");
  const tempCwd = path.join(tempDir, "project");
  try {
    process.env.HOME = tempHome;
    await mkdir(tempCwd, { recursive: true });
    process.chdir(tempCwd);
    await fn();
  } finally {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true, force: true });
  }
}

function row(serverName) {
  return {
    id: `project:claude:${serverName}`,
    client: "claude",
    scope: "project",
    file: ".mcp.json",
    serverName,
    installed: true,
    locked: false,
    lockDrift: false,
    updateAvailable: false,
    canUpdate: false,
    canDelete: true,
    canTest: false,
    runningStatus: "not_checked",
  };
}

function packageServer(overrides = {}) {
  const name = overrides.name ?? "io.github/example";
  const version = overrides.version ?? "1.0.0";
  const identifier = overrides.identifier ?? "@example/server";
  return {
    registrySource: "official",
    registryMode: "installable",
    name,
    title: "Example Server",
    description: "Synthetic server",
    version,
    isLatest: overrides.isLatest === true,
    installable: true,
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
          identifier,
          version,
          transport: { type: "stdio" },
        },
      ],
    },
  };
}
