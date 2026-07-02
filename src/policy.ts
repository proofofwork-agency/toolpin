import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "./canonicalJson.js";
import { isClientName, type ClientName } from "./config.js";
import { hasOciDigestMarker, hasValidOciDigestPin, isValidSha256Hex } from "./integrity.js";
import type { InstallPlan } from "./plan.js";
import { hasFreshTrustedArtifactEvidence, trustedArtifactEvidenceProblem, trustTier } from "./trust.js";
import type { RegistrySourceId, TrustTier } from "./types.js";
import { isRecord } from "./util.js";

export interface PolicyConfig {
  version?: 1;
  minTrustScore?: number;
  minTrustTier?: TrustTier;
  requireToolPinVerifiedEvidence?: boolean;
  allowedSources?: RegistrySourceId[];
  deniedSources?: RegistrySourceId[];
  allowedClients?: ClientName[];
  deniedClients?: ClientName[];
  deniedServers?: string[];
  deniedPackageTypes?: string[];
  deniedTransports?: string[];
  deniedRemoteHosts?: string[];
  denyRemoteEndpoints?: boolean;
  denyRequiredSecrets?: boolean;
  requireDigestPinnedOci?: boolean;
  requireMcpbSha256?: boolean;
}

export interface PolicyIssue {
  code: string;
  message: string;
}

export interface PolicyReport {
  ok: boolean;
  key: string;
  issues: PolicyIssue[];
  policy?: PolicyConfig;
}

const POLICY_KEYS = new Set([
  "version",
  "minTrustScore",
  "minTrustTier",
  "requireToolPinVerifiedEvidence",
  "allowedSources",
  "deniedSources",
  "allowedClients",
  "deniedClients",
  "deniedServers",
  "deniedPackageTypes",
  "deniedTransports",
  "deniedRemoteHosts",
  "denyRemoteEndpoints",
  "denyRequiredSecrets",
  "requireDigestPinnedOci",
  "requireMcpbSha256",
]);

export async function readPolicy(path = ".toolpin/policy.json"): Promise<PolicyConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsePolicy(parsed, path);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid policy JSON in ${path}: ${error.message}`);
    }
    throw error;
  }
}

export async function readPolicyDigest(path = ".toolpin/policy.json"): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid policy JSON in ${path}: ${error.message}`);
    }
    throw error;
  }
  const policy = parsePolicy(parsed, path);
  return `sha256-${createHash("sha256").update(canonicalJson(policy)).digest("base64")}`;
}

export async function enforcePolicy(plan: InstallPlan, path = ".toolpin/policy.json"): Promise<PolicyReport> {
  const policy = await readPolicy(path);
  return evaluatePolicy(plan, policy);
}

