import { attestationBadge, readAttestations, readCapabilityManifest } from "./capabilities.js";
import { scanFindingsToTrustIssues, scanServerMetadata } from "./scan.js";
import type { NormalizedServer, RegistryPackage, RegistryRemote, TrustEvidence, TrustGate, TrustIssue, TrustReport, TrustTier } from "./types.js";

const STRONG_PACKAGE_TYPES = new Set(["oci", "mcpb"]);
const SUPPORTED_PACKAGE_TYPES = new Set(["npm", "pypi", "nuget", "cargo", "oci", "mcpb"]);
const BLOCKED_TRUST_CODES = new Set(["no_install_target", "insecure_remote", "invalid_remote_url"]);
const UNVERIFIED_TRUST_CODES = new Set(["mutable_oci_tag", "missing_mcpb_hash"]);

interface TrustPillars {
  provenance: number;
  integrity: number;
  reputation: number;
  metadataCompleteness: number;
}

export function scoreServer(server: NormalizedServer): TrustReport {
  const issues: TrustIssue[] = [];
  const badges: string[] = [];
  const evidence: TrustEvidence[] = [];
  let score = 50;

  if (server.repositoryUrl) {
    score += 8;
    badges.push("source repo");
  } else {
    score -= 8;
    issues.push({ severity: "warning", code: "missing_repository", message: "No source repository is declared." });
  }
  if (server.name.includes("/")) {
    score += 6;
    badges.push("namespaced");
  }

  const packages = server.raw.packages ?? [];
  const remotes = server.raw.remotes ?? [];
  let integritySignals = 0;
  if (packages.length === 0 && remotes.length === 0) {
    score -= 35;
    issues.push({ severity: "critical", code: "no_install_target", message: "No package or remote endpoint is declared." });
  }
  for (const pkg of packages) {
    const before = badges.length;
    score += packageScore(pkg, issues, badges, evidence);
    integritySignals += countIntegrityBadges(badges.slice(before));
  }
  for (const remote of remotes) {
    const before = badges.length;
    score += remoteScore(remote, issues, badges);
    integritySignals += countIntegrityBadges(badges.slice(before));
  }

  if (server.requiresSecrets) {
    score -= 6;
    badges.push("requires secrets");
    issues.push({ severity: "info", code: "requires_secrets", message: "This server declares secret configuration inputs." });
  }
  if (server.transports.includes("sse")) {
    score -= 4;
    issues.push({ severity: "info", code: "legacy_transport", message: "SSE transport appears in the manifest; streamable HTTP is preferred for remote servers." });
  }
  if (server.isLatest) badges.push("latest");
  if (readCapabilityManifest(server)) badges.push("capability-pinned");
  for (const attestation of readAttestations(server)) {
    badges.push(attestationBadge(attestation));
    evidence.push({
      code: "attestation_declared",
      status: "declared",
      message: `${attestation.type} attestation metadata is declared but not cryptographically verified.`,
    });
  }

  const metadataScan = scanServerMetadata(server);
  if (metadataScan.findings.length) {
    badges.push("description-scan-advisory");
    issues.push(...scanFindingsToTrustIssues(metadataScan));
  }

  const metadataCompleteness = clamp(score);
  const uniqueEvidence = dedupeEvidence(evidence);
  const verifiedProvenance = Boolean(server.repositoryUrl && (server.registrySource === "official" || server.registrySource === "docker"));
  const pillars = trustPillars(server, metadataCompleteness, issues, integritySignals, verifiedProvenance);
  const gated = gateTrust(metadataCompleteness, issues, uniqueEvidence, pillars, verifiedProvenance);
  return {
    score: metadataCompleteness,
    overallScore: gated.overallScore,
    metadataCompleteness,
    tier: gated.tier,
    capReason: gated.capReason,
    vetoes: gated.vetoes,
    gates: gated.gates,
    gatedBy: gated.gatedBy,
    pillars,
    evidence: uniqueEvidence,
    badges: [...new Set(badges)],
    issues,
  };
}

export function classifyTrust(score: number, issues: TrustIssue[], evidence: TrustEvidence[] = []): { tier: TrustTier; gatedBy: string[]; gates: TrustGate[] } {
  const gates = criticalGates(issues);
  const criticalCodes = gates.map((gate) => gate.code);
  const failedEvidence = evidence.filter((entry) => entry.status === "failed");
  const failedRequiredEvidence = failedEvidence.filter((entry) => entry.required);
  if (gates.some((gate) => gate.tier === "blocked")) return { tier: "blocked", gatedBy: criticalCodes, gates };
  if (failedRequiredEvidence.length) {
    return {
      tier: "blocked",
      gatedBy: [...criticalCodes, ...failedRequiredEvidence.map((entry) => entry.code)],
      gates: [
        ...gates,
        ...failedRequiredEvidence.map((entry): TrustGate => ({ code: entry.code, message: entry.message, tier: "blocked" })),
      ],
    };
  }
  if (gates.length) return { tier: "unverified", gatedBy: criticalCodes, gates };
  if (failedEvidence.length) return { tier: "unverified", gatedBy: failedEvidence.map((entry) => entry.code), gates };
  if (hasPassedPinEvidence(evidence) && hasPassedArtifactEvidence(evidence)) return { tier: "verified", gatedBy: [], gates };
  if (score >= 40 || hasPassedPinEvidence(evidence)) return { tier: "conditional", gatedBy: [], gates };
  return { tier: "unverified", gatedBy: [], gates };
}

