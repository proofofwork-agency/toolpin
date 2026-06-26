import { clientsForScope, PROJECT_CLIENTS, type ClientName } from "../config.js";
import { resolveConfigTarget, type InstallScope } from "../install.js";
import { lockKey, type InstallPlan, type Lockfile } from "../plan.js";
import { latestOnly, normalizeEntries } from "../registry.js";
import { searchServers } from "../search.js";
import type { FetchOptions } from "../registry.js";
import type { NormalizedServer, RegistryEntry, RegistrySourceInfo, SearchResult, SourceStatus } from "../types.js";
import { compareVersionStatus, knownVersions } from "../versions.js";
import { CLIENTS, RESULT_LIMIT_STEP, VIEWS } from "./constants.js";
import { asObject, safeJson, shortPath, unique } from "./format.js";
import type { ClientSelection, CommandLog, SourceMode, TuiState, TuiVersionInfo, View } from "./types.js";

export function nextView(view: View): View {
  return VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length] ?? "discover";
}

export function switchView(state: TuiState, view: View): TuiState {
  const commandLog = commandLogBelongsToView(state.commandLog, view) ? state.commandLog : undefined;
  return {
    ...state,
    view,
    commandLog,
  };
}

export function commandLogForView(state: TuiState): CommandLog | undefined {
  return commandLogBelongsToView(state.commandLog, state.view) ? state.commandLog : undefined;
}

export function commandLogBelongsToView(log: CommandLog | undefined, view: View): boolean {
  if (!log) return false;
  if (view === "installed") return ["installed", "remove", "install", "update", "adopt", "test", "doctor", "versions"].includes(log.title);
  if (view === "sources") return ["sources", "ingest", "search", "results", "reset"].includes(log.title);
  if (view === "details") return ["info", "audit", "test", "versions"].includes(log.title);
  if (view === "plan") return ["install", "lock", "plan", "versions"].includes(log.title);
  if (view === "config") return ["export-config", "config", "versions"].includes(log.title);
  if (view === "discover") return ["ingest", "search", "results", "reset"].includes(log.title);
  return log.title === "help";
}

export function nextClient(client: ClientSelection): ClientSelection {
  return CLIENTS[(CLIENTS.indexOf(client) + 1) % CLIENTS.length] ?? "claude";
}

export function selectedClients(client: ClientSelection): ClientName[] {
  return client === "all" ? PROJECT_CLIENTS : [client];
}

export function selectedClientsForScope(client: ClientSelection, scope: InstallScope): ClientName[] {
  return client === "all" ? clientsForScope(scope) : [client];
}

export function installClientChoicesForScope(scope: InstallScope, preferredClient: ClientSelection): ClientSelection[] {
  const choices: ClientSelection[] = [...clientsForScope(scope), "all"];
  if (!choices.includes(preferredClient)) return choices;
  return [preferredClient, ...choices.filter((client) => client !== preferredClient)];
}

export function selectedServerVersion(servers: NormalizedServer[], defaultServer: NormalizedServer, selectedVersion?: string): NormalizedServer {
  if (!selectedVersion || selectedVersion === defaultServer.version) return defaultServer;
  return servers.find((server) => server.name === defaultServer.name && server.version === selectedVersion) ?? defaultServer;
}

export function initialInstallVersionIndex(versions: NormalizedServer[], selectedVersion: string): number {
  return Math.max(0, versions.findIndex((entry) => entry.version === selectedVersion));
}

export function pruneVersionSelections(selections: Record<string, string>, servers: NormalizedServer[]): Record<string, string> {
  const available = new Set(servers.map((server) => `${server.name}@${server.version}`));
  return Object.fromEntries(Object.entries(selections).filter(([name, version]) => available.has(`${name}@${version}`)));
}

export function buildTuiVersionInfo(
  servers: NormalizedServer[],
  serverName: string,
  selectedVersion: string,
  lockfile: Lockfile | undefined,
  client: ClientSelection,
  installScope: InstallScope,
): TuiVersionInfo {
  const entries = knownVersions(servers, serverName);
  const latestVersion = entries[0]?.version ?? "unknown";
  const targetClients = selectedClientsForScope(client, installScope);
  const lockedEntries = targetClients
    .map((targetClient) => {
      const keyed = lockfile?.servers[lockKey(serverName, targetClient)];
      const legacy = lockfile?.servers[serverName];
      return keyed ?? (legacy?.client === targetClient ? legacy : undefined);
    })
    .filter((entry): entry is InstallPlan => Boolean(entry?.name === serverName));
  const lockedVersions = unique(lockedEntries.map((entry) => entry.version));
  const lockedLabel = lockedVersions.length === 0
    ? "none"
    : lockedVersions.length === 1
      ? lockedVersions[0]
      : `mixed ${lockedVersions.join(", ")}`;

  let status: TuiVersionInfo["status"];
  if (!entries.length) {
    status = "unknown";
  } else if (!lockedVersions.length) {
    status = "not locked";
  } else if (lockedVersions.some((lockedVersion) => compareVersionStatus(latestVersion, lockedVersion) === undefined)) {
    status = "unknown";
  } else if (lockedVersions.some((lockedVersion) => (compareVersionStatus(latestVersion, lockedVersion) ?? 0) > 0)) {
    status = "update available";
  } else if (lockedVersions.some((lockedVersion) => (compareVersionStatus(latestVersion, lockedVersion) ?? 0) < 0)) {
    status = "ahead of registry";
  } else {
    status = "current";
  }

  return {
    selectedVersion,
    latestVersion,
    lockedLabel,
    status,
    versions: entries.map((entry) => entry.version),
  };
}

