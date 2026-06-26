import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { installServerConfig } from "../dist/install.js";
import { buildInstallPlan, readLockfile, writeLockfile } from "../dist/plan.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist", "cli.js");

test("CLI rejects known disabled registry sources before fetching", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [CLI, "search", "github", "--source", "smithery"]),
    /--source smithery is known but not enabled yet/,
  );
});

test("CLI boolean flags do not consume positional arguments", async () => {
  await withTempCwd(async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      CLI,
      "remove",
      "--project",
      "io.github/example",
      "--client",
      "claude",
    ]);

    assert.match(stdout, /Remove/);
    assert.match(stdout, /server\s+io\.github\/example/);
  });
});

test("CLI treats unknown double-dash flags as boolean for positional parsing", async () => {
  await withTempCwd(async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      CLI,
      "remove",
      "--future-boolean",
      "io.github/example",
      "--client",
      "claude",
    ]);

    assert.match(stdout, /Remove/);
    assert.match(stdout, /server\s+io\.github\/example/);
  });
});

test("CLI accepts short client and scope aliases", async () => {
  await withTempCwd(async () => {
    const listed = await execFileAsync(process.execPath, [CLI, "list", "-s", "global", "-c", "continue", "--json"]);
    const parsed = JSON.parse(listed.stdout);

    assert.equal(parsed.checked, 1);
    assert.equal(parsed.entries.length, 0);

    const removed = await execFileAsync(process.execPath, [
      CLI,
      "remove",
      "-p",
      "io.github/example",
      "-c",
      "claude",
    ]);

    assert.match(removed.stdout, /Remove/);
    assert.match(removed.stdout, /scope\s+project/);
    assert.match(removed.stdout, /server\s+io\.github\/example/);
  });
});

test("CLI accepts npm-style -g as global scope", async () => {
  await withTempCwd(async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI, "doctor", "-g", "--json"]);
    const parsed = JSON.parse(stdout);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.checked, 0);
  });
});

test("CLI ci --help prints usage without cwd side effects", async () => {
  await withTempCwd(async (dir) => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, "ci", "--help"], {
      env: isolatedHomeEnv(dir),
    });

    assert.match(stdout, /^Usage: toolpin ci /);
    assert.equal(stderr, "");
    assert.deepEqual(await readdir(dir), []);
  });
});

test("CLI doctor --help prints usage without cwd side effects", async () => {
  await withTempCwd(async (dir) => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, "doctor", "--help"], {
      env: isolatedHomeEnv(dir),
    });

    assert.match(stdout, /^Usage: toolpin doctor /);
    assert.equal(stderr, "");
    assert.deepEqual(await readdir(dir), []);
  });
});

test("CLI test-installed tests installed config directly", async () => {
  await withTempCwd(async (dir) => {
    const serverPath = path.join(dir, "mcp-fixture.mjs");
    await writeFile(serverPath, `
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const index = buffer.indexOf("\\n");
    if (index < 0) break;
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } } }) + "\\n");
    } else if (message.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "ping", description: "Ping", inputSchema: { type: "object", properties: {} } }] } }) + "\\n");
    }
  }
});
`, "utf8");
    await writeFile(".mcp.json", JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [serverPath],
        },
      },
    }), "utf8");

    const { stdout } = await execFileAsync(process.execPath, [CLI, "test-installed", "fixture", "--client", "claude", "--scope", "project", "--json"]);
    const parsed = JSON.parse(stdout);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.serverName, "fixture");
    assert.equal(parsed.tools[0].name, "ping");
  });
});

test("CLI test-installed fails clearly for missing config and no launch target", async () => {
  await withTempCwd(async () => {
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "test-installed", "missing", "--client", "claude", "--scope", "project"]),
      /Installed config entry missing is missing/,
    );

    await writeFile(".mcp.json", JSON.stringify({ mcpServers: { empty: {} } }), "utf8");
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "test-installed", "empty", "--client", "claude", "--scope", "project", "--json"]),
      (error) => {
        const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
        const parsed = JSON.parse(stdout);
        assert.equal(parsed.ok, false);
        assert.match(parsed.message, /No stdio or remote launch target/);
        return true;
      },
    );
  });
});