export function evaluatePolicy(plan: InstallPlan, policy?: PolicyConfig): PolicyReport {
  const key = `${plan.name}:${plan.client}`;
  if (!policy) return { ok: true, key, issues: [] };

  const issues: PolicyIssue[] = [];
  const source = plan.resolved?.source ?? plan.capabilityManifest?.registrySource;
  const packageTypes = plan.capabilityManifest?.packageTypes ?? selectedPackageTypes(plan);
  const transports = plan.capabilityManifest?.transports ?? selectedTransports(plan);
  const remoteHosts = plan.capabilityManifest?.remoteHosts ?? selectedRemoteHosts(plan);
  const requiredSecrets = plan.capabilityManifest?.secrets?.filter((secret) => secret.required) ?? [];

  if (typeof policy.minTrustScore === "number" && plan.trust.score < policy.minTrustScore) {
    issues.push({
      code: "trust_below_minimum",
      message: `${plan.name} trust score ${plan.trust.score} is below required minimum ${policy.minTrustScore}`,
    });
  }

  if (policy.minTrustTier && trustTierRank(trustTier(plan.trust)) < trustTierRank(policy.minTrustTier)) {
    issues.push({
      code: "trust_tier_below_minimum",
      message: `${plan.name} trust tier ${trustTier(plan.trust)} is below required minimum ${policy.minTrustTier}`,
    });
  }

  if (policy.requireToolPinVerifiedEvidence && !hasToolPinVerifiedEvidence(plan)) {
    issues.push({
      code: "toolpin_verified_evidence_required",
      message: `${plan.name} does not have fresh trusted artifact evidence verified by ToolPin (${plan.trust.verifiedProvenance === true ? trustedArtifactEvidenceProblem(plan.trust.evidence ?? []) : "missing verified provenance"})`,
    });
  }

  if (policy.allowedSources?.length && (!source || !policy.allowedSources.includes(source))) {
    issues.push({
      code: "source_not_allowed",
      message: `${plan.name} registry source ${source ?? "unknown"} is not in allowedSources`,
    });
  }

  if (policy.deniedSources?.length && source && policy.deniedSources.includes(source)) {
    issues.push({
      code: "source_denied",
      message: `${plan.name} registry source ${source} is denied`,
    });
  }

  if (policy.allowedClients?.length && !policy.allowedClients.includes(plan.client)) {
    issues.push({
      code: "client_not_allowed",
      message: `${plan.client} is not in allowedClients`,
    });
  }

  if (policy.deniedClients?.includes(plan.client)) {
    issues.push({
      code: "client_denied",
      message: `${plan.client} is denied`,
    });
  }

  if (policy.deniedServers?.includes(plan.name)) {
    issues.push({
      code: "server_denied",
      message: `${plan.name} is denied`,
    });
  }

  for (const packageType of packageTypes) {
    if (policy.deniedPackageTypes?.includes(packageType)) {
      issues.push({
        code: "package_type_denied",
        message: `${plan.name} uses denied package type ${packageType}`,
      });
    }
  }

  for (const transport of transports) {
    if (policy.deniedTransports?.includes(transport)) {
      issues.push({
        code: "transport_denied",
        message: `${plan.name} uses denied transport ${transport}`,
      });
    }
  }

  for (const host of remoteHosts) {
    if (policy.deniedRemoteHosts?.includes(host)) {
      issues.push({
        code: "remote_host_denied",
        message: `${plan.name} uses denied remote host ${host}`,
      });
    }
  }

  if (policy.denyRemoteEndpoints && remoteHosts.length > 0) {
    issues.push({
      code: "remote_endpoint_denied",
      message: `${plan.name} declares remote endpoint host(s): ${remoteHosts.join(", ")}`,
    });
  }

  if (policy.denyRequiredSecrets && requiredSecrets.length > 0) {
    issues.push({
      code: "required_secrets_denied",
      message: `${plan.name} requires secret input(s): ${requiredSecrets.map((secret) => `${secret.source}:${secret.name}`).join(", ")}`,
    });
  }

  if (policy.requireDigestPinnedOci && isSelectedPackage(plan, "oci")) {
    const target = selectedTarget(plan);
    const identifier = typeof target.identifier === "string" ? target.identifier : "";
    if (!hasValidOciDigestPin(identifier)) {
      const detail = hasOciDigestMarker(identifier) ? " with a valid sha256 digest" : " by digest";
      issues.push({
        code: "oci_digest_required",
        message: `${plan.name} OCI target must be pinned${detail}`,
      });
    }
  }

  if (policy.requireMcpbSha256 && isSelectedPackage(plan, "mcpb")) {
    const target = selectedTarget(plan);
    if (!isValidSha256Hex(target.fileSha256)) {
      issues.push({
        code: "mcpb_sha256_required",
        message: `${plan.name} MCPB target must declare a valid 64-character fileSha256`,
      });
    }
  }

  return { ok: issues.length === 0, key, issues, policy };
}

