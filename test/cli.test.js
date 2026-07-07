import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { installServerConfig } from "../dist/install.js";
import { buildInstallPlan, readLockfile, writeLockfile } from "../dist/plan.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist", "cli.js");

test("CLI lists built-in directory sources as disabled by default", async () => {
  await withTempCwd(async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, "registry", "list", "--json"]);
    const parsed = JSON.parse(stdout);
    const smithery = parsed.sources.find((source) => source.id === "smithery");

    assert.equal(stderr, "");
    assert.equal(smithery.mode, "discovery");
    assert.equal(smithery.enabled, false);
    assert.equal(smithery.status, "disabled");
    assert.equal(smithery.adapter, "smithery");
  });
});

test("CLI search --json writes parseable JSON to stdout only", async () => {
  await withTempCwd(async () => {
    await writeRegistryCache([
      packageServer({ name: "io.github/example", title: "GitHub Example Server" }),
    ]);

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      CLI,
      "search",
      "github",
      "--source",
      "official",
      "--json",
    ]);
    const parsed = JSON.parse(stdout);

    assert.equal(stderr, "");
    assert.equal(parsed.query, "github");
    assert.equal(parsed.count, 1);
    assert.equal(parsed.results[0].server.name, "io.github/example");
    assert.equal(typeof parsed.results[0].trust.score, "number");
  });
});

test("CLI search preserves human output without --json", async () => {
  await withTempCwd(async () => {
    await writeRegistryCache([
      packageServer({ name: "io.github/example", title: "GitHub Example Server" }),
    ]);

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      CLI,
      "search",
      "github",
      "--source",
      "official",
    ]);

    assert.equal(stderr, "");
    assert.match(stdout, /Search results for "github"/);
    assert.match(stdout, /io\.github\/example@1\.0\.0/);
    assert.match(stdout, /title\s+GitHub Example Server/);
    assert.match(stdout, /trust\s+conditional \/ \d+% profile/);
    assert.match(stdout, /evidence\s+declared package_pin/);
    assert.doesNotMatch(stdout, /\d+% complete/);
  });
});

test("CLI export-config --client all skips unsupported curated clients and keeps stdout JSON", async () => {
  await withTempCwd(async () => {
    await writeRegistryCache([
      packageServer({
        name: "@proofofwork-agency/contextrelay",
        identifier: "@proofofwork-agency/contextrelay",
        runtimeHint: "bun",
        packageArguments: ["codex-mcp", "server"],
        clientSupport: contextRelayClientSupport(),
      }),
    ]);

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      CLI,
      "export-config",
      "@proofofwork-agency/contextrelay",
      "--client",
      "all",
      "--source",
      "official",
    ]);
    const parsed = JSON.parse(stdout);

    assert.deepEqual(Object.keys(parsed), ["codex"]);
    assert.equal(parsed.codex.mcp_servers["@proofofwork-agency/contextrelay"].command, "bunx");
    assert.match(stderr, /Skipping claude: .*external setup/);
    assert.match(stderr, /Skipping cursor: .*not supported/);
  });
});

test("CLI install --client all installs only ToolPin-installable clients and fails when none are scoped installable", async () => {
  await withTempCwd(async () => {
    await writeRegistryCache([
      packageServer({
        name: "@proofofwork-agency/contextrelay",
        identifier: "@proofofwork-agency/contextrelay",
        runtimeHint: "bun",
        packageArguments: ["codex-mcp", "server"],
        clientSupport: contextRelayClientSupport(),
      }),
      packageServer({
        name: "io.github/external-only",
        clientSupport: {
          default: "unsupported",
          clients: {
            claude: {
              status: "external-setup",
              installMode: "claude-plugin",
              requirements: ["external-cli"],
              setupCommands: ["external init"],
              notes: "Uses external setup.",
            },
          },
        },
      }),
    ]);

    const installed = await execFileAsync(process.execPath, [
      CLI,
      "install",
      "@proofofwork-agency/contextrelay",
      "--client",
      "all",
      "--scope",
      "project",
      "--source",
      "official",
      "--update-lock",
      "--no-policy",
    ]);
    const lockfile = await readLockfile();

    assert.ok(lockfile.servers["@proofofwork-agency/contextrelay:codex"]);
    assert.equal(lockfile.servers["@proofofwork-agency/contextrelay:claude"], undefined);
    assert.match(installed.stdout, /clients\s+codex/);
    assert.match(installed.stderr, /Skipping claude: .*external setup/);

    await assert.rejects(
      () => execFileAsync(process.execPath, [
        CLI,
        "install",
        "io.github/external-only",
        "--client",
        "all",
        "--scope",
        "global",
        "--source",
        "official",
        "--update-lock",
        "--no-policy",
      ]),
      (error) => {
        const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
        assert.match(stderr, /No ToolPin-installable clients are available/);
        assert.match(stderr, /codex: .*not supported/);
        return true;
      },
    );
  });
});