export function trustTier(report: Pick<TrustReport, "score" | "issues" | "tier" | "evidence">): TrustTier {
  return report.tier ?? classifyTrust(report.score, report.issues, report.evidence).tier;
}

export function evidenceSummary(report: Pick<TrustReport, "evidence">): string {
  const evidence = report.evidence ?? [];
  if (!evidence.length) return "no automated evidence";
  const passed = evidence.filter((entry) => entry.status === "passed").map((entry) => entry.code);
  const failed = evidence.filter((entry) => entry.status === "failed").map((entry) => entry.code);
  const declared = evidence.filter((entry) => entry.status === "declared").map((entry) => entry.code);
  const unavailable = evidence.filter((entry) => entry.status === "unavailable").map((entry) => entry.code);
  return [
    passed.length ? `passed ${passed.join(", ")}` : "",
    failed.length ? `failed ${failed.join(", ")}` : "",
    declared.length ? `declared ${declared.join(", ")}` : "",
    unavailable.length ? `unavailable ${unavailable.join(", ")}` : "",
  ].filter(Boolean).join("; ");
}

export function evidenceStatus(report: Pick<TrustReport, "evidence" | "score" | "issues" | "tier">): string {
  const tier = trustTier(report);
  if (tier === "verified") return "verified evidence passed";
  if ((report.evidence ?? []).some((entry) => entry.status === "failed")) return "evidence failed";
  if ((report.evidence ?? []).some((entry) => entry.status === "passed")) return "evidence incomplete";
  if ((report.evidence ?? []).some((entry) => entry.status === "declared")) return "evidence declared";
  return "no automated evidence";
}

function criticalGates(issues: TrustIssue[]): TrustGate[] {
  return issues.flatMap((issue): TrustGate[] => {
    if (issue.severity !== "critical") return [];
    const tier = BLOCKED_TRUST_CODES.has(issue.code) ? "blocked" : "unverified";
    return [{ code: issue.code, message: issue.message, tier }];
  });
}

function trustPillars(server: NormalizedServer, metadataCompleteness: number, issues: TrustIssue[], integritySignals: number, verifiedProvenance: boolean): TrustPillars {
  const provenance = verifiedProvenance ? (server.registrySource === "official" ? 85 : 80) : server.repositoryUrl ? 55 : 20;
  const blocked = issues.some((issue) => issue.severity === "critical" && BLOCKED_TRUST_CODES.has(issue.code));
  const unverified = issues.some((issue) => issue.severity === "critical" && UNVERIFIED_TRUST_CODES.has(issue.code));
  const integrityPenalty = blocked ? 60 : unverified ? 35 : 0;
  const integrity = clamp(35 + integritySignals * 15 - integrityPenalty);
  const baseReputation = server.registrySource === "official" ? 80 : server.registrySource === "docker" ? 75 : server.registryMode === "discovery" ? 45 : 60;
  const scanPenalty = issues.filter((issue) => issue.code === "agent_instruction_in_description" || issue.code === "hidden_unicode_in_description").length * 10;
  return { provenance: clamp(provenance), integrity, reputation: clamp(baseReputation - scanPenalty), metadataCompleteness };
}

function gateTrust(
  score: number,
  issues: TrustIssue[],
  evidence: TrustEvidence[],
  pillars: TrustPillars,
  verifiedProvenance: boolean,
): { overallScore: number; tier: TrustTier; capReason?: string; vetoes: TrustGate[]; gates: TrustGate[]; gatedBy: string[] } {
  const classified = classifyTrust(score, issues, evidence);
  const vetoes = classified.gates.filter((gate) => gate.tier === "blocked");
  const unverifiedGates = classified.gates.filter((gate) => gate.tier === "unverified");
  let overallScore = Math.round(pillars.provenance * 0.25 + pillars.integrity * 0.30 + pillars.reputation * 0.15 + pillars.metadataCompleteness * 0.30);
  let capReason: string | undefined;
  if (vetoes.length) {
    overallScore = Math.min(overallScore, 20);
    capReason = `veto: ${vetoes.map((gate) => gate.code).join(", ")}`;
  } else if (unverifiedGates.length) {
    overallScore = Math.min(overallScore, 45);
    capReason = unverifiedGates.map((gate) => gate.code).join(", ");
  } else if (classified.tier !== "verified") {
    const cap = verifiedProvenance ? 69 : 59;
    if (overallScore > cap) overallScore = cap;
    capReason = verifiedProvenance ? "automated evidence incomplete" : "no verified provenance";
  }
  return {
    overallScore,
    tier: classified.tier,
    capReason,
    vetoes,
    gates: classified.gates,
    gatedBy: classified.gatedBy,
  };
}

