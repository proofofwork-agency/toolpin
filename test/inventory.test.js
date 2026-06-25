import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { installServerConfig } from "../dist/install.js";
import { listInstalledServers } from "../dist/inventory.js";
import { buildInstallPlan, writeLockfile } from "../dist/plan.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist", "cli.js");

test("listInstalledServers inventories project and global client configs", async () => {
  await withTempHomeAndCwd(async () => {
    await installServerConfig(packageServer("io.github/project-json"), "claude", "project");
    await installServerConfig(packageServer("io.github/project-codex"), "codex", "project");
    await installServerConfig(packageServer("io.github/global-continue"), "continue", "global");

    const report = await listInstalledServers({ scope: "all", client: "all" });

    assert.equal(report.ok, true);
    assert.ok(report.checked > 0);
    assert.ok(report.entries.some((entry) => entry.scope === "project" && entry.client === "claude" && entry.serverName === "io.github/project-json"));
    assert.ok(report.entries.some((entry) => entry.scope === "project" && entry.client === "codex" && entry.serverName === "io.github/project-codex"));
    assert.ok(report.entries.some((entry) => entry.scope === "global" && entry.client === "continue" && entry.serverName === "io.github/global-continue"));
  });
});

test("listInstalledServers covers non-mcpServers project root keys", async () => {
  await withTempHomeAndCwd(async () => {
    await installServerConfig(packageServer("io.github/vscode-server"), "vscode", "project");
    await installServerConfig(packageServer("io.github/opencode-server"), "opencode", "project");

    const vscode = await listInstalledServers({ scope: "project", client: "vscode" });
    const opencode = await listInstalledServers({ scope: "project", client: "opencode" });

    assert.equal(vscode.ok, true);
    assert.equal(opencode.ok, true);
    assert.deepEqual(vscode.entries.map((entry) => entry.serverName), ["io.github/vscode-server"]);
    assert.deepEqual(opencode.entries.map((entry) => entry.serverName), ["io.github/opencode-server"]);
  });
});

test("listInstalledServers reports clean machines, invalid scopes, and unreadable configs", async () => {
  await withTempHomeAndCwd(async () => {
    const clean = await listInstalledServers({ scope: "project", client: "claude" });
    assert.equal(clean.ok, true);
    assert.equal(clean.checked, 1);
    assert.deepEqual(clean.entries, []);

    const invalid = await listInstalledServers({ scope: "project", client: "continue" });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.issues[0].kind, "invalid_scope");

    await writeFile(".mcp.json", "{bad json", "utf8");
    const unreadable = await listInstalledServers({ scope: "project", client: "claude" });
    assert.equal(unreadable.ok, false);
    assert.equal(unreadable.issues[0].kind, "unreadable");
    assert.match(unreadable.issues[0].message, /JSON/);
  });
});

test("CLI list can narrow inventory to global user config", async () => {
  await withTempHomeAndCwd(async () => {
    await installServerConfig(packageServer("io.github/project-json"), "claude", "project");
    await installServerConfig(packageServer("io.github/global-continue"), "continue", "global");

    const { stdout } = await execFileAsync(process.execPath, [CLI, "list", "--scope", "global", "--client", "continue", "--json"]);
    const parsed = JSON.parse(stdout);

    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].scope, "global");
    assert.equal(parsed.entries[0].client, "continue");
    assert.equal(parsed.entries[0].serverName, "io.github/global-continue");
  });
});

test("CLI list and uninstall print command-specific help", async () => {
  const list = await execFileAsync(process.execPath, [CLI, "list", "--help"]);
  const uninstall = await execFileAsync(process.execPath, [CLI, "uninstall", "--help"]);

  assert.match(list.stdout, /Usage: toolpin list/);
  assert.match(uninstall.stdout, /Usage: toolpin uninstall <server-name>/);
});

test("CLI uninstall aliases remove", async () => {
  await withTempHomeAndCwd(async () => {
    const server = packageServer("io.github/remove-me");
    await installServerConfig(server, "claude", "project");
    await writeLockfile(buildInstallPlan(server, "claude"));

    await execFileAsync(process.execPath, [CLI, "uninstall", "io.github/remove-me", "--client", "claude", "--scope", "project"]);

    const config = JSON.parse(await readFile(".mcp.json", "utf8"));
    assert.equal(config.mcpServers["io.github/remove-me"], undefined);
  });
});

test("CLI uninstall removes global config even when no lockfile exists", async () => {
  await withTempHomeAndCwd(async () => {
    await installServerConfig(packageServer("io.github/global-remove-me"), "continue", "global");

    await execFileAsync(process.execPath, [CLI, "uninstall", "io.github/global-remove-me", "--client", "continue", "--scope", "global"]);

    const report = await listInstalledServers({ scope: "global", client: "continue" });
    assert.equal(report.ok, true);
    assert.deepEqual(report.entries, []);
    await assert.rejects(() => access("mcp-lock.json"));
  });
});

async function withTempHomeAndCwd(fn) {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-inventory-"));
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

function packageServer(name) {
  const identifier = `@example/${name.split("/").at(-1)}`;
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
    requiresSecrets: false,
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
        },
      ],
    },
  };
}
