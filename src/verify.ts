import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { selectLaunchTarget } from "./config.js";
import { attestationBadge, deriveCapabilityManifest, hashToolDescriptions, hashToolManifests, readAttestations, readCapabilityManifest } from "./capabilities.js";
import { hasOciDigestMarker, hasValidOciDigestPin, isValidSha256Hex } from "./integrity.js";
import { verifyNpmPackageIntegrity } from "./packageIntegrity.js";
import { safeFetch, safeFetchBuffer, safeFetchJson, type SafeFetchOptions } from "./safeFetch.js";
import { scanFindingsToTrustIssues, scanServerMetadata, scanToolDescriptions } from "./scan.js";
import { testServer } from "./tester.js";
import { classifyTrust, scoreServer, trustedArtifactEvidenceProblem } from "./trust.js";
import type { Attestation, CapabilityManifest, NormalizedServer, TrustEvidence, TrustIssue } from "./types.js";
import { TRUSTED_MCPB_SOURCES, canonicalizeOciRef, trustedMcpbSourceHost, trustedOciAuthHosts, trustedOciRegistry } from "./verificationTrust.js";

export interface VerificationOptions {
  liveRemoteProbe?: boolean;
  livePackageProbe?: boolean;
  /**
   * Explicit opt-in to execute the server package for the live probe.
   * Without it, verification runs only network artifact checks and connects to
   * remote endpoints; it never spawns npx/uvx/docker/etc. for the target.
   */
  allowExecute?: boolean;
  timeoutMs?: number;
  requireVerified?: boolean;
  fetch?: SafeFetchOptions["fetch"];
  lookup?: SafeFetchOptions["lookup"];
}

export interface VerificationReport {
  ok: boolean;
  serverName: string;
  serverVersion: string;
  capabilityManifest: CapabilityManifest;
  attestations: Attestation[];
  badges: string[];
  evidence: TrustEvidence[];
  issues: TrustIssue[];
  verifiedProvenance?: boolean;
}

export async function verifyServer(server: NormalizedServer, options: VerificationOptions = {}): Promise<VerificationReport> {
  const issues: TrustIssue[] = [];
  const badges: string[] = [];
  const evidence: TrustEvidence[] = [...(scoreServer(server).evidence ?? [])];
  const attestations = readAttestations(server);
  const declaredCapabilityManifest = readCapabilityManifest(server);
  const launch = selectLaunchTarget(server);
  const generatedAt = new Date().toISOString();
  let capabilityManifest = deriveCapabilityManifest(server, { generatedAt });
  const metadataScan = scanServerMetadata(server, generatedAt);
  const verifiedProvenance = Boolean(server.repositoryUrl && (server.registrySource === "toolpin" || server.registrySource === "official" || server.registrySource === "docker" || server.resolvedFromRegistry === "official"));
  issues.push(...scanFindingsToTrustIssues(metadataScan));
  if (metadataScan.findings.length) badges.push("description-scan-advisory");

  if (declaredCapabilityManifest) {
    badges.push("capability-pinned");
  }

  for (const attestation of attestations) {
    badges.push(attestationBadge(attestation));
  }

  if (!launch) {
    issues.push({
      severity: "critical",
      code: "no_install_target",
      message: `No install target is available for ${server.name}@${server.version}.`,
    });
  } else if (launch.kind === "package") {
    await verifyPackagePins(launch.pkg, issues, badges, evidence, generatedAt, options);
    if (options.livePackageProbe === true) {
      // Executing the package is a separate trust decision from verifying it:
      // the artifact checks above never run target code, but the live probe
      // spawns the (possibly unverified) server. Require an explicit opt-in.
      if (options.allowExecute === true) {
        const pinned = await verifyLiveToolManifest(server, generatedAt, issues, badges, evidence, "package", options.timeoutMs);
        if (pinned) capabilityManifest = pinned;
      } else {
        issues.push({
          severity: "warning",
          code: "package_execution_skipped",
          message: "Live package probe skipped: ToolPin does not execute server packages during verification without --allow-execute. Network artifact checks still ran.",
        });
        evidence.push({
          code: "tool_description_hash",
          status: "unavailable",
          message: "Package tools/list hashing requires executing the package; rerun with --allow-execute to capture live capability pins.",
        });
      }
    }
  } else {
    badges.push("remote-target");
    const remoteTrust = remoteTrustIssue(launch.remote.url);
    if (remoteTrust) {
      issues.push(remoteTrust.issue);
      evidence.push(remoteTrust.evidence);
    }
    if (options.liveRemoteProbe !== false) {
      const pinned = remoteTrust?.blockProbe ? undefined : await verifyLiveToolManifest(server, generatedAt, issues, badges, evidence, "remote", options.timeoutMs);
      if (pinned) capabilityManifest = pinned;
    } else {
      issues.push({
        severity: "warning",
        code: "remote_probe_skipped",
        message: "Remote tool-description hashing was skipped; capability pin is metadata-only.",
      });
      evidence.push({
        code: "tool_description_hash",
        status: "unavailable",
        message: "Remote tools/list hashing was skipped.",
      });
    }
  }

  const finalEvidence = dedupeEvidence(evidence);
  if (options.requireVerified) {
    const classified = classifyTrust(scoreServer(server).score, issues, finalEvidence, { verifiedProvenance });
    if (classified.tier !== "verified") {
      issues.push({
        severity: "critical",
        code: "verified_required",
        message: `Verified proof is required but incomplete: ${verifiedProvenance ? trustedArtifactEvidenceProblem(finalEvidence) : "missing verified provenance"}.`,
      });
    }
  }
  const critical = issues.some((issue) => issue.severity === "critical");
  return {
    ok: !critical,
    serverName: server.name,
    serverVersion: server.version,
    capabilityManifest,
    attestations,
    badges: [...new Set(badges)],
    evidence: finalEvidence,
    issues,
    verifiedProvenance,
  };
}

