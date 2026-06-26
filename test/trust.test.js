import assert from "node:assert/strict";
import test from "node:test";
import { scoreServer } from "../dist/trust.js";

test("repository and namespace trust signals have exact weights", () => {
  const trusted = scoreServer(packageServer());
  const missingRepository = scoreServer(packageServer({ repositoryUrl: undefined }));
  const unnamespaced = scoreServer(packageServer({ name: "example-server" }));

  assert.equal(trusted.score, 70);
  assert.equal(trusted.metadataCompleteness, 74);
  assert.equal(trusted.tier, "verified");
  assert.deepEqual(trusted.gates, []);
  assert.deepEqual(trusted.badges.filter((badge) => ["source repo", "namespaced"].includes(badge)), ["source repo", "namespaced"]);
  assert.equal(missingRepository.score, 49);
  assert.equal(missingRepository.metadataCompleteness, 58);
  assert.equal(missingRepository.tier, "conditional");
  assert.equal(missingRepository.capReason, "no verified provenance");
  assert.ok(missingRepository.issues.some((issue) => issue.code === "missing_repository"));
  assert.equal(unnamespaced.score, 69);
  assert.equal(unnamespaced.metadataCompleteness, 68);
  assert.equal(unnamespaced.tier, "conditional");
});

test("package type and pinned version signals have exact weights", () => {
  const pinnedNpm = scoreServer(packageServer());
  const unknownType = scoreServer(packageServer({ pkg: { registryType: "tarball", identifier: "example.tar.gz", version: "1.0.0" } }));
  const floatingVersion = scoreServer(packageServer({ pkg: { registryType: "npm", identifier: "@example/server", version: "^1.0.0" } }));

  assert.equal(pinnedNpm.score, 70);
  assert.equal(pinnedNpm.metadataCompleteness, 74);
  assert.ok(pinnedNpm.badges.includes("npm"));
  assert.ok(pinnedNpm.badges.includes("pinned version"));
  assert.equal(unknownType.score, 67);
  assert.equal(unknownType.metadataCompleteness, 61);
  assert.ok(unknownType.issues.some((issue) => issue.code === "unknown_package_type"));
  assert.equal(floatingVersion.score, 63);
  assert.equal(floatingVersion.metadataCompleteness, 63);
  assert.ok(floatingVersion.issues.some((issue) => issue.code === "unpinned_package"));
});

test("OCI digest and MCPB hash signals have exact weights", () => {
  const digestPinned = scoreServer(packageServer({ pkg: { registryType: "oci", identifier: "ghcr.io/example/server@sha256:abc123" } }));
  const mutableTag = scoreServer(packageServer({ pkg: { registryType: "oci", identifier: "ghcr.io/example/server:latest" } }));
  const hashedMcpb = scoreServer(packageServer({ pkg: { registryType: "mcpb", identifier: "example.mcpb", version: "1.0.0", fileSha256: "abc123" } }));
  const unhashedMcpb = scoreServer(packageServer({ pkg: { registryType: "mcpb", identifier: "example.mcpb", version: "1.0.0" } }));

  assert.equal(digestPinned.score, 73);
  assert.equal(digestPinned.metadataCompleteness, 81);
  assert.ok(digestPinned.badges.includes("digest-pinned"));
  assert.equal(mutableTag.score, 45);
  assert.equal(mutableTag.metadataCompleteness, 63);
  assert.equal(mutableTag.tier, "unverified");
  assert.deepEqual(mutableTag.gates.map((gate) => gate.code), ["mutable_oci_tag"]);
  assert.equal(mutableTag.capReason, "mutable_oci_tag");
  assert.ok(mutableTag.issues.some((issue) => issue.code === "mutable_oci_tag"));
  assert.equal(hashedMcpb.score, 79);
  assert.equal(hashedMcpb.metadataCompleteness, 86);
  assert.ok(hashedMcpb.badges.includes("fileSha256"));
  assert.equal(unhashedMcpb.score, 45);
  assert.equal(unhashedMcpb.metadataCompleteness, 66);
  assert.equal(unhashedMcpb.tier, "unverified");
  assert.deepEqual(unhashedMcpb.gates.map((gate) => gate.code), ["missing_mcpb_hash"]);
  assert.equal(unhashedMcpb.capReason, "missing_mcpb_hash");
  assert.ok(unhashedMcpb.issues.some((issue) => issue.code === "missing_mcpb_hash"));
});

