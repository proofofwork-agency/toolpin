import assert from "node:assert/strict";
import test from "node:test";
import { publicVerdict, trustDetailLine, verdictLine, verificationOutcome, verificationStatus } from "../dist/verdict.js";

test("publicVerdict maps verified evidence to verified", () => {
  const result = publicVerdict({
    score: 92,
    metadataCompleteness: 92,
    tier: "verified",
    verifiedProvenance: true,
    badges: [],
    issues: [],
    evidence: [passedEvidence("npm_integrity_verified", { verifiedByToolPin: true, trustedAnchor: true })],
  });

  assert.deepEqual(result, {
    verdict: "verified",
    reason: "fresh verified artifact proof",
    detailTier: "verified",
  });
  assert.equal(verdictLine(result), "verified - fresh verified artifact proof");
});

test("publicVerdict maps incomplete artifact proof to needs-review", () => {
  const result = publicVerdict({
    score: 74,
    metadataCompleteness: 74,
    tier: "conditional",
    capReason: "automated evidence incomplete",
    badges: [],
    issues: [],
    evidence: [declaredEvidence("package_pin")],
  });

  assert.deepEqual(result, {
    verdict: "needs-review",
    reason: "artifact proof missing",
    detailTier: "conditional",
  });
});

test("publicVerdict keeps weak pins needs-review in passive context", () => {
  const result = publicVerdict({
    score: 63,
    metadataCompleteness: 63,
    tier: "unverified",
    capReason: "mutable_oci_tag",
    badges: [],
    issues: [critical("mutable_oci_tag", "OCI image uses a mutable tag.")],
    evidence: [failedEvidence("digest_present", "OCI digest is missing.")],
  });

  assert.equal(result.verdict, "needs-review");
  assert.equal(result.detailTier, "unverified");
  assert.match(result.reason, /pin is weak/);
});

test("publicVerdict blocks weak pins in fatal verify context", () => {
  const result = publicVerdict({
    ok: false,
    score: 63,
    metadataCompleteness: 63,
    tier: "unverified",
    badges: [],
    issues: [critical("mutable_oci_tag", "OCI image uses a mutable tag.")],
    evidence: [failedEvidence("digest_present", "OCI digest is missing.")],
  }, { command: "verify" });

  assert.equal(result.verdict, "blocked");
  assert.equal(result.detailTier, "unverified");
  assert.equal(result.reason, "pin is weak: OCI image uses a mutable tag.");
});

test("publicVerdict blocks uninstallable entries", () => {
  const result = publicVerdict({
    score: 20,
    tier: "blocked",
    badges: [],
    issues: [critical("no_install_target", "No package or remote target.")],
    evidence: [],
  });

  assert.deepEqual(result, {
    verdict: "blocked",
    reason: "No package or remote target.",
    detailTier: "blocked",
  });
});

test("verification presentation helpers preserve detailed outcomes", () => {
  const report = {
    ok: true,
    serverName: "example/server",
    serverVersion: "1.0.0",
    packages: [],
    remotes: [],
    requiredSecrets: [],
    toolHashes: [],
    evidence: [
      passedEvidence("package_pin"),
      passedEvidence("npm_integrity_verified", { verifiedByToolPin: true, trustedAnchor: true }),
    ],
    verifiedProvenance: true,
    issues: [],
    summary: "ok",
  };

  assert.equal(verificationOutcome(report), "verified");
  assert.equal(verificationStatus(true, report), "verified");
  assert.equal(verificationStatus(false, report), "skipped");
  assert.equal(trustDetailLine({ score: 74, metadataCompleteness: 81, tier: "conditional", issues: [], evidence: [declaredEvidence("package_pin")] }), "conditional / 81% profile / evidence declared");
});

function critical(code, message = code) {
  return { severity: "critical", code, message };
}

function passedEvidence(code, extra = {}) {
  return { code, status: "passed", message: code, verifiedAt: new Date().toISOString(), ...extra };
}

function declaredEvidence(code) {
  return { code, status: "declared", message: code, verifiedByToolPin: false };
}

function failedEvidence(code, message = code) {
  return { code, status: "failed", message };
}
