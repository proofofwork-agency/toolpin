import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exportClientConfig } from "../dist/config.js";
import { doctorLockfile } from "../dist/doctor.js";
import { installServerConfig, removeServerConfig, resolveConfigTarget, vsCodeGlobalConfigFile } from "../dist/install.js";
import { buildInstallPlan, writeLockfile } from "../dist/plan.js";

test("new object-map clients export documented local config shapes", () => {
  const server = packageServer("io.github/example");

  const windsurf = exportClientConfig(server, "windsurf").config;
  assert.equal(windsurf.mcpServers["io.github/example"].command, "npx");
  assert.equal(windsurf.mcpServers["io.github/example"].env.EXAMPLE_TOKEN, "${env:EXAMPLE_TOKEN}");

  const cline = exportClientConfig(server, "cline").config;
  assert.equal(cline.mcpServers["io.github/example"].disabled, false);
  assert.deepEqual(cline.mcpServers["io.github/example"].autoApprove, []);

  const gemini = exportClientConfig(server, "gemini").config;
  assert.equal(gemini.mcpServers["io.github/example"].env.EXAMPLE_TOKEN, "${EXAMPLE_TOKEN}");

  const zed = exportClientConfig(server, "zed").config;
  assert.equal(zed.context_servers["io.github/example"].command, "npx");

  const roo = exportClientConfig(server, "roo").config;
  assert.equal(roo.mcpServers["io.github/example"].disabled, false);
});

test("OCI packages pass env names to docker while keeping client env placeholders", () => {
  const server = ociServer("io.github/container");

  const config = exportClientConfig(server, "claude").config;
  const entry = config.mcpServers["io.github/container"];

  assert.equal(entry.command, "docker");
  assert.deepEqual(entry.args, ["run", "--rm", "-i", "-e", "API_TOKEN", "-e", "LOG_LEVEL", "ghcr.io/example/container:1.0.0"]);
  assert.deepEqual(entry.env, {
    API_TOKEN: "<API_TOKEN>",
    LOG_LEVEL: "info",
  });
});

test("new object-map clients export documented remote config shapes", () => {
  const server = remoteServer("io.github/remote");

  const windsurf = exportClientConfig(server, "windsurf").config;
  assert.equal(windsurf.mcpServers["io.github/remote"].serverUrl, "https://example.com/mcp");
  assert.equal(windsurf.mcpServers["io.github/remote"].headers.AUTH_TOKEN, "${env:AUTH_TOKEN}");

  const cline = exportClientConfig(server, "cline").config;
  assert.equal(cline.mcpServers["io.github/remote"].type, "streamableHttp");
  assert.equal(cline.mcpServers["io.github/remote"].url, "https://example.com/mcp");

  const gemini = exportClientConfig(server, "gemini").config;
  assert.equal(gemini.mcpServers["io.github/remote"].httpUrl, "https://example.com/mcp");
  assert.equal(gemini.mcpServers["io.github/remote"].url, undefined);

  const zed = exportClientConfig(server, "zed").config;
  assert.equal(zed.context_servers["io.github/remote"].url, "https://example.com/mcp");

  const roo = exportClientConfig(server, "roo").config;
  assert.equal(roo.mcpServers["io.github/remote"].type, "streamable-http");
  assert.equal(roo.mcpServers["io.github/remote"].disabled, false);
});

test("Gemini and Roo project installs use verified project paths", async () => {
  await withTempCwd(async () => {
    const server = packageServer("io.github/example");

    const cursor = await installServerConfig(server, "cursor", "project");
    const gemini = await installServerConfig(server, "gemini", "project");
    const roo = await installServerConfig(server, "roo", "project");

    assert.equal(cursor.file.endsWith(path.join(".cursor", "mcp.json")), true);
    assert.equal(gemini.file.endsWith(path.join(".gemini", "settings.json")), true);
    assert.equal(roo.file.endsWith(path.join(".roo", "mcp.json")), true);
    assert.ok(JSON.parse(await readFile(cursor.file, "utf8")).mcpServers["io.github/example"]);
    assert.ok(JSON.parse(await readFile(gemini.file, "utf8")).mcpServers["io.github/example"]);
    assert.ok(JSON.parse(await readFile(roo.file, "utf8")).mcpServers["io.github/example"]);
  });
});

test("global-only and path-caveat clients are gated by verified paths", () => {
  assert.match(resolveConfigTarget("cursor", "global").file, /\.cursor\/mcp\.json$/);
  assert.match(resolveConfigTarget("windsurf", "global").file, /\.codeium\/windsurf\/mcp_config\.json$/);
  assert.match(resolveConfigTarget("cline", "global").file, /\.cline\/mcp\.json$/);
  assert.match(resolveConfigTarget("gemini", "global").file, /\.gemini\/settings\.json$/);

  assert.throws(() => resolveConfigTarget("claude", "global"), /Claude global MCP config is managed by the Claude CLI/);
  assert.throws(() => resolveConfigTarget("windsurf", "project"), /Project Windsurf\/Cascade MCP config path is not documented/);
  assert.throws(() => resolveConfigTarget("cline", "project"), /Project Cline MCP config path is not documented/);
  assert.throws(() => resolveConfigTarget("zed", "project"), /Zed settings path is not verified/);
  assert.throws(() => resolveConfigTarget("zed", "global"), /Zed settings path is not verified/);
  assert.throws(() => resolveConfigTarget("roo", "global"), /Global Roo Code mcp_settings\.json path is not verified/);
});

