import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildInstallPlan, writeLockfile } from "../dist/plan.js";
import { enforcePolicy, evaluatePolicy, readPolicy } from "../dist/policy.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist", "cli.js");

test("evaluatePolicy allows installs when no policy exists", () => {
  const report = evaluatePolicy(buildInstallPlan(packageServer(), "claude"));

  assert.equal(report.ok, true);
  assert.deepEqual(report.issues, []);
});

test("evaluatePolicy reports trust, source, client, transport, and server violations", () => {
  const report = evaluatePolicy(buildInstallPlan(packageServer(), "claude"), {
    minTrustScore: 100,
    allowedSources: ["docker"],
    deniedClients: ["claude"],
    deniedServers: ["io.github/example"],
    deniedTransports: ["stdio"],
  });

  assert.equal(report.ok, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code).sort(),
    ["client_denied", "server_denied", "source_not_allowed", "transport_denied", "trust_below_minimum"],
  );
});

test("evaluatePolicy enforces OCI and MCPB pin requirements", () => {
  const oci = evaluatePolicy(buildInstallPlan(packageServer({ registryType: "oci", identifier: "ghcr.io/example/server:latest" }), "claude"), {
    requireDigestPinnedOci: true,
  });
  const mcpb = evaluatePolicy(buildInstallPlan(packageServer({ registryType: "mcpb", identifier: "example.mcpb" }), "claude"), {
    requireMcpbSha256: true,
  });

  assert.equal(oci.ok, false);
  assert.ok(oci.issues.some((issue) => issue.code === "oci_digest_required"));
  assert.equal(mcpb.ok, false);
  assert.ok(mcpb.issues.some((issue) => issue.code === "mcpb_sha256_required"));
});

test("readPolicy rejects malformed policy schema", async () => {
  await withTempCwd(async () => {
    await mkdir(".toolpin", { recursive: true });
    await writeFile(".toolpin/policy.json", '{"minTrustScore": 101}\n', "utf8");

    await assert.rejects(() => readPolicy(".toolpin/policy.json"), /minTrustScore must be 0-100/);

    await writeFile(".toolpin/policy.json", JSON.stringify({ deniedClient: ["codex"] }), "utf8");
    await assert.rejects(() => readPolicy(".toolpin/policy.json"), /unknown policy key deniedClient/);

    await writeFile(".toolpin/policy.json", JSON.stringify({ requireDigestPinnedOci: "yes" }), "utf8");
    await assert.rejects(() => readPolicy(".toolpin/policy.json"), /requireDigestPinnedOci must be a boolean/);
  });
});

test("readPolicy rejects unknown clients and sources", async () => {
  await withTempCwd(async () => {
    await mkdir(".toolpin", { recursive: true });
    await writeFile(".toolpin/policy.json", JSON.stringify({ allowedClients: ["not-a-client"] }), "utf8");
    await assert.rejects(() => readPolicy(".toolpin/policy.json"), /allowedClients contains an unknown client/);

    await writeFile(".toolpin/policy.json", JSON.stringify({ allowedSources: ["not-a-source"] }), "utf8");
    await assert.rejects(() => readPolicy(".toolpin/policy.json"), /allowedSources contains an unknown registry source/);
  });
});

test("enforcePolicy reads .toolpin/policy.json when present", async () => {
  await withTempCwd(async () => {
    await mkdir(".toolpin", { recursive: true });
    await writeFile(".toolpin/policy.json", JSON.stringify({ deniedServers: ["io.github/example"] }), "utf8");

    const report = await enforcePolicy(buildInstallPlan(packageServer(), "claude"));

    assert.equal(report.ok, false);
    assert.equal(report.issues[0].code, "server_denied");
  });
});

test("CLI install refuses policy violations before writing client config", async () => {
  await withTempCwd(async () => {
    await writeCache([registryEntry(packageServer())]);
    await mkdir(".toolpin", { recursive: true });
    await writeFile(".toolpin/policy.json", JSON.stringify({ deniedServers: ["io.github/example"] }), "utf8");

    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "install", "io.github/example", "--client", "claude", "--source", "official"]),
      /Install refused by policy/,
    );
    await assert.rejects(() => access(".mcp.json"));
  });
});

test("CLI ci reports policy violations as frozen-install issues", async () => {
  await withTempCwd(async () => {
    const server = packageServer();
    await writeCache([registryEntry(server)]);
    await writeLockfile(buildInstallPlan(server, "claude"));
    await writeFile(".toolpin/policy.json", JSON.stringify({ deniedServers: ["io.github/example"] }), "utf8");

    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI, "ci", "--source", "official", "--policy", ".toolpin/policy.json"]),
      /server_denied/,
    );
  });
});

test("allowedSources denies plans with an unknown source", () => {
  const plan = buildInstallPlan(packageServer(), "claude");
  delete plan.resolved.source;
  delete plan.capabilityManifest.registrySource;

  const report = evaluatePolicy(plan, { allowedSources: ["official"] });

  assert.equal(report.ok, false);
  assert.equal(report.issues[0].code, "source_not_allowed");
  assert.match(report.issues[0].message, /registry source unknown/);
});

async function withTempCwd(fn) {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "toolpin-policy-"));
  try {
    process.chdir(tempDir);
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeCache(entries) {
  await mkdir(".toolpin", { recursive: true });
  await writeFile(".toolpin/registry-cache.json", JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2), "utf8");
}

function registryEntry(server) {
  return { source: "official", server: server.raw };
}

function packageServer(overrides = {}) {
  const registryType = overrides.registryType ?? "npm";
  const identifier = overrides.identifier ?? "@example/server";
  const fileSha256 = overrides.fileSha256;
  return {
    registrySource: "official",
    name: "io.github/example",
    title: "Example Server",
    description: "Synthetic server",
    version: "1.0.0",
    isLatest: true,
    repositoryUrl: "https://github.com/example/server",
    packageTypes: [registryType],
    remoteTypes: [],
    transports: ["stdio"],
    requiresSecrets: false,
    raw: {
      name: "io.github/example",
      title: "Example Server",
      description: "Synthetic server",
      version: "1.0.0",
      repository: { url: "https://github.com/example/server" },
      packages: [
        {
          registryType,
          identifier,
          version: registryType === "oci" ? undefined : "1.0.0",
          fileSha256,
          transport: { type: "stdio" },
        },
      ],
    },
  };
}
