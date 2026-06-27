import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrust, scoreServer, trustCapExplanation, trustedArtifactEvidenceProblem, trustProfileScore, trustRankingScore, trustTier } from "../dist/trust.js";

test("repository and namespace trust signals have exact metadata weights", () => {
  const trusted = scoreServer(packageServer());
  const missingRepository = scoreServer(packageServer({ repositoryUrl: undefined }));
  const unnamespaced = scoreServer(packageServer({ name: "example-server" }));

  assert.equal(trusted.score, 74);
  assert.equal(trusted.metadataCompleteness, 74);
  assert.equal(trusted.overallScore, 69);
  assert.equal(trusted.tier, "conditional");
  assert.equal(trusted.capReason, "automated evidence incomplete");
  assert.equal(trustCapExplanation(trusted), "automated evidence incomplete: missing ToolPin-verified artifact proof (OCI registry digest, MCPB byte hash, or npm tarball integrity)");
  assert.ok(trusted.evidence.some((entry) => entry.code === "package_pin" && entry.status === "declared" && entry.verifiedByToolPin === false));
  assert.deepEqual(trusted.badges.filter((badge) => ["source repo", "namespaced"].includes(badge)), ["source repo", "namespaced"]);

  assert.equal(missingRepository.score, 58);
  assert.equal(missingRepository.metadataCompleteness, 58);
  assert.equal(missingRepository.tier, "conditional");
  assert.equal(missingRepository.capReason, "no verified provenance");
  assert.equal(trustCapExplanation(missingRepository), "no verified provenance: source must be ToolPin, official, or Docker and include a repository URL");
  assert.ok(missingRepository.issues.some((issue) => issue.code === "missing_repository"));

  assert.equal(unnamespaced.score, 68);
  assert.equal(unnamespaced.metadataCompleteness, 68);
  assert.equal(unnamespaced.tier, "conditional");
});

test("trust presentation helpers use profile score and tier-banded ranking", () => {
  const conditionalLow = scoreServer(packageServer({ requiresSecrets: true }));
  const conditionalHigh = scoreServer(packageServer({ pkg: { registryType: "mcpb", identifier: "example.mcpb", version: "1.0.0", fileSha256: "b".repeat(64) } }));
  const unverifiedHigh = {
    score: 100,
    metadataCompleteness: 100,
    tier: "unverified",
    badges: [],
    issues: [],
  };
  const blockedHigh = {
    score: 100,
    metadataCompleteness: 100,
    tier: "blocked",
    badges: [],
    issues: [],
  };

  assert.equal(conditionalLow.overallScore, 69);
  assert.equal(conditionalHigh.overallScore, 69);
  assert.equal(trustProfileScore(conditionalLow), conditionalLow.metadataCompleteness);
  assert.equal(trustProfileScore(conditionalHigh), conditionalHigh.metadataCompleteness);
  assert.ok(trustRankingScore(conditionalHigh) > trustRankingScore(conditionalLow));
  assert.ok(trustRankingScore(conditionalLow) > trustRankingScore(unverifiedHigh));
  assert.ok(trustRankingScore(unverifiedHigh) > trustRankingScore(blockedHigh));
});

test("package type and pinned version signals have exact metadata weights", () => {
  const pinnedNpm = scoreServer(packageServer());
  const unknownType = scoreServer(packageServer({ pkg: { registryType: "tarball", identifier: "example.tar.gz", version: "1.0.0" } }));
  const floatingVersion = scoreServer(packageServer({ pkg: { registryType: "npm", identifier: "@example/server", version: "^1.0.0" } }));

  assert.equal(pinnedNpm.score, 74);
  assert.equal(pinnedNpm.metadataCompleteness, 74);
  assert.ok(pinnedNpm.badges.includes("npm"));
  assert.ok(pinnedNpm.badges.includes("pinned version"));
  assert.equal(pinnedNpm.tier, "conditional");

  assert.equal(unknownType.score, 61);
  assert.equal(unknownType.metadataCompleteness, 61);
  assert.ok(unknownType.issues.some((issue) => issue.code === "unknown_package_type"));

  assert.equal(floatingVersion.score, 63);
  assert.equal(floatingVersion.metadataCompleteness, 63);
  assert.equal(floatingVersion.tier, "unverified");
  assert.deepEqual(floatingVersion.gatedBy, ["package_pin"]);
  assert.ok(floatingVersion.issues.some((issue) => issue.code === "unpinned_package"));
});

