import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import type { Attestation, CapabilityManifest, CapabilitySecret, NormalizedServer, ToolDescriptionHash, ToolDescriptionScan, ToolManifestHash } from "./types.js";

export interface ToolDescriptionInput {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const TOOLPIN_CAPABILITIES_META = "dev.toolpin/capabilities";
const TOOLPIN_ATTESTATIONS_META = "dev.toolpin/attestations";

export function deriveCapabilityManifest(
  server: NormalizedServer,
  options: { toolDescriptionHash?: ToolDescriptionHash; toolDescriptionScan?: ToolDescriptionScan; generatedAt?: string } = {},
): CapabilityManifest {
  const toolManifestHash = options.toolDescriptionHash
    ? {
        algorithm: options.toolDescriptionHash.algorithm,
        value: options.toolDescriptionHash.value,
        toolCount: options.toolDescriptionHash.toolCount,
        generatedAt: options.toolDescriptionHash.generatedAt,
      }
    : undefined;
  return {
    version: 1,
    serverName: server.name,
    serverVersion: server.version,
    registrySource: server.registrySource,
    packageTypes: [...new Set(server.packageTypes)].sort(),
    transports: [...new Set(server.transports)].sort(),
    remoteHosts: remoteHosts(server).sort(),
    secrets: capabilitySecrets(server).sort((left, right) => `${left.source}:${left.name}`.localeCompare(`${right.source}:${right.name}`)),
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    toolDescriptionHash: options.toolDescriptionHash,
    toolManifestHash,
    toolDescriptionScan: options.toolDescriptionScan,
  };
}

export function hashToolDescriptions(tools: ToolDescriptionInput[], generatedAt = new Date().toISOString()): ToolDescriptionHash {
  const normalized = tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const value = createHash("sha256").update(canonicalJson(normalized)).digest("hex");
  return {
    algorithm: "sha256",
    value,
    toolCount: normalized.length,
    generatedAt,
  };
}

export function hashToolManifests(tools: ToolDescriptionInput[], generatedAt = new Date().toISOString()): ToolManifestHash {
  const normalized = tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? {},
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const value = createHash("sha256").update(canonicalJson(normalized)).digest("hex");
  return {
    algorithm: "sha256",
    value,
    toolCount: normalized.length,
    generatedAt,
  };
}

export function readCapabilityManifest(server: NormalizedServer): CapabilityManifest | undefined {
  const value = server.raw._meta?.[TOOLPIN_CAPABILITIES_META] ?? server.registryMeta?.[TOOLPIN_CAPABILITIES_META];
  return isCapabilityManifest(value) ? value : undefined;
}

export function readAttestations(server: NormalizedServer): Attestation[] {
  const value = server.raw._meta?.[TOOLPIN_ATTESTATIONS_META] ?? server.registryMeta?.[TOOLPIN_ATTESTATIONS_META];
  return Array.isArray(value) ? value.filter(isAttestation) : [];
}

export function attestationBadge(attestation: Attestation): string {
  return `${attestation.type}-declared`;
}

function remoteHosts(server: NormalizedServer): string[] {
  const hosts: string[] = [];
  for (const remote of server.raw.remotes ?? []) {
    try {
      hosts.push(new URL(remote.url).host);
    } catch {
      // Invalid URLs are reported by trust/verification; they cannot produce an egress host.
    }
  }
  return [...new Set(hosts)];
}

function capabilitySecrets(server: NormalizedServer): CapabilitySecret[] {
  const secrets: CapabilitySecret[] = [];
  for (const pkg of server.raw.packages ?? []) {
    for (const variable of pkg.environmentVariables ?? []) {
      if (variable.isSecret || variable.isRequired) {
        secrets.push({
          name: variable.name,
          source: "env",
          required: variable.isRequired === true,
        });
      }
    }
  }
  for (const remote of server.raw.remotes ?? []) {
    for (const header of remote.headers ?? []) {
      if (header.isSecret || header.isRequired) {
        secrets.push({
          name: header.name,
          source: "header",
          required: header.isRequired === true,
        });
      }
    }
  }
  return secrets;
}

export function isCapabilityManifest(value: unknown): value is CapabilityManifest {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    typeof value.serverName === "string" &&
    typeof value.serverVersion === "string" &&
    typeof value.registrySource === "string" &&
    Array.isArray(value.packageTypes) &&
    Array.isArray(value.transports) &&
    Array.isArray(value.remoteHosts) &&
    Array.isArray(value.secrets) &&
    typeof value.generatedAt === "string" &&
    (value.toolManifestHash === undefined || isToolManifestHash(value.toolManifestHash)) &&
    (value.toolDescriptionScan === undefined || isToolDescriptionScan(value.toolDescriptionScan))
  );
}

function isToolManifestHash(value: unknown): value is ToolManifestHash {
  return (
    isRecord(value) &&
    value.algorithm === "sha256" &&
    typeof value.value === "string" &&
    typeof value.toolCount === "number" &&
    typeof value.generatedAt === "string"
  );
}

function isToolDescriptionScan(value: unknown): value is ToolDescriptionScan {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.generatedAt === "string" &&
    typeof value.scannedDescriptions === "number" &&
    Array.isArray(value.findings)
  );
}

function isAttestation(value: unknown): value is Attestation {
  return isRecord(value) && typeof value.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