async function verifyLiveToolManifest(
  server: NormalizedServer,
  generatedAt: string,
  issues: TrustIssue[],
  badges: string[],
  evidence: TrustEvidence[],
  targetKind: "remote" | "package",
  timeoutMs?: number,
): Promise<CapabilityManifest | undefined> {
  const result = await testServer(server, timeoutMs);
  if (!result.ok) {
    const label = targetKind === "remote" ? "Remote" : "Package";
    issues.push({
      severity: "critical",
      code: targetKind === "remote" ? "remote_probe_failed" : "package_probe_failed",
      message: `${label} capability verification failed: ${result.message}`,
    });
    evidence.push({
      code: "tool_description_hash",
      status: "failed",
      message: `Live tools/list descriptions were not hashed: ${result.message}`,
      required: true,
    });
    return undefined;
  }

  const toolDescriptionHash = hashToolDescriptions(result.tools, generatedAt);
  const toolManifestHash = hashToolManifests(result.tools, generatedAt);
  const toolDescriptionScan = scanToolDescriptions(result.tools, { generatedAt });
  const capabilityManifest = deriveCapabilityManifest(server, { generatedAt, toolDescriptionHash, toolManifestHash, toolDescriptionScan });
  badges.push("tool-description-pinned");
  badges.push("tool-manifest-pinned");
  evidence.push({
    code: "tool_description_hash",
    status: "passed",
    message: "Live tools/list descriptions were hashed into the capability manifest.",
  });
  if (toolDescriptionScan.findings.length) {
    badges.push("tool-description-scan-advisory");
    issues.push(...scanFindingsToTrustIssues(toolDescriptionScan));
  }
  return capabilityManifest;
}

function remoteTrustIssue(url: string): { issue: TrustIssue; evidence: TrustEvidence; blockProbe: boolean } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      issue: {
        severity: "critical",
        code: "invalid_remote_url",
        message: `Remote MCP URL is invalid: ${reason}.`,
      },
      evidence: {
        code: "remote_transport_trust",
        status: "failed",
        message: "Remote MCP target URL could not be parsed.",
        claim: url,
        verificationMethod: "remote-url-scheme-check",
        verifiedByToolPin: true,
        trustedAnchor: false,
        required: true,
      },
      blockProbe: true,
    };
  }

  if (parsed.protocol === "https:") return undefined;
  if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) {
    return {
      issue: {
        severity: "warning",
        code: "local_http_remote",
        message: `Remote MCP URL ${url} uses loopback HTTP; treat it as a local runtime target, not trusted public remote metadata.`,
      },
      evidence: {
        code: "remote_transport_trust",
        status: "unavailable",
        message: "Loopback HTTP remote target is local/advisory and not trusted public remote metadata.",
        claim: url,
        verificationMethod: "remote-url-scheme-check",
        verifiedByToolPin: true,
        trustedAnchor: false,
      },
      blockProbe: false,
    };
  }

  return {
    issue: {
      severity: "critical",
      code: "insecure_remote",
      message: `Remote MCP URL ${url} must use HTTPS unless it is a loopback local fixture.`,
    },
    evidence: {
      code: "remote_transport_trust",
      status: "failed",
      message: "Remote MCP target uses insecure transport.",
      claim: url,
      verificationMethod: "remote-url-scheme-check",
      verifiedByToolPin: true,
      trustedAnchor: false,
      required: true,
    },
    blockProbe: true,
  };
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIP(host) === 4) {
    const first = Number.parseInt(host.split(".")[0] ?? "", 10);
    return first === 127;
  }
  return host === "::1" || host === "0:0:0:0:0:0:0:1";
}