test("OCI digest and MCPB hash signals have exact metadata weights", () => {
  const validDigest = "a".repeat(64);
  const validHash = "b".repeat(64);
  const digestPinned = scoreServer(packageServer({ pkg: { registryType: "oci", identifier: `ghcr.io/example/server@sha256:${validDigest}` } }));
  const fakeDigest = scoreServer(packageServer({ pkg: { registryType: "oci", identifier: "ghcr.io/example/server@sha256:deadbeef" } }));
  const mutableTag = scoreServer(packageServer({ pkg: { registryType: "oci", identifier: "ghcr.io/example/server:latest" } }));
  const hashedMcpb = scoreServer(packageServer({ pkg: { registryType: "mcpb", identifier: "example.mcpb", version: "1.0.0", fileSha256: validHash } }));
  const fakeHashedMcpb = scoreServer(packageServer({ pkg: { registryType: "mcpb", identifier: "example.mcpb", version: "1.0.0", fileSha256: "x" } }));
  const unhashedMcpb = scoreServer(packageServer({ pkg: { registryType: "mcpb", identifier: "example.mcpb", version: "1.0.0" } }));

  assert.equal(digestPinned.score, 81);
  assert.equal(digestPinned.metadataCompleteness, 81);
  assert.equal(digestPinned.overallScore, 69);
  assert.equal(digestPinned.tier, "conditional");
  assert.equal(digestPinned.capReason, "automated evidence incomplete");
  assert.ok(digestPinned.badges.includes("digest-pinned"));
  assert.ok(digestPinned.evidence.some((entry) => entry.code === "digest_present" && entry.status === "declared" && entry.verifiedByToolPin === false));
  assert.ok(digestPinned.evidence.some((entry) => entry.code === "package_pin" && entry.status === "declared" && entry.verifiedByToolPin === false));

  assert.equal(fakeDigest.score, 63);
  assert.equal(fakeDigest.tier, "unverified");
  assert.equal(fakeDigest.capReason, "mutable_oci_tag");
  assert.ok(fakeDigest.evidence.some((entry) => entry.code === "digest_present" && entry.status === "failed"));

  assert.equal(mutableTag.score, 63);
  assert.equal(mutableTag.metadataCompleteness, 63);
  assert.equal(mutableTag.tier, "unverified");
  assert.deepEqual(mutableTag.gates.map((gate) => gate.code), ["mutable_oci_tag"]);
  assert.deepEqual(mutableTag.gatedBy, ["mutable_oci_tag"]);
  assert.equal(mutableTag.capReason, "mutable_oci_tag");
  assert.match(trustCapExplanation(mutableTag), /OCI image/);
  assert.ok(mutableTag.evidence.some((entry) => entry.code === "digest_present" && entry.status === "failed"));
  assert.ok(mutableTag.issues.some((issue) => issue.code === "mutable_oci_tag"));

  assert.equal(hashedMcpb.score, 86);
  assert.equal(hashedMcpb.metadataCompleteness, 86);
  assert.equal(hashedMcpb.overallScore, 69);
  assert.equal(hashedMcpb.tier, "conditional");
  assert.equal(hashedMcpb.capReason, "automated evidence incomplete");
  assert.ok(hashedMcpb.badges.includes("fileSha256"));
  assert.ok(hashedMcpb.evidence.some((entry) => entry.code === "file_hash_present" && entry.status === "declared" && entry.verifiedByToolPin === false));

  assert.equal(fakeHashedMcpb.score, 66);
  assert.equal(fakeHashedMcpb.tier, "unverified");
  assert.equal(fakeHashedMcpb.capReason, "missing_mcpb_hash");
  assert.ok(fakeHashedMcpb.evidence.some((entry) => entry.code === "file_hash_present" && entry.status === "failed"));

  assert.equal(unhashedMcpb.score, 66);
  assert.equal(unhashedMcpb.metadataCompleteness, 66);
  assert.equal(unhashedMcpb.tier, "unverified");
  assert.deepEqual(unhashedMcpb.gates.map((gate) => gate.code), ["missing_mcpb_hash"]);
  assert.deepEqual(unhashedMcpb.gatedBy, ["missing_mcpb_hash"]);
  assert.equal(unhashedMcpb.capReason, "missing_mcpb_hash");
  assert.ok(unhashedMcpb.evidence.some((entry) => entry.code === "file_hash_present" && entry.status === "failed"));
  assert.ok(unhashedMcpb.issues.some((issue) => issue.code === "missing_mcpb_hash"));
});

