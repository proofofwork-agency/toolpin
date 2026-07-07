import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { deriveCapabilityManifest, isCapabilityManifest } from "./capabilities.js";
import { canonicalJson } from "./canonicalJson.js";
import { DEFAULT_LOCKFILE_PATH } from "./constants.js";
import { exportClientConfig, isClientName, selectLaunchTarget, type ClientName } from "./config.js";
import type { InstallScope } from "./install.js";
import { regateTrustReport, scoreServer, trustTier } from "./trust.js";
import type { VerificationReport } from "./verify.js";
import type { CapabilityManifest, NormalizedServer, TrustEvidence, TrustIssue, TrustReport, TrustTier } from "./types.js";
import { dedupeTrustEvidence, isRecord } from "./util.js";

export const LOCKFILE_VERSION = 2;

export interface InstallPlan {
  name: string;
  version: string;
  client: ClientName;
  scope?: InstallScope;
  selectedTarget: unknown;
  trust: ReturnType<typeof scoreServer>;
  config: unknown;
  notes: string[];
  capabilityManifest?: CapabilityManifest;
  resolvedAt: string;
  lockedAt?: string;
  resolved?: {
    source: NormalizedServer["registrySource"];
    name: string;
    version: string;
  };
  original?: {
    name: string;
    version: string;
    client: ClientName;
  };
  locked?: {
    selectedTarget: unknown;
    config: unknown;
    capabilityManifest?: CapabilityManifest;
  };
  integrity?: string;
}

export interface Lockfile {
  lockfileVersion: 2;
  generatedAt: string;
  updatedAt?: string;
  servers: Record<string, InstallPlan>;
}

export interface LockVerification {
  ok: boolean;
  key: string;
  messages: string[];
  locked?: InstallPlan;
}

export function buildInstallPlan(server: NormalizedServer, client: ClientName, options: { capabilityManifest?: CapabilityManifest; scope?: InstallScope; verificationReport?: VerificationReport } = {}): InstallPlan {
  if (server.installable === false) {
    throw new Error(`Cannot install ${server.name}@${server.version}: ${server.installableReason ?? "registry entry is discovery-only"}.`);
  }
  const selected = selectLaunchTarget(server);
  if (!selected) {
    throw new Error(`No install target is available for ${server.name}@${server.version}`);
  }

  const exported = exportClientConfig(server, client);
  const target =
    selected.kind === "remote"
      ? {
          kind: "remote",
          type: selected.remote.type,
          url: selected.remote.url,
        }
      : {
          kind: "package",
          registryType: selected.pkg.registryType,
          identifier: selected.pkg.identifier,
          version: selected.pkg.version,
          fileSha256: selected.pkg.fileSha256,
          transport: selected.pkg.transport?.type,
        };

  const resolvedAt = new Date().toISOString();
  const capabilityManifest = options.capabilityManifest ?? deriveCapabilityManifest(server, { generatedAt: resolvedAt });
  const trust = options.verificationReport ? mergeVerificationTrust(scoreServer(server), options.verificationReport) : scoreServer(server);
  const plan: InstallPlan = {
    name: server.name,
    version: server.version,
    client,
    scope: options.scope ?? "project",
    selectedTarget: target,
    trust,
    config: exported.config,
    notes: exported.notes,
    capabilityManifest,
    resolvedAt,
    lockedAt: resolvedAt,
    resolved: {
      source: server.registrySource,
      name: server.name,
      version: server.version,
    },
    original: {
      name: server.name,
      version: server.version,
      client,
    },
    locked: {
      selectedTarget: target,
      config: exported.config,
      capabilityManifest,
    },
  };
  return { ...plan, integrity: computePlanIntegrity(plan) };
}

function mergeVerificationTrust(base: TrustReport, report: VerificationReport): TrustReport {
  const evidence = dedupeTrustEvidence([...(base.evidence ?? []), ...report.evidence]);
  const issues = dedupeTrustIssues([...base.issues, ...report.issues]);
  const badges = [...new Set([...base.badges, ...report.badges])];
  return regateTrustReport({
    ...base,
    evidence,
    issues,
    badges,
    verifiedProvenance: report.verifiedProvenance === true,
  });
}

