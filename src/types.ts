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
  packageArguments?: string[];
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
  registryMode: RegistrySourceMode;
  name: string;
  title: string;
  description: string;
  version: string;
  isLatest: boolean;
  installable: boolean;
  installableReason?: string;
  resolvedFromRegistry?: RegistrySourceId;
  resolutionNote?: string;
  repositoryUrl?: string;
  packageTypes: string[];
  remoteTypes: string[];
  transports: string[];
  requiresSecrets: boolean;
  raw: RegistryServer;
  registryMeta?: Record<string, unknown>;
}

export type RegistrySourceId = string;
export type RegistrySourceMode = "installable" | "discovery";
export type SourceKind = "toolpin" | "official" | "docker" | "glama" | "smithery" | "pulsemcp" | "custom";
export type SourceStatus = "ready" | "disabled" | "auth-missing" | "discovery-only" | "fetch-error" | "stale";
export type RegistrySourceType = SourceKind | "official-compatible" | "http-json" | "known";
export type RegistryAdapterKind = "official-compatible" | "http-json" | "glama" | "smithery" | "pulsemcp";

export interface RegistrySourceInfo {
  id: RegistrySourceId;
  label: string;
  type?: RegistrySourceType;
  adapter?: RegistryAdapterKind;
  mode: RegistrySourceMode;
  trust: "canonical" | "curated" | "directory" | "private";
  enabled: boolean;
  pinned?: boolean;
  authRequired: boolean;
  description: string;
  url?: string;
  status?: SourceStatus;
  setupHint?: string;
  cacheEntries?: number;
  cachePageInfo?: RegistryFetchPageInfo;
  /** Opt-in escape hatches for private/self-hosted registries (default: off). */
  allowHttp?: boolean;
  allowPrivateHosts?: boolean;
}

export interface RegistryFetchPageInfo {
  fetchedPages: number;
  maxPages: number;
  hasMore: boolean;
  nextCursor?: string;
  total?: number;
}

export interface RegistryFetchResult {
  source: RegistrySourceInfo;
  status: SourceStatus;
  entries: RegistryEntry[];
  pageInfo?: RegistryFetchPageInfo;
  accepted: number;
  skipped: number;
  malformed: number;
  failed: number;
  lastError?: string;
  fetchedAt: string;
}

export interface RegistryCachePartition {
  source: RegistrySourceInfo;
  status: SourceStatus;
  generatedAt: string;
  ttlMs?: number;
  bundledRegistryFingerprint?: string;
  entries: RegistryEntry[];
  pageInfo?: RegistryFetchPageInfo;
  accepted: number;
  skipped: number;
  malformed: number;
  failed: number;
  lastError?: string;
}

export interface RegistryCacheFileV2 {
  schema: "dev.toolpin.registry-cache.v2";
  generatedAt: string;
  ttlMs: number;
  sources: Record<string, RegistryCachePartition>;
}

export interface TrustIssue {
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
}

export type TrustTier = "verified" | "conditional" | "unverified" | "blocked";

export interface TrustGate {
  code: string;
  message: string;
  tier: "unverified" | "blocked";
}

export type TrustEvidenceStatus = "passed" | "declared" | "failed" | "unavailable";

export interface TrustEvidence {
  code: string;
  status: TrustEvidenceStatus;
  message: string;
  source?: string;
  claim?: string;
  verificationMethod?: string;
  verifiedByToolPin?: boolean;
  trustedAnchor?: boolean;
  trustAnchor?: string;
  verifiedAt?: string;
  failureReason?: string;
  required?: boolean;
}

export interface TrustReport {
  score: number;
  overallScore?: number;
  metadataCompleteness?: number;
  tier?: TrustTier;
  capReason?: string;
  verifiedProvenance?: boolean;
  vetoes?: TrustGate[];
  gates?: TrustGate[];
  pillars?: {
    provenance: number;
    integrity: number;
    reputation: number;
    metadataCompleteness: number;
  };
  gatedBy?: string[];
  evidence?: TrustEvidence[];
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
  toolManifestHash?: ToolManifestHash;
  toolDescriptionScan?: ToolDescriptionScan;
}

export interface ToolDescriptionHash {
  algorithm: "sha256";
  value: string;
  toolCount: number;
  generatedAt: string;
}

export interface ToolManifestHash {
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