test("CLI adopt dry-run previews without writes, and adopt mutates alias to registry target", async () => {
  await withTempCwd(async () => {
    const registryServer = packageServer({ name: "io.modelcontextprotocol/github", title: "GitHub MCP Server", identifier: "@modelcontextprotocol/server-github", version: "2.0.0" });
    await writeRegistryCache([registryServer]);
    await writeFile(".mcp.json", JSON.stringify({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
      },
    }), "utf8");

    const dry = await execFileAsync(process.execPath, [CLI, "adopt", "github", "--client", "claude", "--scope", "project", "--source", "official", "--dry-run", "--json"]);
    const dryParsed = JSON.parse(dry.stdout);
    assert.equal(dryParsed.dryRun, true);
    assert.equal(dryParsed.targetName, "io.modelcontextprotocol/github");
    assert.equal(JSON.parse(await readFile(".mcp.json", "utf8")).mcpServers.github.command, "npx");
    await assert.rejects(() => access("mcp-lock.json"));

    const adopted = await execFileAsync(process.execPath, [CLI, "adopt", "github", "--client", "claude", "--scope", "project", "--source", "official", "--json"]);
    const adoptedParsed = JSON.parse(adopted.stdout);
    assert.equal(adoptedParsed.lockfileWritten, true);

    const config = JSON.parse(await readFile(".mcp.json", "utf8"));
    assert.equal(config.mcpServers.github, undefined);
    assert.ok(config.mcpServers["io.modelcontextprotocol/github"]);
    const lockfile = await readLockfile();
    assert.ok(lockfile.servers["io.modelcontextprotocol/github:claude"]);
  });
});

test("CLI adopt rejects ambiguous alias matches with candidates", async () => {
  await withTempCwd(async () => {
    await writeRegistryCache([
      packageServer({ name: "io.one/github", title: "GitHub", identifier: "@one/server-github" }),
      packageServer({ name: "io.two/github", title: "GitHub", identifier: "@two/server-github" }),
    ]);
    await writeFile(".mcp.json", JSON.stringify({
      mcpServers: {
        github: { command: "npx", args: ["-y", "@one/server-github"] },
      },
    }), "utf8");

    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "adopt", "github", "--client", "claude", "--scope", "project", "--source", "official"]),
      /Ambiguous registry alias match.*io\.one\/github.*io\.two\/github/s,
    );
  });
});

test("CLI update only updates locked rows and update --all skips adoptable unlocked rows", async () => {
  await withTempCwd(async () => {
    const lockedOld = packageServer({ name: "io.github/locked", identifier: "@example/locked", version: "1.0.0", isLatest: false });
    const lockedNew = packageServer({ name: "io.github/locked", identifier: "@example/locked", version: "2.0.0", isLatest: true });
    const adoptable = packageServer({ name: "io.modelcontextprotocol/github", title: "GitHub MCP Server", identifier: "@modelcontextprotocol/server-github", version: "2.0.0" });
    await writeRegistryCache([lockedOld, lockedNew, adoptable]);
    await installServerConfig(lockedOld, "claude", "project");
    await writeLockfile(buildInstallPlan(lockedOld, "claude"));
    await writeFile(".mcp.json", JSON.stringify({
      mcpServers: {
        ...(JSON.parse(await readFile(".mcp.json", "utf8")).mcpServers),
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
      },
    }, null, 2), "utf8");

    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "update", "github", "--client", "claude", "--scope", "project", "--source", "official"]),
      /github is not locked/,
    );

    const { stdout } = await execFileAsync(process.execPath, [CLI, "update", "--all", "--client", "claude", "--scope", "project", "--source", "official", "--json"]);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.updated.length, 1);
    assert.equal(parsed.skippedAdoptable.length, 1);
    assert.equal(parsed.skippedAdoptable[0].serverName, "github");

    const config = JSON.parse(await readFile(".mcp.json", "utf8"));
    assert.deepEqual(config.mcpServers["io.github/locked"].args, ["-y", "@example/locked@2.0.0"]);
    assert.ok(config.mcpServers.github);
    const lockfile = await readLockfile();
    assert.equal(lockfile.servers["io.github/locked:claude"].version, "2.0.0");
  });
});

async function withTempCwd(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-cli-"));
  try {
    process.chdir(tempDir);
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

function isolatedHomeEnv(dir) {
  return {
    ...process.env,
    HOME: dir,
    USERPROFILE: dir,
  };
}

async function writeRegistryCache(servers) {
  await mkdir(".toolpin", { recursive: true });
  await writeFile(".toolpin/registry-cache.json", JSON.stringify({
    generatedAt: new Date().toISOString(),
    entries: servers.map((server) => ({
      source: server.registrySource,
      server: server.raw,
      _meta: {
        "io.modelcontextprotocol.registry/official": {
          isLatest: server.isLatest,
        },
      },
    })),
  }, null, 2), "utf8");
}

function packageServer(overrides = {}) {
  const name = overrides.name ?? "io.github/example";
  const version = overrides.version ?? "1.0.0";
  const identifier = overrides.identifier ?? "@example/server";
  return {
    registrySource: "official",
    registryMode: "installable",
    name,
    title: overrides.title ?? "Example Server",
    description: "Synthetic server",
    version,
    isLatest: overrides.isLatest !== false,
    installable: true,
    repositoryUrl: "https://github.com/example/server",
    packageTypes: ["npm"],
    remoteTypes: [],
    transports: ["stdio"],
    requiresSecrets: false,
    raw: {
      name,
      title: overrides.title ?? "Example Server",
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