test("remote trust signals and penalties have exact weights", () => {
  const httpsRemote = scoreServer(remoteServer({ type: "streamable-http", url: "https://example.com/mcp" }));
  const insecureRemote = scoreServer(remoteServer({ type: "streamable-http", url: "http://example.com/mcp" }));
  const sseRemote = scoreServer(remoteServer({ type: "sse", url: "https://example.com/sse" }));

  assert.equal(httpsRemote.score, 72);
  assert.equal(httpsRemote.metadataCompleteness, 80);
  assert.ok(httpsRemote.badges.includes("https remote"));
  assert.equal(insecureRemote.score, 20);
  assert.equal(insecureRemote.metadataCompleteness, 59);
  assert.equal(insecureRemote.tier, "blocked");
  assert.deepEqual(insecureRemote.vetoes.map((gate) => gate.code), ["insecure_remote"]);
  assert.equal(insecureRemote.capReason, "veto: insecure_remote");
  assert.ok(insecureRemote.issues.some((issue) => issue.code === "insecure_remote"));
  assert.equal(sseRemote.score, 70);
  assert.equal(sseRemote.metadataCompleteness, 72);
  assert.ok(sseRemote.issues.some((issue) => issue.code === "legacy_transport"));
});

test("secrets and missing install target penalties have exact weights", () => {
  const secrets = scoreServer(packageServer({ requiresSecrets: true }));
  const noTarget = scoreServer(packageServer({ packages: [], remotes: [], transports: [] }));

  assert.equal(secrets.score, 69);
  assert.equal(secrets.metadataCompleteness, 68);
  assert.ok(secrets.badges.includes("requires secrets"));
  assert.ok(secrets.issues.some((issue) => issue.code === "requires_secrets"));
  assert.equal(noTarget.score, 20);
  assert.equal(noTarget.metadataCompleteness, 29);
  assert.equal(noTarget.tier, "blocked");
  assert.deepEqual(noTarget.vetoes.map((gate) => gate.code), ["no_install_target"]);
  assert.equal(noTarget.capReason, "veto: no_install_target");
  assert.ok(noTarget.issues.some((issue) => issue.code === "no_install_target" && issue.severity === "critical"));
});

test("positive trust metadata is advisory and self-declared", () => {
  const baseline = scoreServer(packageServer());
  const declared = scoreServer(packageServer({
    rawMeta: {
      "dev.toolpin/capabilities": {
        version: 1,
        serverName: "example/server",
        serverVersion: "1.0.0",
        registrySource: "official",
        packageTypes: ["npm"],
        transports: ["stdio"],
        remoteHosts: [],
        secrets: [],
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
      "dev.toolpin/attestations": [{ type: "sigstore", verified: true }],
    },
  }));

  assert.equal(declared.metadataCompleteness, baseline.metadataCompleteness);
  assert.ok(declared.score >= baseline.score);
  assert.ok(declared.badges.includes("capability-pinned"));
  assert.ok(declared.badges.includes("sigstore-declared"));
  assert.equal(declared.badges.some((badge) => badge.includes("verified")), false);
});

test("metadata-rich discovery entries cannot reach high trust without verified provenance", () => {
  const directoryRich = scoreServer(packageServer({
    registrySource: "glama",
    registryMode: "discovery",
  }));

  assert.equal(directoryRich.metadataCompleteness, 74);
  assert.equal(directoryRich.score, 58);
  assert.equal(directoryRich.tier, "conditional");
  assert.equal(directoryRich.capReason, "no verified provenance");
  assert.equal(directoryRich.pillars.reputation, 45);
});

function packageServer(overrides = {}) {
  const name = overrides.name ?? "example/server";
  const pkg = overrides.pkg ?? { registryType: "npm", identifier: "@example/server", version: "1.0.0" };
  const packages = overrides.packages ?? [{ transport: { type: "stdio" }, ...pkg }];
  const remotes = overrides.remotes ?? [];
  const transports = overrides.transports ?? ["stdio"];
  const repositoryUrl = overrides.repositoryUrl;

  return {
    registrySource: overrides.registrySource ?? "official",
    registryMode: overrides.registryMode,
    name,
    title: "Example Server",
    description: "Synthetic server",
    version: "1.0.0",
    isLatest: true,
    repositoryUrl: repositoryUrl === undefined && !("repositoryUrl" in overrides) ? "https://github.com/example/server" : repositoryUrl,
    packageTypes: packages.map((entry) => entry.registryType),
    remoteTypes: remotes.map((entry) => entry.type),
    transports,
    requiresSecrets: overrides.requiresSecrets === true,
    raw: {
      name,
      title: "Example Server",
      description: "Synthetic server",
      version: "1.0.0",
      packages,
      remotes,
      _meta: overrides.rawMeta,
    },
  };
}

function remoteServer(remote) {
  return packageServer({
    packages: [],
    remotes: [remote],
    transports: [remote.type],
  });
}
