import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { deriveCapabilityManifest, isCapabilityManifest } from "./capabilities.js";
import { exportClientConfig, selectLaunchTarget, type ClientName } from "./config.js";
import { scoreServer } from "./trust.js";
import type { CapabilityManifest, NormalizedServer } from "./types.js";

export const LOCKFILE_VERSION = 2;

export interface InstallPlan {
  name: string;
  version: string;
  client: ClientName;
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
  lockfileVersion: 1 | 2;
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

export function buildInstallPlan(server: NormalizedServer, client: ClientName): InstallPlan {
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
  const plan: InstallPlan = {
    name: server.name,
    version: server.version,
    client,
    selectedTarget: target,
    trust: scoreServer(server),
    config: exported.config,
    notes: exported.notes,
    capabilityManifest: deriveCapabilityManifest(server, { generatedAt: resolvedAt }),
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
      capabilityManifest: deriveCapabilityManifest(server, { generatedAt: resolvedAt }),
    },
  };
  return { ...plan, integrity: computePlanIntegrity(plan) };
}

export async function writeLockfile(plan: InstallPlan, path = "mcp-lock.json", key = lockKey(plan.name, plan.client)): Promise<Lockfile> {
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

export async function removeLockfileEntry(serverName: string, client: ClientName, path = "mcp-lock.json"): Promise<{ removed: boolean; key: string; lockfile: Lockfile }> {
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

export async function readLockfile(path = "mcp-lock.json"): Promise<Lockfile> {
  return readExistingLockfile(path);
}

export async function verifyAgainstLockfile(plan: InstallPlan, path = "mcp-lock.json"): Promise<LockVerification> {
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

  return emptyLockfile();
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
  if (value.lockfileVersion !== 1 && value.lockfileVersion !== 2) return undefined;
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
  if (!isRecord(value.trust) || typeof value.trust.score !== "number") throw new Error(`Invalid lockfile entry ${key}: invalid trust`);
  if (!Array.isArray(value.notes)) throw new Error(`Invalid lockfile entry ${key}: invalid notes`);
  if (value.capabilityManifest !== undefined && !isCapabilityManifest(value.capabilityManifest)) throw new Error(`Invalid lockfile entry ${key}: invalid capabilityManifest`);
  if (value.integrity !== undefined && typeof value.integrity !== "string") throw new Error(`Invalid lockfile entry ${key}: invalid integrity`);
  return {
    name: value.name,
    version: value.version,
    client: value.client,
    selectedTarget: value.selectedTarget,
    trust: value.trust as unknown as InstallPlan["trust"],
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

function diffInstallPlans(locked: InstallPlan, current: InstallPlan): string[] {
  const messages: string[] = [];
  if (!locked.integrity) messages.push("lock integrity is missing");
  if (locked.integrity && computePlanIntegrity(locked) !== locked.integrity) messages.push("locked entry integrity does not match its contents");
  if (locked.version !== current.version) messages.push(`version changed ${locked.version} -> ${current.version}`);
  if (stableJson(locked.selectedTarget) !== stableJson(current.selectedTarget)) messages.push("selected install target changed");
  if (locked.trust.score > current.trust.score) messages.push(`trust score decreased ${locked.trust.score} -> ${current.trust.score}`);
  if (stableJson(locked.config) !== stableJson(current.config)) messages.push("client config changed");
  if (locked.integrity && current.integrity && locked.integrity !== current.integrity) messages.push("lock integrity changed");
  return messages;
}

export function computePlanIntegrity(plan: InstallPlan): string {
  return `sha256-${createHash("sha256").update(stableJson(integrityPayload(plan))).digest("base64")}`;
}

function finalizeLockEntry(plan: InstallPlan, lockedAt: string): InstallPlan {
  const next: InstallPlan = {
    ...plan,
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

function integrityPayload(plan: InstallPlan): unknown {
  return {
    name: plan.name,
    version: plan.version,
    client: plan.client,
    selectedTarget: plan.selectedTarget,
    trust: plan.trust,
    config: plan.config,
    capabilityManifest: normalizeCapabilityManifest(plan.capabilityManifest),
    resolved: plan.resolved,
    original: plan.original,
    locked: {
      selectedTarget: plan.locked?.selectedTarget,
      config: plan.locked?.config,
      capabilityManifest: normalizeCapabilityManifest(plan.locked?.capabilityManifest),
    },
  };
}

function normalizeCapabilityManifest(manifest?: CapabilityManifest): unknown {
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
    toolDescriptionHash: manifest.toolDescriptionHash
      ? {
          algorithm: manifest.toolDescriptionHash.algorithm,
          value: manifest.toolDescriptionHash.value,
          toolCount: manifest.toolDescriptionHash.toolCount,
        }
      : undefined,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortJson(child)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function isClientName(value: unknown): value is ClientName {
  return ["claude", "cursor", "vscode", "codex", "opencode", "generic"].includes(String(value));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