function parsePolicy(value: unknown, path: string): PolicyConfig {
  if (!isRecord(value)) throw new Error(`Invalid policy schema in ${path}: expected object`);
  for (const key of Object.keys(value)) {
    if (!POLICY_KEYS.has(key)) {
      throw new Error(`Invalid policy schema in ${path}: unknown policy key ${key}`);
    }
  }
  if (value.version !== undefined && value.version !== 1) throw new Error(`Invalid policy schema in ${path}: unsupported version`);
  if (value.minTrustScore !== undefined && (typeof value.minTrustScore !== "number" || value.minTrustScore < 0 || value.minTrustScore > 100)) {
    throw new Error(`Invalid policy schema in ${path}: minTrustScore must be 0-100`);
  }
  if (value.minTrustTier !== undefined && !isTrustTier(value.minTrustTier)) {
    throw new Error(`Invalid policy schema in ${path}: minTrustTier must be verified, conditional, unverified, or blocked`);
  }

  return {
    version: value.version,
    minTrustScore: value.minTrustScore,
    minTrustTier: value.minTrustTier,
    requireToolPinVerifiedEvidence: booleanValue(value.requireToolPinVerifiedEvidence, "requireToolPinVerifiedEvidence", path),
    allowedSources: sourceArray(value.allowedSources, "allowedSources", path),
    deniedSources: sourceArray(value.deniedSources, "deniedSources", path),
    allowedClients: clientArray(value.allowedClients, "allowedClients", path),
    deniedClients: clientArray(value.deniedClients, "deniedClients", path),
    deniedServers: stringArray(value.deniedServers, "deniedServers", path),
    deniedPackageTypes: stringArray(value.deniedPackageTypes, "deniedPackageTypes", path),
    deniedTransports: stringArray(value.deniedTransports, "deniedTransports", path),
    deniedRemoteHosts: stringArray(value.deniedRemoteHosts, "deniedRemoteHosts", path),
    denyRemoteEndpoints: booleanValue(value.denyRemoteEndpoints, "denyRemoteEndpoints", path),
    denyRequiredSecrets: booleanValue(value.denyRequiredSecrets, "denyRequiredSecrets", path),
    requireDigestPinnedOci: booleanValue(value.requireDigestPinnedOci, "requireDigestPinnedOci", path),
    requireMcpbSha256: booleanValue(value.requireMcpbSha256, "requireMcpbSha256", path),
  };
}

function selectedPackageTypes(plan: InstallPlan): string[] {
  const target = selectedTarget(plan);
  return target.kind === "package" && typeof target.registryType === "string" ? [target.registryType] : [];
}

function selectedTransports(plan: InstallPlan): string[] {
  const target = selectedTarget(plan);
  if (target.kind === "remote" && typeof target.type === "string") return [target.type];
  if (target.kind === "package" && typeof target.transport === "string") return [target.transport];
  return [];
}

function selectedRemoteHosts(plan: InstallPlan): string[] {
  const target = selectedTarget(plan);
  if (target.kind !== "remote" || typeof target.url !== "string") return [];
  try {
    return [new URL(target.url).host];
  } catch {
    return [];
  }
}

function isSelectedPackage(plan: InstallPlan, registryType: string): boolean {
  const target = selectedTarget(plan);
  return target.kind === "package" && target.registryType === registryType;
}

function hasToolPinVerifiedEvidence(plan: InstallPlan): boolean {
  return plan.trust.verifiedProvenance === true && hasFreshTrustedArtifactEvidence(plan.trust.evidence ?? []);
}

function trustTierRank(tier: TrustTier): number {
  return {
    blocked: 0,
    unverified: 1,
    conditional: 2,
    verified: 3,
  }[tier];
}

function isTrustTier(value: unknown): value is TrustTier {
  return value === "verified" || value === "conditional" || value === "unverified" || value === "blocked";
}

function selectedTarget(plan: InstallPlan): Record<string, unknown> {
  return isRecord(plan.selectedTarget) ? plan.selectedTarget : {};
}

function sourceArray(value: unknown, field: string, path: string): RegistrySourceId[] | undefined {
  const values = stringArray(value, field, path);
  if (values === undefined) return undefined;
  const normalized = values.map(normalizePolicySource);
  if (normalized.some((item) => item === undefined)) {
    throw new Error(`Invalid policy schema in ${path}: ${field} contains an unknown registry source`);
  }
  return normalized as RegistrySourceId[];
}

function normalizePolicySource(value: string): RegistrySourceId | undefined {
  if (value === "pulse") return "pulsemcp";
  if (["toolpin", "official", "docker", "pulsemcp", "smithery", "glama"].includes(value)) return value;
  return undefined;
}

function clientArray(value: unknown, field: string, path: string): ClientName[] | undefined {
  const values = stringArray(value, field, path);
  if (values?.some((item) => !isClientName(item))) {
    throw new Error(`Invalid policy schema in ${path}: ${field} contains an unknown client`);
  }
  return values as ClientName[] | undefined;
}

function stringArray(value: unknown, field: string, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Invalid policy schema in ${path}: ${field} must be an array of strings`);
  }
  return value;
}

function booleanValue(value: unknown, field: string, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`Invalid policy schema in ${path}: ${field} must be a boolean`);
  }
  return value;
}
