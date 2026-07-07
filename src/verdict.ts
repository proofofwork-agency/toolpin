import { evidenceStatus, hasFreshTrustedArtifactEvidence, trustedArtifactEvidenceProblem, trustTier } from "./trust.js";
import type { TrustEvidence, TrustIssue, TrustReport, TrustTier } from "./types.js";
import type { VerificationReport } from "./verify.js";

export type PublicVerdict = "verified" | "needs-review" | "blocked";

export interface PublicVerdictResult {
  verdict: PublicVerdict;
  reason: string;
  detailTier: TrustTier;
}

export interface PublicVerdictContext {
  fatal?: boolean;
  command?: "passive" | "verify" | "install" | "lock" | "ci" | "audit" | "policy";
}

type VerdictReport = Partial<Pick<TrustReport, "score" | "tier" | "capReason" | "verifiedProvenance" | "metadataCompleteness">> & {
  evidence?: TrustEvidence[];
  issues?: TrustIssue[];
  ok?: boolean;
};

const WEAK_PIN_CODES = new Set(["mutable_oci_tag", "missing_mcpb_hash"]);
const BLOCKED_CODES = new Set(["no_install_target", "insecure_remote", "invalid_remote_url", "verified_required"]);

export function publicVerdict(report: VerdictReport, context: PublicVerdictContext = {}): PublicVerdictResult {
  const issues = report.issues ?? [];
  const evidence = report.evidence ?? [];
  const detailTier = detailTrustTier(report, issues, evidence);
  const fatal = context.fatal === true || report.ok === false;

  if (fatal || detailTier === "blocked") {
    return {
      verdict: "blocked",
      reason: blockedReason(issues, evidence, context),
      detailTier,
    };
  }

  if (detailTier === "verified") {
    return {
      verdict: "verified",
      reason: "fresh verified artifact proof",
      detailTier,
    };
  }

  return {
    verdict: "needs-review",
    reason: needsReviewReason(report, issues, evidence),
    detailTier,
  };
}

export function verdictLine(result: PublicVerdictResult): string {
  return `${result.verdict} - ${result.reason}`;
}

export function trustDetailLine(report: Pick<TrustReport, "score" | "metadataCompleteness" | "issues" | "tier" | "evidence">): string {
  return `${trustTier(report)} / ${Math.max(0, Math.min(100, Math.round(report.metadataCompleteness ?? report.score)))}% profile / ${evidenceStatus(report)}`;
}

export function verificationStatus(verifyRequested: boolean, report?: VerificationReport): string {
  if (!verifyRequested) return "skipped";
  return verificationOutcome(report);
}

export function verificationOutcome(report?: VerificationReport): "verified" | "incomplete" | "failed" {
  if (!report || !report.ok) return "failed";
  const hasPin = report.evidence.some((entry) => (entry.status === "passed" || entry.status === "declared") && ["package_pin", "digest_present", "file_hash_present"].includes(entry.code));
  if (report.verifiedProvenance === true && hasPin && hasFreshTrustedArtifactEvidence(report.evidence)) return "verified";
  return "incomplete";
}

function detailTrustTier(report: VerdictReport, issues: TrustIssue[], evidence: TrustEvidence[]): TrustTier {
  if (report.tier) return report.tier;
  if (report.score !== undefined) {
    return trustTier({
      score: report.score,
      issues,
      evidence,
    });
  }
  if (verificationOutcome(report as VerificationReport) === "verified") return "verified";
  if (issues.some((issue) => issue.severity === "critical" && BLOCKED_CODES.has(issue.code))) return "blocked";
  if (issues.some((issue) => issue.severity === "critical") || evidence.some((entry) => entry.status === "failed")) return "unverified";
  return "conditional";
}

function blockedReason(issues: TrustIssue[], evidence: TrustEvidence[], context: PublicVerdictContext): string {
  const critical = issues.find((issue) => issue.severity === "critical");
  if (critical) {
    if (WEAK_PIN_CODES.has(critical.code)) return `pin is weak: ${critical.message}`;
    if (critical.code === "verified_required") return critical.message;
    return critical.message;
  }
  const requiredFailure = evidence.find((entry) => entry.status === "failed" && entry.required);
  if (requiredFailure) return `required evidence failed: ${requiredFailure.message}`;
  if (context.command === "ci") return "CI gate failed";
  if (context.command === "policy") return "policy gate failed";
  return "command failed";
}

function needsReviewReason(report: VerdictReport, issues: TrustIssue[], evidence: TrustEvidence[]): string {
  const weakPin = issues.find((issue) => issue.severity === "critical" && WEAK_PIN_CODES.has(issue.code));
  if (weakPin) return `pin is weak: ${weakPin.message}`;
  const failedEvidence = evidence.find((entry) => entry.status === "failed");
  if (failedEvidence) return `evidence failed: ${failedEvidence.message}`;
  if (evidence.some((entry) => entry.code === "tool_surface_hash" && entry.status === "unavailable")) return "input schemas not pinned";
  const artifactProblem = trustedArtifactEvidenceProblem(evidence);
  if (report.verifiedProvenance === true && artifactProblem) return artifactProblem;
  if (report.capReason === "automated evidence incomplete") return "artifact proof missing";
  if (report.capReason === "no verified provenance") return "verified provenance missing";
  if (evidence.some((entry) => entry.status === "declared")) return "artifact proof declared, not verified";
  if (!evidence.length) return "automated evidence missing";
  return "review required";
}