async function verifyPackagePins(
  pkg: { registryType: string; identifier: string; version?: string; fileSha256?: string },
  issues: TrustIssue[],
  badges: string[],
  evidence: TrustEvidence[],
  verifiedAt: string,
  options: VerificationOptions,
): Promise<void> {
  if (pkg.registryType === "oci") {
    if (hasValidOciDigestPin(pkg.identifier)) {
      badges.push("digest-pinned");
      const result = await verifyOciDigest(pkg.identifier, options);
      if (result.status === "passed") {
        badges.push("oci-digest-verified");
        evidence.push({
          code: "oci_digest_verified",
          status: "passed",
          message: `OCI manifest digest matched via ${result.trustAnchor}.`,
          source: "oci-registry",
          claim: result.expected,
          verificationMethod: "registry-manifest-digest",
          verifiedByToolPin: true,
          trustedAnchor: true,
          trustAnchor: result.trustAnchor,
          verifiedAt,
        });
      } else if (result.status === "failed") {
        issues.push({
          severity: "critical",
          code: "oci_digest_mismatch",
          message: `OCI registry digest mismatch for ${pkg.identifier}: expected ${result.expected}, got ${result.actual ?? "unknown"}.`,
        });
        evidence.push({
          code: "oci_digest_verified",
          status: "failed",
          message: `OCI registry digest mismatch for ${pkg.identifier}.`,
          source: "oci-registry",
          claim: result.expected,
          verificationMethod: "registry-manifest-digest",
          verifiedByToolPin: true,
          trustedAnchor: result.trustedAnchor,
          trustAnchor: result.trustAnchor,
          verifiedAt,
          failureReason: result.actual ? `resolved ${result.actual}` : result.reason,
          required: true,
        });
      } else {
        evidence.push({
          code: "oci_digest_verified",
          status: "unavailable",
          message: `OCI registry bytes were not resolved for ${pkg.identifier}: ${result.reason}.`,
          source: "oci-registry",
          claim: result.expected,
          verificationMethod: "registry-manifest-digest",
          verifiedByToolPin: false,
          trustedAnchor: result.trustedAnchor,
          trustAnchor: result.trustAnchor,
          failureReason: result.reason,
        });
      }
    } else {
      const reason = hasOciDigestMarker(pkg.identifier) ? "does not contain a valid sha256 digest pin" : "is not pinned by digest";
      issues.push({
        severity: "critical",
        code: "mutable_oci_tag",
        message: `OCI image ${pkg.identifier} ${reason}.`,
      });
    }
  }

  if (pkg.registryType === "npm") {
    const result = await verifyNpmPackageIntegrity(pkg, options);
    if (result.status === "passed") {
      badges.push("npm-integrity-verified");
      evidence.push({
        code: "npm_integrity_verified",
        status: "passed",
        message: `npm tarball integrity matched registry dist.integrity for ${pkg.identifier}@${pkg.version}.`,
        source: result.source,
        claim: result.expected,
        verificationMethod: "npm-packument-sri",
        verifiedByToolPin: true,
        trustedAnchor: true,
        trustAnchor: result.trustAnchor,
        verifiedAt,
      });
    } else if (result.status === "failed") {
      issues.push({
        severity: "critical",
        code: result.issueCode ?? "npm_integrity_failed",
        message: `npm integrity verification failed for ${pkg.identifier}${pkg.version ? `@${pkg.version}` : ""}: ${result.reason ?? "unknown failure"}.`,
      });
      evidence.push({
        code: "npm_integrity_verified",
        status: "failed",
        message: `npm integrity verification failed for ${pkg.identifier}${pkg.version ? `@${pkg.version}` : ""}.`,
        source: result.source,
        claim: result.expected ?? `${pkg.identifier}${pkg.version ? `@${pkg.version}` : ""}`,
        verificationMethod: "npm-packument-sri",
        verifiedByToolPin: true,
        trustedAnchor: result.trustedAnchor,
        trustAnchor: result.trustAnchor,
        verifiedAt,
        failureReason: result.actual ? `computed ${result.actual}` : result.reason,
        required: true,
      });
    } else {
      evidence.push({
        code: "npm_integrity_verified",
        status: "unavailable",
        message: `npm integrity evidence was not available for ${pkg.identifier}${pkg.version ? `@${pkg.version}` : ""}: ${result.reason}.`,
        source: result.source,
        claim: result.expected ?? `${pkg.identifier}${pkg.version ? `@${pkg.version}` : ""}`,
        verificationMethod: "npm-packument-sri",
        verifiedByToolPin: false,
        trustedAnchor: result.trustedAnchor,
        trustAnchor: result.trustAnchor,
        failureReason: result.reason,
      });
    }
  }

  if (pkg.registryType === "mcpb") {
    if (isValidSha256Hex(pkg.fileSha256)) {
      badges.push("fileSha256");
      const result = await verifyMcpbSha256(pkg.identifier, pkg.fileSha256, options);
      if (result.status === "passed") {
        badges.push("mcpb-sha256-verified");
        evidence.push({
          code: "mcpb_sha256_verified",
          status: "passed",
          message: `MCPB bytes match declared fileSha256 for ${pkg.identifier}.`,
          source: result.source,
          claim: pkg.fileSha256,
          verificationMethod: "sha256-bytes",
          verifiedByToolPin: true,
          trustedAnchor: true,
          trustAnchor: result.trustAnchor,
          verifiedAt,
        });
      } else if (result.status === "failed") {
        issues.push({
          severity: "critical",
          code: "mcpb_sha256_mismatch",
          message: `MCPB fileSha256 mismatch for ${pkg.identifier}: expected ${pkg.fileSha256}, got ${result.actual ?? "unknown"}.`,
        });
        evidence.push({
          code: "mcpb_sha256_verified",
          status: "failed",
          message: `MCPB bytes do not match declared fileSha256 for ${pkg.identifier}.`,
          source: result.source,
          claim: pkg.fileSha256,
          verificationMethod: "sha256-bytes",
          verifiedByToolPin: true,
          trustedAnchor: result.trustedAnchor,
          trustAnchor: result.trustAnchor,
          verifiedAt,
          failureReason: result.actual ? `computed ${result.actual}` : result.reason,
          required: true,
        });
      } else {
        evidence.push({
          code: "mcpb_sha256_verified",
          status: "unavailable",
          message: `MCPB bytes were not available for ${pkg.identifier}: ${result.reason}.`,
          source: result.source,
          claim: pkg.fileSha256,
          verificationMethod: "sha256-bytes",
          verifiedByToolPin: false,
          trustedAnchor: result.trustedAnchor,
          trustAnchor: result.trustAnchor,
          failureReason: result.reason,
        });
      }
    } else {
      issues.push({
        severity: "critical",
        code: "missing_mcpb_hash",
        message: "MCPB package is missing a valid 64-character fileSha256.",
      });
    }
  }
}

