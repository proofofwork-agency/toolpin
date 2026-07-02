import { attestationBadge, readAttestations, readCapabilityManifest } from "./capabilities.js";
import { hasOciDigestMarker, hasValidOciDigestPin, isValidSha256Hex } from "./integrity.js";
import { scanFindingsToTrustIssues, scanServerMetadata } from "./scan.js";
import { TRUSTED_MCPB_SOURCES, TRUSTED_NPM_PACKUMENT_HOSTS, TRUSTED_NPM_TARBALL_HOSTS, trustedOciRegistry } from "./verificationTrust.js";
import type { NormalizedServer, RegistryPackage, RegistryRemote, TrustEvidence, TrustGate, TrustIssue, TrustReport, TrustTier } from "./types.js";

const STRONG_PACKAGE_TYPES = new Set(["oci", "mcpb"]);
const SUPPORTED_PACKAGE_TYPES = new Set(["npm", "pypi", "nuget", "cargo", "oci", "mcpb"]);
const BLOCKED_TRUST_CODES = new Set(["no_install_target", "insecure_remote", "invalid_remote_url"]);
const UNVERIFIED_TRUST_CODES = new Set(["mutable_oci_tag", "missing_mcpb_hash"]);
const TRUSTED_ARTIFACT_EVIDENCE_CODES = new Set(["oci_digest_verified", "mcpb_sha256_verified", "npm_integrity_verified"]);
const VERIFIED_EVIDENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TOOLPIN_EVIDENCE_META = "dev.toolpin/evidence";

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
      source: "registry-metadata",
      claim: attestation.type,
      verificationMethod: "metadata-presence",
      verifiedByToolPin: false,
    });
  }

  const registryEvidence = readToolPinEvidence(server);
  if (registryEvidence.length) {
    evidence.push(...registryEvidence);
    if (registryEvidence.some((entry) => entry.code === "npm_integrity_verified" && entry.status === "passed")) badges.push("npm-integrity-verified");
    if (registryEvidence.some((entry) => entry.code === "oci_digest_verified" && entry.status === "passed")) badges.push("oci-digest-verified");
    if (registryEvidence.some((entry) => entry.code === "mcpb_sha256_verified" && entry.status === "passed")) badges.push("mcpb-sha256-verified");
  }

  const metadataScan = scanServerMetadata(server);
  if (metadataScan.findings.length) {
    badges.push("description-scan-advisory");
    issues.push(...scanFindingsToTrustIssues(metadataScan));
  }

  const metadataCompleteness = clamp(score);
  const uniqueEvidence = dedupeEvidence(evidence);
  const verifiedProvenance = Boolean(server.repositoryUrl && (server.registrySource === "toolpin" || server.registrySource === "official" || server.registrySource === "docker" || server.resolvedFromRegistry === "official"));
  const pillars = {
    ...trustPillars(server, metadataCompleteness, issues, integritySignals, verifiedProvenance),
    ...(hasFreshTrustedArtifactEvidence(uniqueEvidence) ? { integrity: 100 } : {}),
  };
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
    verifiedProvenance,
    pillars,
    evidence: uniqueEvidence,
    badges: [...new Set(badges)],
    issues,
  };
}

export function classifyTrust(
  score: number,
  issues: TrustIssue[],
  evidence: TrustEvidence[] = [],
  options: { verifiedProvenance?: boolean; now?: Date } = {},
): { tier: TrustTier; gatedBy: string[]; gates: TrustGate[] } {
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
  if (options.verifiedProvenance === true && hasUsablePinEvidence(evidence) && hasFreshTrustedArtifactEvidence(evidence, options.now)) return { tier: "verified", gatedBy: [], gates };
  if (score >= 40 || hasUsablePinEvidence(evidence)) return { tier: "conditional", gatedBy: [], gates };
  return { tier: "unverified", gatedBy: [], gates };
}

export function trustTier(report: Pick<TrustReport, "score" | "issues" | "tier" | "evidence">): TrustTier {
  return report.tier ?? classifyTrust(report.score, report.issues, report.evidence).tier;
}

export function trustProfileScore(report: Pick<TrustReport, "score" | "metadataCompleteness">): number {
  return clamp(report.metadataCompleteness ?? report.score);
}