function dedupeTrustIssues(issues: TrustIssue[]): TrustIssue[] {
  const byKey = new Map<string, TrustIssue>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}:${issue.message}`;
    if (!byKey.has(key)) byKey.set(key, issue);
  }
  return [...byKey.values()];
}

export async function writeLockfile(plan: InstallPlan, path = DEFAULT_LOCKFILE_PATH, key = lockKey(plan.name, plan.client)): Promise<Lockfile> {
  const existing = await readExistingLockfile(path);
  const now = new Date().toISOString();
  const entry = finalizeLockEntry(plan, now);
  const next: Lockfile = {
    lockfileVersion: LOCKFILE_VERSION,
    generatedAt: existing.generatedAt === new Date(0).toISOString() ? now : existing.generatedAt,
    updatedAt: now,
    servers: {
      ...existing.servers,
      [key]: entry,
    },
  };

  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function removeLockfileEntry(serverName: string, client: ClientName, path = DEFAULT_LOCKFILE_PATH): Promise<{ removed: boolean; key: string; lockfile: Lockfile }> {
  const existed = await fileExists(path);
  const existing = await readExistingLockfile(path);
  const nextServers = { ...existing.servers };
  const key = lockKey(serverName, client);
  let removed = false;

  for (const candidate of [key, serverName]) {
    const entry = nextServers[candidate];
    if (entry?.name === serverName && entry.client === client) {
      delete nextServers[candidate];
      removed = true;
    }
  }

  if (!removed && !existed) {
    return { removed, key, lockfile: existing };
  }

  const now = new Date().toISOString();
  const next: Lockfile = {
    lockfileVersion: LOCKFILE_VERSION,
    generatedAt: existing.generatedAt === new Date(0).toISOString() ? now : existing.generatedAt,
    updatedAt: now,
    servers: nextServers,
  };

  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { removed, key, lockfile: next };
}

export async function readLockfile(path = DEFAULT_LOCKFILE_PATH): Promise<Lockfile> {
  return readExistingLockfile(path);
}

export async function readLockfileDigest(path = DEFAULT_LOCKFILE_PATH): Promise<string> {
  return computeLockfileDigest(await readExistingLockfile(path));
}

export function computeLockfileDigest(lockfile: Lockfile): string {
  return `sha256-${createHash("sha256").update(stableJson(lockfileDigestPayload(lockfile))).digest("base64")}`;
}

export async function verifyAgainstLockfile(plan: InstallPlan, path = DEFAULT_LOCKFILE_PATH): Promise<LockVerification> {
  const lockfile = await readExistingLockfile(path);
  const key = lockKey(plan.name, plan.client);
  const locked = lockfile.servers[key] ?? lockfile.servers[plan.name];
  if (!locked) {
    return { ok: true, key, messages: [] };
  }

  const messages = diffInstallPlans(locked, plan);
  return { ok: messages.length === 0, key, messages, locked };
}

export function lockKey(serverName: string, client: ClientName): string {
  return `${serverName}:${client}`;
}

async function readExistingLockfile(path: string): Promise<Lockfile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const lockfile = parseLockfile(parsed);
    if (lockfile) return lockfile;
    throw new Error(`Invalid lockfile schema in ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyLockfile();
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid lockfile JSON in ${path}: ${error.message}`);
    }
    throw error;
  }
}

function emptyLockfile(): Lockfile {
  return {
    lockfileVersion: LOCKFILE_VERSION,
    generatedAt: new Date(0).toISOString(),
    servers: {},
  };
}

function parseLockfile(value: unknown): Lockfile | undefined {
  if (!isRecord(value)) return undefined;
  if (value.lockfileVersion === 1) {
    throw new Error("Unsupported lockfileVersion 1 in v0.1; regenerate the lockfile with the current ToolPin release.");
  }
  if (value.lockfileVersion !== LOCKFILE_VERSION) return undefined;
  if (typeof value.generatedAt !== "string") return undefined;
  if (!isRecord(value.servers)) return undefined;

  const servers: Record<string, InstallPlan> = {};
  for (const [key, entry] of Object.entries(value.servers)) {
    servers[key] = parseInstallPlan(entry, key);
  }

  return {
    lockfileVersion: value.lockfileVersion,
    generatedAt: value.generatedAt,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    servers,
  };
}

function parseInstallPlan(value: unknown, key: string): InstallPlan {
  if (!isRecord(value)) throw new Error(`Invalid lockfile entry ${key}: expected object`);
  if (typeof value.name !== "string") throw new Error(`Invalid lockfile entry ${key}: missing name`);
  if (typeof value.version !== "string") throw new Error(`Invalid lockfile entry ${key}: missing version`);
  if (!isClientName(value.client)) throw new Error(`Invalid lockfile entry ${key}: invalid client`);
  if (!isRecord(value.selectedTarget)) throw new Error(`Invalid lockfile entry ${key}: invalid selectedTarget`);
  const trust = parseTrust(value.trust, key);
  if (!Array.isArray(value.notes)) throw new Error(`Invalid lockfile entry ${key}: invalid notes`);
  if (value.capabilityManifest !== undefined && !isCapabilityManifest(value.capabilityManifest)) throw new Error(`Invalid lockfile entry ${key}: invalid capabilityManifest`);
  if (value.integrity !== undefined && typeof value.integrity !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid integrity`);
  return {
    name: value.name,
    version: value.version,
    client: value.client,
    scope: parseScope(value.scope, key),
    selectedTarget: value.selectedTarget,
    trust,
    config: value.config,
    notes: value.notes.filter((note): note is string => typeof note === "string"),
    capabilityManifest: value.capabilityManifest,
    resolvedAt: typeof value.resolvedAt === "string" ? value.resolvedAt : new Date(0).toISOString(),
    lockedAt: typeof value.lockedAt === "string" ? value.lockedAt : undefined,
    resolved: parseResolved(value.resolved),
    original: parseOriginal(value.original),
    locked: parseLocked(value.locked),
    integrity: value.integrity,
  };
}