type ByteVerificationResult = {
  status: "passed" | "failed" | "unavailable";
  expected: string;
  actual?: string;
  source: string;
  reason?: string;
  trustedAnchor?: boolean;
  trustAnchor?: string;
};

async function verifyMcpbSha256(identifier: string, expected: string, options: VerificationOptions): Promise<ByteVerificationResult> {
  const normalizedExpected = normalizeSha256(expected);
  const source = artifactSource(identifier);
  if (source === "file-artifact" || source === "local-file") {
    return {
      status: "unavailable",
      expected: normalizedExpected,
      source,
      trustedAnchor: false,
      reason: "registry metadata cannot request local file hashing",
    };
  }
  if (identifier.startsWith("http://")) {
    return {
      status: "unavailable",
      expected: normalizedExpected,
      source,
      trustedAnchor: false,
      reason: "MCPB artifact URL is not HTTPS",
    };
  }
  if (identifier.startsWith("https://")) {
    const trustAnchor = trustedMcpbSourceHost(identifier);
    if (!trustAnchor) {
      return {
        status: "unavailable",
        expected: normalizedExpected,
        source,
        trustedAnchor: false,
        reason: "MCPB artifact host is not a ToolPin trusted anchor",
      };
    }
    try {
      const bytes = await safeFetchBuffer(identifier, {
        allowedHosts: TRUSTED_MCPB_SOURCES,
        fetch: options.fetch,
        lookup: options.lookup,
        timeoutMs: options.timeoutMs,
        maxBytes: 64 * 1024 * 1024,
      });
      const actual = createHash("sha256").update(bytes).digest("hex");
      return {
        status: actual === normalizedExpected ? "passed" : "failed",
        expected: normalizedExpected,
        actual,
        source,
        trustedAnchor: true,
        trustAnchor,
      };
    } catch (error) {
      return {
        status: "unavailable",
        expected: normalizedExpected,
        source,
        trustedAnchor: true,
        trustAnchor,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    status: "unavailable",
    expected: normalizedExpected,
    source,
    trustedAnchor: false,
    reason: "unsupported MCPB artifact identifier",
  };
}

function artifactSource(identifier: string): string {
  if (identifier.startsWith("https://") || identifier.startsWith("http://")) return "http-artifact";
  if (identifier.startsWith("file://")) return "file-artifact";
  return "local-file";
}

type OciVerificationResult = {
  status: "passed" | "failed" | "unavailable";
  expected: string;
  actual?: string;
  reason?: string;
  trustedAnchor: boolean;
  trustAnchor?: string;
};

async function verifyOciDigest(identifier: string, options: VerificationOptions = {}): Promise<OciVerificationResult> {
  const parsed = canonicalizeOciRef(identifier);
  if (!parsed) return { status: "unavailable", expected: "", trustedAnchor: false, reason: "unsupported OCI identifier" };
  const trustAnchor = parsed.host;
  if (!trustedOciRegistry(parsed)) {
    return {
      status: "unavailable",
      expected: parsed.digest,
      trustedAnchor: false,
      trustAnchor,
      reason: `OCI registry ${parsed.host} is not a ToolPin trusted anchor`,
    };
  }
  const registryHost = parsed.host === "docker.io" ? "registry-1.docker.io" : parsed.host;
  const url = `https://${registryHost}/v2/${parsed.repository}/manifests/${encodeURIComponent(parsed.digest)}`;
  const headers = {
    Accept: [
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.oci.image.index.v1+json",
    ].join(", "),
  };

  try {
    let response = await safeFetch(url, { method: "HEAD", headers, fetch: options.fetch, lookup: options.lookup, timeoutMs: options.timeoutMs });
    if (response.status === 401) {
      const token = await fetchBearerToken(response.headers.get("www-authenticate"), parsed.host, options);
      if (token) response = await safeFetch(url, { method: "HEAD", headers: { ...headers, Authorization: `Bearer ${token}` }, fetch: options.fetch, lookup: options.lookup, timeoutMs: options.timeoutMs });
    }
    if (!response.ok) return { status: "unavailable", expected: parsed.digest, trustedAnchor: true, trustAnchor, reason: `HTTP ${response.status} ${response.statusText}` };
    const actual = response.headers.get("docker-content-digest") ?? "";
    if (!actual) return { status: "unavailable", expected: parsed.digest, trustedAnchor: true, trustAnchor, reason: "registry did not return Docker-Content-Digest" };
    return { status: actual === parsed.digest ? "passed" : "failed", expected: parsed.digest, actual, trustedAnchor: true, trustAnchor };
  } catch (error) {
    return { status: "unavailable", expected: parsed.digest, trustedAnchor: true, trustAnchor, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchBearerToken(wwwAuthenticate: string | null, registryHost: string, options: VerificationOptions = {}): Promise<string | undefined> {
  if (!wwwAuthenticate?.startsWith("Bearer ")) return undefined;
  const params = Object.fromEntries(
    wwwAuthenticate
      .slice("Bearer ".length)
      .split(",")
      .map((part) => part.trim().split("="))
      .filter((parts): parts is [string, string] => parts.length === 2)
      .map(([key, value]) => [key, value.replace(/^"|"$/g, "")]),
  );
  if (!params.realm) return undefined;
  const url = new URL(params.realm);
  const allowedHosts = trustedOciAuthHosts(registryHost);
  if (params.service) url.searchParams.set("service", params.service);
  if (params.scope) url.searchParams.set("scope", params.scope);
  const body = await safeFetchJson<{ token?: string; access_token?: string }>(url, { allowedHosts, maxBytes: 256 * 1024, fetch: options.fetch, lookup: options.lookup, timeoutMs: options.timeoutMs });
  return body.token ?? body.access_token;
}

function normalizeSha256(value: string): string {
  return value.startsWith("sha256:") ? value.slice("sha256:".length).toLowerCase() : value.toLowerCase();
}

function dedupeEvidence(evidence: TrustEvidence[]): TrustEvidence[] {
  const byKey = new Map<string, TrustEvidence>();
  for (const entry of evidence) {
    const key = `${entry.code}:${entry.status}:${entry.message}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return [...byKey.values()];
}
