import type { TrustReport } from "../../types.js";

export type TrustBand = "high" | "medium" | "low";

export function trustBand(score: number): TrustBand {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function riskTone(score: number): { label: string; band: TrustBand } {
  const band = trustBand(score);
  if (band === "high") return { label: "LOW RISK", band };
  if (band === "medium") return { label: "REVIEW", band };
  return { label: "ELEVATED RISK", band };
}

export const TRUST_BAR_CELLS = 9;

export function trustBarCells(score: number): { filled: number; empty: number } {
  const filled = Math.max(0, Math.min(TRUST_BAR_CELLS, Math.round((score / 100) * TRUST_BAR_CELLS)));
  return { filled, empty: TRUST_BAR_CELLS - filled };
}

export interface ScoreDelta {
  label: string;
  tone: "base" | "positive" | "negative";
}

const PACKAGE_TYPE_BADGES = new Set(["npm", "pypi", "nuget", "cargo", "oci", "mcpb"]);

export function scoreBreakdown(report: Pick<TrustReport, "badges">): ScoreDelta[] {
  const deltas: ScoreDelta[] = [{ label: "base 50", tone: "base" }];
  let sawPackageType = false;
  for (const badge of report.badges) {
    switch (badge) {
      case "source repo":
        deltas.push({ label: "repo +8", tone: "positive" });
        break;
      case "namespaced":
        deltas.push({ label: "namespaced +6", tone: "positive" });
        break;
      case "https remote":
        deltas.push({ label: "https +6", tone: "positive" });
        break;
      case "pinned version":
        deltas.push({ label: "pinned +5", tone: "positive" });
        break;
      case "streamable-http":
        deltas.push({ label: "streamable +4", tone: "positive" });
        break;
      case "digest-pinned":
        deltas.push({ label: "digest +8", tone: "positive" });
        break;
      case "fileSha256":
        deltas.push({ label: "fileSha256 +8", tone: "positive" });
        break;
      case "requires secrets":
        deltas.push({ label: "secrets -6", tone: "negative" });
        break;
      default:
        if (PACKAGE_TYPE_BADGES.has(badge) && !sawPackageType) {
          deltas.push({ label: "supported type +5", tone: "positive" });
          sawPackageType = true;
        }
        break;
    }
  }
  return deltas;
}