function parseTrust(value: unknown, key: string): TrustReport {
  if (!isRecord(value)) throw new Error(`Invalid lockfile entry ${key}: invalid trust`);
  if (typeof value.score !== "number" || !Number.isFinite(value.score)) throw new Error(`Invalid lockfile entry ${key}: invalid trust.score`);
  if (value.tier !== undefined && !isTrustTier(value.tier)) throw new Error(`Invalid lockfile entry ${key}: invalid trust.tier`);
  if (value.gatedBy !== undefined && (!Array.isArray(value.gatedBy) || !value.gatedBy.every((code) => typeof code === "string"))) throw new Error(`Invalid lockfile entry ${key}: invalid trust.gatedBy`);
  if (value.evidence !== undefined && !Array.isArray(value.evidence)) throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence`);
  if (!Array.isArray(value.badges) || !value.badges.every((badge) => typeof badge === "string")) throw new Error(`Invalid lockfile entry ${key}: invalid trust.badges`);
  if (!Array.isArray(value.issues)) throw new Error(`Invalid lockfile entry ${key}: invalid trust.issues`);
  if (value.overallScore !== undefined && (typeof value.overallScore !== "number" || !Number.isFinite(value.overallScore))) throw new Error(`Invalid lockfile entry ${key}: invalid trust.overallScore`);
  if (value.metadataCompleteness !== undefined && (typeof value.metadataCompleteness !== "number" || !Number.isFinite(value.metadataCompleteness))) throw new Error(`Invalid lockfile entry ${key}: invalid trust.metadataCompleteness`);
  if (value.capReason !== undefined && typeof value.capReason !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid trust.capReason`);
  if (value.verifiedProvenance !== undefined && typeof value.verifiedProvenance !== "boolean") throw new Error(`Invalid lockfile entry ${key}: invalid trust.verifiedProvenance`);
  if (value.gates !== undefined && (!Array.isArray(value.gates) || !value.gates.every(isTrustGate))) throw new Error(`Invalid lockfile entry ${key}: invalid trust.gates`);
  if (value.vetoes !== undefined && (!Array.isArray(value.vetoes) || !value.vetoes.every(isTrustGate))) throw new Error(`Invalid lockfile entry ${key}: invalid trust.vetoes`);
  if (value.pillars !== undefined && !isTrustPillars(value.pillars)) throw new Error(`Invalid lockfile entry ${key}: invalid trust.pillars`);

  const trust: TrustReport = {
    score: value.score,
    ...(typeof value.overallScore === "number" ? { overallScore: value.overallScore } : {}),
    ...(typeof value.metadataCompleteness === "number" ? { metadataCompleteness: value.metadataCompleteness } : {}),
    ...(value.tier ? { tier: value.tier } : {}),
    ...(typeof value.capReason === "string" ? { capReason: value.capReason } : {}),
    ...(typeof value.verifiedProvenance === "boolean" ? { verifiedProvenance: value.verifiedProvenance } : {}),
    ...(Array.isArray(value.gates) ? { gates: value.gates } : {}),
    ...(Array.isArray(value.vetoes) ? { vetoes: value.vetoes } : {}),
    ...(isTrustPillars(value.pillars) ? { pillars: value.pillars } : {}),
    ...(Array.isArray(value.gatedBy) ? { gatedBy: value.gatedBy } : {}),
    ...(Array.isArray(value.evidence) ? { evidence: value.evidence.map((entry, index) => parseTrustEvidence(entry, key, index)) } : {}),
    badges: value.badges,
    issues: value.issues.map((issue, index) => parseTrustIssue(issue, key, index)),
  };
  return trust;
}

