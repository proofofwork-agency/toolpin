import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readLockfile } from "../dist/plan.js";
import { verifyServer } from "../dist/verify.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist", "cli.js");
const TEST_SOURCE = "tpn-test";
const SERVER_NAME = "dev.toolpin/tpn-test-mcp-server";
const publicLookup = async () => [{ address: "93.184.216.34" }];

test("CLI detects remote MCP tool drift against live capability pins", async () => {
  await withTempCwd(async (dir) => {
    let tools = [tool("alpha", "Alpha remote tool")];
    const remote = await startRemoteMcpFixture(() => tools);
    try {
      await writeRegistryConfig();
      await writeRegistryCache([remoteServer(remote.url)]);

      await execFileAsync(process.execPath, [
        CLI,
        "lock",
        SERVER_NAME,
        "--client",
        "claude",
        "--source",
        TEST_SOURCE,
        "--verify",
        "--timeout",
        "5000",
      ], { env: isolatedHomeEnv(dir) });

      const before = await readFile("mcp-lock.json", "utf8");
      const lockfile = await readLockfile();
      const locked = lockfile.servers[`${SERVER_NAME}:claude`];
      assert.equal(locked.capabilityManifest.toolDescriptionHash.toolCount, 1);
      assert.equal(locked.capabilityManifest.toolSurfaceHash.toolCount, 1);
      assert.equal(locked.capabilityManifest.toolManifestHash.toolCount, 1);

      tools = [
        tool("alpha", "Alpha remote tool with changed behavior"),
        tool("beta", "Beta remote tool"),
      ];

      await assert.rejects(
        () => execFileAsync(process.execPath, [
          CLI,
          "ci",
          "--file",
          "mcp-lock.json",
          "--source",
          TEST_SOURCE,
          "--verify",
          "--no-policy",
          "--timeout",
          "5000",
        ], { env: isolatedHomeEnv(dir) }),
        (error) => {
          const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
          assert.match(stderr, /tool input schemas changed/);
          return true;
        },
      );
      assert.equal(await readFile("mcp-lock.json", "utf8"), before);
    } finally {
      await remote.close();
    }
  });
});

test("CLI detects stdio package MCP tool drift against live capability pins", async () => {
  await withTempCwd(async (dir) => {
    const fixture = await writeStdioFixture(dir);
    await writeToolState(fixture.toolsPath, [tool("alpha", "Alpha stdio package tool")]);
    await writeRegistryConfig();
    await writeRegistryCache([packageServer("cargo", { identifier: "tpn-cargo-fixture" })]);
    const env = fixtureEnv(dir, fixture);

    await execFileAsync(process.execPath, [
      CLI,
      "install",
      SERVER_NAME,
      "--client",
      "claude",
      "--scope",
      "project",
      "--source",
      TEST_SOURCE,
      "--verify",
      "--allow-execute",
      "--update-lock",
      "--no-policy",
      "--timeout",
      "5000",
    ], { env });

    const before = await readFile("mcp-lock.json", "utf8");
    const installed = JSON.parse(await readFile(".mcp.json", "utf8"));
    assert.equal(installed.mcpServers[SERVER_NAME].command, "tpn-cargo-fixture");
    const locked = (await readLockfile()).servers[`${SERVER_NAME}:claude`];
    assert.equal(locked.capabilityManifest.toolDescriptionHash.toolCount, 1);
    assert.equal(locked.capabilityManifest.toolSurfaceHash.toolCount, 1);
    assert.equal(locked.capabilityManifest.toolManifestHash.toolCount, 1);

    await writeToolState(fixture.toolsPath, [
      tool("alpha", "Alpha stdio package tool with changed behavior"),
      tool("beta", "Beta stdio package tool"),
    ]);

    await assert.rejects(
      () => execFileAsync(process.execPath, [
        CLI,
        "ci",
        "--file",
        "mcp-lock.json",
        "--source",
        TEST_SOURCE,
        "--verify",
        "--allow-execute",
        "--no-policy",
        "--timeout",
        "5000",
      ], { env }),
      (error) => {
        const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
        assert.match(stderr, /tool input schemas changed/);
        return true;
      },
    );
    assert.equal(await readFile("mcp-lock.json", "utf8"), before);

    // Without --allow-execute, CI must refuse up front to re-verify live pins
    // on a package entry (that would execute it), with an actionable message.
    await assert.rejects(
      () => execFileAsync(process.execPath, [
        CLI,
        "ci",
        "--file",
        "mcp-lock.json",
        "--source",
        TEST_SOURCE,
        "--verify",
        "--no-policy",
        "--timeout",
        "5000",
      ], { env }),
      (error) => {
        const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
        assert.match(stderr, /re-verifying them executes the package/);
        assert.match(stderr, /--allow-execute/);
        return true;
      },
    );
  });
});

