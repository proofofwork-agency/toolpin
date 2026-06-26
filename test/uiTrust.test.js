import assert from "node:assert/strict";
import test from "node:test";
import { riskTone, trustBand, trustBarCells, trustDimensions, trustRiskTone, trustTierScore } from "../dist/tui/ui/trust.js";

test("trustBand maps score boundaries to neutral bands", () => {
  assert.equal(trustBand(39), "low");
  assert.equal(trustBand(40), "medium");
  assert.equal(trustBand(69), "medium");
  assert.equal(trustBand(70), "high");
  assert.equal(trustBand(100), "high");
});

test("riskTone maps score ranges to labels and bands", () => {
  assert.deepEqual(riskTone(39), { label: "INCOMPLETE", band: "low" });
  assert.deepEqual(riskTone(40), { label: "REVIEW", band: "medium" });
  assert.deepEqual(riskTone(69), { label: "REVIEW", band: "medium" });
  assert.deepEqual(riskTone(70), { label: "COMPLETE", band: "high" });
  assert.deepEqual(riskTone(100), { label: "COMPLETE", band: "high" });
});

test("trustRiskTone maps gated tiers to evidence labels", () => {
  assert.deepEqual(trustRiskTone(report({ score: 90, tier: "verified" })), { label: "EVIDENCE OK", band: "high", tier: "verified" });
  assert.deepEqual(trustRiskTone(report({ score: 55, tier: "conditional" })), { label: "REVIEW", band: "medium", tier: "conditional" });
  assert.deepEqual(trustRiskTone(report({ score: 90, issues: [critical("mutable_oci_tag")] })), { label: "UNVERIFIED", band: "low", tier: "unverified" });
  assert.deepEqual(trustRiskTone(report({ score: 90, issues: [critical("insecure_remote")] })), { label: "BLOCKED", band: "low", tier: "blocked" });
});

test("trustTierScore maps categorical tiers to summary bar fill", () => {
  assert.equal(trustTierScore(report({ tier: "verified" })), 100);
  assert.equal(trustTierScore(report({ tier: "conditional" })), 67);
  assert.equal(trustTierScore(report({ tier: "unverified" })), 34);
  assert.equal(trustTierScore(report({ tier: "blocked" })), 0);
});

test("trustRiskTone gates critical issues regardless of metadata score", () => {
  const report = {
    score: 74,
    badges: ["source repo", "namespaced", "oci"],
    issues: [{ severity: "critical", code: "mutable_oci_tag", message: "OCI image is mutable." }],
  };

  assert.deepEqual(trustRiskTone(report), { label: "UNVERIFIED", band: "low", tier: "unverified" });
});

test("trustBarCells returns a nine-cell rounded trust bar", () => {
  const cases = [
    [0, { filled: 0, empty: 9 }],
    [37, { filled: 3, empty: 6 }],
    [68, { filled: 6, empty: 3 }],
    [74, { filled: 7, empty: 2 }],
    [87, { filled: 8, empty: 1 }],
    [100, { filled: 9, empty: 0 }],
  ];

  for (const [score, expected] of cases) {
    const cells = trustBarCells(score);
    assert.deepEqual(cells, expected);
    assert.equal(cells.filled + cells.empty, 9);
  }
});

test("trustDimensions reports gated trust pillars with metadata completeness", () => {
  const dimensions = trustDimensions({
    score: 45,
    metadataCompleteness: 74,
    tier: "unverified",
    gates: [{ code: "mutable_oci_tag", message: "OCI image is mutable.", tier: "unverified" }],
    badges: ["source repo", "namespaced", "oci", "pinned version"],
    issues: [
      { severity: "critical", code: "mutable_oci_tag", message: "OCI image is mutable." },
    ],
  });

  assert.deepEqual(dimensions.map((entry) => entry.label), ["provenance", "integrity", "reputation", "metadata"]);
  assert.equal(dimensions.find((entry) => entry.label === "integrity").score, 25);
  assert.equal(dimensions.find((entry) => entry.label === "metadata").score, 74);
});

test("trustDimensions uses trust report pillars when present", () => {
  const dimensions = trustDimensions({
    score: 58,
    metadataCompleteness: 74,
    tier: "conditional",
    badges: [],
    issues: [],
    pillars: {
      provenance: 55,
      integrity: 50,
      reputation: 45,
      metadataCompleteness: 74,
    },
  });

  assert.deepEqual(dimensions.map((entry) => entry.score), [55, 50, 45, 74]);
});

test("trustDimensions uses evidence status in fallback integrity", () => {
  const dimensions = trustDimensions(report({
    score: 74,
    badges: ["source repo", "pinned version", "capability-pinned"],
    issues: [],
    evidence: [{ code: "package_pin", status: "passed", message: "exact version" }],
  }));

  assert.deepEqual(dimensions.map((dimension) => dimension.label), ["provenance", "integrity", "reputation", "metadata"]);
  assert.equal(dimensions.find((dimension) => dimension.label === "provenance")?.score, 100);
  assert.equal(dimensions.find((dimension) => dimension.label === "integrity")?.score, 85);
  assert.equal(dimensions.find((dimension) => dimension.label === "metadata")?.score, 74);
});

test("trustDimensions shows blocked integrity for blocked gate codes", () => {
  const dimensions = trustDimensions(report({
    score: 80,
    badges: ["source repo", "https remote"],
    issues: [critical("invalid_remote_url")],
  }));

  assert.equal(dimensions.find((dimension) => dimension.label === "integrity")?.score, 0);
});

function report(overrides = {}) {
  return {
    score: overrides.score ?? 80,
    tier: overrides.tier,
    gatedBy: overrides.gatedBy,
    evidence: overrides.evidence,
    badges: overrides.badges ?? [],
    issues: overrides.issues ?? [],
  };
}

function critical(code) {
  return { severity: "critical", code, message: code };
}