test("CLI ci --verify --skip-live-verification rejects description and manifest pins", async () => {
  for (const field of ["toolDescriptionHash", "toolManifestHash"]) {
    await withTempCwd(async () => {
      const server = packageServer({ name: `io.github/${field}` });
      await writeRegistryCache([server]);
      await writeLockfile(buildInstallPlan(server, "claude", { capabilityManifest: capabilityManifest(server, field) }));

      await assert.rejects(
        () => execFileAsync(process.execPath, [
          CLI,
          "ci",
          "--file",
          "mcp-lock.json",
          "--source",
          "official",
          "--verify",
          "--skip-live-verification",
          "--no-policy",
        ]),
        (error) => {
          const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
          assert.match(stderr, /--skip-live-verification is not allowed for pinned CI entries/);
          return true;
        },
      );
    });
  }
});

test("CLI ci --json emits machine-readable success status", async () => {
  await withTempCwd(async () => {
    const server = packageServer({ name: "io.github/json-ok" });
    await writeRegistryCache([server]);
    await writeLockfile(buildInstallPlan(server, "claude"));

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      CLI,
      "ci",
      "--source",
      "official",
      "--no-policy",
      "--json",
    ]);
    const parsed = JSON.parse(stdout);

    assert.equal(stderr, "");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.checkedEntries, 1);
    assert.deepEqual(parsed.failures, []);
    assert.equal(parsed.lockIntegrity.status, "ok");
    assert.equal(parsed.registryDrift.status, "ok");
    assert.equal(parsed.policy.status, "skipped");
    assert.equal(parsed.verification.status, "skipped");
    assert.equal(parsed.signature.status, "skipped");
  });
});

test("CLI ci --json emits remediations for failed entries", async () => {
  await withTempCwd(async () => {
    await writeFile("mcp-lock.json", JSON.stringify({
      lockfileVersion: 2,
      generatedAt: new Date().toISOString(),
      servers: {},
    }, null, 2), "utf8");

    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "ci", "--no-policy", "--json"]),
      (error) => {
        const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
        const parsed = JSON.parse(stdout);
        assert.equal(parsed.ok, false);
        assert.equal(parsed.checkedEntries, 0);
        assert.equal(parsed.failures[0].entryName, "mcp-lock.json");
        assert.equal(parsed.failures[0].client, "unknown");
        assert.match(parsed.failures[0].condition, /lockfile has no server entries/);
        assert.match(parsed.failures[0].remediation, /toolpin install mcp-lock\.json --client <client> --update-lock/);
        assert.equal(parsed.lockIntegrity.status, "failed");
        assert.equal(parsed.registryDrift.status, "failed");
        return true;
      },
    );
  });
});

test("CLI policy init --recommended writes starter policy and refuses accidental overwrite", async () => {
  await withTempCwd(async () => {
    const created = await execFileAsync(process.execPath, [CLI, "policy", "init", "--recommended"]);
    const policy = JSON.parse(await readFile(".toolpin/policy.json", "utf8"));

    assert.match(created.stdout, /Policy initialized/);
    assert.equal(policy.version, 1);
    assert.equal(policy.minTrustTier, "conditional");
    assert.equal(policy.requireToolPinVerifiedEvidence, false);
    assert.equal(policy.requireDigestPinnedOci, true);
    assert.equal(policy.requireMcpbSha256, true);
    assert.equal(policy.allowedSources, undefined);
    assert.match(created.stdout, /verdict floor\s+needs-review or better; blocked entries fail/);
    assert.match(created.stdout, /verified proof\s+not required yet/);

    await writeFile(".toolpin/policy.json", "{\"version\":1}\n", "utf8");
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "policy", "init", "--recommended"]),
      (error) => {
        const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
        assert.match(stderr, /already exists; rerun with --force/);
        return true;
      },
    );

    const replaced = await execFileAsync(process.execPath, [CLI, "policy", "init", "--recommended", "--force"]);
    assert.match(replaced.stdout, /status\s+replaced/);
    assert.equal(JSON.parse(await readFile(".toolpin/policy.json", "utf8")).minTrustTier, "conditional");
  });
});

