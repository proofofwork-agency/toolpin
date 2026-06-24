import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { codexTomlFromClientConfig, mergeCodexToml } from "../dist/codexToml.js";
import { exportClientConfig } from "../dist/config.js";
import { installServerConfig } from "../dist/install.js";

test("codexTomlFromClientConfig serializes quoted MCP server tables", () => {
  const toml = codexTomlFromClientConfig({
    mcp_servers: {
      "io.github/example": {
        command: "npx",
        args: ["-y", "example@1.0.0"],
        env: { EXAMPLE_TOKEN: "<EXAMPLE_TOKEN>" },
      },
    },
  });

  assert.match(toml, /\[mcp_servers\."io\.github\/example"\]/);
  assert.match(toml, /command = "npx"/);
  assert.match(toml, /args = \["-y", "example@1\.0\.0"\]/);
  assert.match(toml, /\[mcp_servers\."io\.github\/example"\.env\]/);
  assert.match(toml, /EXAMPLE_TOKEN = "<EXAMPLE_TOKEN>"/);
});

test("mergeCodexToml replaces only the matching server tables", () => {
  const existing = [
    'model = "gpt-5.5"',
    "",
    "[mcp_servers.keep]",
    'command = "uvx"',
    "",
    '[mcp_servers."io.github/example"]',
    'command = "old"',
    "",
    '[mcp_servers."io.github/example".env]',
    'OLD = "1"',
    "",
    '[mcp_servers."io.github/example".tools.search]',
    'approval_mode = "approve"',
    "",
    "[projects.\"/tmp/example\"]",
    'trust_level = "trusted"',
    "",
  ].join("\n");

  const merged = mergeCodexToml(existing, {
    mcp_servers: {
      "io.github/example": {
        command: "npx",
        args: ["-y", "example@1.0.0"],
      },
    },
  });

  assert.match(merged, /model = "gpt-5\.5"/);
  assert.match(merged, /\[mcp_servers\.keep\]/);
  assert.match(merged, /\[projects\."\/tmp\/example"\]/);
  assert.doesNotMatch(merged, /command = "old"/);
  assert.doesNotMatch(merged, /OLD = "1"/);
  assert.doesNotMatch(merged, /approval_mode = "approve"/);
  assert.match(merged, /\[mcp_servers\."io\.github\/example"\]/);
  assert.match(merged, /command = "npx"/);
});

test("mergeCodexToml does not remove servers that share a name prefix", () => {
  const existing = [
    "[mcp_servers.foo]",
    'command = "old-foo"',
    "",
    "[mcp_servers.foo.env]",
    'FOO = "old"',
    "",
    "[mcp_servers.foobar]",
    'command = "keep-foobar"',
    "",
    "[mcp_servers.foobar.env]",
    'FOOBAR = "keep"',
    "",
  ].join("\n");

  const merged = mergeCodexToml(existing, {
    mcp_servers: {
      foo: {
        command: "new-foo",
      },
    },
  });

  assert.doesNotMatch(merged, /old-foo/);
  assert.doesNotMatch(merged, /FOO = "old"/);
  assert.match(merged, /\[mcp_servers\.foo\]/);
  assert.match(merged, /command = "new-foo"/);
  assert.match(merged, /\[mcp_servers\.foobar\]/);
  assert.match(merged, /command = "keep-foobar"/);
  assert.match(merged, /\[mcp_servers\.foobar\.env\]/);
  assert.match(merged, /FOOBAR = "keep"/);
});

test("Codex export and project install use .codex/config.toml", async () => {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mpm-codex-install-"));
  try {
    process.chdir(tempDir);
    const server = packageServer();
    const exported = exportClientConfig(server, "codex");

    assert.deepEqual(Object.keys(exported.config), ["mcp_servers"]);

    const result = await installServerConfig(server, "codex", "project");
    assert.equal(result.file.endsWith(path.join(".codex", "config.toml")), true);

    const written = await readFile(result.file, "utf8");
    assert.match(written, /\[mcp_servers\."io\.github\/example"\]/);
    assert.match(written, /command = "npx"/);
    assert.match(written, /\[mcp_servers\."io\.github\/example"\.env\]/);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
});

function packageServer() {
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
    requiresSecrets: true,
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
          environmentVariables: [{ name: "EXAMPLE_TOKEN", isRequired: true, isSecret: true }],
        },
      ],
    },
  };
}