function packageScore(pkg: RegistryPackage, issues: TrustIssue[], badges: string[], evidence: TrustEvidence[]): number {
  let score = 0;
  if (SUPPORTED_PACKAGE_TYPES.has(pkg.registryType)) {
    score += 5;
    badges.push(pkg.registryType);
  } else {
    score -= 8;
    issues.push({ severity: "warning", code: "unknown_package_type", message: `Unknown package registry type: ${pkg.registryType}.` });
  }
  if (STRONG_PACKAGE_TYPES.has(pkg.registryType)) score += 4;
  if (pkg.version && !isFloatingVersion(pkg.version)) {
    score += 5;
    badges.push("pinned version");
    evidence.push({
      code: "package_pin",
      status: "passed",
      message: `Package ${pkg.identifier} declares exact version ${pkg.version}.`,
    });
  } else if (pkg.registryType !== "oci") {
    score -= 6;
    evidence.push({
      code: "package_pin",
      status: "failed",
      message: `Package ${pkg.identifier} does not declare an exact package version.`,
    });
    issues.push({ severity: "warning", code: "unpinned_package", message: `Package ${pkg.identifier} does not declare an exact package version.` });
  }
  if (pkg.registryType === "oci") {
    if (pkg.identifier.includes("@sha256:")) {
      score += 8;
      badges.push("digest-pinned");
      evidence.push({
        code: "digest_present",
        status: "passed",
        message: `OCI image ${pkg.identifier} is pinned by digest.`,
      });
      evidence.push({
        code: "package_pin",
        status: "passed",
        message: `OCI image ${pkg.identifier} is pinned by digest.`,
      });
    } else {
      score -= 10;
      evidence.push({
        code: "digest_present",
        status: "failed",
        message: `OCI image ${pkg.identifier} is not pinned by digest.`,
      });
      issues.push({ severity: "critical", code: "mutable_oci_tag", message: `OCI image ${pkg.identifier} is not pinned by digest.` });
    }
  }
  if (pkg.registryType === "mcpb") {
    if (pkg.fileSha256) {
      score += 8;
      badges.push("fileSha256");
      evidence.push({
        code: "file_hash_present",
        status: "passed",
        message: "MCPB package declares fileSha256.",
      });
    } else {
      score -= 12;
      evidence.push({
        code: "file_hash_present",
        status: "failed",
        message: "MCPB package is missing fileSha256.",
      });
      issues.push({ severity: "critical", code: "missing_mcpb_hash", message: "MCPB packages should include fileSha256." });
    }
  }
  return score;
}

function remoteScore(remote: RegistryRemote, issues: TrustIssue[], badges: string[]): number {
  let score = 6;
  badges.push(remote.type);
  try {
    const url = new URL(remote.url);
    if (url.protocol === "https:") {
      score += 6;
      badges.push("https remote");
    } else {
      score -= 15;
      issues.push({ severity: "critical", code: "insecure_remote", message: `Remote MCP endpoint is not HTTPS: ${remote.url}` });
    }
  } catch {
    score -= 15;
    issues.push({ severity: "critical", code: "invalid_remote_url", message: `Remote MCP endpoint is not a valid URL: ${remote.url}` });
  }
  if (remote.type === "streamable-http") score += 4;
  return score;
}

function countIntegrityBadges(badges: string[]): number {
  return badges.filter((badge) => ["pinned version", "digest-pinned", "fileSha256", "https remote"].includes(badge)).length;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isFloatingVersion(version: string): boolean {
  return ["latest", "*"].includes(version.trim().toLowerCase()) || /[~^x*]/i.test(version);
}

function hasPassedPinEvidence(evidence: TrustEvidence[]): boolean {
  return evidence.some((entry) => entry.status === "passed" && ["package_pin", "digest_present", "file_hash_present"].includes(entry.code));
}

function hasPassedArtifactEvidence(evidence: TrustEvidence[]): boolean {
  return evidence.some((entry) => entry.status === "passed" && ["digest_present", "file_hash_present", "attestation_verified"].includes(entry.code));
}

function dedupeEvidence(evidence: TrustEvidence[]): TrustEvidence[] {
  const byKey = new Map<string, TrustEvidence>();
  for (const entry of evidence) {
    const key = `${entry.code}:${entry.status}:${entry.message}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return [...byKey.values()];
}
