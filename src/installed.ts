import { doctorLockfile, readInstalledServerConfig, type DoctorIssue } from "./doctor.js";
import { installServerConfig, removeServerConfig, resolveConfigTarget, type InstallResult, type InstallScope, type RemoveResult } from "./install.js";
import { listInstalledServers, type InventoryScope } from "./inventory.js";
import { buildInstallPlan, lockKey, readLockfile, removeLockfileEntry, writeLockfile, type InstallPlan, type Lockfile } from "./plan.js";
import { enforcePolicy } from "./policy.js";
import { testInstalledClientConfig, type ServerTestResult } from "./tester.js";
import { verifyServer, type VerificationReport } from "./verify.js";
import { compareVersionStatus, compareVersionish } from "./versions.js";
import type { ClientName } from "./config.js";
import type { CapabilityManifest, NormalizedServer } from "./types.js";

export type InstalledRuntimeStatus = "not_checked" | "reachable" | "stale" | "unknown";
export type InstalledRegistryStatus = "exact" | "alias" | "none";
export type InstalledLifecycleAction = "update" | "adopt" | "none";
export type InstalledTestSource = "registry" | "config" | "none";

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
  registryStatus: InstalledRegistryStatus;
  lifecycleAction: InstalledLifecycleAction;
  testSource: InstalledTestSource;
  runningStatus: InstalledRuntimeStatus;
  testResult?: ServerTestResult;
  installableServer?: NormalizedServer;
  updateServer?: NormalizedServer;
  issue?: string;
  registryCandidates?: string[];
}

export interface InstalledLifecycleOptions {
  source?: string;
  live?: boolean;
  lockfilePath?: string;
  version?: string;
  verify?: boolean;
  timeoutMs?: number;
  policyPath?: string;
  enforcePolicy?: boolean;
  dryRun?: boolean;
}

export interface InstalledMutationResult {
  action: "update" | "adopt";
  dryRun: boolean;
  serverName: string;
  targetName: string;
  client: ClientName;
  scope: InstallScope;
  fromVersion?: string;
  toVersion: string;
  removedAlias?: RemoveResult;
  config?: InstallResult;
  lockfilePath: string;
  lockfileWritten: boolean;
  verification?: VerificationReport;
  planned: string[];
}

export interface InstalledUpdateAllResult {
  dryRun: boolean;
  scope: InventoryScope;
  client: ClientName | "all";
  updated: InstalledMutationResult[];
  skippedAdoptable: Array<{ serverName: string; client: ClientName; scope: InstallScope; targetName: string }>;
  skipped: Array<{ serverName: string; client: ClientName; scope: InstallScope; reason: string }>;
}

export async function loadInstalledServerStates(options: {
  servers: NormalizedServer[];
  lockfile?: Lockfile;
  scope?: InventoryScope;
  client?: ClientName | "all";
  tests?: Record<string, ServerTestResult>;
}): Promise<InstalledServerState[]> {
  const scope = options.scope ?? "all";
  const [inventory, doctor] = await Promise.all([
    listInstalledServers({ scope, client: options.client }),
    doctorLockfile("mcp-lock.json", scope).catch(() => undefined),
  ]);
  const issues = doctor?.issues ?? [];
  const rows = inventory.entries.map((entry) => {
    const locked = findLockedPlan(options.lockfile, entry.serverName, entry.client);
    const match = resolveInstalledRegistryMatch(options.servers, entry.serverName, locked?.version);
    const registryMatch = match.registryMatch ?? (locked ? "exact" : undefined);
    const testResult = options.tests?.[installedId(entry.serverName, entry.client, entry.scope)];
    const lockDrift = issues.some((issue) => issueMatchesInstalled(issue, entry.serverName, entry.client, entry.scope));
    const versionDelta = locked?.version && match.latestVersion ? compareVersionStatus(match.latestVersion, locked.version) : undefined;
    const updateAvailable = versionDelta !== undefined && versionDelta > 0;
    const lifecycleAction = lifecycleActionFor({ locked: Boolean(locked), updateAvailable, updateServer: match.updateServer, registryMatch });
    const canTest = entry.client !== "zed";
    const runningStatus: InstalledRuntimeStatus = testResult?.ok
      ? "reachable"
      : lockDrift || updateAvailable
        ? "stale"
        : testResult
          ? "unknown"
          : "not_checked";
    const issue = lockDrift
      ? issues.find((candidate) => issueMatchesInstalled(candidate, entry.serverName, entry.client, entry.scope))?.message
      : match.ambiguousCandidates?.length
        ? `ambiguous registry alias match: ${match.ambiguousCandidates.join(", ")}`
        : undefined;

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
      latestVersion: match.latestVersion ?? locked?.version,
      updateAvailable,
      source: locked?.resolved?.source,
      canUpdate: lifecycleAction !== "none",
      canDelete: true,
      canTest,
      registryMatch,
      registryStatus: (registryMatch ?? "none") as InstalledRegistryStatus,
      lifecycleAction,
      testSource: (canTest ? "config" : "none") as InstalledTestSource,
      runningStatus,
      testResult,
      installableServer: match.currentServer,
      updateServer: match.updateServer,
      issue,
      registryCandidates: match.ambiguousCandidates,
    };
  });

  return rows.sort((left, right) =>
    left.scope.localeCompare(right.scope)
    || left.client.localeCompare(right.client)
    || left.serverName.localeCompare(right.serverName)
    || left.file.localeCompare(right.file),
  );
}

