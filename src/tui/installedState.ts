import { doctorLockfile, type DoctorIssue } from "../doctor.js";
import { listInstalledServers, type InventoryScope } from "../inventory.js";
import { lockKey, type InstallPlan, type Lockfile } from "../plan.js";
import type { ServerTestResult } from "../tester.js";
import type { ClientName } from "../config.js";
import type { InstallScope } from "../install.js";
import type { NormalizedServer } from "../types.js";
import { compareVersionish } from "../versions.js";

export type InstalledRuntimeStatus = "not_checked" | "reachable" | "stale" | "unknown";

export interface InstalledServerState {
  id: string;
  client: ClientName;
  scope: InstallScope;
  file: string;
  serverName: string;
  installed: boolean;
  locked: boolean;
  lockDrift: boolean;
  lockedVersion?: string;
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  source?: string;
  canUpdate: boolean;
  canDelete: boolean;
  canTest: boolean;
  registryMatch?: "exact" | "alias";
  runningStatus: InstalledRuntimeStatus;
  testResult?: ServerTestResult;
  installableServer?: NormalizedServer;
  updateServer?: NormalizedServer;
  issue?: string;
}

export interface InstalledViewState {
  rows: InstalledServerState[];
  selected: number;
  scope: InventoryScope;
  loading: boolean;
}

export type InstalledViewAction =
  | { type: "loading" }
  | { type: "loaded"; rows: InstalledServerState[] }
  | { type: "select"; selected: number }
  | { type: "move"; delta: number }
  | { type: "scope"; scope: InventoryScope };

export async function loadInstalledServerStates(options: {
  servers: NormalizedServer[];
  lockfile?: Lockfile;
  scope?: InventoryScope;
  tests?: Record<string, ServerTestResult>;
}): Promise<InstalledServerState[]> {
  const scope = options.scope ?? "all";
  const [inventory, doctor] = await Promise.all([
    listInstalledServers({ scope }),
    doctorLockfile("mcp-lock.json", scope).catch(() => undefined),
  ]);
  const issues = doctor?.issues ?? [];
  const rows = inventory.entries.map((entry) => {
    const locked = findLockedPlan(options.lockfile, entry.serverName, entry.client);
    const latest = latestKnownInstalledVersion(options.servers, entry.serverName);
    const currentServer = findInstallableServer(options.servers, entry.serverName, locked?.version ?? latest?.version);
    const updateServer = findInstallableServer(options.servers, entry.serverName, latest?.version);
    const registryMatch = updateServer ? matchKind(updateServer, entry.serverName) : undefined;
    const testResult = options.tests?.[installedId(entry.serverName, entry.client, entry.scope)];
    const lockDrift = issues.some((issue) => issueMatchesInstalled(issue, entry.serverName, entry.client, entry.scope));
    const updateAvailable = Boolean(locked?.version && latest?.version && compareVersionish(latest.version, locked.version) > 0);
    const canAdopt = Boolean(!locked && updateServer?.installable);
    const runningStatus: InstalledRuntimeStatus = testResult?.ok
      ? "reachable"
      : lockDrift || updateAvailable
        ? "stale"
        : testResult
          ? "unknown"
          : "not_checked";

    return {
      id: installedId(entry.serverName, entry.client, entry.scope),
      client: entry.client,
      scope: entry.scope,
      file: entry.file,
      serverName: entry.serverName,
      installed: true,
      locked: Boolean(locked),
      lockDrift,
      lockedVersion: locked?.version,
      currentVersion: locked?.version,
      latestVersion: latest?.version,
      updateAvailable,
      source: locked?.resolved?.source,
      canUpdate: Boolean((updateAvailable || canAdopt) && updateServer?.installable),
      canDelete: true,
      canTest: Boolean(currentServer) || entry.client !== "zed",
      registryMatch,
      runningStatus,
      testResult,
      installableServer: currentServer,
      updateServer,
      issue: lockDrift ? issues.find((issue) => issueMatchesInstalled(issue, entry.serverName, entry.client, entry.scope))?.message : undefined,
    };
  });

  return rows.sort((left, right) =>
    left.scope.localeCompare(right.scope)
    || left.client.localeCompare(right.client)
    || left.serverName.localeCompare(right.serverName)
    || left.file.localeCompare(right.file),
  );
}

