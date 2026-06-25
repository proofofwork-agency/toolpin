import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
    assert.equal(row.installableServer.version, "1.0.0");
    assert.equal(row.updateServer.version, "1.2.0");
    assert.equal(row.runningStatus, "stale");
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
          identifier: "@example/server",
          version,
          transport: { type: "stdio" },
        },
      ],
    },
  };
}
