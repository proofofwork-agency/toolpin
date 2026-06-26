import assert from "node:assert/strict";
import test from "node:test";
import { riskTone, scoreBreakdown, trustBand, trustBarCells } from "../dist/tui/ui/trust.js";

test("trustBand maps score boundaries to neutral bands", () => {
  assert.equal(trustBand(39), "low");
  assert.equal(trustBand(40), "medium");
  assert.equal(trustBand(69), "medium");
  assert.equal(trustBand(70), "high");
  assert.equal(trustBand(100), "high");
});

test("riskTone maps score ranges to labels and bands", () => {
  assert.deepEqual(riskTone(39), { label: "ELEVATED RISK", band: "low" });
  assert.deepEqual(riskTone(40), { label: "REVIEW", band: "medium" });
  assert.deepEqual(riskTone(69), { label: "REVIEW", band: "medium" });
  assert.deepEqual(riskTone(70), { label: "LOW RISK", band: "high" });
  assert.deepEqual(riskTone(100), { label: "LOW RISK", band: "high" });
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

test("scoreBreakdown translates known trust badges and drops unknown badges", () => {
  const breakdown = scoreBreakdown({
    badges: [
      "source repo",
      "namespaced",
      "npm",
      "pinned version",
      "https remote",
      "requires secrets",
      "latest",
      "oci",
    ],
  });

  assert.deepEqual(breakdown[0], { label: "base 50", tone: "base" });
  assert.ok(breakdown.some((entry) => entry.label === "repo +8" && entry.tone === "positive"));
  assert.ok(breakdown.some((entry) => entry.label === "namespaced +6" && entry.tone === "positive"));
  assert.ok(breakdown.some((entry) => entry.label === "https +6" && entry.tone === "positive"));
  assert.ok(breakdown.some((entry) => entry.label === "pinned +5" && entry.tone === "positive"));
  assert.equal(breakdown.filter((entry) => entry.label === "supported type +5" && entry.tone === "positive").length, 1);
  assert.ok(breakdown.some((entry) => entry.label === "secrets -6" && entry.tone === "negative"));
  assert.equal(breakdown.some((entry) => entry.label.includes("latest")), false);
});
