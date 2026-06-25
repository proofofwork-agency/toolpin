export type RegistryTransportType = "stdio" | "streamable-http" | "sse" | string;

export interface RegistryTransport {
  type: RegistryTransportType;
  [key: string]: unknown;
}

export interface RegistryEnvironmentVariable {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
  [key: string]: unknown;
}

export interface RegistryRemoteHeader {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  [key: string]: unknown;
}

export interface RegistryPackage {
  registryType: string;
  identifier: string;
  version?: string;
  runtimeHint?: string;
  fileSha256?: string;
  transport?: RegistryTransport;
  environmentVariables?: RegistryEnvironmentVariable[];
  [key: string]: unknown;
}

export interface RegistryRemote {
  type: RegistryTransportType;
  url: string;
  headers?: RegistryRemoteHeader[];
  [key: string]: unknown;
}

export interface RegistryRepository {
  url: string;
  source?: string;
  [key: string]: unknown;
}

export interface RegistryServer {
  $schema?: string;
  name: string;
  title?: string;
  description?: string;
  version: string;
  packages?: RegistryPackage[];
  remotes?: RegistryRemote[];
  repository?: RegistryRepository;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RegistryEntry {
  server: RegistryServer;
  _meta?: Record<string, unknown>;
  source?: RegistrySourceId;
}

export interface RegistryListResponse {
  servers: RegistryEntry[];
  metadata?: {
    nextCursor?: string;
    count?: number;
    total?: number;
    [key: string]: unknown;
  };
}

export interface NormalizedServer {
  registrySource: RegistrySourceId;
  name: string;
  title: string;
  description: string;
  version: string;
  isLatest: boolean;
  repositoryUrl?: string;
  packageTypes: string[];
  remoteTypes: string[];
  transports: string[];
  requiresSecrets: boolean;
  raw: RegistryServer;
  registryMeta?: Record<string, unknown>;
}

export type RegistrySourceId = "official" | "docker" | "pulse" | "smithery" | "glama";

export interface RegistrySourceInfo {
  id: RegistrySourceId;
  label: string;
  trust: "canonical" | "curated" | "directory";
  enabled: boolean;
  authRequired: boolean;
  description: string;
}

export interface TrustIssue {
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
}

export interface TrustReport {
  score: number;
  badges: string[];
  issues: TrustIssue[];
}

export interface CapabilitySecret {
  name: string;
  source: "env" | "header";
  required: boolean;
}

export interface CapabilityManifest {
  version: 1;
  serverName: string;
  serverVersion: string;
  registrySource: RegistrySourceId;
  packageTypes: string[];
  transports: string[];
  remoteHosts: string[];
  secrets: CapabilitySecret[];
  generatedAt: string;
  toolDescriptionHash?: ToolDescriptionHash;
  toolDescriptionScan?: ToolDescriptionScan;
}

export interface ToolDescriptionHash {
  algorithm: "sha256";
  value: string;
  toolCount: number;
  generatedAt: string;
}

export interface ToolDescriptionScanFinding {
  severity: "info" | "warning";
  code: string;
  message: string;
  subject: string;
}

export interface ToolDescriptionScan {
  version: 1;
  generatedAt: string;
  scannedDescriptions: number;
  findings: ToolDescriptionScanFinding[];
}

export interface Attestation {
  type: "sigstore" | "provenance" | "sbom" | "capability" | string;
  predicateType?: string;
  issuer?: string;
  subject?: string;
  url?: string;
  digest?: string;
  verified?: boolean;
  [key: string]: unknown;
}

export interface SearchResult {
  server: NormalizedServer;
  trust: TrustReport;
  relevance: number;
}

export interface ClientConfig {
  client: string;
  serverName: string;
  config: unknown;
  notes: string[];
}
