import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { continueYamlFromClientConfig, mergeContinueYaml, readContinueServerConfig, removeContinueServerYaml } from "../dist/continueYaml.js";
import { exportClientConfig } from "../dist/config.js";
import { doctorLockfile } from "../dist/doctor.js";
import { installServerConfig, removeServerConfig, resolveConfigTarget } from "../dist/install.js";
import { buildInstallPlan, writeLockfile } from "../dist/plan.js";

test("Continue export serializes documented local YAML shape", () => {
  const exported = exportClientConfig(packageServer("io.github/example"), "continue").config;
  const yaml = continueYamlFromClientConfig(exported);
  const parsed = parseYaml(yaml);

  assert.equal(parsed.name, "ToolPin Config");
  assert.equal(parsed.version, "1.0.0");
  assert.equal(parsed.schema, "v1");
  assert.equal(parsed.mcpServers[0].name, "io.github/example");
  assert.equal(parsed.mcpServers[0].command, "npx");
  assert.equal(parsed.mcpServers[0].env.EXAMPLE_TOKEN, "${{ secrets.EXAMPLE_TOKEN }}");
});

test("Continue export serializes remote requestOptions headers", () => {
  const exported = exportClientConfig(remoteServer("io.github/remote"), "continue").config;
  const parsed = parseYaml(continueYamlFromClientConfig(exported));

  assert.equal(parsed.mcpServers[0].name, "io.github/remote");
  assert.equal(parsed.mcpServers[0].type, "streamable-http");
  assert.equal(parsed.mcpServers[0].url, "https://example.com/mcp");
  assert.equal(parsed.mcpServers[0].requestOptions.headers.AUTH_TOKEN, "${{ secrets.AUTH_TOKEN }}");
});

test("mergeContinueYaml replaces by server name and preserves unrelated config", () => {
  const existing = [
    "name: Existing Config",
    "version: 1.2.3",
    "schema: v1",
    "models:",
    "  - name: model-a",
    "    provider: openai",
    "    model: gpt-4o",
    "mcpServers:",
    "  - name: keep",
    "    command: uvx",
    "  - name: replace",
    "    command: old",
    "",
  ].join("\n");

  const merged = mergeContinueYaml(existing, {
    mcpServers: [{ name: "replace", command: "npx", args: ["-y", "new"] }],
  });
  const parsed = parseYaml(merged);

  assert.equal(parsed.name, "Existing Config");
  assert.equal(parsed.models[0].name, "model-a");
  assert.equal(parsed.mcpServers.length, 2);
  assert.equal(parsed.mcpServers.find((server) => server.name === "keep").command, "uvx");
  assert.equal(parsed.mcpServers.find((server) => server.name === "replace").command, "npx");
});

test("removeContinueServerYaml removes by name and preserves missing files byte-for-byte", () => {
  const existing = mergeContinueYaml("", {
    mcpServers: [
      { name: "one", command: "npx" },
      { name: "two", command: "uvx" },
    ],
  });

  const removed = removeContinueServerYaml(existing, "one");
  const parsed = parseYaml(removed);

  assert.equal(parsed.mcpServers.length, 1);
  assert.equal(parsed.mcpServers[0].name, "two");
  assert.equal(removeContinueServerYaml(existing, "missing"), existing);
});

test("Continue global install, remove, and doctor use ~/.continue/config.yaml", async () => {
  await withTempHomeAndCwd(async (tempHome) => {
    const server = packageServer("io.github/example");
    const install = await installServerConfig(server, "continue", "global");
    await writeLockfile(buildInstallPlan(server, "continue"));

    assert.equal(install.file, path.join(tempHome, ".continue", "config.yaml"));
    assert.ok(readContinueServerConfig(await readFile(install.file, "utf8"), "io.github/example"));

    const report = await doctorLockfile("mcp-lock.json", "global");
    assert.equal(report.ok, true);

    const remove = await removeServerConfig("io.github/example", "continue", "global");
    const after = await readFile(install.file, "utf8");
    assert.equal(remove.action, "removed");
    assert.equal(readContinueServerConfig(after, "io.github/example"), undefined);
  });
});

test("Continue project path remains fail-closed until documented", () => {
  assert.throws(() => resolveConfigTarget("continue", "project"), /Project Continue config path is not documented/);
});

test("Continue doctor reports malformed YAML as unreadable", async () => {
  await withTempHomeAndCwd(async (tempHome) => {
    const server = packageServer("io.github/example");
    await writeLockfile(buildInstallPlan(server, "continue"));
    const file = path.join(tempHome, ".continue", "config.yaml");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "name: bad\nmcpServers:\n  - name: broken\n    command: [unterminated\n", "utf8");

    const report = await doctorLockfile("mcp-lock.json", "global");
    assert.equal(report.ok, false);
    assert.equal(report.issues[0].kind, "unreadable");
  });
});

async function withTempHomeAndCwd(fn) {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-continue-"));
  const tempHome = path.join(tempDir, "home");
  const tempProject = path.join(tempDir, "project");
  try {
    process.env.HOME = tempHome;
    await mkdir(tempProject, { recursive: true });
    process.chdir(tempProject);
    await fn(tempHome);
  } finally {
    process.chdir(originalCwd);
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
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