export function trustRankingScore(report: Pick<TrustReport, "score" | "metadataCompleteness" | "issues" | "tier" | "evidence">): number {
  const profileScore = trustProfileScore(report);
  const tier = trustTier(report);
  if (tier === "verified") return 100;
  if (tier === "conditional") return bandScore(profileScore, 60, 99);
  if (tier === "unverified") return bandScore(profileScore, 30, 59);
  return bandScore(profileScore, 0, 20);
}

export function regateTrustReport(report: TrustReport): TrustReport {
  const verifiedProvenance = report.verifiedProvenance === true;
  const pillars = report.pillars ?? {
    provenance: verifiedProvenance ? 80 : 20,
    integrity: hasFreshTrustedArtifactEvidence(report.evidence ?? []) ? 85 : 50,
    reputation: 60,
    metadataCompleteness: report.metadataCompleteness ?? report.score,
  };
  const gated = gateTrust(report.score, report.issues, report.evidence ?? [], pillars, verifiedProvenance);
  return {
    ...report,
    overallScore: gated.overallScore,
    tier: gated.tier,
    capReason: gated.capReason,
    vetoes: gated.vetoes,
    gates: gated.gates,
    gatedBy: gated.gatedBy,
    pillars,
  };
}

export function evidenceSummary(report: Pick<TrustReport, "evidence">): string {
  const evidence = report.evidence ?? [];
  if (!evidence.length) return "no automated evidence";
  const verified = evidence.filter((entry) => entry.status === "passed" && entry.verifiedByToolPin).map((entry) => entry.code);
  const passed = evidence.filter((entry) => entry.status === "passed" && !entry.verifiedByToolPin).map((entry) => entry.code);
  const failed = evidence.filter((entry) => entry.status === "failed").map((entry) => entry.code);
  const declared = evidence.filter((entry) => entry.status === "declared").map((entry) => entry.code);
  const unavailable = evidence.filter((entry) => entry.status === "unavailable").map((entry) => entry.code);
  return [
    verified.length ? `ToolPin-verified ${verified.join(", ")}` : "",
    passed.length ? `passed ${passed.join(", ")}` : "",
    failed.length ? `failed ${failed.join(", ")}` : "",
    declared.length ? `declared ${declared.join(", ")}` : "",
    unavailable.length ? `unavailable ${unavailable.join(", ")}` : "",
  ].filter(Boolean).join("; ");
}

export function evidenceStatus(report: Pick<TrustReport, "evidence" | "score" | "issues" | "tier">): string {
  const tier = trustTier(report);
  if (tier === "verified") return "ToolPin-verified evidence passed";
  if ((report.evidence ?? []).some((entry) => entry.status === "failed")) return "evidence failed";
  if ((report.evidence ?? []).some((entry) => entry.status === "passed" && entry.verifiedByToolPin)) return "ToolPin evidence incomplete";
  if ((report.evidence ?? []).some((entry) => entry.status === "passed")) return "evidence incomplete";
  if ((report.evidence ?? []).some((entry) => entry.status === "declared")) return "evidence declared";
  return "no automated evidence";
}

export function trustCapExplanation(report: Pick<TrustReport, "capReason" | "evidence" | "issues">): string | undefined {
  if (!report.capReason) return undefined;
  if (report.capReason === "automated evidence incomplete") {
    const evidence = report.evidence ?? [];
    const hasPin = hasUsablePinEvidence(evidence);
    const hasArtifact = hasFreshTrustedArtifactEvidence(evidence);
    const hasStaleArtifact = evidence.some((entry) => isTrustedArtifactEvidence(entry) && entry.verifiedAt && !isFreshVerifiedAt(entry.verifiedAt));
    const hasUntrustedArtifact = evidence.some((entry) => TRUSTED_ARTIFACT_EVIDENCE_CODES.has(entry.code) && entry.status === "passed" && entry.verifiedByToolPin === true && entry.trustedAnchor !== true);
    const declaredAttestation = evidence.some((entry) => entry.code === "attestation_declared");
    const missing = [
      hasPin ? "" : "exact package pin",
      hasArtifact ? "" : artifactMissingReason(hasStaleArtifact, hasUntrustedArtifact),
    ].filter(Boolean);
    const base = missing.length
      ? `automated evidence incomplete: missing ${missing.join(" and ")}`
      : "automated evidence incomplete: required automated evidence has not all passed";
    return declaredAttestation ? `${base}; declared attestations are not verified` : base;
  }
  if (report.capReason === "no verified provenance") {
    return "no verified provenance: source must be ToolPin, official, or Docker and include a repository URL";
  }
  if (report.capReason.startsWith("veto: ")) {
    const codes = report.capReason.slice("veto: ".length).split(", ");
    const messages = codes.map((code) => report.issues.find((issue) => issue.code === code)?.message ?? code);
    return `blocked by critical issue: ${messages.join("; ")}`;
  }
  const issue = report.issues.find((entry) => entry.code === report.capReason);
  if (issue) return `${report.capReason}: ${issue.message}`;
  return report.capReason;
}