function isTrustTier(value: unknown): value is TrustTier {
  return value === "verified" || value === "conditional" || value === "unverified" || value === "blocked";
}

function parseTrustIssue(value: unknown, key: string, index: number): TrustIssue {
  if (!isRecord(value)) throw new Error(`Invalid lockfile entry ${key}: invalid trust.issues[${index}]`);
  const severity = value.severity;
  if (severity !== "info" && severity !== "warning" && severity !== "critical") throw new Error(`Invalid lockfile entry ${key}: invalid trust.issues[${index}].severity`);
  if (typeof value.code !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid trust.issues[${index}].code`);
  if (typeof value.message !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid trust.issues[${index}].message`);
  return {
    severity,
    code: value.code,
    message: value.message,
  };
}

function isTrustGate(value: unknown): value is NonNullable<TrustReport["gates"]>[number] {
  if (!isRecord(value)) return false;
  return typeof value.code === "string"
    && typeof value.message === "string"
    && (value.tier === "unverified" || value.tier === "blocked");
}

function isTrustPillars(value: unknown): value is NonNullable<TrustReport["pillars"]> {
  if (!isRecord(value)) return false;
  return typeof value.provenance === "number" && Number.isFinite(value.provenance)
    && typeof value.integrity === "number" && Number.isFinite(value.integrity)
    && typeof value.reputation === "number" && Number.isFinite(value.reputation)
    && typeof value.metadataCompleteness === "number" && Number.isFinite(value.metadataCompleteness);
}

