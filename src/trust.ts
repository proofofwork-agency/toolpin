import { attestationBadge, readAttestations, readCapabilityManifest } from "./capabilities.js";
import type { NormalizedServer, RegistryPackage, RegistryRemote, TrustIssue, TrustReport } from "./types.js";

const STRONG_PACKAGE_TYPES = new Set(["oci", "mcpb"]);
const SUPPORTED_PACKAGE_TYPES = new Set(["npm", "pypi", "nuget", "cargo", "oci", "mcpb"]);

export function scoreServer(server: NormalizedServer): TrustReport {
  const issues: TrustIssue[] = [];
  const badges: string[] = [];
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
    score += packageScore(pkg, issues, badges);
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
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    badges: [...new Set(badges)],
    issues,
  };
}

function packageScore(pkg: RegistryPackage, issues: TrustIssue[], badges: string[]): number {
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
  } else if (pkg.registryType !== "oci") {
    score -= 6;
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
    } else {
      score -= 10;
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
    } else {
      score -= 12;
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