test("CLI init ci writes GitHub workflow and recommended policy idempotently", async () => {
  await withTempCwd(async () => {
    await writeLockfile(buildInstallPlan(packageServer({ name: "io.github/ci-init" }), "claude"));

    const initialized = await execFileAsync(process.execPath, [CLI, "init", "ci"]);
    const workflow = await readFile(".github/workflows/toolpin.yml", "utf8");
    const policy = JSON.parse(await readFile(".toolpin/policy.json", "utf8"));
    const firstWorkflow = workflow;
    const firstPolicy = JSON.stringify(policy);

    assert.match(initialized.stdout, /ToolPin CI initialized/);
    assert.match(initialized.stdout, /\.github\/workflows\/toolpin\.yml\s+created/);
    assert.match(initialized.stdout, /\.toolpin\/policy\.json\s+created/);
    assert.match(initialized.stdout, /commit these files; CI now fails on MCP drift/);
    assert.match(workflow, /permissions:\n  contents: read/);
    assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
    assert.match(workflow, /proofofwork-agency\/toolpin@v0\.3\.2/);
    assert.equal(policy.minTrustTier, "conditional");

    const second = await execFileAsync(process.execPath, [CLI, "init", "ci", "--github"]);
    assert.match(second.stdout, /already configured/);
    assert.equal(await readFile(".github/workflows/toolpin.yml", "utf8"), firstWorkflow);
    assert.equal(JSON.stringify(JSON.parse(await readFile(".toolpin/policy.json", "utf8"))), firstPolicy);
  });
});

test("CLI init ci dry-run reports files without writing", async () => {
  await withTempCwd(async () => {
    await writeLockfile(buildInstallPlan(packageServer({ name: "io.github/ci-dry-run" }), "claude"));

    const { stdout } = await execFileAsync(process.execPath, [CLI, "init", "ci", "--dry-run"]);
    assert.match(stdout, /ToolPin CI dry run/);
    assert.match(stdout, /\.github\/workflows\/toolpin\.yml\s+would write/);
    assert.match(stdout, /\.toolpin\/policy\.json\s+would write/);
    await assert.rejects(() => access(".github/workflows/toolpin.yml"));
    await assert.rejects(() => access(".toolpin/policy.json"));
  });
});

test("CLI init ci guides instead of writing when lockfile is missing", async () => {
  await withTempCwd(async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, "init", "ci"]);

    assert.equal(stderr, "");
    assert.match(stdout, /ToolPin CI not configured/);
    assert.match(stdout, /missing\s+mcp-lock\.json/);
    assert.match(stdout, /toolpin install <server> --client <client> --update-lock/);
    assert.match(stdout, /CI would fail immediately/);
    await assert.rejects(() => access(".github/workflows/toolpin.yml"));
    await assert.rejects(() => access(".toolpin/policy.json"));
  });
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

test("CLI rejects unknown double-dash flags with a clear parser error", async () => {
  await withTempCwd(async () => {
    await assert.rejects(
      () => execFileAsync(process.execPath, [
        CLI,
        "remove",
        "--future-boolean",
        "io.github/example",
        "--client",
        "claude",
      ]),
      /Unknown flag for remove: --future-boolean/,
    );
  });
});

test("default install leaves a matching mcp-lock.json byte-for-byte unchanged", async () => {
  await withTempCwd(async () => {
    await writeRegistryCache([
      packageServer({
        name: "@proofofwork-agency/contextrelay",
        identifier: "@proofofwork-agency/contextrelay",
        runtimeHint: "bun",
        packageArguments: ["codex-mcp", "server"],
        clientSupport: contextRelayClientSupport(),
      }),
    ]);

    const installArgs = [
      CLI, "install", "@proofofwork-agency/contextrelay",
      "--client", "codex", "--scope", "project", "--source", "official", "--no-policy",
    ];

    await execFileAsync(process.execPath, [...installArgs, "--update-lock"]);
    const first = await readFile("mcp-lock.json", "utf8");

    // A second default install (no --update-lock) with matching metadata must
    // not rewrite the lockfile — otherwise lockedAt/integrity churn would break
    // signed / --expect-digest lockfiles.
    const rerun = await execFileAsync(process.execPath, installArgs);
    const second = await readFile("mcp-lock.json", "utf8");

    assert.equal(second, first, "default install must not rewrite a matching lockfile");
    assert.match(rerun.stdout, /unchanged \(matches lock\)/);
  });
});