export async function testInstalledServer(options: {
  serverName: string;
  client: ClientName;
  scope: InstallScope;
  timeoutMs?: number;
}): Promise<ServerTestResult> {
  const target = await getInstalledConfig(options.serverName, options.client, options.scope);
  return testInstalledClientConfig(options.serverName, target.config, options.timeoutMs ?? 15000);
}

export async function adoptInstalledServer(options: InstalledLifecycleOptions & {
  installedName: string;
  client: ClientName;
  scope: InstallScope;
  servers: NormalizedServer[];
}): Promise<InstalledMutationResult> {
  const lockfilePath = options.lockfilePath ?? "mcp-lock.json";
  const row = await getInstalledLifecycleRow(options.installedName, options.client, options.scope, options.servers, lockfilePath);
  if (row.locked) throw new Error(`${row.serverName} is already locked for ${row.client}; use \`toolpin update ${row.serverName} --client ${row.client} --scope ${row.scope}\`.`);
  if (row.registryCandidates?.length) {
    throw new Error(`Ambiguous registry alias match for ${row.serverName}: ${row.registryCandidates.join(", ")}`);
  }
  if (row.lifecycleAction !== "adopt" || !row.updateServer) {
    throw new Error(`No adoptable registry match found for ${row.serverName}.`);
  }

  return mutateInstalledRow(row, row.updateServer, "adopt", options);
}

export async function updateInstalledServer(options: InstalledLifecycleOptions & {
  serverName: string;
  client: ClientName;
  scope: InstallScope;
  servers: NormalizedServer[];
}): Promise<InstalledMutationResult> {
  const lockfilePath = options.lockfilePath ?? "mcp-lock.json";
  const row = await getInstalledLifecycleRow(options.serverName, options.client, options.scope, options.servers, lockfilePath);
  if (!row.locked) throw new Error(`${row.serverName} is not locked for ${row.client}; use \`toolpin adopt ${row.serverName} --client ${row.client} --scope ${row.scope}\` if you want to lock a registry match.`);
  if (row.registryCandidates?.length) {
    throw new Error(`Ambiguous registry alias match for ${row.serverName}: ${row.registryCandidates.join(", ")}`);
  }
  const targetServer = options.version
    ? resolveInstalledRegistryVersion(options.servers, row, options.version)
    : row.updateServer;
  if (!targetServer) {
    throw new Error(`No locked update is available for ${row.serverName}.`);
  }

  return mutateInstalledRow(row, targetServer, "update", options);
}