export function installedViewReducer(state: InstalledViewState, action: InstalledViewAction): InstalledViewState {
  switch (action.type) {
    case "loading":
      return { ...state, loading: true };
    case "loaded":
      return {
        ...state,
        rows: action.rows,
        selected: clamp(state.selected, 0, Math.max(0, action.rows.length - 1)),
        loading: false,
      };
    case "select":
      return { ...state, selected: clamp(action.selected, 0, Math.max(0, state.rows.length - 1)) };
    case "move":
      return { ...state, selected: clamp(state.selected + action.delta, 0, Math.max(0, state.rows.length - 1)) };
    case "scope":
      return { ...state, scope: action.scope, selected: 0, loading: true };
  }
}

export function installedId(serverName: string, client: ClientName, scope: InstallScope): string {
  return `${scope}:${client}:${serverName}`;
}

function findLockedPlan(lockfile: Lockfile | undefined, serverName: string, client: ClientName): InstallPlan | undefined {
  const keyed = lockfile?.servers[lockKey(serverName, client)];
  const legacy = lockfile?.servers[serverName];
  return keyed ?? (legacy?.client === client ? legacy : undefined);
}

function findInstallableServer(servers: NormalizedServer[], serverName: string, version: string | undefined): NormalizedServer | undefined {
  const candidates = matchingServers(servers, serverName);
  const exact = version ? candidates.find((server) => server.version === version) : undefined;
  return exact ?? candidates[0];
}

function latestKnownInstalledVersion(servers: NormalizedServer[], serverName: string): { version: string; server: NormalizedServer } | undefined {
  const candidates = matchingServers(servers, serverName);
  const server = candidates.reduce<NormalizedServer | undefined>((best, candidate) => {
    if (!best) return candidate;
    if (candidate.isLatest && !best.isLatest) return candidate;
    if (candidate.isLatest === best.isLatest && compareVersionish(candidate.version, best.version) > 0) return candidate;
    return best;
  }, undefined);
  return server ? { version: server.version, server } : undefined;
}

function matchingServers(servers: NormalizedServer[], installedName: string): NormalizedServer[] {
  const normalized = normalizeName(installedName);
  return servers
    .filter((server) => server.installable && serverAliases(server).has(normalized))
    .sort((left, right) =>
      matchWeight(left, installedName) - matchWeight(right, installedName)
      || right.isLatest.toString().localeCompare(left.isLatest.toString())
      || compareVersionish(right.version, left.version)
      || left.name.localeCompare(right.name),
    );
}

function matchKind(server: NormalizedServer, installedName: string): "exact" | "alias" {
  return server.name === installedName ? "exact" : "alias";
}

function matchWeight(server: NormalizedServer, installedName: string): number {
  if (server.name === installedName) return 0;
  const normalized = normalizeName(installedName);
  if (normalizeName(server.name.split("/").pop() ?? "") === normalized) return 1;
  if (normalizeName(server.title) === normalized) return 2;
  return 3;
}

function serverAliases(server: NormalizedServer): Set<string> {
  const aliases = new Set<string>();
  addAlias(aliases, server.name);
  addAlias(aliases, server.name.split("/").pop());
  addAlias(aliases, server.title);
  addAlias(aliases, server.repositoryUrl?.split("/").filter(Boolean).pop());
  for (const pkg of server.raw.packages ?? []) {
    addAlias(aliases, pkg.identifier);
    addAlias(aliases, pkg.identifier.split("/").pop());
  }
  return aliases;
}

function addAlias(aliases: Set<string>, value?: string): void {
  const normalized = normalizeName(value);
  if (!normalized) return;
  aliases.add(normalized);
  for (const prefix of ["server-", "mcp-", "mcp-server-", "@modelcontextprotocol/server-"]) {
    if (normalized.startsWith(prefix)) aliases.add(normalized.slice(prefix.length));
  }
}

function normalizeName(value?: string): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function issueMatchesInstalled(issue: DoctorIssue, serverName: string, client: ClientName, scope: InstallScope): boolean {
  return issue.serverName === serverName && issue.client === client && (!issue.scope || issue.scope === scope);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