test("CLI value flags reject a missing or flag-like value", async () => {
  await withTempCwd(async () => {
    // A value flag immediately followed by another flag must fail loudly
    // instead of consuming the next flag as its value.
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "list", "--scope", "--json"]),
      /--scope requires a value/,
    );
    // Non-integer numeric flags are rejected rather than silently falling back.
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "search", "github", "--limit", "abc"]),
      /--limit requires a non-negative integer/,
    );
  });
});

test("CLI accepts --flag=value syntax and suggests flag typos", async () => {
  await withTempCwd(async () => {
    const { stdout } = await execFileAsync(process.execPath, [CLI, "list", "--scope=global", "--client=continue", "--json"]);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.checked, 1);

    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "list", "--scoep=global"]),
      /Unknown flag for list: --scoep\. Did you mean --scope\?/,
    );
  });
});

test("CLI search help is universal and does not execute a search", async () => {
  await withTempCwd(async (dir) => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, "search", "github", "--help"]);
    assert.match(stdout, /^Usage: toolpin search /);
    assert.equal(stderr, "");
    assert.deepEqual(await readdir(dir), []);
  });
});

test("CLI command-specific help covers documented commands", async () => {
  const commands = [
    "ingest",
    "info",
    "versions",
    "plan",
    "install",
    "export-config",
    "test",
    "test-installed",
    "adopt",
    "update",
    "outdated",
    "secrets",
    "version",
  ];
  for (const command of commands) {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, command, "--help"]);
    assert.match(stdout, /^Usage: toolpin /, command);
    assert.equal(stderr, "", command);
  }
});

test("CLI rejects invalid --color even for machine-readable commands", async () => {
  await withTempCwd(async () => {
    await writeRegistryCache([
      packageServer({ name: "io.github/example", title: "GitHub Example Server" }),
    ]);
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "search", "github", "--source", "official", "--json", "--color", "sometimes"]),
      /--color must be auto, always, or never/,
    );
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "registry", "list", "--json", "--color", "sometimes"]),
      /--color must be auto, always, or never/,
    );
  });
});

test("CLI accepts short client and scope aliases", async () => {
  await withTempCwd(async () => {
    const listed = await execFileAsync(process.execPath, [CLI, "list", "-s", "global", "-c", "continue", "--json"]);
    const parsed = JSON.parse(listed.stdout);

    assert.equal(listed.stderr, "");
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

test("CLI remove warns when deleting a local HTTP MCP endpoint", async () => {
  await withTempCwd(async () => {
    const listener = net.createServer((socket) => socket.end());
    await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const address = listener.address();
    assert.equal(typeof address, "object");
    const url = `http://127.0.0.1:${address.port}/mcp`;
    try {
      const server = remoteServer({ name: "io.github/local-http", url });
      await installServerConfig(server, "claude", "project");
      await writeLockfile(buildInstallPlan(server, "claude"));

      const { stdout } = await execFileAsync(process.execPath, [
        CLI,
        "remove",
        "io.github/local-http",
        "--client",
        "claude",
        "--scope",
        "project",
      ]);

      assert.match(stdout, new RegExp(`runtime\\s+local HTTP endpoint ${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is accepting connections`));
      assert.match(stdout, /does not stop that process/);
    } finally {
      await new Promise((resolve) => listener.close(resolve));
    }
  });
});

test("CLI remove does not print config-written notes when entry is missing", async () => {
  await withTempCwd(async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      CLI,
      "remove",
      "io.github/missing",
      "--client",
      "codex",
      "--scope",
      "project",
    ]);

    assert.match(stdout, /config\s+missing/);
    assert.doesNotMatch(stdout, /config\.toml written/);
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

test("CLI tui --help prints usage without requiring a TTY", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, "tui", "--help"]);

  assert.match(stdout, /^Usage: toolpin tui/);
  assert.equal(stderr, "");
});

test("CLI interactive help works without requiring a TTY", async () => {
  const interactive = await execFileAsync(process.execPath, [CLI, "interactive", "--help"]);
  assert.match(interactive.stdout, /^Usage: toolpin interactive/);
  assert.match(interactive.stdout, /toolpin i \[query\]/);
  assert.equal(interactive.stderr, "");

  const alias = await execFileAsync(process.execPath, [CLI, "i", "--help"]);
  assert.match(alias.stdout, /^Usage: toolpin interactive/);
  assert.equal(alias.stderr, "");
});

test("CLI upgrade help and dry-run expose the package-manager command", async () => {
  const help = await execFileAsync(process.execPath, [CLI, "upgrade", "--help"]);
  assert.match(help.stdout, /^Usage: toolpin upgrade/);
  assert.equal(help.stderr, "");

  const dry = await execFileAsync(process.execPath, [CLI, "upgrade", "--dry-run", "--target", "latest", "--package-manager", "npm"]);
  assert.match(dry.stdout, /ToolPin Upgrade/);
  assert.match(dry.stdout, /command\s+npm install -g @proofofwork-agency\/toolpin@latest/);
  assert.match(dry.stdout, /dry run; no changes made/);
  assert.equal(dry.stderr, "");
});

test("CLI upgrade dry-run supports JSON and package-manager selection", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    CLI,
    "upgrade",
    "--dry-run",
    "--json",
    "--target",
    "3.9.2",
    "--package-manager",
    "pnpm",
  ]);
  const parsed = JSON.parse(stdout);

  assert.equal(stderr, "");
  assert.equal(parsed.package, "@proofofwork-agency/toolpin");
  assert.equal(parsed.target, "3.9.2");
  assert.equal(parsed.packageManager, "pnpm");
  assert.deepEqual(parsed.command.slice(-3), ["add", "-g", "@proofofwork-agency/toolpin@3.9.2"]);
  assert.equal(parsed.dryRun, true);
});