export async function updateAllInstalledServers(options: InstalledLifecycleOptions & {
  scope: InventoryScope;
  client: ClientName | "all";
  servers: NormalizedServer[];
}): Promise<InstalledUpdateAllResult> {
  const lockfilePath = options.lockfilePath ?? "mcp-lock.json";
  const lockfile = await readLockfile(lockfilePath).catch(() => undefined);
  const rows = await loadInstalledServerStates({
    servers: options.servers,
    lockfile,
    scope: options.scope,
    client: options.client,
  });
  const updated: InstalledMutationResult[] = [];
  const skippedAdoptable: InstalledUpdateAllResult["skippedAdoptable"] = [];
  const skipped: InstalledUpdateAllResult["skipped"] = [];

  for (const row of rows) {
    if (row.lifecycleAction === "adopt" && row.updateServer) {
      skippedAdoptable.push({ serverName: row.serverName, client: row.client, scope: row.scope, targetName: row.updateServer.name });
      continue;
    }
    if (row.lifecycleAction !== "update" || !row.updateServer) {
      skipped.push({ serverName: row.serverName, client: row.client, scope: row.scope, reason: row.locked ? "current" : "unlocked/no-registry-match" });
      continue;
    }
    updated.push(await mutateInstalledRow(row, row.updateServer, "update", options));
  }

  return {
    dryRun: options.dryRun === true,
    scope: options.scope,
    client: options.client,
    updated,
    skippedAdoptable,
    skipped,
  };
}

export function installedId(serverName: string, client: ClientName, scope: InstallScope): string {
  return `${scope}:${client}:${serverName}`;
}

function lifecycleActionFor(input: {
  locked: boolean;
  updateAvailable: boolean;
  updateServer?: NormalizedServer;
  registryMatch?: "exact" | "alias";
}): InstalledLifecycleAction {
  if (!input.updateServer?.installable || !input.registryMatch) return "none";
  if (input.locked) return input.updateAvailable ? "update" : "none";
  return "adopt";
}

async function getInstalledLifecycleRow(
  serverName: string,
  client: ClientName,
  scope: InstallScope,
  servers: NormalizedServer[],
  lockfilePath: string,
): Promise<InstalledServerState> {
  const lockfile = await readLockfile(lockfilePath).catch(() => undefined);
  const rows = await loadInstalledServerStates({ servers, lockfile, scope, client });
  const row = rows.find((candidate) => candidate.serverName === serverName && candidate.client === client && candidate.scope === scope);
  if (!row) {
    throw new Error(`No installed config entry found for ${serverName} in ${client} ${scope} config.`);
  }
  return row;
}

async function mutateInstalledRow(
  row: InstalledServerState,
  server: NormalizedServer,
  action: "update" | "adopt",
  options: InstalledLifecycleOptions,
): Promise<InstalledMutationResult> {
  const lockfilePath = options.lockfilePath ?? "mcp-lock.json";
  const planned = mutationPlan(row, server, action, lockfilePath);
  const dryRun = options.dryRun === true;
  const { plan, verification } = await buildCheckedPlan(server, row.client, row.scope, options);

  if (dryRun) {
    return {
      action,
      dryRun,
      serverName: row.serverName,
      targetName: server.name,
      client: row.client,
      scope: row.scope,
      fromVersion: row.lockedVersion,
      toVersion: server.version,
      lockfilePath,
      lockfileWritten: false,
      verification,
      planned,
    };
  }

  let removedAlias: RemoveResult | undefined;
  if (row.serverName !== server.name) {
    removedAlias = await removeServerConfig(row.serverName, row.client, row.scope);
    await removeLockfileEntry(row.serverName, row.client, lockfilePath);
  }
  const config = await installServerConfig(server, row.client, row.scope);
  await writeLockfile(plan, lockfilePath, lockKey(server.name, row.client));

  return {
    action,
    dryRun,
    serverName: row.serverName,
    targetName: server.name,
    client: row.client,
    scope: row.scope,
    fromVersion: row.lockedVersion,
    toVersion: server.version,
    removedAlias,
    config,
    lockfilePath,
    lockfileWritten: true,
    verification,
    planned,
  };
}