test("VS Code global config path follows the host platform", () => {
  assert.equal(
    vsCodeGlobalConfigFile("/home/alice", "linux"),
    path.join("/home/alice", ".config", "Code", "User", "mcp.json"),
  );
  assert.equal(
    vsCodeGlobalConfigFile("/Users/alice", "darwin"),
    path.join("/Users/alice", "Library", "Application Support", "Code", "User", "mcp.json"),
  );
  assert.equal(
    vsCodeGlobalConfigFile("C:\\Users\\Alice", "win32", "C:\\Users\\Alice\\AppData\\Roaming"),
    path.join("C:\\Users\\Alice\\AppData\\Roaming", "Code", "User", "mcp.json"),
  );
});

test("new JSON root keys merge, remove, and doctor correctly", async () => {
  await withTempCwd(async () => {
    await installServerConfig(packageServer("io.github/one"), "gemini", "project");
    await installServerConfig(packageServer("io.github/two"), "gemini", "project");

    const removed = await removeServerConfig("io.github/one", "gemini", "project");
    const config = JSON.parse(await readFile(path.join(".gemini", "settings.json"), "utf8"));
    assert.equal(removed.action, "removed");
    assert.equal(config.mcpServers["io.github/one"], undefined);
    assert.ok(config.mcpServers["io.github/two"]);

    const server = packageServer("io.github/two");
    await writeLockfile(buildInstallPlan(server, "gemini"));
    const report = await doctorLockfile("mcp-lock.json", "project");

    assert.equal(report.ok, true);
    assert.equal(report.checked, 1);
  });
});

test("opencode install preserves existing top-level metadata", async () => {
  await withTempCwd(async () => {
    await writeFile("opencode.json", JSON.stringify({
      $schema: "https://example.com/custom-opencode-schema.json",
      name: "user config",
      mcp: {
        "io.github/existing": { type: "local", command: ["node", "existing.js"], enabled: true },
      },
    }, null, 2), "utf8");

    await installServerConfig(packageServer("io.github/new"), "opencode", "project");

    const config = JSON.parse(await readFile("opencode.json", "utf8"));
    assert.equal(config.$schema, "https://example.com/custom-opencode-schema.json");
    assert.equal(config.name, "user config");
    assert.ok(config.mcp["io.github/existing"]);
    assert.ok(config.mcp["io.github/new"]);
  });
});

test("install and remove refuse to overwrite an unparseable existing config", async () => {
  await withTempCwd(async () => {
    const broken = '{ "mcp": { "io.github/existing": { "command": ["node"] }  // truncated';
    await writeFile("opencode.json", broken, "utf8");

    await assert.rejects(
      () => installServerConfig(packageServer("io.github/new"), "opencode", "project"),
      /not valid JSON/,
    );
    await assert.rejects(
      () => removeServerConfig("io.github/existing", "opencode", "project"),
      /not valid JSON/,
    );

    // The corrupt file must be left exactly as-is, not clobbered.
    assert.equal(await readFile("opencode.json", "utf8"), broken);
  });
});

test("install refuses a config whose top level is valid JSON but not an object", async () => {
  await withTempCwd(async () => {
    await writeFile("opencode.json", JSON.stringify(["not", "an", "object"]), "utf8");
    await assert.rejects(
      () => installServerConfig(packageServer("io.github/new"), "opencode", "project"),
      /expected a JSON object/,
    );
  });
});

test("doctor reports scope-incompatible client entries without aborting", async () => {
  await withTempCwd(async () => {
    const server = packageServer("io.github/roo-only");
    await installServerConfig(server, "roo", "project");
    await writeLockfile(buildInstallPlan(server, "roo"));

    const report = await doctorLockfile("mcp-lock.json", "global");

    assert.equal(report.ok, false);
    assert.equal(report.checked, 1);
    assert.equal(report.issues[0].kind, "invalid");
    assert.equal(report.issues[0].client, "roo");
    assert.match(report.issues[0].message, /cannot check roo at global scope/);
  });
});

async function withTempCwd(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-client-config-"));
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
          environmentVariables: [{ name: "EXAMPLE_TOKEN", isRequired: true, isSecret: true }],
        },
      ],
    },
  };
}

function ociServer(name) {
  return {
    registrySource: "official",
    name,
    title: "Container Server",
    description: "Synthetic OCI server",
    version: "1.0.0",
    isLatest: true,
    repositoryUrl: "https://github.com/example/container",
    packageTypes: ["oci"],
    remoteTypes: [],
    transports: ["stdio"],
    requiresSecrets: true,
    raw: {
      name,
      title: "Container Server",
      description: "Synthetic OCI server",
      version: "1.0.0",
      packages: [
        {
          registryType: "oci",
          identifier: "ghcr.io/example/container:1.0.0",
          version: "1.0.0",
          transport: { type: "stdio" },
          environmentVariables: [
            { name: "API_TOKEN", isRequired: true, isSecret: true },
            { name: "LOG_LEVEL", default: "info" },
          ],
        },
      ],
    },
  };
}

function remoteServer(name) {
  return {
    registrySource: "official",
    name,
    title: "Remote Server",
    description: "Synthetic remote server",
    version: "1.0.0",
    isLatest: true,
    repositoryUrl: "https://github.com/example/remote",
    packageTypes: [],
    remoteTypes: ["streamable-http"],
    transports: ["streamable-http"],
    requiresSecrets: true,
    raw: {
      name,
      title: "Remote Server",
      description: "Synthetic remote server",
      version: "1.0.0",
      remotes: [
        {
          type: "streamable-http",
          url: "https://example.com/mcp",
          headers: [{ name: "AUTH_TOKEN", isRequired: true, isSecret: true }],
        },
      ],
    },
  };
}
