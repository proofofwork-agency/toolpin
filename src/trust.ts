import { attestationBadge, readAttestations, readCapabilityManifest } from "./capabilities.js";
import { scanFindingsToTrustIssues, scanServerMetadata } from "./scan.js";
import type { NormalizedServer, RegistryPackage, RegistryRemote, TrustGate, TrustIssue, TrustReport, TrustTier } from "./types.js";

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
    score += packageScore(pkg, issues, badges);
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
  const attestations = readAttestations(server);
  for (const attestation of attestations) badges.push(attestationBadge(attestation));

  const metadataScan = scanServerMetadata(server);
  if (metadataScan.findings.length) {
    badges.push("description-scan-advisory");
    issues.push(...scanFindingsToTrustIssues(metadataScan));
  }

  const metadataCompleteness = clamp(score);
  const verifiedAttestation = attestations.some((attestation) => attestation.verified === true);
  const verifiedProvenance = Boolean(server.repositoryUrl && (server.registrySource === "official" || server.registrySource === "docker" || verifiedAttestation));
  const pillars = trustPillars(server, metadataCompleteness, issues, integritySignals, verifiedProvenance, verifiedAttestation);
  const gated = gateTrust(issues, pillars, verifiedProvenance, verifiedAttestation);
  return {
    score: gated.overallScore,
    overallScore: gated.overallScore,
    metadataCompleteness,
    tier: gated.tier,
    capReason: gated.capReason,
    vetoes: gated.vetoes,
    gates: gated.gates,
    pillars,
    badges: [...new Set(badges)],
    issues,
  };
}

export function classifyTrust(score: number, issues: TrustIssue[]): { tier: TrustTier; gates: TrustGate[] } {
  const gates = criticalGates(issues);
  if (gates.some((gate) => gate.tier === "blocked")) return { tier: "blocked", gates };
  if (gates.length) return { tier: "unverified", gates };
  if (score >= 70) return { tier: "verified", gates };
  if (score >= 40) return { tier: "conditional", gates };
  return { tier: "unverified", gates };
}

export function trustTier(report: Pick<TrustReport, "score" | "issues" | "tier">): TrustTier {
  return report.tier ?? classifyTrust(report.score, report.issues).tier;
}

function criticalGates(issues: TrustIssue[]): TrustGate[] {
  return issues.flatMap((issue): TrustGate[] => {
    if (issue.severity !== "critical") return [];
    const tier = BLOCKED_TRUST_CODES.has(issue.code) ? "blocked" : "unverified";
    return [{ code: issue.code, message: issue.message, tier }];
  });
}

function trustPillars(server: NormalizedServer, metadataCompleteness: number, issues: TrustIssue[], integritySignals: number, verifiedProvenance: boolean, verifiedAttestation: boolean): TrustPillars {
  const provenance = verifiedProvenance ? (verifiedAttestation ? 100 : server.registrySource === "official" ? 85 : 80) : server.repositoryUrl ? 55 : 20;
  const blocked = issues.some((issue) => issue.severity === "critical" && BLOCKED_TRUST_CODES.has(issue.code));
  const unverified = issues.some((issue) => issue.severity === "critical" && UNVERIFIED_TRUST_CODES.has(issue.code));
  const integrityPenalty = blocked ? 60 : unverified ? 35 : 0;
  const integrity = clamp(35 + integritySignals * 15 - integrityPenalty);
  const baseReputation = server.registrySource === "official" ? 80 : server.registrySource === "docker" ? 75 : server.registryMode === "discovery" ? 45 : 60;
  const scanPenalty = issues.filter((issue) => issue.code === "agent_instruction_in_description" || issue.code === "hidden_unicode_in_description").length * 10;
  return { provenance: clamp(provenance), integrity, reputation: clamp(baseReputation - scanPenalty), metadataCompleteness };
}

function gateTrust(issues: TrustIssue[], pillars: TrustPillars, verifiedProvenance: boolean, verifiedAttestation: boolean): { overallScore: number; tier: TrustTier; capReason?: string; vetoes: TrustGate[]; gates: TrustGate[] } {
  const gates = criticalGates(issues);
  const vetoes = gates.filter((gate) => gate.tier === "blocked");
  const unverifiedGates = gates.filter((gate) => gate.tier === "unverified");
  let overallScore = Math.round(pillars.provenance * 0.25 + pillars.integrity * 0.30 + pillars.reputation * 0.15 + pillars.metadataCompleteness * 0.30);
  let capReason: string | undefined;
  if (vetoes.length) {
    overallScore = Math.min(overallScore, 20);
    capReason = `veto: ${vetoes.map((gate) => gate.code).join(", ")}`;
    return { overallScore, tier: "blocked", capReason, vetoes, gates };
  }
  if (unverifiedGates.length) {
    overallScore = Math.min(overallScore, 45);
    capReason = unverifiedGates.map((gate) => gate.code).join(", ");
    return { overallScore, tier: "unverified", capReason, vetoes, gates };
  }
  if (!verifiedProvenance) {
    const cap = verifiedAttestation ? 80 : 69;
    if (overallScore > cap) {
      overallScore = cap;
      capReason = verifiedAttestation ? "attested without registry provenance" : "no verified provenance";
    } else if (!verifiedAttestation) {
      capReason = "no verified provenance";
    }
  }
  const tier = overallScore >= 70 ? "verified" : overallScore >= 40 ? "conditional" : "unverified";
  return { overallScore, tier, capReason, vetoes, gates };
}

function packageScore(pkg: RegistryPackage, issues: TrustIssue[], badges: string[]): number {
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
  } else if (pkg.registryType !== "oci") {
    score -= 6;
    issues.push({ severity: "warning", code: "unpinned_package", message: `Package ${pkg.identifier} does not declare an exact package version.` });
  }
  if (pkg.registryType === "oci") {
    if (pkg.identifier.includes("@sha256:")) {
      score += 8;
      badges.push("digest-pinned");
    } else {
      score -= 10;
      issues.push({ severity: "critical", code: "mutable_oci_tag", message: `OCI image ${pkg.identifier} is not pinned by digest.` });
    }
  }
  if (pkg.registryType === "mcpb") {
    if (pkg.fileSha256) {
      score += 8;
      badges.push("fileSha256");
    } else {
      score -= 12;
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
