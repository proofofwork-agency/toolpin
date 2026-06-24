import assert from "node:assert/strict";
import test from "node:test";
import { hashToolDescriptions } from "../dist/capabilities.js";
import { scoreServer } from "../dist/trust.js";
import { verifyServer } from "../dist/verify.js";

test("verifyServer accepts digest-pinned OCI packages", async () => {
  const report = await verifyServer(packageServer("oci", { identifier: "ghcr.io/example/server@sha256:abc123" }));

  assert.equal(report.ok, true);
  assert.equal(report.issues.some((issue) => issue.code === "mutable_oci_tag"), false);
  assert.ok(report.badges.includes("digest-pinned"));
});

test("verifyServer rejects mutable OCI packages", async () => {
  const report = await verifyServer(packageServer("oci", { identifier: "ghcr.io/example/server:latest" }));

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.severity === "critical" && issue.code === "mutable_oci_tag"));
});

test("verifyServer rejects MCPB packages without fileSha256", async () => {
  const report = await verifyServer(packageServer("mcpb", { identifier: "example-server.mcpb" }));

  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.severity === "critical" && issue.code === "missing_mcpb_hash"));
});

test("verifyServer accepts MCPB packages with fileSha256", async () => {
  const report = await verifyServer(packageServer("mcpb", { identifier: "example-server.mcpb", fileSha256: "abc123" }));

  assert.equal(report.ok, true);
  assert.equal(report.issues.some((issue) => issue.code === "missing_mcpb_hash"), false);
  assert.ok(report.badges.includes("fileSha256"));
});

test("remote probe skip is warning-only", async () => {
  const report = await verifyServer(remoteServer(), { liveRemoteProbe: false });

  assert.equal(report.ok, true);
  assert.ok(report.issues.some((issue) => issue.severity === "warning" && issue.code === "remote_probe_skipped"));
});

test("tool-description hash is stable across order and generatedAt", () => {
  const left = hashToolDescriptions(
    [
      { name: "second", description: "B" },
      { name: "first", description: "A" },
    ],
    "2026-01-01T00:00:00.000Z",
  );
  const right = hashToolDescriptions(
    [
      { name: "first", description: "A" },
      { name: "second", description: "B" },
    ],
    "2027-01-01T00:00:00.000Z",
  );

  assert.equal(left.value, right.value);
  assert.notEqual(left.generatedAt, right.generatedAt);
});

test("attestation metadata is declared, not verified", async () => {
  const server = packageServer("oci", { identifier: "ghcr.io/example/server@sha256:abc123" });
  server.raw._meta = {
    "dev.mpm/attestations": [{ type: "sigstore", verified: true }],
  };

  const verification = await verifyServer(server);
  const trust = scoreServer(server);

  assert.ok(verification.badges.includes("sigstore-declared"));
  assert.ok(trust.badges.includes("sigstore-declared"));
  assert.equal(verification.badges.some((badge) => badge.includes("verified")), false);
  assert.equal(trust.badges.some((badge) => badge.includes("verified")), false);
});

function packageServer(registryType, overrides = {}) {
  const identifier = overrides.identifier ?? `example-${registryType}`;
  return {
    registrySource: "official",
    name: `example/${registryType}`,
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
      name: `example/${registryType}`,
      title: "Example Server",
      description: "Synthetic server",
      version: "1.0.0",
      packages: [
        {
          registryType,
          identifier,
          version: "1.0.0",
          fileSha256: overrides.fileSha256,
          transport: { type: "stdio" },
        },
      ],
    },
  };
}

function remoteServer() {
  return {
    registrySource: "official",
    name: "example/remote",
    title: "Example Remote",
    description: "Synthetic remote server",
    version: "1.0.0",
    isLatest: true,
    repositoryUrl: "https://github.com/example/remote",
    packageTypes: [],
    remoteTypes: ["streamable-http"],
    transports: ["streamable-http"],
    requiresSecrets: false,
    raw: {
      name: "example/remote",
      title: "Example Remote",
      description: "Synthetic remote server",
      version: "1.0.0",
      remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
    },
  };
}