export function installClientLabel(client: ClientSelection, targetClients: ClientName[]): string {
  return client === "all" ? `all supported clients (${targetClients.join(", ")})` : `client ${targetClients[0] ?? client}`;
}

export function scopeLabel(scope: InstallScope): string {
  return scope === "project" ? "project scope (this folder)" : "global scope (current user)";
}

export function formatVersionChoices(versionInfo: TuiVersionInfo, limit: number): string {
  const versions = versionInfo.versions.slice(0, limit).map((version) => {
    const suffix = version === versionInfo.latestVersion ? " latest" : "";
    return version === versionInfo.selectedVersion ? `[${version}${suffix}]` : `${version}${suffix}`;
  });
  const remaining = Math.max(0, versionInfo.versions.length - versions.length);
  return remaining ? `${versions.join(", ")} +${remaining} more` : versions.join(", ");
}

export function configTargetLabel(client: ClientName, scope: InstallScope): string {
  const target = safeJson(() => resolveConfigTarget(client, scope));
  if ("error" in asObject(target)) return String(asObject(target).error);
  return shortPath((target as ReturnType<typeof resolveConfigTarget>).file);
}

export function nextSource(source: SourceMode): SourceMode {
  const sources: SourceMode[] = ["all", "official", "docker"];
  return sources[(sources.indexOf(source) + 1) % sources.length] ?? "all";
}

export function filterBySource(servers: NormalizedServer[], source: SourceMode): NormalizedServer[] {
  return source === "all" ? servers : servers.filter((server) => server.registrySource === source);
}

export function filterByEnabledSources(servers: NormalizedServer[], source: SourceMode, sources: RegistrySourceInfo[]): NormalizedServer[] {
  const enabled = new Set(sources.filter((entry) => entry.enabled).map((entry) => entry.id));
  return filterBySource(servers, source).filter((server) => source === "all" ? enabled.has(server.registrySource) : true);
}

const CACHE_COVERED_EMPTY_STATUSES = new Set<SourceStatus>(["auth-missing", "stale", "fetch-error", "disabled"]);

export function cacheCoverage(entries: RegistryEntry[], source: SourceMode, registrySources: RegistrySourceInfo[] = []): { covered: boolean; missing: string[] } {
  const entrySources = new Set(normalizeEntries(entries).map((server) => server.registrySource));
  const sourcesById = new Map(registrySources.map((entry) => [entry.id, entry]));
  const enabledSources = registrySources.length
    ? registrySources.filter((entry) => entry.enabled).map((entry) => entry.id)
    : ["official", "docker"];
  const expected = source === "all" ? enabledSources : [source];
  const missing = expected.filter((sourceId) => {
    if (entrySources.has(sourceId)) return false;
    const sourceInfo = sourcesById.get(sourceId);
    return !(sourceInfo?.cacheEntries === 0 && sourceInfo.status && CACHE_COVERED_EMPTY_STATUSES.has(sourceInfo.status));
  });
  return { covered: missing.length === 0, missing };
}

export function cacheHasSource(entries: RegistryEntry[], source: SourceMode, registrySources: RegistrySourceInfo[] = []): boolean {
  return cacheCoverage(entries, source, registrySources).covered;
}

export function browseSearchResults(servers: NormalizedServer[], query: string, browseVersionMode: "latest" | "all"): SearchResult[] {
  const candidates = browseVersionMode === "all" ? servers : latestOnly(servers);
  return searchServers(candidates, query || "mcp", candidates.length);
}

export function nextResultLimit(currentLimit: number, totalMatches: number): number {
  return Math.min(Math.max(totalMatches, currentLimit), currentLimit + RESULT_LIMIT_STEP);
}

export function persistentRefreshOptions(source: SourceMode): Pick<FetchOptions, "source" | "limit" | "maxPages"> {
  return { source, limit: 500, maxPages: 25 };
}