async function buildCheckedPlan(
  server: NormalizedServer,
  client: ClientName,
  scope: InstallScope,
  options: InstalledLifecycleOptions,
): Promise<{ plan: InstallPlan; verification?: VerificationReport }> {
  let capabilityManifest: CapabilityManifest | undefined;
  let verification: VerificationReport | undefined;
  if (options.verify) {
    verification = await verifyServer(server, {
      liveRemoteProbe: true,
      timeoutMs: options.timeoutMs ?? 15000,
    });
    if (!verification.ok) {
      throw new Error([
        `${server.name} failed verification.`,
        ...verification.issues.map((issue) => `- ${issue.severity}: ${issue.code}: ${issue.message}`),
      ].join("\n"));
    }
    capabilityManifest = verification.capabilityManifest;
  }

  const plan = buildInstallPlan(server, client, { capabilityManifest, scope });
  if (options.enforcePolicy !== false) {
    const report = await enforcePolicy(plan, options.policyPath ?? ".toolpin/policy.json");
    if (!report.ok) {
      throw new Error([
        `Lifecycle action refused by policy ${options.policyPath ?? ".toolpin/policy.json"}.`,
        ...report.issues.map((issue) => `- ${issue.code}: ${issue.message}`),
      ].join("\n"));
    }
  }
  return { plan, verification };
}

async function getInstalledConfig(serverName: string, client: ClientName, scope: InstallScope): Promise<{ file: string; config: unknown }> {
  let target: { file: string };
  try {
    target = resolveConfigTarget(client, scope);
  } catch (error) {
    throw new Error(`Unsupported ${client} ${scope} target: ${error instanceof Error ? error.message : String(error)}`);
  }

  const installedConfig = await readInstalledServerConfig(target.file, serverName, client);
  if (installedConfig.kind === "missing") {
    throw new Error(`Installed config entry ${serverName} is missing from ${target.file}.`);
  }
  if (installedConfig.kind === "unreadable") {
    throw new Error(installedConfig.message);
  }
  return { file: target.file, config: installedConfig.config };
}

function mutationPlan(row: InstalledServerState, server: NormalizedServer, action: "update" | "adopt", lockfilePath: string): string[] {
  return [
    `${action} ${row.serverName} (${row.client}/${row.scope})`,
    row.serverName !== server.name ? `remove installed alias ${row.serverName}` : `keep installed name ${row.serverName}`,
    `write registry target ${server.name}@${server.version}`,
    `write lockfile entry ${lockKey(server.name, row.client)} to ${lockfilePath}`,
  ];
}

function resolveInstalledRegistryMatch(
  servers: NormalizedServer[],
  installedName: string,
  currentVersion?: string,
): {
  registryMatch?: "exact" | "alias";
  latestVersion?: string;
  currentServer?: NormalizedServer;
  updateServer?: NormalizedServer;
  ambiguousCandidates?: string[];
} {
  const candidates = matchingServers(servers, installedName);
  if (!candidates.length) return {};

  const exact = candidates.filter((server) => server.name === installedName);
  const pool = exact.length ? exact : candidates;
  const names = [...new Set(pool.map((server) => server.name))].sort();
  if (!exact.length && names.length > 1) {
    return { ambiguousCandidates: names };
  }

  const updateServer = bestServer(pool);
  const currentServer = currentVersion
    ? pool.find((server) => server.version === currentVersion) ?? updateServer
    : updateServer;
  if (!updateServer) return {};
  return {
    registryMatch: updateServer.name === installedName ? "exact" : "alias",
    latestVersion: updateServer.version,
    currentServer,
    updateServer,
  };
}

function resolveInstalledRegistryVersion(servers: NormalizedServer[], row: InstalledServerState, version: string): NormalizedServer {
  const pool = matchingServers(servers, row.serverName)
    .filter((server) => !row.updateServer || server.name === row.updateServer.name);
  const server = pool.find((candidate) => candidate.version === version);
  if (!server) {
    const known = pool.map((candidate) => candidate.version).filter(Boolean).join(", ");
    throw new Error(`No installable registry version ${version} found for ${row.serverName}.${known ? ` Known versions: ${known}.` : ""}`);
  }
  return server;
}

function findLockedPlan(lockfile: Lockfile | undefined, serverName: string, client: ClientName): InstallPlan | undefined {
  const keyed = lockfile?.servers[lockKey(serverName, client)];
  const legacy = lockfile?.servers[serverName];
  return keyed ?? (legacy?.client === client ? legacy : undefined);
}

function bestServer(servers: NormalizedServer[]): NormalizedServer | undefined {
  return servers.reduce<NormalizedServer | undefined>((best, candidate) => {
    if (!best) return candidate;
    if (candidate.isLatest && !best.isLatest) return candidate;
    if (candidate.isLatest === best.isLatest && compareVersionish(candidate.version, best.version) > 0) return candidate;
    return best;
  }, undefined);
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