test("scan --live does not execute a package target without --allow-execute", async () => {
  await withTempCwd(async (dir) => {
    const fixture = await writeStdioFixture(dir);
    await writeToolState(fixture.toolsPath, [tool("alpha", "Alpha stdio package tool")]);
    // `scan --live` fetches the registry live (no cache fallback), so serve a
    // local official-compatible registry and opt it in via allowHttp/allowPrivateHosts
    // (also exercising the safeFetch registry routing added in this branch).
    const registry = await startLocalRegistry([packageServer("cargo", { identifier: "tpn-cargo-fixture" })]);
    try {
      await writeLocalRegistryConfig(registry.url);
      const env = fixtureEnv(dir, fixture);

      // Default: live scan of a package target must skip execution.
      const skipped = await execFileAsync(process.execPath, [
        CLI, "scan", SERVER_NAME, "--source", TEST_SOURCE, "--live", "--json", "--timeout", "5000",
      ], { env });
      const skippedReport = JSON.parse(skipped.stdout);
      assert.equal(skippedReport.liveProbe.skipped, true);
      assert.match(skippedReport.liveProbe.message, /--allow-execute/);
      const noInvocations = await readInvocations(fixture.invocationsPath).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      assert.equal(noInvocations.length, 0, `scan --live executed the package without --allow-execute: ${JSON.stringify(noInvocations)}`);

      // Opt in: --allow-execute runs the live probe and the package is spawned.
      const executed = await execFileAsync(process.execPath, [
        CLI, "scan", SERVER_NAME, "--source", TEST_SOURCE, "--live", "--allow-execute", "--json", "--timeout", "5000",
      ], { env });
      const executedReport = JSON.parse(executed.stdout);
      assert.equal(executedReport.liveProbe.ok, true, executedReport.liveProbe.message);
      const invocations = await readInvocations(fixture.invocationsPath);
      assert.ok(invocations.some((entry) => entry.command === "tpn-cargo-fixture"), "expected the package launcher to run under --allow-execute");
    } finally {
      await registry.close();
    }
  });
});

test("CLI detects input-schema drift without description drift", async () => {
  await withTempCwd(async (dir) => {
    let tools = [tool("alpha", "Stable remote tool", { type: "object", properties: { before: { type: "string" } } })];
    const remote = await startRemoteMcpFixture(() => tools);
    try {
      await writeRegistryConfig();
      await writeRegistryCache([remoteServer(remote.url)]);

      await execFileAsync(process.execPath, [
        CLI,
        "lock",
        SERVER_NAME,
        "--client",
        "claude",
        "--source",
        TEST_SOURCE,
        "--verify",
        "--timeout",
        "5000",
      ], { env: isolatedHomeEnv(dir) });
      const before = await readFile("mcp-lock.json", "utf8");
      const locked = (await readLockfile()).servers[`${SERVER_NAME}:claude`];
      assert.deepEqual(locked.capabilityManifest.toolSurfaceHash.coverage, ["name", "description", "inputSchema"]);

      tools = [tool("alpha", "Stable remote tool", { type: "object", properties: { after: { type: "number" } } })];

      await assert.rejects(
        () => execFileAsync(process.execPath, [
          CLI,
          "ci",
          "--file",
          "mcp-lock.json",
          "--source",
          TEST_SOURCE,
          "--verify",
          "--no-policy",
          "--timeout",
          "5000",
        ], { env: isolatedHomeEnv(dir) }),
        (error) => {
          const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
          assert.doesNotMatch(stderr, /tool-description hash changed/);
          assert.match(stderr, /tool input schemas changed/);
          return true;
        },
      );
      assert.equal(await readFile("mcp-lock.json", "utf8"), before);
    } finally {
      await remote.close();
    }
  });
});

