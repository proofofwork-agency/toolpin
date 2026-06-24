import { selectLaunchTarget } from "./config.js";
import { attestationBadge, deriveCapabilityManifest, hashToolDescriptions, readAttestations, readCapabilityManifest } from "./capabilities.js";
import { testServer } from "./tester.js";
import type { Attestation, CapabilityManifest, NormalizedServer, TrustIssue } from "./types.js";

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
  issues: TrustIssue[];
}

export async function verifyServer(server: NormalizedServer, options: VerificationOptions = {}): Promise<VerificationReport> {
  const issues: TrustIssue[] = [];
  const badges: string[] = [];
  const attestations = readAttestations(server);
  const declaredCapabilityManifest = readCapabilityManifest(server);
  const launch = selectLaunchTarget(server);
  const generatedAt = new Date().toISOString();
  let capabilityManifest = deriveCapabilityManifest(server, { generatedAt });

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
        capabilityManifest = deriveCapabilityManifest(server, { generatedAt, toolDescriptionHash });
        badges.push("tool-description-pinned");
      } else {
        issues.push({
          severity: "critical",
          code: "remote_probe_failed",
          message: `Remote capability verification failed: ${result.message}`,
        });
      }
    } else {
      issues.push({
        severity: "warning",
        code: "remote_probe_skipped",
        message: "Remote tool-description hashing was skipped; capability pin is metadata-only.",
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
    issues,
  };
}

function verifyPackagePins(pkg: { registryType: string; identifier: string; fileSha256?: string }, issues: TrustIssue[], badges: string[]): void {
  if (pkg.registryType === "oci") {
    if (pkg.identifier.includes("@sha256:")) {
      badges.push("digest-pinned");
    } else {
      issues.push({
        severity: "critical",
        code: "mutable_oci_tag",
        message: `OCI image ${pkg.identifier} is not pinned by digest.`,
      });
    }
  }

  if (pkg.registryType === "mcpb") {
    if (pkg.fileSha256) {
      badges.push("fileSha256");
    } else {
      issues.push({
        severity: "critical",
        code: "missing_mcpb_hash",
        message: "MCPB package is missing fileSha256.",
      });
    }
  }
}
