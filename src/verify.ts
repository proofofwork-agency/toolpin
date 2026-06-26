import { selectLaunchTarget } from "./config.js";
import { attestationBadge, deriveCapabilityManifest, hashToolDescriptions, hashToolManifests, readAttestations, readCapabilityManifest } from "./capabilities.js";
import { hasOciDigestMarker, hasValidOciDigestPin, isValidSha256Hex } from "./integrity.js";
import { scanFindingsToTrustIssues, scanServerMetadata, scanToolDescriptions } from "./scan.js";
import { testServer } from "./tester.js";
import { scoreServer } from "./trust.js";
import type { Attestation, CapabilityManifest, NormalizedServer, TrustEvidence, TrustIssue } from "./types.js";

export interface VerificationOptions {
  liveRemoteProbe?: boolean;
  timeoutMs?: number;
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
    verifyPackagePins(launch.pkg, issues, badges);
  } else {
    badges.push("remote-target");
    if (options.liveRemoteProbe !== false) {
      const result = await testServer(server, options.timeoutMs);
      if (result.ok) {
        const toolDescriptionHash = hashToolDescriptions(result.tools, generatedAt);
        const toolManifestHash = hashToolManifests(result.tools, generatedAt);
        const toolDescriptionScan = scanToolDescriptions(result.tools, { generatedAt });
        capabilityManifest = deriveCapabilityManifest(server, { generatedAt, toolDescriptionHash, toolDescriptionScan });
        capabilityManifest.toolManifestHash = toolManifestHash;
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
      } else {
        issues.push({
          severity: "critical",
          code: "remote_probe_failed",
          message: `Remote capability verification failed: ${result.message}`,
        });
        evidence.push({
          code: "tool_description_hash",
          status: "failed",
          message: `Remote tools/list descriptions were not hashed: ${result.message}`,
          required: true,
        });
      }
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

  const critical = issues.some((issue) => issue.severity === "critical");
  return {
    ok: !critical,
    serverName: server.name,
    serverVersion: server.version,
    capabilityManifest,
    attestations,
    badges: [...new Set(badges)],
    evidence: dedupeEvidence(evidence),
    issues,
  };
}

function verifyPackagePins(pkg: { registryType: string; identifier: string; fileSha256?: string }, issues: TrustIssue[], badges: string[]): void {
  if (pkg.registryType === "oci") {
    if (hasValidOciDigestPin(pkg.identifier)) {
      badges.push("digest-pinned");
    } else {
      const reason = hasOciDigestMarker(pkg.identifier) ? "does not contain a valid sha256 digest pin" : "is not pinned by digest";
      issues.push({
        severity: "critical",
        code: "mutable_oci_tag",
        message: `OCI image ${pkg.identifier} ${reason}.`,
      });
    }
  }

  if (pkg.registryType === "mcpb") {
    if (isValidSha256Hex(pkg.fileSha256)) {
      badges.push("fileSha256");
    } else {
      issues.push({
        severity: "critical",
        code: "missing_mcpb_hash",
        message: "MCPB package is missing a valid 64-character fileSha256.",
      });
    }
  }
}

function dedupeEvidence(evidence: TrustEvidence[]): TrustEvidence[] {
  const byKey = new Map<string, TrustEvidence>();
  for (const entry of evidence) {
    const key = `${entry.code}:${entry.status}:${entry.message}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return [...byKey.values()];
}