function criticalGates(issues: TrustIssue[]): TrustGate[] {
  return issues.flatMap((issue): TrustGate[] => {
    if (issue.severity !== "critical") return [];
    const tier = BLOCKED_TRUST_CODES.has(issue.code) ? "blocked" : "unverified";
    return [{ code: issue.code, message: issue.message, tier }];
  });
}

function trustPillars(server: NormalizedServer, metadataCompleteness: number, issues: TrustIssue[], integritySignals: number, verifiedProvenance: boolean): TrustPillars {
  const provenance = verifiedProvenance ? (server.registrySource === "official" ? 85 : server.registrySource === "toolpin" ? 82 : 80) : server.repositoryUrl ? 55 : 20;
  const blocked = issues.some((issue) => issue.severity === "critical" && BLOCKED_TRUST_CODES.has(issue.code));
  const unverified = issues.some((issue) => issue.severity === "critical" && UNVERIFIED_TRUST_CODES.has(issue.code));
  const integrityPenalty = blocked ? 60 : unverified ? 35 : 0;
  const integrity = clamp(35 + integritySignals * 15 - integrityPenalty);
  const baseReputation = server.registrySource === "official" ? 80 : server.registrySource === "toolpin" ? 78 : server.registrySource === "docker" ? 75 : server.registryMode === "discovery" ? 45 : 60;
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
  const classified = classifyTrust(score, issues, evidence, { verifiedProvenance });
  const vetoes = classified.gates.filter((gate) => gate.tier === "blocked");
  const unverifiedGates = classified.gates.filter((gate) => gate.tier === "unverified");
  let overallScore = Math.round(pillars.provenance * 0.25 + pillars.integrity * 0.30 + pillars.reputation * 0.15 + pillars.metadataCompleteness * 0.30);
  let capReason: string | undefined;
  if (vetoes.length) {
    overallScore = Math.min(overallScore, 20);
    capReason = `veto: ${vetoes.map((gate) => gate.code).join(", ")}`;
  } else if (classified.tier === "verified") {
    overallScore = 100;
  } else if (unverifiedGates.length) {
    overallScore = Math.min(overallScore, 45);
    capReason = unverifiedGates.map((gate) => gate.code).join(", ");
  } else {
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

function bandScore(score: number, min: number, max: number): number {
  return min + Math.round((clamp(score) / 100) * (max - min));
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
      status: "declared",
      message: `Package ${pkg.identifier} declares exact version ${pkg.version}.`,
      source: "registry-metadata",
      claim: `${pkg.identifier}@${pkg.version}`,
      verificationMethod: "metadata-presence",
      verifiedByToolPin: false,
    });
  } else if (pkg.registryType !== "oci") {
    score -= 6;
    evidence.push({
      code: "package_pin",
      status: "failed",
      message: `Package ${pkg.identifier} does not declare an exact package version.`,
      source: "registry-metadata",
      claim: pkg.identifier,
      verificationMethod: "metadata-presence",
      verifiedByToolPin: false,
      failureReason: "missing exact version",
    });
    issues.push({ severity: "warning", code: "unpinned_package", message: `Package ${pkg.identifier} does not declare an exact package version.` });
  }
  if (pkg.registryType === "oci") {
    if (hasValidOciDigestPin(pkg.identifier)) {
      score += 8;
      badges.push("digest-pinned");
      evidence.push({
        code: "digest_present",
        status: "declared",
        message: `OCI image ${pkg.identifier} declares a digest pin; image bytes were not resolved by ToolPin.`,
        source: "registry-metadata",
        claim: pkg.identifier,
        verificationMethod: "metadata-presence",
        verifiedByToolPin: false,
      });
      evidence.push({
        code: "package_pin",
        status: "declared",
        message: `OCI image ${pkg.identifier} is pinned by digest.`,
        source: "registry-metadata",
        claim: pkg.identifier,
        verificationMethod: "metadata-presence",
        verifiedByToolPin: false,
      });
    } else {
      score -= 10;
      const reason = hasOciDigestMarker(pkg.identifier) ? "does not contain a valid sha256 digest pin" : "is not pinned by digest";
      evidence.push({
        code: "digest_present",
        status: "failed",
        message: `OCI image ${pkg.identifier} ${reason}.`,
        source: "registry-metadata",
        claim: pkg.identifier,
        verificationMethod: "metadata-presence",
        verifiedByToolPin: false,
        failureReason: reason,
      });
      issues.push({ severity: "critical", code: "mutable_oci_tag", message: `OCI image ${pkg.identifier} ${reason}.` });
    }
  }
  if (pkg.registryType === "mcpb") {
    if (isValidSha256Hex(pkg.fileSha256)) {
      score += 8;
      badges.push("fileSha256");
      evidence.push({
        code: "file_hash_present",
        status: "declared",
        message: "MCPB package declares fileSha256; package bytes were not hashed by ToolPin in metadata scoring.",
        source: "registry-metadata",
        claim: pkg.fileSha256,
        verificationMethod: "metadata-presence",
        verifiedByToolPin: false,
      });
    } else {
      score -= 12;
      evidence.push({
        code: "file_hash_present",
        status: "failed",
        message: "MCPB package is missing a valid 64-character fileSha256.",
        source: "registry-metadata",
        claim: pkg.identifier,
        verificationMethod: "metadata-presence",
        verifiedByToolPin: false,
        failureReason: "missing valid 64-character fileSha256",
      });
      issues.push({ severity: "critical", code: "missing_mcpb_hash", message: "MCPB packages should include a valid 64-character fileSha256." });
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

// Evidence read from registry `_meta` is a CLAIM by the registry, not proof
// this installation verified anything. A claimed "passed" is downgraded to
// "declared" and `verifiedByToolPin` is forced to false, so registry metadata
// alone can never satisfy the verified tier, `requireToolPinVerifiedEvidence`,
// or the fresh-trusted-artifact gate — only the local re-hash path in
// verify.ts produces `passed` + `verifiedByToolPin` evidence. Negative claims
// ("failed", especially required ones) keep their teeth as-is. The claimed
// anchor host is still checked against the code allowlist so the claim's
// provenance stays visible.
function readToolPinEvidence(server: NormalizedServer): TrustEvidence[] {
  if (server.registrySource !== "toolpin") return [];
  const rawValue = server.raw._meta?.[TOOLPIN_EVIDENCE_META] ?? server.registryMeta?.[TOOLPIN_EVIDENCE_META];
  if (!Array.isArray(rawValue)) return [];
  return rawValue.flatMap((entry): TrustEvidence[] => {
    if (!isRecord(entry)) return [];
    if (typeof entry.code !== "string" || typeof entry.status !== "string" || typeof entry.message !== "string") return [];
    if (!["passed", "declared", "failed", "unavailable"].includes(entry.status)) return [];
    const declaredTrustedAnchor = typeof entry.trustedAnchor === "boolean" ? entry.trustedAnchor : undefined;
    const trustAnchorHost = typeof entry.trustAnchor === "string" ? entry.trustAnchor : undefined;
    const trustedAnchor = declaredTrustedAnchor === true
      ? anchorAllowsEvidenceCode(entry.code, trustAnchorHost)
      : declaredTrustedAnchor;
    const status = entry.status === "passed" ? "declared" : entry.status as TrustEvidence["status"];
    const message = entry.status === "passed" ? `${entry.message} (registry-declared, not locally recomputed)` : entry.message;
    return [{
      code: entry.code,
      status,
      message,
      verifiedByToolPin: false,
      ...(typeof entry.source === "string" ? { source: entry.source } : {}),
      ...(typeof entry.claim === "string" ? { claim: entry.claim } : {}),
      ...(typeof entry.verificationMethod === "string" ? { verificationMethod: entry.verificationMethod } : {}),
      ...(trustedAnchor !== undefined ? { trustedAnchor } : {}),
      ...(trustAnchorHost ? { trustAnchor: trustAnchorHost } : {}),
      ...(typeof entry.verifiedAt === "string" ? { verifiedAt: entry.verifiedAt } : {}),
      ...(typeof entry.failureReason === "string" ? { failureReason: entry.failureReason } : {}),
      ...(typeof entry.required === "boolean" ? { required: entry.required } : {}),
    }];
  });
}

function anchorAllowsEvidenceCode(code: string, trustAnchor: string | undefined): boolean {
  if (typeof trustAnchor !== "string") return false;
  const host = trustAnchor.toLowerCase();
  if (code === "npm_integrity_verified") return TRUSTED_NPM_PACKUMENT_HOSTS.has(host) || TRUSTED_NPM_TARBALL_HOSTS.has(host);
  if (code === "oci_digest_verified") return trustedOciRegistry(host);
  if (code === "mcpb_sha256_verified") return TRUSTED_MCPB_SOURCES.has(host);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isFloatingVersion(version: string): boolean {
  return ["latest", "*"].includes(version.trim().toLowerCase()) || /[~^x*]/i.test(version);
}

function hasUsablePinEvidence(evidence: TrustEvidence[]): boolean {
  return evidence.some((entry) => (entry.status === "passed" || entry.status === "declared") && ["package_pin", "digest_present", "file_hash_present"].includes(entry.code));
}

export function hasFreshTrustedArtifactEvidence(evidence: TrustEvidence[], now = new Date()): boolean {
  return evidence.some((entry) => isTrustedArtifactEvidence(entry) && isFreshVerifiedAt(entry.verifiedAt, now));
}

export function trustedArtifactEvidenceProblem(evidence: TrustEvidence[], now = new Date()): string | undefined {
  const candidates = evidence.filter((entry) => TRUSTED_ARTIFACT_EVIDENCE_CODES.has(entry.code));
  if (!candidates.length) return "missing trusted artifact evidence";
  if (candidates.some((entry) => entry.status === "failed" && entry.required)) return "required artifact evidence failed";
  if (candidates.some((entry) => entry.status === "passed" && entry.verifiedByToolPin === true && entry.trustedAnchor !== true)) return "artifact evidence used an untrusted anchor";
  if (candidates.some((entry) => isTrustedArtifactEvidence(entry) && isFreshVerifiedAt(entry.verifiedAt, now))) return undefined;
  if (candidates.some((entry) => isTrustedArtifactEvidence(entry) && !isFreshVerifiedAt(entry.verifiedAt, now))) return "trusted artifact evidence is stale";
  return "missing trusted artifact evidence";
}

function isTrustedArtifactEvidence(entry: TrustEvidence): boolean {
  return entry.status === "passed"
    && entry.verifiedByToolPin === true
    && entry.trustedAnchor === true
    && TRUSTED_ARTIFACT_EVIDENCE_CODES.has(entry.code);
}

function isFreshVerifiedAt(value: string | undefined, now = new Date()): boolean {
  if (!value) return false;
  const verifiedAt = Date.parse(value);
  if (!Number.isFinite(verifiedAt)) return false;
  return now.getTime() - verifiedAt <= VERIFIED_EVIDENCE_MAX_AGE_MS && verifiedAt <= now.getTime() + 60_000;
}

function artifactMissingReason(stale: boolean, untrusted: boolean): string {
  if (stale) return "fresh ToolPin-verified artifact proof";
  if (untrusted) return "trusted-anchor artifact proof";
  return "ToolPin-verified artifact proof (OCI registry digest, MCPB byte hash, or npm tarball integrity)";
}

function dedupeEvidence(evidence: TrustEvidence[]): TrustEvidence[] {
  const byKey = new Map<string, TrustEvidence>();
  for (const entry of evidence) {
    const key = `${entry.code}:${entry.status}:${entry.message}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return [...byKey.values()];
}