test("CLI tui fails cleanly when stdio is not a TTY", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [CLI, "tui"]),
    (error) => {
      assert.equal(error && typeof error === "object" && "stdout" in error ? error.stdout : undefined, "");
      const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
      assert.match(stderr, /Error: toolpin tui requires an interactive terminal/);
      assert.match(stderr, /stdin and stdout must both be TTYs/);
      return true;
    },
  );
});

test("CLI interactive fails cleanly without TTY unless --no-input is used", async () => {
  await withTempCwd(async () => {
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "interactive", "github"]),
      (error) => {
        assert.equal(error && typeof error === "object" && "stdout" in error ? error.stdout : undefined, "");
        const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
        assert.match(stderr, /Error: toolpin interactive requires an interactive terminal/);
        assert.match(stderr, /Use --no-input to print command guidance/);
        return true;
      },
    );
  });
});

test("CLI interactive --no-input prints command guidance and makes no writes", async () => {
  await withTempCwd(async (dir) => {
    await writeRegistryCache([
      packageServer({ name: "io.github/example", title: "GitHub Example Server" }),
    ]);

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      CLI,
      "i",
      "github",
      "--source",
      "official",
      "--client",
      "claude",
      "--scope",
      "project",
      "--no-input",
    ]);

    assert.equal(stderr, "");
    assert.match(stdout, /ToolPin interactive guidance/);
    assert.match(stdout, /Top result: io\.github\/example@1\.0\.0/);
    assert.match(stdout, /Equivalent one-shot command:/);
    assert.match(stdout, /toolpin install io\.github\/example --client claude --scope project --update-lock --source official --version 1\.0\.0/);
    assert.match(stdout, /No files were written/);
    assert.deepEqual((await readdir(dir)).sort(), [".toolpin"]);
  });
});

test("CLI interactive does not print stale cache warnings before guidance", async () => {
  await withTempCwd(async () => {
    await writeRegistryCache([
      packageServer({ name: "io.github/example", title: "GitHub Example Server" }),
    ], { generatedAt: "2020-01-01T00:00:00.000Z" });

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      CLI,
      "i",
      "github",
      "--source",
      "official",
      "--client",
      "claude",
      "--scope",
      "project",
      "--no-input",
    ]);

    assert.equal(stderr, "");
    assert.match(stdout, /ToolPin interactive guidance/);
    assert.doesNotMatch(stdout, /Registry cache .* is stale/);
  });
});

test("CLI interactive validates numeric flags and forced no-input color", async () => {
  await withTempCwd(async () => {
    await writeRegistryCache([
      packageServer({ name: "io.github/example", title: "GitHub Example Server" }),
    ]);
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "i", "github", "--limit", "banana", "--no-input"]),
      /--limit must be a number/,
    );
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "i", "github", "--timeout", "--no-input", "--no-input"]),
      /--timeout requires a numeric value/,
    );

    const { stdout } = await execFileAsync(process.execPath, [
      CLI,
      "i",
      "github",
      "--source",
      "official",
      "--client",
      "claude",
      "--scope",
      "project",
      "--no-input",
      "--color",
      "always",
    ]);
    assert.match(stdout, /\x1b\[/);
  });
});