test("verifyServer package live probe honors timeoutMs", async () => {
  await withTempCwd(async (dir) => {
    const binDir = path.join(dir, "bin");
    await mkdir(binDir, { recursive: true });
    const commandPath = path.join(binDir, "tpn-slow-fixture");
    await writeFile(commandPath, `#!/usr/bin/env node
setTimeout(() => process.exit(0), 250);
`, "utf8");
    await chmod(commandPath, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
    try {
      const started = Date.now();
      const report = await verifyServer(packageServer("cargo", { identifier: "tpn-slow-fixture" }), {
        livePackageProbe: true,
        allowExecute: true,
        timeoutMs: 25,
      });

      assert.equal(report.ok, false);
      assert.ok(Date.now() - started < 1000);
      assert.ok(report.issues.some((issue) => issue.code === "package_probe_failed" && /Timed out/.test(issue.message)));
    } finally {
      restoreEnv("PATH", originalPath);
    }
  });
});

test("verifyServer live-probes every supported stdio package launcher", async () => {
  await withTempCwd(async (dir) => {
    const fixture = await writeStdioFixture(dir);
    await writeToolState(fixture.toolsPath, [tool("alpha", "Alpha package tool")]);
    const originalPath = process.env.PATH;
    const originalToolsPath = process.env.TOOLPIN_TEST_TOOLS;
    const originalInvocationsPath = process.env.TOOLPIN_TEST_INVOCATIONS;
    process.env.PATH = `${fixture.binDir}${path.delimiter}${originalPath ?? ""}`;
    process.env.TOOLPIN_TEST_TOOLS = fixture.toolsPath;
    process.env.TOOLPIN_TEST_INVOCATIONS = fixture.invocationsPath;
    try {
      const cases = [
        ["npm", { identifier: "@toolpin/test-mcp-server", version: "1.0.0" }],
        ["pypi", { identifier: "toolpin-test-mcp-server", version: "1.0.0" }],
        ["nuget", { identifier: "ToolPin.TestMcpServer", version: "1.0.0" }],
        ["cargo", { identifier: "tpn-cargo-fixture", version: "1.0.0" }],
        ["oci", { identifier: `127.0.0.1:5000/toolpin/test-mcp-server@sha256:${"a".repeat(64)}` }],
        ["mcpb", { identifier: path.join(dir, "tpn-test.mcpb"), version: "1.0.0", fileSha256: "b".repeat(64) }],
      ];

      for (const [registryType, overrides] of cases) {
        const report = await verifyServer(packageServer(registryType, overrides), {
          livePackageProbe: true,
          allowExecute: true,
          timeoutMs: 5000,
          lookup: publicLookup,
          fetch: npmIntegrityFetch,
        });

        assert.equal(report.ok, true, `${registryType}: ${report.issues.map((issue) => issue.message).join("; ")}`);
        assert.equal(report.capabilityManifest.toolDescriptionHash.toolCount, 1, registryType);
        assert.equal(report.capabilityManifest.toolSurfaceHash.toolCount, 1, registryType);
        assert.equal(report.capabilityManifest.toolManifestHash.toolCount, 1, registryType);
        assert.ok(report.badges.includes("tool-description-pinned"), registryType);
        assert.ok(report.badges.includes("tool-surface-pinned"), registryType);
        assert.ok(report.badges.includes("tool-manifest-pinned"), registryType);
      }

      const invocations = await readInvocations(fixture.invocationsPath);
      assert.deepEqual(
        invocations.map((entry) => entry.command).sort(),
        ["dnx", "docker", "mcpb", "npx", "tpn-cargo-fixture", "uvx"],
      );
      assert.deepEqual(invocations.find((entry) => entry.command === "npx").args, ["-y", "@toolpin/test-mcp-server@1.0.0"]);
      assert.deepEqual(invocations.find((entry) => entry.command === "uvx").args, ["toolpin-test-mcp-server==1.0.0"]);
      assert.deepEqual(invocations.find((entry) => entry.command === "dnx").args, ["ToolPin.TestMcpServer@1.0.0"]);
      assert.deepEqual(invocations.find((entry) => entry.command === "docker").args, ["run", "--rm", "-i", "-e", "TOOLPIN_TEST_TOOLS", "-e", "TOOLPIN_TEST_INVOCATIONS", `127.0.0.1:5000/toolpin/test-mcp-server@sha256:${"a".repeat(64)}`]);
      assert.deepEqual(invocations.find((entry) => entry.command === "mcpb").args, ["run", path.join(dir, "tpn-test.mcpb")]);
    } finally {
      restoreEnv("PATH", originalPath);
      restoreEnv("TOOLPIN_TEST_TOOLS", originalToolsPath);
      restoreEnv("TOOLPIN_TEST_INVOCATIONS", originalInvocationsPath);
    }
  });
});

test("live package probe does not leak ambient env vars to the spawned server", async () => {
  await withTempCwd(async (dir) => {
    const fixture = await writeStdioFixture(dir);
    await writeToolState(fixture.toolsPath, [tool("alpha", "Alpha package tool")]);
    const originalPath = process.env.PATH;
    const originalToolsPath = process.env.TOOLPIN_TEST_TOOLS;
    const originalInvocationsPath = process.env.TOOLPIN_TEST_INVOCATIONS;
    const originalSentinel = process.env.TOOLPIN_SECRET_SENTINEL;
    process.env.PATH = `${fixture.binDir}${path.delimiter}${originalPath ?? ""}`;
    process.env.TOOLPIN_TEST_TOOLS = fixture.toolsPath;
    process.env.TOOLPIN_TEST_INVOCATIONS = fixture.invocationsPath;
    process.env.TOOLPIN_SECRET_SENTINEL = "super-secret-token";
    try {
      const report = await verifyServer(packageServer("npm", { identifier: "@toolpin/test-mcp-server", version: "1.0.0" }), {
        livePackageProbe: true,
        allowExecute: true,
        timeoutMs: 5000,
        lookup: publicLookup,
        fetch: npmIntegrityFetch,
      });
      assert.equal(report.ok, true, report.issues.map((issue) => issue.message).join("; "));

      const invocations = await readInvocations(fixture.invocationsPath);
      const npx = invocations.find((entry) => entry.command === "npx");
      assert.ok(npx, "expected the npx launcher to be invoked");
      // The un-declared ambient secret must NOT reach the spawned process...
      assert.equal(npx.sawSentinel, null, "ambient TOOLPIN_SECRET_SENTINEL leaked into the spawned MCP server");
      // ...while the server's explicitly-declared env vars still flow through.
      assert.equal(npx.sawDeclaredTools, "present", "declared env var was not passed to the spawned MCP server");
    } finally {
      restoreEnv("PATH", originalPath);
      restoreEnv("TOOLPIN_TEST_TOOLS", originalToolsPath);
      restoreEnv("TOOLPIN_TEST_INVOCATIONS", originalInvocationsPath);
      restoreEnv("TOOLPIN_SECRET_SENTINEL", originalSentinel);
    }
  });
});

test("live package probe does not execute the package without allowExecute", async () => {
  await withTempCwd(async (dir) => {
    const fixture = await writeStdioFixture(dir);
    await writeToolState(fixture.toolsPath, [tool("alpha", "Alpha package tool")]);
    const originalPath = process.env.PATH;
    const originalToolsPath = process.env.TOOLPIN_TEST_TOOLS;
    const originalInvocationsPath = process.env.TOOLPIN_TEST_INVOCATIONS;
    process.env.PATH = `${fixture.binDir}${path.delimiter}${originalPath ?? ""}`;
    process.env.TOOLPIN_TEST_TOOLS = fixture.toolsPath;
    process.env.TOOLPIN_TEST_INVOCATIONS = fixture.invocationsPath;
    try {
      const report = await verifyServer(packageServer("npm", { identifier: "@toolpin/test-mcp-server", version: "1.0.0" }), {
        livePackageProbe: true,
        timeoutMs: 5000,
        lookup: publicLookup,
        fetch: npmIntegrityFetch,
      });

      // Execution is denied by default: verification still succeeds on network
      // artifact checks but must not spawn the package.
      assert.equal(report.ok, true, report.issues.map((issue) => issue.message).join("; "));
      assert.ok(
        report.issues.some((issue) => issue.code === "package_execution_skipped" && issue.severity === "warning"),
        "expected a package_execution_skipped warning",
      );
      assert.ok(
        report.evidence.some((entry) => entry.code === "tool_description_hash" && entry.status === "unavailable"),
        "expected tool_description_hash to be unavailable without execution",
      );
      assert.ok(!report.badges.includes("tool-description-pinned"), "live pins must not appear without execution");

      // The wrapper only creates the invocations file when something executes,
      // so a missing file is exactly the expected outcome here.
      const invocations = await readInvocations(fixture.invocationsPath).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      assert.equal(invocations.length, 0, `package was executed without --allow-execute: ${JSON.stringify(invocations)}`);
    } finally {
      restoreEnv("PATH", originalPath);
      restoreEnv("TOOLPIN_TEST_TOOLS", originalToolsPath);
      restoreEnv("TOOLPIN_TEST_INVOCATIONS", originalInvocationsPath);
    }
  });
});

test("TOOLPIN_SPAWN_ENV_ALLOW opts a named var back into the spawned server env", async () => {
  await withTempCwd(async (dir) => {
    const fixture = await writeStdioFixture(dir);
    await writeToolState(fixture.toolsPath, [tool("alpha", "Alpha package tool")]);
    const saved = {
      PATH: process.env.PATH,
      TOOLPIN_TEST_TOOLS: process.env.TOOLPIN_TEST_TOOLS,
      TOOLPIN_TEST_INVOCATIONS: process.env.TOOLPIN_TEST_INVOCATIONS,
      TOOLPIN_SECRET_SENTINEL: process.env.TOOLPIN_SECRET_SENTINEL,
      TOOLPIN_SPAWN_ENV_ALLOW: process.env.TOOLPIN_SPAWN_ENV_ALLOW,
    };
    process.env.PATH = `${fixture.binDir}${path.delimiter}${saved.PATH ?? ""}`;
    process.env.TOOLPIN_TEST_TOOLS = fixture.toolsPath;
    process.env.TOOLPIN_TEST_INVOCATIONS = fixture.invocationsPath;
    process.env.TOOLPIN_SECRET_SENTINEL = "opted-in-value";
    process.env.TOOLPIN_SPAWN_ENV_ALLOW = "TOOLPIN_SECRET_SENTINEL";
    try {
      const report = await verifyServer(packageServer("npm", { identifier: "@toolpin/test-mcp-server", version: "1.0.0" }), {
        livePackageProbe: true,
        allowExecute: true,
        timeoutMs: 5000,
        lookup: publicLookup,
        fetch: npmIntegrityFetch,
      });
      assert.equal(report.ok, true, report.issues.map((issue) => issue.message).join("; "));
      const npx = (await readInvocations(fixture.invocationsPath)).find((entry) => entry.command === "npx");
      assert.equal(npx.sawSentinel, "opted-in-value", "explicit opt-in var should reach the spawned server");
    } finally {
      for (const [key, value] of Object.entries(saved)) restoreEnv(key, value);
    }
  });
});

test("remote probe refuses private/reserved and non-HTTPS targets (SSRF guard)", async () => {
  const blocked = [
    "https://169.254.169.254/mcp",   // cloud metadata endpoint
    "https://10.0.0.1/mcp",           // RFC1918 private
    "https://192.168.1.10/mcp",       // RFC1918 private
    "http://example.com/mcp",         // non-loopback plaintext
  ];
  for (const url of blocked) {
    const report = await verifyServer(remoteServer(url), {
      liveRemoteProbe: true,
      timeoutMs: 5000,
      lookup: publicLookup,
    });
    assert.equal(report.ok, false, `${url} should not verify`);
    const messages = report.issues.map((issue) => issue.message).join(" | ");
    assert.match(messages, /private or reserved|HTTPS|Refusing/i, `${url} -> ${messages}`);
  }
});

async function startRemoteMcpFixture(getTools) {
  const listener = createServer(async (req, res) => {
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404).end();
      return;
    }

    const server = new Server(
      { name: "tpn-test-mcp-server", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: getTools() }));
    server.setRequestHandler(CallToolRequestSchema, (request) => ({
      content: [{ type: "text", text: `called ${request.params.name}` }],
    }));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void server.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500).end(error instanceof Error ? error.message : String(error));
      } else {
        res.end();
      }
    }
  });

  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  assert.equal(typeof address, "object");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise((resolve) => listener.close(resolve)),
  };
}