test("remote trust signals and penalties have exact metadata weights", () => {
  const httpsRemote = scoreServer(remoteServer({ type: "streamable-http", url: "https://example.com/mcp" }));
  const insecureRemote = scoreServer(remoteServer({ type: "streamable-http", url: "http://example.com/mcp" }));
  const sseRemote = scoreServer(remoteServer({ type: "sse", url: "https://example.com/sse" }));

  assert.equal(httpsRemote.score, 80);
  assert.equal(httpsRemote.metadataCompleteness, 80);
  assert.equal(httpsRemote.tier, "conditional");
  assert.ok(httpsRemote.badges.includes("https remote"));

  assert.equal(insecureRemote.score, 59);
  assert.equal(insecureRemote.metadataCompleteness, 59);
  assert.equal(insecureRemote.tier, "blocked");
  assert.deepEqual(insecureRemote.vetoes.map((gate) => gate.code), ["insecure_remote"]);
  assert.deepEqual(insecureRemote.gatedBy, ["insecure_remote"]);
  assert.equal(insecureRemote.capReason, "veto: insecure_remote");
  assert.match(trustCapExplanation(insecureRemote), /blocked by critical issue/);
  assert.ok(insecureRemote.issues.some((issue) => issue.code === "insecure_remote"));

  assert.equal(sseRemote.score, 72);
  assert.equal(sseRemote.metadataCompleteness, 72);
  assert.equal(sseRemote.tier, "conditional");
  assert.ok(sseRemote.issues.some((issue) => issue.code === "legacy_transport"));
});

test("secrets and missing install target penalties have exact metadata weights", () => {
  const secrets = scoreServer(packageServer({ requiresSecrets: true }));
  const noTarget = scoreServer(packageServer({ packages: [], remotes: [], transports: [] }));

  assert.equal(secrets.score, 68);
  assert.equal(secrets.metadataCompleteness, 68);
  assert.ok(secrets.badges.includes("requires secrets"));
  assert.ok(secrets.issues.some((issue) => issue.code === "requires_secrets"));

  assert.equal(noTarget.score, 29);
  assert.equal(noTarget.metadataCompleteness, 29);
  assert.equal(noTarget.tier, "blocked");
  assert.deepEqual(noTarget.vetoes.map((gate) => gate.code), ["no_install_target"]);
  assert.deepEqual(noTarget.gatedBy, ["no_install_target"]);
  assert.equal(noTarget.capReason, "veto: no_install_target");
  assert.ok(noTarget.issues.some((issue) => issue.code === "no_install_target" && issue.severity === "critical"));
});

test("verified requires provenance plus fresh trusted artifact evidence, not high metadata completeness", () => {
  const verifiedAt = new Date().toISOString();
  assert.deepEqual(classifyTrust(95, [], []), { tier: "conditional", gatedBy: [], gates: [] });
  assert.deepEqual(classifyTrust(95, [], [{ code: "package_pin", status: "passed", message: "exact version" }]), { tier: "conditional", gatedBy: [], gates: [] });
  assert.deepEqual(
    classifyTrust(95, [], [
      { code: "package_pin", status: "declared", message: "exact version", verifiedByToolPin: false },
      { code: "digest_present", status: "declared", message: "digest", verifiedByToolPin: false },
    ]),
    { tier: "conditional", gatedBy: [], gates: [] },
  );
  assert.deepEqual(
    classifyTrust(95, [], [
      { code: "package_pin", status: "declared", message: "exact version", verifiedByToolPin: false },
      { code: "mcpb_sha256_verified", status: "passed", message: "bytes hashed", verifiedByToolPin: true, trustedAnchor: true, verifiedAt },
    ]),
    { tier: "conditional", gatedBy: [], gates: [] },
  );
  assert.deepEqual(
    classifyTrust(95, [], [
      { code: "package_pin", status: "declared", message: "exact version", verifiedByToolPin: false },
      { code: "mcpb_sha256_verified", status: "passed", message: "bytes hashed", verifiedByToolPin: true, trustedAnchor: true, verifiedAt },
    ], { verifiedProvenance: true }),
    { tier: "verified", gatedBy: [], gates: [] },
  );
  assert.deepEqual(
    classifyTrust(95, [], [
      { code: "package_pin", status: "declared", message: "exact version", verifiedByToolPin: false },
      { code: "oci_digest_verified", status: "passed", message: "registry manifest digest matched", verifiedByToolPin: true, trustedAnchor: true, verifiedAt },
    ], { verifiedProvenance: true }),
    { tier: "verified", gatedBy: [], gates: [] },
  );
  assert.deepEqual(
    classifyTrust(95, [], [
      { code: "package_pin", status: "declared", message: "exact version", verifiedByToolPin: false },
      { code: "mcpb_sha256_verified", status: "passed", message: "MCPB bytes matched fileSha256", verifiedByToolPin: true, trustedAnchor: false, verifiedAt },
    ], { verifiedProvenance: true }),
    { tier: "conditional", gatedBy: [], gates: [] },
  );
});

