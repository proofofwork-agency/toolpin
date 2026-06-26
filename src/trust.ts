import { attestationBadge, readAttestations, readCapabilityManifest } from "./capabilities.js";
import { scanFindingsToTrustIssues, scanServerMetadata } from "./scan.js";
import type { NormalizedServer, RegistryPackage, RegistryRemote, TrustEvidence, TrustIssue, TrustReport, TrustTier } from "./types.js";

const STRONG_PACKAGE_TYPES = new Set(["oci", "mcpb"]);
const SUPPORTED_PACKAGE_TYPES = new Set(["npm", "pypi", "nuget", "cargo", "oci", "mcpb"]);
const BLOCKED_TRUST_CODES = new Set(["no_install_target", "insecure_remote", "invalid_remote_url"]);

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
    issues.push({
      severity: "warning",
      code: "missing_repository",
      message: "No source repository is declared.",
    });
  }

  if (server.name.includes("/")) {
    score += 6;
    badges.push("namespaced");
  }

  const packages = server.raw.packages ?? [];
  const remotes = server.raw.remotes ?? [];

  if (packages.length === 0 && remotes.length === 0) {
    score -= 35;
    issues.push({
      severity: "critical",
      code: "no_install_target",
      message: "No package or remote endpoint is declared.",
    });
  }

  for (const pkg of packages) {
    score += packageScore(pkg, issues, badges, evidence);
  }

  for (const remote of remotes) {
    score += remoteScore(remote, issues, badges);
  }

  if (server.requiresSecrets) {
    score -= 6;
    badges.push("requires secrets");
    issues.push({
      severity: "info",
      code: "requires_secrets",
      message: "This server declares secret configuration inputs.",
    });
  }

  if (server.transports.includes("sse")) {
    score -= 4;
    issues.push({
      severity: "info",
      code: "legacy_transport",
      message: "SSE transport appears in the manifest; streamable HTTP is preferred for remote servers.",
    });
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

  const metadataCompleteness = Math.max(0, Math.min(100, Math.round(score)));
  const uniqueEvidence = dedupeEvidence(evidence);
  const gated = classifyTrust(metadataCompleteness, issues, uniqueEvidence);

  return {
    score: metadataCompleteness,
    tier: gated.tier,
    gatedBy: gated.gatedBy,
    evidence: uniqueEvidence,
    badges: [...new Set(badges)],
    issues,
  };
}

export function classifyTrust(score: number, issues: TrustIssue[], evidence: TrustEvidence[] = []): { tier: TrustTier; gatedBy: string[] } {
  const gatedBy = issues.flatMap((issue): string[] => issue.severity === "critical" ? [issue.code] : []);
  const failedEvidence = evidence.filter((entry) => entry.status === "failed");
  const failedRequiredEvidence = failedEvidence.filter((entry) => entry.required);
  if (gatedBy.some((code) => BLOCKED_TRUST_CODES.has(code))) return { tier: "blocked", gatedBy };
  if (failedRequiredEvidence.length) return { tier: "blocked", gatedBy: [...gatedBy, ...failedRequiredEvidence.map((entry) => entry.code)] };
  if (gatedBy.length) return { tier: "unverified", gatedBy };
  if (failedEvidence.length) return { tier: "unverified", gatedBy: failedEvidence.map((entry) => entry.code) };
  if (hasPassedPinEvidence(evidence) && hasPassedArtifactEvidence(evidence)) return { tier: "verified", gatedBy };
  if (score >= 40 || hasPassedPinEvidence(evidence)) return { tier: "conditional", gatedBy };
  return { tier: "unverified", gatedBy };
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

function packageScore(pkg: RegistryPackage, issues: TrustIssue[], badges: string[], evidence: TrustEvidence[]): number {
  let score = 0;

  if (SUPPORTED_PACKAGE_TYPES.has(pkg.registryType)) {
    score += 5;
    badges.push(pkg.registryType);
  } else {
    score -= 8;
    issues.push({
      severity: "warning",
      code: "unknown_package_type",
      message: `Unknown package registry type: ${pkg.registryType}.`,
    });
  }

  if (STRONG_PACKAGE_TYPES.has(pkg.registryType)) {
    score += 4;
  }

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
    issues.push({
      severity: "warning",
      code: "unpinned_package",
      message: `Package ${pkg.identifier} does not declare an exact package version.`,
    });
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
      issues.push({
        severity: "critical",
        code: "mutable_oci_tag",
        message: `OCI image ${pkg.identifier} is not pinned by digest.`,
      });
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
      issues.push({
        severity: "critical",
        code: "missing_mcpb_hash",
        message: "MCPB packages should include fileSha256.",
      });
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
      issues.push({
        severity: "critical",
        code: "insecure_remote",
        message: `Remote MCP endpoint is not HTTPS: ${remote.url}`,
      });
    }
  } catch {
    score -= 15;
    issues.push({
      severity: "critical",
      code: "invalid_remote_url",
      message: `Remote MCP endpoint is not a valid URL: ${remote.url}`,
    });
  }

  if (remote.type === "streamable-http") score += 4;

  return score;
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