async function writeStdioFixture(dir) {
  const binDir = path.join(dir, "bin");
  const toolsPath = path.join(dir, "tools.json");
  const invocationsPath = path.join(dir, "invocations.jsonl");
  const serverPath = path.join(dir, "mcp-stdio-fixture.mjs");
  await mkdir(binDir, { recursive: true });
  await writeFile(serverPath, `
import { readFileSync } from "node:fs";

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
      respond(message.id, {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "tpn-test-mcp-server", version: "1.0.0" }
      });
    } else if (message.method === "tools/list") {
      respond(message.id, { tools: JSON.parse(readFileSync(process.env.TOOLPIN_TEST_TOOLS, "utf8")) });
    } else if (message.method === "tools/call") {
      respond(message.id, { content: [{ type: "text", text: "ok" }] });
    }
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
`, "utf8");

  for (const command of ["npx", "uvx", "dnx", "docker", "mcpb", "tpn-cargo-fixture"]) {
    const commandPath = path.join(binDir, command);
    await writeFile(commandPath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
import { spawn } from "node:child_process";

appendFileSync(process.env.TOOLPIN_TEST_INVOCATIONS, JSON.stringify({
  command: basename(process.argv[1]),
  args: process.argv.slice(2),
  sawSentinel: process.env.TOOLPIN_SECRET_SENTINEL ?? null,
  sawDeclaredTools: process.env.TOOLPIN_TEST_TOOLS ? "present" : null
}) + "\\n");
const child = spawn(process.execPath, [${JSON.stringify(serverPath)}], {
  stdio: "inherit",
  env: process.env
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
`, "utf8");
    await chmod(commandPath, 0o755);
  }

  return { binDir, toolsPath, invocationsPath };
}

async function writeRegistryConfig() {
  await mkdir(".toolpin", { recursive: true });
  await writeFile(".toolpin/registries.json", JSON.stringify({
    registries: [
      {
        id: TEST_SOURCE,
        type: "official-compatible",
        url: "https://example.invalid/registry/v0",
        mode: "installable",
        trust: "private",
      },
    ],
  }, null, 2), "utf8");
}

async function startLocalRegistry(servers) {
  const entries = servers.map((server) => ({
    server: server.raw,
    _meta: { "io.modelcontextprotocol.registry/official": { isLatest: true } },
  }));
  const server = createServer((request, response) => {
    if ((request.url ?? "").startsWith("/v0/servers")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ servers: entries, metadata: {} }));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/v0`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

async function writeLocalRegistryConfig(url) {
  await mkdir(".toolpin", { recursive: true });
  await writeFile(".toolpin/registries.json", JSON.stringify({
    registries: [
      {
        id: TEST_SOURCE,
        type: "official-compatible",
        url,
        mode: "installable",
        trust: "private",
        allowHttp: true,
        allowPrivateHosts: true,
      },
    ],
  }, null, 2), "utf8");
}

async function writeRegistryCache(servers) {
  await mkdir(".toolpin", { recursive: true });
  await writeFile(".toolpin/registry-cache.json", JSON.stringify({
    generatedAt: new Date().toISOString(),
    entries: servers.map((server) => ({
      source: TEST_SOURCE,
      server: server.raw,
      _meta: {
        "io.modelcontextprotocol.registry/official": {
          isLatest: true,
        },
      },
    })),
  }, null, 2), "utf8");
}

async function writeToolState(file, tools) {
  await writeFile(file, JSON.stringify(tools, null, 2), "utf8");
}

async function readInvocations(file) {
  const raw = await readFile(file, "utf8");
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function tool(name, description, inputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
}) {
  return {
    name,
    description,
    inputSchema,
  };
}

function remoteServer(url) {
  return normalizedServer({
    packageTypes: [],
    remoteTypes: ["streamable-http"],
    transports: ["streamable-http"],
    raw: {
      ...baseRawServer(),
      remotes: [{ type: "streamable-http", url }],
    },
  });
}

function packageServer(registryType, overrides = {}) {
  const identifier = overrides.identifier ?? `toolpin-${registryType}-fixture`;
  const version = overrides.version ?? "1.0.0";
  return normalizedServer({
    packageTypes: [registryType],
    remoteTypes: [],
    transports: ["stdio"],
    raw: {
      ...baseRawServer(),
      packages: [
        {
          registryType,
          identifier,
          version,
          fileSha256: overrides.fileSha256,
          transport: { type: "stdio" },
          // Declared so the fixture's control vars reach the spawned probe via
          // the legitimate resolved-env path (ToolPin no longer leaks ambient env).
          environmentVariables: [
            { name: "TOOLPIN_TEST_TOOLS", isRequired: false },
            { name: "TOOLPIN_TEST_INVOCATIONS", isRequired: false },
          ],
        },
      ],
    },
  });
}

function normalizedServer(overrides) {
  return {
    registrySource: TEST_SOURCE,
    registryMode: "installable",
    name: SERVER_NAME,
    title: "Tpn Test MCP Server",
    description: "Synthetic MCP server for ToolPin live drift tests.",
    version: "1.0.0",
    isLatest: true,
    installable: true,
    repositoryUrl: "https://github.com/proofofwork-agency/toolpin",
    requiresSecrets: false,
    ...overrides,
  };
}

function baseRawServer() {
  return {
    name: SERVER_NAME,
    title: "Tpn Test MCP Server",
    description: "Synthetic MCP server for ToolPin live drift tests.",
    version: "1.0.0",
    repository: {
      url: "https://github.com/proofofwork-agency/toolpin",
      source: "github",
    },
  };
}

function npmIntegrityFetch(url) {
  const key = String(url);
  const tarball = Buffer.from("tpn npm fixture bytes");
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  if (key === "https://registry.npmjs.org/%40toolpin%2Ftest-mcp-server") {
    return Promise.resolve(jsonResponse({
      versions: {
        "1.0.0": {
          dist: {
            integrity,
            tarball: "https://registry.npmjs.org/@toolpin/test-mcp-server/-/test-mcp-server-1.0.0.tgz",
          },
        },
      },
    }));
  }
  if (key === "https://registry.npmjs.org/@toolpin/test-mcp-server/-/test-mcp-server-1.0.0.tgz") {
    return Promise.resolve(new Response(tarball));
  }
  return Promise.reject(new Error(`Unexpected fetch ${key}`));
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

async function withTempCwd(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-mcp-drift-"));
  try {
    process.chdir(tempDir);
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

function fixtureEnv(dir, fixture) {
  return {
    ...isolatedHomeEnv(dir),
    PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    TOOLPIN_TEST_TOOLS: fixture.toolsPath,
    TOOLPIN_TEST_INVOCATIONS: fixture.invocationsPath,
  };
}

function isolatedHomeEnv(dir) {
  return {
    ...process.env,
    HOME: dir,
    USERPROFILE: dir,
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
