import { readFile, writeFile } from "node:fs/promises";
import { deriveCapabilityManifest, isCapabilityManifest } from "./capabilities.js";
import { exportClientConfig, selectLaunchTarget, type ClientName } from "./config.js";
import { scoreServer } from "./trust.js";
import type { CapabilityManifest, NormalizedServer } from "./types.js";

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
}

export interface Lockfile {
  lockfileVersion: 1;
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
  return {
    name: server.name,
    version: server.version,
    client,
    selectedTarget: target,
    trust: scoreServer(server),
    config: exported.config,
    notes: exported.notes,
    capabilityManifest: deriveCapabilityManifest(server, { generatedAt: resolvedAt }),
    resolvedAt,
  };
}

export async function writeLockfile(plan: InstallPlan, path = "mcp-lock.json", key = lockKey(plan.name, plan.client)): Promise<Lockfile> {
  const existing = await readExistingLockfile(path);
  const now = new Date().toISOString();
  const next: Lockfile = {
    lockfileVersion: 1,
    generatedAt: existing.generatedAt === new Date(0).toISOString() ? now : existing.generatedAt,
    updatedAt: now,
    servers: {
      ...existing.servers,
      [key]: {
        ...plan,
        resolvedAt: plan.resolvedAt ?? now,
      },
    },
  };

  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
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
    lockfileVersion: 1,
    generatedAt: new Date(0).toISOString(),
    servers: {},
  };
}

function parseLockfile(value: unknown): Lockfile | undefined {
  if (!isRecord(value)) return undefined;
  if (value.lockfileVersion !== 1) return undefined;
  if (typeof value.generatedAt !== "string") return undefined;
  if (!isRecord(value.servers)) return undefined;

  const servers: Record<string, InstallPlan> = {};
  for (const [key, entry] of Object.entries(value.servers)) {
    servers[key] = parseInstallPlan(entry, key);
  }

  return {
    lockfileVersion: 1,
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
  };
}

function diffInstallPlans(locked: InstallPlan, current: InstallPlan): string[] {
  const messages: string[] = [];
  if (locked.version !== current.version) messages.push(`version changed ${locked.version} -> ${current.version}`);
  if (stableJson(locked.selectedTarget) !== stableJson(current.selectedTarget)) messages.push("selected install target changed");
  if (locked.trust.score > current.trust.score) messages.push(`trust score decreased ${locked.trust.score} -> ${current.trust.score}`);
  if (stableJson(locked.config) !== stableJson(current.config)) messages.push("client config changed");
  return messages;
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

function isClientName(value: unknown): value is ClientName {
  return ["claude", "cursor", "vscode", "codex", "opencode", "generic"].includes(String(value));
}