test("ToolPin registry evidence can verify artifact integrity without changing metadata completeness", () => {
  const evidence = {
    code: "npm_integrity_verified",
    status: "passed",
    message: "npm tarball integrity matched registry dist.integrity.",
    source: "npm-tarball",
    claim: "sha512-example",
    verificationMethod: "npm-packument-sri",
    verifiedByToolPin: true,
    trustedAnchor: true,
    trustAnchor: "registry.npmjs.org",
    verifiedAt: new Date().toISOString(),
  };
  const verified = scoreServer(packageServer({
    registrySource: "toolpin",
    rawMeta: { "dev.toolpin/evidence": [evidence] },
  }));
  const ignored = scoreServer(packageServer({
    registrySource: "official",
    rawMeta: { "dev.toolpin/evidence": [evidence] },
  }));

  assert.equal(verified.score, 74);
  assert.equal(verified.metadataCompleteness, 74);
  assert.equal(verified.overallScore, 100);
  assert.equal(verified.tier, "verified");
  assert.equal(verified.capReason, undefined);
  assert.ok(verified.badges.includes("npm-integrity-verified"));
  assert.equal(trustCapExplanation(verified), undefined);

  assert.equal(ignored.overallScore, 69);
  assert.equal(ignored.tier, "conditional");
  assert.equal(ignored.capReason, "automated evidence incomplete");
  assert.equal(ignored.badges.includes("npm-integrity-verified"), false);
});

test("ToolPin registry evidence with an untrusted anchor cannot reach the verified tier", () => {
  const bogusAnchor = {
    code: "npm_integrity_verified",
    status: "passed",
    message: "self-declared integrity against a non-allowlisted registry",
    source: "npm-tarball",
    claim: "sha512-example",
    verificationMethod: "npm-packument-sri",
    verifiedByToolPin: true,
    trustedAnchor: true,
    trustAnchor: "registry.evil.example",
    verifiedAt: new Date().toISOString(),
  };
  const missingAnchor = { ...bogusAnchor, trustAnchor: undefined };
  delete missingAnchor.trustAnchor;

  const bogusReport = scoreServer(packageServer({
    registrySource: "toolpin",
    rawMeta: { "dev.toolpin/evidence": [bogusAnchor] },
  }));
  const missingReport = scoreServer(packageServer({
    registrySource: "toolpin",
    rawMeta: { "dev.toolpin/evidence": [missingAnchor] },
  }));

  assert.notEqual(bogusReport.tier, "verified");
  assert.equal(bogusReport.overallScore < 100, true);
  assert.ok(bogusReport.evidence.some((entry) => entry.code === "npm_integrity_verified" && entry.trustedAnchor === false));
  assert.notEqual(missingReport.tier, "verified");
  assert.equal(missingReport.overallScore < 100, true);
});

test("trustedArtifactEvidenceProblem accepts fresh npm integrity evidence", () => {
  const now = new Date("2026-06-27T20:00:00.000Z");
  const fresh = {
    code: "npm_integrity_verified",
    status: "passed",
    message: "npm tarball integrity matched registry dist.integrity.",
    verifiedByToolPin: true,
    trustedAnchor: true,
    verifiedAt: "2026-06-27T19:50:00.000Z",
  };
  const stale = {
    ...fresh,
    verifiedAt: "2026-06-01T00:00:00.000Z",
  };
  const untrusted = {
    ...fresh,
    trustedAnchor: false,
  };

  assert.equal(trustedArtifactEvidenceProblem([fresh], now), undefined);
  assert.equal(trustedArtifactEvidenceProblem([stale], now), "trusted artifact evidence is stale");
  assert.equal(trustedArtifactEvidenceProblem([untrusted], now), "artifact evidence used an untrusted anchor");
});

test("trustTier derives legacy lockfile tiers without mutating the report shape", () => {
  const legacyReport = {
    score: 80,
    badges: ["source repo"],
    issues: [{ severity: "critical", code: "mutable_oci_tag", message: "mutable tag" }],
  };

  assert.equal(trustTier(legacyReport), "unverified");
  assert.equal(Object.hasOwn(legacyReport, "tier"), false);
  assert.equal(Object.hasOwn(legacyReport, "gatedBy"), false);
  assert.equal(Object.hasOwn(legacyReport, "evidence"), false);
  assert.equal(trustTier({ score: 80, badges: [], issues: [] }), "conditional");
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
  assert.equal(declared.score, baseline.score);
  assert.equal(declared.tier, "conditional");
  assert.ok(declared.badges.includes("capability-pinned"));
  assert.ok(declared.badges.includes("sigstore-declared"));
  assert.ok(declared.evidence.some((entry) => entry.code === "attestation_declared" && entry.status === "declared"));
  assert.equal(declared.badges.some((badge) => badge.includes("verified")), false);
});

test("metadata-rich discovery entries cannot reach verified without automated evidence", () => {
  const directoryRich = scoreServer(packageServer({
    registrySource: "glama",
    registryMode: "discovery",
  }));

  assert.equal(directoryRich.metadataCompleteness, 74);
  assert.equal(directoryRich.score, 74);
  assert.equal(directoryRich.overallScore, 58);
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
    registryMode: overrides.registryMode ?? "installable",
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