test("CLI interactive-only flags remain rejected for existing commands", async () => {
  await withTempCwd(async () => {
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "search", "github", "--no-input"]),
      /Unknown flag for search: --no-input/,
    );
  });
});

test("CLI interactive rejects unsupported legacy flags", async () => {
  await withTempCwd(async () => {
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "interactive", "github", "--json"]),
      /Unknown flag for interactive: --json/,
    );
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

test("CLI test --json emits pipe-friendly failure JSON and exits nonzero", async () => {
  await withTempCwd(async () => {
    const server = packageServer({ name: "io.github/unlaunchable" });
    server.raw.packages = [];
    await writeRegistryCache([server]);

    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "test", "io.github/unlaunchable", "--source", "official", "--json"]),
      (error) => {
        const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
        const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
        const parsed = JSON.parse(stdout);

        assert.equal(stderr, "");
        assert.equal(parsed.ok, false);
        assert.equal(parsed.serverName, "io.github/unlaunchable");
        assert.equal(parsed.target, "none");
        assert.match(parsed.message, /No launch target is available/);
        return true;
      },
    );
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

    const explicit = await execFileAsync(process.execPath, [CLI, "update", "io.github/locked", "--client", "claude", "--scope", "project", "--source", "official", "--version", "1.0.0", "--json"]);
    const explicitParsed = JSON.parse(explicit.stdout);
    assert.equal(explicitParsed.fromVersion, "2.0.0");
    assert.equal(explicitParsed.toVersion, "1.0.0");
    const downgradedConfig = JSON.parse(await readFile(".mcp.json", "utf8"));
    assert.deepEqual(downgradedConfig.mcpServers["io.github/locked"].args, ["-y", "@example/locked@1.0.0"]);
    const downgradedLockfile = await readLockfile();
    assert.equal(downgradedLockfile.servers["io.github/locked:claude"].version, "1.0.0");
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

async function writeRegistryCache(servers, options = {}) {
  await mkdir(".toolpin", { recursive: true });
  await writeFile(".toolpin/registry-cache.json", JSON.stringify({
    generatedAt: options.generatedAt ?? new Date().toISOString(),
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
          runtimeHint: overrides.runtimeHint,
          packageArguments: overrides.packageArguments,
          transport: { type: "stdio" },
        },
      ],
      _meta: overrides.clientSupport
        ? { "dev.toolpin/clientSupport": overrides.clientSupport }
        : undefined,
    },
  };
}

function contextRelayClientSupport() {
  return {
    default: "unsupported",
    clients: {
      codex: {
        status: "toolpin-installable",
        installMode: "mcp-config",
      },
      claude: {
        status: "external-setup",
        installMode: "claude-plugin",
        requirements: ["bun", "claude-code"],
        setupCommands: ["ctxrelay init --instructions project"],
        notes: "Claude support uses plugin setup.",
      },
    },
  };
}

function capabilityManifest(server, field) {
  return {
    version: 1,
    serverName: server.name,
    serverVersion: server.version,
    registrySource: server.registrySource,
    packageTypes: server.packageTypes,
    transports: server.transports,
    remoteHosts: [],
    secrets: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
    [field]: {
      algorithm: "sha256",
      value: field === "toolDescriptionHash" ? "description-hash" : "manifest-hash",
      toolCount: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

function remoteServer(overrides = {}) {
  const name = overrides.name ?? "io.github/remote";
  const version = overrides.version ?? "1.0.0";
  const url = overrides.url ?? "http://localhost:3333/mcp";
  return {
    registrySource: "official",
    registryMode: "installable",
    name,
    title: overrides.title ?? "Remote Server",
    description: "Synthetic remote server",
    version,
    isLatest: true,
    installable: true,
    repositoryUrl: "https://github.com/example/remote",
    packageTypes: [],
    remoteTypes: ["streamable-http"],
    transports: ["streamable-http"],
    requiresSecrets: false,
    raw: {
      name,
      title: overrides.title ?? "Remote Server",
      description: "Synthetic remote server",
      version,
      repository: { url: "https://github.com/example/remote" },
      remotes: [
        {
          type: "streamable-http",
          url,
        },
      ],
    },
  };
}
