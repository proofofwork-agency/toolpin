import { doctorLockfile, type DoctorIssue } from "../doctor.js";
import { listInstalledServers, type InventoryScope } from "../inventory.js";
import { lockKey, type InstallPlan, type Lockfile } from "../plan.js";
import type { ServerTestResult } from "../tester.js";
import type { ClientName } from "../config.js";
import type { InstallScope } from "../install.js";
import type { NormalizedServer } from "../types.js";
import { compareVersionish, latestKnownVersion } from "../versions.js";

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
    const latest = latestKnownVersion(options.servers, entry.serverName);
    const currentServer = findInstallableServer(options.servers, entry.serverName, locked?.version ?? latest?.version);
    const updateServer = findInstallableServer(options.servers, entry.serverName, latest?.version);
    const testResult = options.tests?.[installedId(entry.serverName, entry.client, entry.scope)];
    const lockDrift = issues.some((issue) => issueMatchesInstalled(issue, entry.serverName, entry.client, entry.scope));
    const updateAvailable = Boolean(locked?.version && latest?.version && compareVersionish(latest.version, locked.version) > 0);
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
      canUpdate: Boolean(updateAvailable && updateServer?.installable),
      canDelete: true,
      canTest: Boolean(currentServer),
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
  const exact = version ? servers.find((server) => server.name === serverName && server.version === version) : undefined;
  return exact ?? servers.find((server) => server.name === serverName);
}

function issueMatchesInstalled(issue: DoctorIssue, serverName: string, client: ClientName, scope: InstallScope): boolean {
  return issue.serverName === serverName && issue.client === client && (!issue.scope || issue.scope === scope);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
