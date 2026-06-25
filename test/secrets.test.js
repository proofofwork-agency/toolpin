import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildInstallPlan, writeLockfile } from "../dist/plan.js";
import { auditSecrets } from "../dist/secrets.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist", "cli.js");
const SECRET = "ghp_plaintextsecret123456";

test("auditSecrets accepts generated placeholders and secret references", async () => {
  await withTempCwd(async () => {
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude"));
    await writeFile(".mcp.json", JSON.stringify({ mcpServers: { [server.name]: { command: "npx", args: ["-y", "@example/server@1.0.0"], env: { EXAMPLE_TOKEN: "<EXAMPLE_TOKEN>" } } } }, null, 2), "utf8");

    const report = await auditSecrets("mcp-lock.json", "project");

    assert.equal(report.ok, true);
    assert.deepEqual(report.findings, []);
  });
});

test("auditSecrets flags isSecret fields that contain plaintext-looking values", async () => {
  await withTempCwd(async () => {
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude"));
    await writeFile(".mcp.json", JSON.stringify({ mcpServers: { [server.name]: { command: "npx", args: ["-y", "@example/server@1.0.0"], env: { EXAMPLE_TOKEN: SECRET } } } }, null, 2), "utf8");

    const report = await auditSecrets("mcp-lock.json", "project");

    assert.equal(report.ok, false);
    assert.ok(report.findings.some((finding) => finding.kind === "plaintext_secret" && finding.secretName === "EXAMPLE_TOKEN"));
    assert.ok(report.findings.every((finding) => !JSON.stringify(finding).includes(SECRET)));
  });
});

test("auditSecrets flags known secret prefixes even without registry metadata", async () => {
  await withTempCwd(async () => {
    const server = packageServer({ secretMetadata: false });
    await writeLockfile(buildInstallPlan(server, "claude"));
    await writeFile(".mcp.json", JSON.stringify({ mcpServers: { [server.name]: { command: "npx", args: ["-y", "@example/server@1.0.0"], env: { TOKEN: "sk-live-secret-value" } } } }, null, 2), "utf8");

    const report = await auditSecrets("mcp-lock.json", "project");

    assert.equal(report.ok, false);
    assert.ok(report.findings.some((finding) => finding.kind === "secret_prefix" && finding.secretName === "TOKEN"));
  });
});

test("CLI secrets audit never prints the raw secret value", async () => {
  await withTempCwd(async () => {
    const server = packageServer();
    await writeLockfile(buildInstallPlan(server, "claude"));
    const shortSecret = "pass";
    await writeFile(".mcp.json", JSON.stringify({ mcpServers: { [server.name]: { command: "npx", args: ["-y", "@example/server@1.0.0"], env: { EXAMPLE_TOKEN: shortSecret } } } }, null, 2), "utf8");

    await assert.rejects(
      async () => {
        try {
          await execFileAsync(process.execPath, [CLI, "secrets", "audit"]);
        } catch (error) {
          assert.equal(String(error.stdout).includes(shortSecret), false);
          assert.equal(String(error.stderr).includes(shortSecret), false);
          assert.match(String(error.stdout), /REDACTED/);
          throw error;
        }
      },
      /Command failed/,
    );

    await assert.rejects(
      async () => {
        try {
          await execFileAsync(process.execPath, [CLI, "secrets", "audit", "--json"]);
        } catch (error) {
          assert.equal(String(error.stdout).includes(shortSecret), false);
          assert.equal(String(error.stderr).includes(shortSecret), false);
          assert.match(String(error.stdout), /REDACTED/);
          throw error;
        }
      },
      /Command failed/,
    );
  });
});

test("auditSecrets checks remote header secrets", async () => {
  await withTempCwd(async () => {
    const server = remoteServer();
    await writeLockfile(buildInstallPlan(server, "claude"));
    await writeFile(".mcp.json", JSON.stringify({ mcpServers: { [server.name]: { type: "streamable-http", url: "https://example.com/mcp", headers: { AUTH_TOKEN: SECRET } } } }, null, 2), "utf8");

    const report = await auditSecrets("mcp-lock.json", "project");

    assert.equal(report.ok, false);
    assert.ok(report.findings.some((finding) => finding.secretSource === "header" && finding.secretName === "AUTH_TOKEN"));
  });
});

async function withTempCwd(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mpm-secrets-"));
  try {
    process.chdir(tempDir);
    await mkdir(".mpm", { recursive: true });
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

function packageServer(options = {}) {
  const secretMetadata = options.secretMetadata !== false;
  return {
    registrySource: "official",
    name: "io.github/example",
    title: "Example Server",
    description: "Synthetic server",
    version: "1.0.0",
    isLatest: true,
    repositoryUrl: "https://github.com/example/server",
    packageTypes: ["npm"],
    remoteTypes: [],
    transports: ["stdio"],
    requiresSecrets: secretMetadata,
    raw: {
      name: "io.github/example",
      title: "Example Server",
      description: "Synthetic server",
      version: "1.0.0",
      packages: [
        {
          registryType: "npm",
          identifier: "@example/server",
          version: "1.0.0",
          transport: { type: "stdio" },
          environmentVariables: secretMetadata ? [{ name: "EXAMPLE_TOKEN", isRequired: true, isSecret: true }] : [],
        },
      ],
    },
  };
}

function remoteServer() {
  return {
    registrySource: "official",
    name: "io.github/remote",
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
      name: "io.github/remote",
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