function parseTrustEvidence(value: unknown, key: string, index: number): TrustEvidence {
  if (!isRecord(value)) throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}]`);
  const status = value.status;
  if (status !== "passed" && status !== "declared" && status !== "failed" && status !== "unavailable") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].status`);
  if (typeof value.code !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].code`);
  if (typeof value.message !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].message`);
  if (value.required !== undefined && typeof value.required !== "boolean") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].required`);
  if (value.source !== undefined && typeof value.source !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].source`);
  if (value.claim !== undefined && typeof value.claim !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].claim`);
  if (value.verificationMethod !== undefined && typeof value.verificationMethod !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].verificationMethod`);
  if (value.verifiedByToolPin !== undefined && typeof value.verifiedByToolPin !== "boolean") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].verifiedByToolPin`);
  if (value.trustedAnchor !== undefined && typeof value.trustedAnchor !== "boolean") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].trustedAnchor`);
  if (value.trustAnchor !== undefined && typeof value.trustAnchor !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].trustAnchor`);
  if (value.verifiedAt !== undefined && typeof value.verifiedAt !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].verifiedAt`);
  if (value.failureReason !== undefined && typeof value.failureReason !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid trust.evidence[${index}].failureReason`);
  return {
    code: value.code,
    status,
    message: value.message,
    ...(typeof value.source === "string" ? { source: value.source } : {}),
    ...(typeof value.claim === "string" ? { claim: value.claim } : {}),
    ...(typeof value.verificationMethod === "string" ? { verificationMethod: value.verificationMethod } : {}),
    ...(typeof value.verifiedByToolPin === "boolean" ? { verifiedByToolPin: value.verifiedByToolPin } : {}),
    ...(typeof value.trustedAnchor === "boolean" ? { trustedAnchor: value.trustedAnchor } : {}),
    ...(typeof value.trustAnchor === "string" ? { trustAnchor: value.trustAnchor } : {}),
    ...(typeof value.verifiedAt === "string" ? { verifiedAt: value.verifiedAt } : {}),
    ...(typeof value.failureReason === "string" ? { failureReason: value.failureReason } : {}),
    ...(typeof value.required === "boolean" ? { required: value.required } : {}),
  };
}

function diffInstallPlans(locked: InstallPlan, current: InstallPlan): string[] {
  const messages: string[] = [];
  if (!locked.integrity) messages.push("lock integrity is missing");
  if (locked.integrity && computePlanIntegrity(locked) !== locked.integrity) messages.push("locked entry integrity does not match its contents");
  if (locked.version !== current.version) messages.push(`version changed ${locked.version} -> ${current.version}`);
  if ((locked.scope ?? "project") !== (current.scope ?? "project")) messages.push(`scope changed ${locked.scope ?? "project"} -> ${current.scope ?? "project"}`);
  if (stableJson(locked.selectedTarget) !== stableJson(current.selectedTarget)) messages.push("selected install target changed");
  if (locked.trust.score > current.trust.score) messages.push(`trust score decreased ${locked.trust.score} -> ${current.trust.score}`);
  if (isTrustTierDowngrade(trustTier(locked.trust), trustTier(current.trust))) messages.push(`trust tier decreased ${trustTier(locked.trust)} -> ${trustTier(current.trust)}`);
  if (stableJson(locked.config) !== stableJson(current.config)) messages.push("client config changed");
  if (stableJson(normalizeCapabilityManifestBase(locked.capabilityManifest)) !== stableJson(normalizeCapabilityManifestBase(current.capabilityManifest))) messages.push("capability manifest changed");
  const surfaceComparison = compareToolSurfaceHash(locked.capabilityManifest, current.capabilityManifest);
  if (surfaceComparison) messages.push(surfaceComparison);
  const useLegacySurfacePins = !hasToolSurfaceHash(locked.capabilityManifest);
  if (useLegacySurfacePins && hasToolDescriptionHash(locked.capabilityManifest) && hasToolDescriptionHash(current.capabilityManifest)) {
    if (stableJson(normalizeToolDescriptionHash(locked.capabilityManifest.toolDescriptionHash)) !== stableJson(normalizeToolDescriptionHash(current.capabilityManifest.toolDescriptionHash))) {
      messages.push("tool-description hash changed");
    }
  } else if (useLegacySurfacePins && hasToolDescriptionHash(locked.capabilityManifest) && !hasToolDescriptionHash(current.capabilityManifest)) {
    messages.push("tool-description hash pin could not be refreshed");
  }
  if (useLegacySurfacePins && hasToolManifestHash(locked.capabilityManifest) && hasToolManifestHash(current.capabilityManifest)) {
    if (stableJson(normalizeToolManifestHash(locked.capabilityManifest.toolManifestHash)) !== stableJson(normalizeToolManifestHash(current.capabilityManifest.toolManifestHash))) {
      messages.push("tool-manifest hash changed");
    }
  } else if (useLegacySurfacePins && hasToolManifestHash(locked.capabilityManifest) && !hasToolManifestHash(current.capabilityManifest)) {
    messages.push("tool-manifest hash pin could not be refreshed");
  }
  return messages;
}

function isTrustTierDowngrade(locked: TrustTier, current: TrustTier): boolean {
  const rank: Record<TrustTier, number> = {
    verified: 3,
    conditional: 2,
    unverified: 1,
    blocked: 0,
  };
  return rank[current] < rank[locked];
}

export function computePlanIntegrity(plan: InstallPlan): string {
  return `sha256-${createHash("sha256").update(stableJson(integrityPayload(plan))).digest("base64")}`;
}

function finalizeLockEntry(plan: InstallPlan, lockedAt: string): InstallPlan {
  const trust = withLockIntegrityEvidence(plan.trust);
  const next: InstallPlan = {
    ...plan,
    scope: plan.scope ?? "project",
    trust,
    resolvedAt: plan.resolvedAt ?? lockedAt,
    lockedAt,
    resolved: plan.resolved ?? {
      source: plan.capabilityManifest?.registrySource ?? "official",
      name: plan.name,
      version: plan.version,
    },
    original: plan.original ?? {
      name: plan.name,
      version: plan.version,
      client: plan.client,
    },
    locked: plan.locked ?? {
      selectedTarget: plan.selectedTarget,
      config: plan.config,
      capabilityManifest: plan.capabilityManifest,
    },
  };
  return { ...next, integrity: computePlanIntegrity(next) };
}

function withLockIntegrityEvidence(report: TrustReport): TrustReport {
  const evidence: TrustEvidence[] = [
    ...(report.evidence ?? []),
    {
      code: "lock_integrity",
      status: "passed",
      message: "Lock entry integrity digest is computed over the reviewed install plan.",
      source: "local-lockfile",
      claim: "install plan integrity",
      verificationMethod: "canonical-json-sha256",
      verifiedByToolPin: true,
    },
  ];
  const uniqueEvidence = dedupeTrustEvidence(evidence);
  return regateTrustReport({
    ...report,
    evidence: uniqueEvidence,
  });
}

function integrityPayload(plan: InstallPlan): unknown {
  return {
    name: plan.name,
    version: plan.version,
    client: plan.client,
    scope: plan.scope ?? "project",
    selectedTarget: plan.selectedTarget,
    trust: plan.trust,
    config: plan.config,
    notes: plan.notes,
    capabilityManifest: normalizeCapabilityManifest(plan.capabilityManifest),
    resolvedAt: plan.resolvedAt,
    lockedAt: plan.lockedAt,
    resolved: plan.resolved,
    original: plan.original,
    locked: {
      selectedTarget: plan.locked?.selectedTarget,
      config: plan.locked?.config,
      capabilityManifest: normalizeCapabilityManifest(plan.locked?.capabilityManifest),
    },
  };
}

function lockfileDigestPayload(lockfile: Lockfile): unknown {
  return {
    lockfileVersion: lockfile.lockfileVersion,
    servers: Object.fromEntries(
      Object.entries(lockfile.servers).map(([key, plan]) => [
        key,
        integrityPayload(plan),
      ]),
    ),
  };
}

function normalizeCapabilityManifest(manifest?: CapabilityManifest): unknown {
  const base = normalizeCapabilityManifestBase(manifest);
  if (!base || (!manifest?.toolDescriptionHash && !manifest?.toolSurfaceHash && !manifest?.toolManifestHash)) return base;
  const output = {
    ...base,
    ...(manifest.toolDescriptionHash ? { toolDescriptionHash: normalizeToolDescriptionHash(manifest.toolDescriptionHash) } : {}),
    ...(manifest.toolSurfaceHash ? { toolSurfaceHash: normalizeToolSurfaceHash(manifest.toolSurfaceHash) } : {}),
    ...(manifest.toolManifestHash ? { toolManifestHash: normalizeToolManifestHash(manifest.toolManifestHash) } : {}),
  };
  return output;
}

function normalizeCapabilityManifestBase(manifest?: CapabilityManifest): Record<string, unknown> | undefined {
  if (!manifest) return undefined;
  return {
    version: manifest.version,
    serverName: manifest.serverName,
    serverVersion: manifest.serverVersion,
    registrySource: manifest.registrySource,
    packageTypes: manifest.packageTypes,
    transports: manifest.transports,
    remoteHosts: manifest.remoteHosts,
    secrets: manifest.secrets,
  };
}

function hasToolDescriptionHash(manifest?: CapabilityManifest): manifest is CapabilityManifest & { toolDescriptionHash: NonNullable<CapabilityManifest["toolDescriptionHash"]> } {
  return Boolean(manifest?.toolDescriptionHash);
}

function hasToolManifestHash(manifest?: CapabilityManifest): manifest is CapabilityManifest & { toolManifestHash: NonNullable<CapabilityManifest["toolManifestHash"]> } {
  return Boolean(manifest?.toolManifestHash);
}

function hasToolSurfaceHash(manifest?: CapabilityManifest): manifest is CapabilityManifest & { toolSurfaceHash: NonNullable<CapabilityManifest["toolSurfaceHash"]> } {
  return Boolean(manifest?.toolSurfaceHash);
}

function normalizeToolDescriptionHash(hash: NonNullable<CapabilityManifest["toolDescriptionHash"]>): unknown {
  return {
    algorithm: hash.algorithm,
    value: hash.value,
    toolCount: hash.toolCount,
  };
}

function normalizeToolSurfaceHash(hash: NonNullable<CapabilityManifest["toolSurfaceHash"]>): unknown {
  return {
    algorithm: hash.algorithm,
    coverage: hash.coverage,
    value: hash.value,
    toolCount: hash.toolCount,
  };
}

function normalizeToolManifestHash(hash: NonNullable<CapabilityManifest["toolManifestHash"]>): unknown {
  return {
    algorithm: hash.algorithm,
    value: hash.value,
    toolCount: hash.toolCount,
  };
}

function compareToolSurfaceHash(locked?: CapabilityManifest, current?: CapabilityManifest): string | undefined {
  if (!hasToolSurfaceHash(locked)) return undefined;
  if (!hasToolSurfaceHash(current)) return "tool surface hash pin could not be refreshed";
  if (sameCoverage(locked.toolSurfaceHash.coverage, current.toolSurfaceHash.coverage)) {
    return stableJson(normalizeToolSurfaceHash(locked.toolSurfaceHash)) === stableJson(normalizeToolSurfaceHash(current.toolSurfaceHash))
      ? undefined
      : "tool input schemas changed";
  }
  if (isCoverageDowngrade(locked.toolSurfaceHash.coverage, current.toolSurfaceHash.coverage)) {
    return "tool surface coverage downgraded";
  }
  return undefined;
}

function sameCoverage(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function isCoverageDowngrade(locked: string[], current: string[]): boolean {
  const lockedFields = new Set(locked);
  const currentFields = new Set(current);
  return current.every((field) => lockedFields.has(field)) && locked.some((field) => !currentFields.has(field));
}

function stableJson(value: unknown): string {
  return canonicalJson(value);
}

function parseResolved(value: unknown): InstallPlan["resolved"] {
  if (!isRecord(value)) return undefined;
  if (typeof value.source !== "string" || typeof value.name !== "string" || typeof value.version !== "string") return undefined;
  return {
    source: value.source as NormalizedServer["registrySource"],
    name: value.name,
    version: value.version,
  };
}

function parseOriginal(value: unknown): InstallPlan["original"] {
  if (!isRecord(value)) return undefined;
  if (typeof value.name !== "string" || typeof value.version !== "string" || !isClientName(value.client)) return undefined;
  return {
    name: value.name,
    version: value.version,
    client: value.client,
  };
}

function parseScope(value: unknown, key: string): InstallScope | undefined {
  if (value === undefined) return undefined;
  if (value === "project" || value === "global") return value;
  throw new Error(`Invalid lockfile entry ${key}: invalid scope`);
}

function parseLocked(value: unknown): InstallPlan["locked"] {
  if (!isRecord(value)) return undefined;
  const capabilityManifest = value.capabilityManifest;
  if (capabilityManifest !== undefined && !isCapabilityManifest(capabilityManifest)) return undefined;
  return {
    selectedTarget: value.selectedTarget,
    config: value.config,
    capabilityManifest,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
