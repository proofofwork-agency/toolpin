import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installServerConfig, removeServerConfig } from "../dist/install.js";
import { buildInstallPlan, readLockfile, removeLockfileEntry, writeLockfile } from "../dist/plan.js";

test("removeServerConfig removes JSON client entries and preserves siblings", async () => {
  await withTempCwd(async () => {
    await installServerConfig(packageServer("io.github/one"), "claude", "project");
    await installServerConfig(packageServer("io.github/two"), "claude", "project");

    const result = await removeServerConfig("io.github/one", "claude", "project");
    const config = JSON.parse(await readFile(".mcp.json", "utf8"));

    assert.equal(result.action, "removed");
    assert.equal(config.mcpServers["io.github/one"], undefined);
    assert.ok(config.mcpServers["io.github/two"]);
  });
});

test("removeServerConfig reports missing JSON client entries without rewriting", async () => {
  await withTempCwd(async () => {
    await installServerConfig(packageServer("io.github/one"), "claude", "project");
    const before = await readFile(".mcp.json", "utf8");

    const result = await removeServerConfig("io.github/missing", "claude", "project");
    const after = await readFile(".mcp.json", "utf8");

    assert.equal(result.action, "missing");
    assert.equal(after, before);
  });
});

test("removeServerConfig removes Codex TOML tables without prefix collisions", async () => {
  await withTempCwd(async () => {
    await installServerConfig(packageServer("foo"), "codex", "project");
    await installServerConfig(packageServer("foobar"), "codex", "project");

    const result = await removeServerConfig("foo", "codex", "project");
    const toml = await readFile(path.join(".codex", "config.toml"), "utf8");

    assert.equal(result.action, "removed");
    assert.doesNotMatch(toml, /\[mcp_servers\.foo\]/);
    assert.match(toml, /\[mcp_servers\.foobar\]/);
    assert.match(toml, /@example\/foobar/);
  });
});

test("removeServerConfig reports missing without rewriting Codex TOML", async () => {
  await withTempCwd(async () => {
    await installServerConfig(packageServer("foo"), "codex", "project");
    const before = await readFile(path.join(".codex", "config.toml"), "utf8");

    const result = await removeServerConfig("missing", "codex", "project");
    const after = await readFile(path.join(".codex", "config.toml"), "utf8");

    assert.equal(result.action, "missing");
    assert.equal(after, before);
  });
});

test("removeLockfileEntry removes only the requested server/client entry", async () => {
  await withTempCwd(async () => {
    const server = packageServer("io.github/example");
    await writeLockfile(buildInstallPlan(server, "claude"));
    await writeLockfile(buildInstallPlan(server, "cursor"));

    const result = await removeLockfileEntry("io.github/example", "claude");
    const lockfile = await readLockfile();

    assert.equal(result.removed, true);
    assert.equal(lockfile.servers["io.github/example:claude"], undefined);
    assert.ok(lockfile.servers["io.github/example:cursor"]);
  });
});

test("removeLockfileEntry is a no-op when the lockfile is missing", async () => {
  await withTempCwd(async () => {
    const result = await removeLockfileEntry("io.github/missing", "claude");

    assert.equal(result.removed, false);
    await assert.rejects(() => access("mcp-lock.json"));
  });
});

test("removeLockfileEntry rejects malformed lockfiles before rewriting", async () => {
  await withTempCwd(async () => {
    await writeFile("mcp-lock.json", '{"lockfileVersion":2,"generatedAt":"now","servers":[]}\n', "utf8");
    const before = await readFile("mcp-lock.json", "utf8");

    await assert.rejects(() => removeLockfileEntry("io.github/example", "claude"), /Invalid lockfile schema/);
    assert.equal(await readFile("mcp-lock.json", "utf8"), before);
  });
});

async function withTempCwd(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mpm-remove-"));
  try {
    process.chdir(tempDir);
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
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
