import { classifyTrust, trustTier } from "../../trust.js";
import type { TrustReport, TrustTier } from "../../types.js";

export type TrustBand = "high" | "medium" | "low";

export function trustBand(score: number): TrustBand {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function riskTone(score: number): { label: string; band: TrustBand } {
  const band = trustBand(score);
  if (band === "high") return { label: "COMPLETE", band };
  if (band === "medium") return { label: "REVIEW", band };
  return { label: "INCOMPLETE", band };
}

export function trustRiskTone(report: Pick<TrustReport, "score" | "issues" | "tier" | "evidence">): { label: string; band: TrustBand; tier: TrustTier } {
  const tier = trustTier(report);
  if (tier === "verified") return { label: "EVIDENCE OK", band: "high", tier };
  if (tier === "conditional") return { label: "REVIEW", band: "medium", tier };
  if (tier === "unverified") return { label: "UNVERIFIED", band: "low", tier };
  return { label: "BLOCKED", band: "low", tier };
}

export function trustTierScore(report: Pick<TrustReport, "score" | "issues" | "tier" | "evidence">): number {
  const tier = trustTier(report);
  if (tier === "verified") return 100;
  if (tier === "conditional") return 67;
  if (tier === "unverified") return 34;
  return 0;
}

export const TRUST_BAR_CELLS = 9;

export function trustBarCells(score: number): { filled: number; empty: number } {
  const filled = Math.max(0, Math.min(TRUST_BAR_CELLS, Math.round((score / 100) * TRUST_BAR_CELLS)));
  return { filled, empty: TRUST_BAR_CELLS - filled };
}

export interface TrustDimension {
  label: "provenance" | "integrity" | "completeness";
  score: number;
  tone: TrustBand;
}

export function trustDimensions(report: Pick<TrustReport, "score" | "badges" | "issues" | "tier" | "gatedBy" | "evidence">): TrustDimension[] {
  const gatedBy = report.gatedBy ?? classifyTrust(report.score, report.issues, report.evidence).gatedBy;
  const hasRepo = report.badges.includes("source repo");
  const hasDeclaredAttestation = report.badges.some((badge) => badge.endsWith("-declared"));
  const hasCapabilityPin = report.badges.includes("capability-pinned");
  const hasPassedEvidence = (report.evidence ?? []).some((entry) => entry.status === "passed");
  const hasFailedEvidence = (report.evidence ?? []).some((entry) => entry.status === "failed");
  const hasIntegritySignal = hasPassedEvidence || report.badges.some((badge) => ["digest-pinned", "fileSha256", "https remote", "pinned version"].includes(badge));
  const integrityBlocked = gatedBy.some((code) => ["no_install_target", "insecure_remote", "invalid_remote_url"].includes(code));
  const integrityUnverified = gatedBy.length > 0 || hasFailedEvidence;

  const provenanceScore = hasRepo ? (hasCapabilityPin || hasDeclaredAttestation ? 100 : 80) : 30;
  const integrityScore = integrityBlocked ? 0 : integrityUnverified ? 25 : hasIntegritySignal ? 85 : 50;

  return [
    dimension("provenance", provenanceScore),
    dimension("integrity", integrityScore),
    dimension("completeness", report.score),
  ];
}

function dimension(label: TrustDimension["label"], score: number): TrustDimension {
  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  return { label, score: normalized, tone: trustBand(normalized) };
}
