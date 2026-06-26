import { useEffect, useMemo, useReducer, useState } from "react";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { exportClientConfig, type ClientName } from "../config.js";
import { doctorLockfile } from "../doctor.js";
import { installServerConfig, removeServerConfig, type InstallScope } from "../install.js";
import { adoptInstalledServer, testInstalledServer, updateAllInstalledServers, updateInstalledServer } from "../installed.js";
import { buildInstallPlan, lockKey, readLockfile, removeLockfileEntry, verifyAgainstLockfile, writeLockfile, type Lockfile } from "../plan.js";
import { enforcePolicy } from "../policy.js";
import { dedupeRegistryEntries, fetchRegistryResult, latestOnly, listRegistrySourceStatuses, normalizeEntries, readCache, REGISTRY_SOURCES, refreshCache as refreshRegistryCache, updateRegistrySourceEnabled } from "../registry.js";
import { testServer, type ServerTestResult } from "../tester.js";
import type { NormalizedServer, RegistryFetchResult, RegistrySourceInfo } from "../types.js";
import { commandLineFor, commandRequiresServer } from "./command.js";
import {
  DEFAULT_RESULT_LIMIT,
  ERR,
  SERVER_VIEWS,
  TUI_COMMANDS,
} from "./constants.js";
import { formatClientConfigSnippet } from "./configSnippet.js";
import { clamp, safeFileName, truncate, unique } from "./format.js";
import { buildTuiHitZones, hitTestTui } from "./layout.js";
import {
  buildTuiVersionInfo,
  browseSearchResults,
  cacheCoverage,
  commandLogForView,
  filterByEnabledSources,
  installClientChoicesForScope,
  installClientLabel,
  initialInstallVersionIndex,
  nextResultLimit,
  nextClient,
  nextSource,
  persistentRefreshOptions,
  pruneVersionSelections,
  scopeLabel,
  selectedClients,
  selectedClientsForScope,
  selectedServerVersion,
  switchView,
} from "./selectors.js";
import type { BrowseLayout, DataMode, TuiCommandId, TuiState, View } from "./types.js";
import { knownVersions } from "../versions.js";
import { installedId, installedViewReducer, loadInstalledServerStates, type InstalledServerState } from "./installedState.js";
import {
  ActivityStrip,
  Centered,
  ChromeHeader,
  CommandPalette,
  DeleteConfirmModal,
  Footer,
  HelpView,
  InstallWizard,
  ModeLine,
  OperationModal,
  OptionList,
  PromptBar,
  SelectedServerPanel,
  SourcesView,
} from "./views/panels.js";
import { InstalledServerDetails, InstalledServersView } from "./views/installed.js";
import { trustRiskTone } from "./ui/trust.js";

export function MpmTui() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { width, height } = useTerminalSize(stdout);
  const [state, setState] = useState<TuiState>(() => ({
    entries: [],
    registrySources: REGISTRY_SOURCES,
    servers: [],
    query: "github",
    commandQuery: "",
    commandSelected: 0,
    sourceSelected: 0,
    selected: 0,
    versionSelections: {},
    installedVersionSelections: {},
    view: "discover",
    inputMode: "normal",
    dataMode: "cache",
    sourceMode: "all",
    browseLayout: "flat",
    browseVersionMode: "latest",
    resultLimit: DEFAULT_RESULT_LIMIT,
    client: "claude",
    installScope: "project",
    loading: true,
    installing: false,
    testing: false,
    checking: false,
  }));
  const [installed, dispatchInstalled] = useReducer(installedViewReducer, {
    rows: [],
    selected: 0,
    scope: "all",
    loading: true,
  });
  const [installedTests, setInstalledTests] = useState<Record<string, ServerTestResult>>({});

  useEffect(() => {
    void loadData("cache");
  }, []);

  useEffect(() => {
    if (!process.stdout.isTTY) return;
    process.stdout.write("\x1b[?1000h\x1b[?1006h");
    return () => {
      process.stdout.write("\x1b[?1000l\x1b[?1006l");
    };
  }, []);

  const allResults = useMemo(() => browseSearchResults(state.servers, state.query, state.browseVersionMode), [state.servers, state.query, state.browseVersionMode]);
  const results = useMemo(() => allResults.slice(0, state.resultLimit), [allResults, state.resultLimit]);
  const browseLayout = state.browseLayout === "category" && !hasCategoryMetadata(results) ? "project" : state.browseLayout;

  const selectedIndex = clamp(state.selected, 0, Math.max(0, results.length - 1));
  const selectedResult = results[selectedIndex];
  const selectedServer = selectedResult?.server
    ? selectedServerVersion(state.servers, selectedResult.server, state.versionSelections[selectedResult.server.name])
    : undefined;
  const selectedVersionInfo = selectedServer
    ? buildTuiVersionInfo(state.servers, selectedServer.name, selectedServer.version, state.lockfile, state.client, state.installScope)
    : undefined;
  const commandResults = useMemo(() => {
    const query = state.commandQuery.trim().toLowerCase();
    if (!query) return TUI_COMMANDS;
    return TUI_COMMANDS.filter((command) => {
      const haystack = `${command.id} ${command.label} ${command.description}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [state.commandQuery]);
  const selectedCommandIndex = clamp(state.commandSelected, 0, Math.max(0, commandResults.length - 1));
  const selectedCommand = commandResults[selectedCommandIndex];
  const selectedInstalled = installed.rows[installed.selected];
  const selectedInstalledTargetVersion = selectedInstalled ? state.installedVersionSelections[selectedInstalled.id] : undefined;
  const selectedInstalledTarget = selectedInstalled
    ? installedTargetServer(selectedInstalled, selectedInstalledTargetVersion)
    : undefined;

  async function loadData(mode: DataMode, query = state.query, sourceMode = state.sourceMode): Promise<void> {
    setState((prev) => ({ ...prev, loading: true, error: undefined, dataMode: mode }));
    try {
      const registrySources = await listRegistrySourceStatuses().catch(() => REGISTRY_SOURCES);
      let nextRegistrySources = registrySources;
      let nextCommandLog = undefined as TuiState["commandLog"];
      const entries = mode === "live"
        ? await fetchRegistryResult({ maxPages: 4, search: query || undefined, source: sourceMode }).then((fetched) => {
            nextRegistrySources = registrySourcesWithFetchResult(registrySources, fetched);
            return dedupeRegistryEntries(fetched.entries);
          })
        : await readCache().then((cached) => {
            const coverage = cacheCoverage(cached, sourceMode, registrySources);
            if (!coverage.covered) {
              nextCommandLog = {
                title: "ingest",
                command: "toolpin ingest",
                ok: false,
                lines: [
                  `cache coverage incomplete for ${coverage.missing.join(", ")}`,
                  "Press r to refresh enabled sources into .toolpin/registry-cache.json.",
                ],
              };
            }
            return cached;
          }).catch(async () => {
            const fetched = await refreshRegistryCache({ maxPages: 3, source: sourceMode });
            nextRegistrySources = registrySourcesWithFetchResult(registrySources, fetched);
            return fetched.entries;
      });
      const servers = normalizeEntries(entries);
      const visibleServers = filterByEnabledSources(servers, sourceMode, nextRegistrySources);
      const lockfile = await readLockfile("mcp-lock.json").catch(() => undefined);
      void refreshInstalledRows(servers, lockfile);
      setState((prev) => ({
        ...prev,
        entries,
        registrySources: nextRegistrySources,
        servers: visibleServers,
        lockfile,
        selected: 0,
        testResult: undefined,
        versionSelections: pruneVersionSelections(prev.versionSelections, servers),
        resultLimit: DEFAULT_RESULT_LIMIT,
        loading: false,
        error: undefined,
        dataMode: mode,
        sourceMode,
        lastAction: mode === "live" ? `loaded live ${sourceMode}` : `loaded cache ${sourceMode}`,
        commandLog: nextCommandLog ?? prev.commandLog,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function refreshCache(source = state.sourceMode): Promise<void> {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const fetched = await refreshRegistryCache(persistentRefreshOptions(source));
      const entries = await readCache().catch(() => fetched.entries);
      const registrySources = await listRegistrySourceStatuses().catch(() => REGISTRY_SOURCES);
      const servers = normalizeEntries(entries);
      const visibleServers = filterByEnabledSources(servers, source, registrySources);
      const lockfile = await readLockfile("mcp-lock.json").catch(() => undefined);
      const ingestLog = fetched.lastError ? {
        title: "ingest",
        command: "toolpin ingest",
        ok: fetched.entries.length > 0,
        lines: [`cached ${fetched.entries.length} ${source} entries`, fetched.lastError],
      } : undefined;
      void refreshInstalledRows(servers, lockfile);
      setState((prev) => ({
        ...prev,
        entries,
        registrySources,
        servers: visibleServers,
        lockfile,
        selected: 0,
        testResult: undefined,
        versionSelections: pruneVersionSelections(prev.versionSelections, servers),
        resultLimit: DEFAULT_RESULT_LIMIT,
        loading: false,
        error: undefined,
        dataMode: "cache",
        sourceMode: source,
        lastAction: `ingested ${fetched.entries.length} ${source} versions`,
        commandLog: ingestLog ?? prev.commandLog,
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function toggleSelectedSource(): Promise<void> {
    const source = sourceRows(state.registrySources)[state.sourceSelected];
    if (!source) return;
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      await updateRegistrySourceEnabled(source.id, !source.enabled);
      const registrySources = await listRegistrySourceStatuses().catch(() => REGISTRY_SOURCES);
      const entries = await readCache().catch(() => state.entries);
      const servers = normalizeEntries(entries);
      const visibleServers = filterByEnabledSources(servers, "all", registrySources);
      setState((prev) => ({
        ...prev,
        entries,
        registrySources,
        servers: visibleServers,
        sourceMode: "all",
        selected: 0,
        loading: false,
        error: undefined,
        lastAction: `${source.enabled ? "disabled" : "enabled"} ${source.id}`,
        commandLog: {
          title: "sources",
          command: `toolpin registry ${source.enabled ? "disable" : "enable"} ${source.id}`,
          ok: true,
          lines: [`${source.id} ${source.enabled ? "disabled" : "enabled"}`, "Browse now uses enabled sources."],
        },
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function writeSelectedLock(): Promise<void> {
    if (!selectedServer) return;
    try {
      let lockfile: Lockfile | undefined;
      for (const client of selectedClients(state.client)) {
        lockfile = await writeLockfile(
          buildInstallPlan(selectedServer, client, { scope: state.installScope }),
          "mcp-lock.json",
          lockKey(selectedServer.name, client),
        );
      }
      setState((prev) => ({ ...prev, lockfile, lastAction: `locked ${selectedServer.name} for ${state.client}` }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function refreshInstalledRows(
    servers = state.servers,
    lockfile = state.lockfile,
    scope = installed.scope,
    tests = installedTests,
  ): Promise<void> {
    dispatchInstalled({ type: "loading" });
    try {
      const rows = await loadInstalledServerStates({ servers, lockfile, scope, tests });
      dispatchInstalled({ type: "loaded", rows });
    } catch (error) {
      dispatchInstalled({ type: "loaded", rows: [] });
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function saveSelectedConfig(): Promise<void> {
    if (!selectedServer) return;
    try {
      await mkdir(".toolpin", { recursive: true });
      const files: string[] = [];
      for (const client of selectedClients(state.client)) {
        const exported = exportClientConfig(selectedServer, client);
        const formatted = formatClientConfigSnippet(client, exported.config);
        const file = path.join(".toolpin", `${safeFileName(selectedServer.name)}.${client}.${formatted.extension}`);
        await writeFile(file, formatted.content, "utf8");
        files.push(file);
      }
      setState((prev) => ({ ...prev, lastAction: `saved ${files.length} config snippet(s)` }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function installSelected(opts?: { server?: NormalizedServer; client?: TuiState["client"]; clients?: ClientName[]; scope?: InstallScope; clientLabel?: string }): Promise<void> {
    const server = opts?.server ?? selectedServer;
    if (!server) {
      setState((prev) => ({
        ...prev,
        commandLog: {
          title: "install",
          command: commandLineFor("install", state, selectedServer),
          ok: false,
          lines: ["Select a server before installing."],
        },
      }));
      return;
    }
    const scope = opts?.scope ?? state.installScope;
    const targetClients = opts?.clients ?? selectedClientsForScope(state.client, scope);
    const clientLabel = opts?.clientLabel ?? installClientLabel(opts?.client ?? state.client, targetClients);
    const command = commandLineFor("install", { ...state, client: opts?.client ?? state.client, installScope: scope }, server);
    if (!targetClients.length) {
      setState((prev) => ({
        ...prev,
        error: `no client available for ${scopeLabel(scope)} scope`,
        commandLog: { title: "install", command, ok: false, lines: [`No client is available for ${scopeLabel(scope)} scope.`] },
      }));
      return;
    }
    setState((prev) => ({
      ...prev,
      view: "plan",
      installing: true,
      error: undefined,
      commandLog: {
        title: "install",
        command,
        ok: true,
        lines: [
          `starting install for ${server.name}`,
          `target: ${clientLabel} / ${scopeLabel(scope)}`,
          "checking policy and lock drift...",
        ],
      },
      lastAction: `installing ${server.name}`,
    }));
    try {
      const files: string[] = [];
      let lockfile: Lockfile | undefined;
      const plans = targetClients.map((client) => buildInstallPlan(server, client, { scope }));
      const policyViolations = [];
      for (const plan of plans) {
        const policy = await enforcePolicy(plan);
        if (!policy.ok) policyViolations.push(`${policy.key}: ${policy.issues.map((issue) => issue.message).join("; ")}`);
      }
      if (policyViolations.length) {
        throw new Error(`policy refused install: ${policyViolations.join(" | ")}`);
      }
      const mismatches = [];
      for (const plan of plans) {
        const verification = await verifyAgainstLockfile(plan, "mcp-lock.json");
        if (!verification.ok) mismatches.push(`${verification.key}: ${verification.messages.join("; ")}`);
      }
      if (mismatches.length) {
        throw new Error(`lock drift: ${mismatches.join(" | ")}. Press w to update the lock after review.`);
      }
      setState((prev) => ({
        ...prev,
        commandLog: {
          title: "install",
          command,
          ok: true,
          lines: [
            `policy and lock checks passed for ${targetClients.length} client(s)`,
            `writing ${scopeLabel(scope)} config and mcp-lock.json...`,
          ],
        },
      }));
      for (const [index, client] of targetClients.entries()) {
        const result = await installServerConfig(server, client, scope);
        lockfile = await writeLockfile(
          plans[index],
          "mcp-lock.json",
          lockKey(server.name, client),
        );
        files.push(result.file);
      }
      setState((prev) => ({
        ...prev,
        lockfile,
        installing: false,
        installFlow: prev.installFlow ? { ...prev.installFlow, step: "complete", selected: 0 } : undefined,
        lastAction: `installed ${server.name} -> ${unique(files).join(", ")}`,
        commandLog: {
          title: "install",
          command,
          ok: true,
          lines: [
            `installed ${server.name}@${server.version} for ${clientLabel}`,
            `scope: ${scopeLabel(scope)}`,
            `${unique(files).length === 1 ? "path" : "paths"}: ${unique(files).join(", ")}`,
            "updated mcp-lock.json",
          ],
        },
      }));
      await refreshInstalledRows(state.servers, lockfile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        installing: false,
        installFlow: prev.installFlow ? { ...prev.installFlow, step: "failed", selected: 0 } : undefined,
        error: message,
        commandLog: {
          title: "install",
          command,
          ok: false,
          lines: [message],
        },
      }));
    }
  }

  function beginInstallFlow(): void {
    const baseServer = selectedServer ?? selectedResult?.server;
    if (!baseServer) {
      setState((prev) => ({
        ...prev,
        commandLog: {
          title: "install",
          command: commandLineFor("install", state, selectedServer),
          ok: false,
          lines: ["Select a server before installing."],
        },
      }));
      return;
    }
    const versions = installVersionServers(baseServer);
    const selectedVersionIndex = initialInstallVersionIndex(versions, baseServer.version);
    const server = versions[selectedVersionIndex] ?? versions[0] ?? baseServer;
    setState((prev) => ({
      ...prev,
      installFlow: {
        step: versions.length > 1 ? "version" : "scope",
        server,
        versions,
        preferredClient: prev.client,
        selected: versions.length > 1 ? selectedVersionIndex : prev.installScope === "global" ? 1 : 0,
      },
      inputMode: "normal",
      lastAction: versions.length > 1 ? `install ${server.name}: choose version` : `install ${server.name}: choose scope`,
    }));
  }

  function installVersionServers(server: NormalizedServer): NormalizedServer[] {
    const versions = knownVersions(state.servers, server.name);
    const versionServers = versions
      .map((entry) => state.servers.find((candidate) =>
        candidate.name === server.name
        && candidate.version === entry.version
        && candidate.registrySource === entry.source,
      ) ?? state.servers.find((candidate) => candidate.name === server.name && candidate.version === entry.version))
      .filter((candidate): candidate is NormalizedServer => Boolean(candidate));
    return versionServers.length ? versionServers : [server];
  }

  async function removeSelected(): Promise<void> {
    if (!selectedServer) return;
    try {
      await readLockfile("mcp-lock.json");
      const results: string[] = [];
      for (const client of selectedClientsForScope(state.client, state.installScope)) {
        const configResult = await removeServerConfig(selectedServer.name, client, state.installScope);
        const lockResult = await removeLockfileEntry(selectedServer.name, client, "mcp-lock.json");
        results.push(`${client}:config=${configResult.action},lock=${lockResult.removed ? "removed" : "missing"}`);
      }
      const lockfile = await readLockfile("mcp-lock.json").catch(() => undefined);
      setState((prev) => ({
        ...prev,
        lockfile,
        pendingRemove: undefined,
        lastAction: `removed ${selectedServer.name} (${results.join("; ")})`,
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, pendingRemove: undefined, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  function requestRemoveConfirmation(): void {
    if (!selectedServer) return;
    const pending = state.pendingRemove;
    if (pending?.serverName === selectedServer.name && pending.client === state.client && pending.scope === state.installScope) {
      void removeSelected();
      return;
    }
    setState((prev) => ({
      ...prev,
      pendingRemove: {
        serverName: selectedServer.name,
        client: state.client,
        scope: state.installScope,
      },
      lastAction: `press x again to remove ${selectedServer.name} from ${state.client} ${state.installScope}`,
    }));
  }

  function requestInstalledRemoveConfirmation(row: InstalledServerState | undefined): void {
    if (!row) return;
    setState((prev) => ({
      ...prev,
      deleteConfirm: {
        source: "installed",
        serverName: row.serverName,
        client: row.client,
        scope: row.scope,
        selected: "no",
      },
      pendingRemove: undefined,
      lastAction: `confirm delete ${row.serverName}`,
    }));
  }

  async function testSelected(): Promise<void> {
    if (!selectedServer) {
      setState((prev) => ({
        ...prev,
        commandLog: {
          title: "test",
          command: commandLineFor("test", state, selectedServer),
          ok: false,
          lines: ["Select a server before testing."],
        },
      }));
      return;
    }
    const command = commandLineFor("test", state, selectedServer);
    setState((prev) => ({
      ...prev,
      view: "details",
      testing: true,
      error: undefined,
      testResult: undefined,
      commandLog: {
        title: "test",
        command,
        ok: true,
        lines: [
          `connecting to ${selectedServer.name}`,
          "some MCP tests require tokens or credentials to succeed",
          "running MCP initialize handshake and tools/list...",
        ],
      },
      lastAction: `testing ${selectedServer.name}`,
    }));
    try {
      const result = await testServer(selectedServer, 15000);
      setState((prev) => ({
        ...prev,
        testing: false,
        testResult: result,
        commandLog: {
          title: "test",
          command,
          ok: result.ok,
          lines: [
            result.message,
            `target: ${result.target}`,
            `duration: ${result.durationMs}ms`,
            ...result.tools.slice(0, 4).map((tool) => `tool ${tool.name}${tool.description ? ` - ${tool.description}` : ""}`),
          ],
        },
        lastAction: result.ok ? `test passed: ${result.tools.length} tool(s)` : `test failed: ${result.message}`,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        testing: false,
        commandLog: {
          title: "test",
          command,
          ok: false,
          lines: [message],
        },
        lastAction: `test failed: ${message}`,
      }));
    }
  }

  async function updateInstalled(row: InstalledServerState | undefined): Promise<void> {
    if (!row) return;
    const targetVersion = state.installedVersionSelections[row.id];
    const updateServer = installedTargetServer(row, targetVersion);
    const hasExplicitTarget = Boolean(targetVersion && updateServer);
    if ((!row.canUpdate && !hasExplicitTarget) || !updateServer || (row.lifecycleAction === "none" && !hasExplicitTarget)) {
      const lines = row.locked
        ? [
            `${row.serverName} is already registry-backed and locked for ${row.client}.`,
            row.latestVersion && row.lockedVersion === row.latestVersion
              ? `locked version ${row.lockedVersion} is current.`
              : "No newer installable registry version is loaded for this lock entry.",
            "Refresh registry data or switch source to all/live if you want to check for updates.",
          ]
        : [
            `No installable registry match is loaded for ${row.serverName}.`,
            "Load live registry data or search the registry first, then retry the lifecycle action.",
          ];
      setState((prev) => ({
        ...prev,
        commandLog: {
          title: "update",
          command: row.locked
            ? `toolpin update ${row.serverName} --client ${row.client} --scope ${row.scope}`
            : `toolpin adopt ${row.serverName} --client ${row.client} --scope ${row.scope}`,
          ok: false,
          lines,
        },
      }));
      return;
    }

    const command = row.lifecycleAction === "update"
      ? `toolpin update ${row.serverName} --client ${row.client} --scope ${row.scope}${targetVersion ? ` --version ${targetVersion}` : ""}`
      : `toolpin adopt ${row.serverName} --client ${row.client} --scope ${row.scope}`;
    setState((prev) => ({
      ...prev,
      installing: true,
      error: undefined,
      commandLog: {
        title: row.lifecycleAction,
        command,
        ok: true,
        lines: [
          row.lifecycleAction === "update" ? `updating locked ${row.serverName}` : `adopting unlocked ${row.serverName}`,
          row.lifecycleAction === "update"
            ? "resolving locked registry entry and updating config + mcp-lock.json"
            : "resolving installed alias in registry, making it registry-backed, and locking it",
          row.serverName !== updateServer.name ? `will replace installed alias ${row.serverName} with ${updateServer.name}` : `registry entry ${updateServer.name}`,
          `version ${row.lockedVersion ?? "unlocked"} -> ${updateServer.version}${targetVersion ? " (explicit)" : ""}`,
        ],
      },
      lastAction: row.lifecycleAction === "update" ? `updating ${row.serverName}` : `adopting ${row.serverName}`,
    }));

    try {
      const result = row.lifecycleAction === "update"
        ? await updateInstalledServer({
            serverName: row.serverName,
            client: row.client,
            scope: row.scope,
            servers: state.servers,
            version: targetVersion,
          })
        : await adoptInstalledServer({
            installedName: row.serverName,
            client: row.client,
            scope: row.scope,
            servers: state.servers,
          });
      const lockfile = await readLockfile("mcp-lock.json").catch(() => undefined);
      setState((prev) => ({
        ...prev,
        lockfile,
        installing: false,
        lastAction: result.action === "update" ? `updated ${result.targetName}` : `adopted ${result.targetName}`,
        commandLog: {
          title: result.action,
          command,
          ok: true,
          lines: [
            ...result.planned,
            result.removedAlias ? `removed old alias: ${result.removedAlias.action} ${result.removedAlias.file}` : "no alias removal needed",
            result.config ? `config: ${result.config.action} ${result.config.file}` : "config write skipped",
            result.lockfileWritten ? "mcp-lock.json updated with registry-backed entry" : "mcp-lock.json unchanged",
          ],
        },
      }));
      await refreshInstalledRows(state.servers, lockfile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        installing: false,
        error: message,
        commandLog: {
          title: row.lifecycleAction,
          command,
          ok: false,
          lines: [message],
        },
      }));
    }
  }

  async function updateAllInstalled(): Promise<void> {
    const command = `toolpin update --all --scope ${installed.scope}`;
    setState((prev) => ({
      ...prev,
      installing: true,
      error: undefined,
      commandLog: {
        title: "update",
        command,
        ok: true,
        lines: ["checking locked installed servers for safe updates..."],
      },
    }));
    try {
      const result = await updateAllInstalledServers({
        scope: installed.scope,
        client: "all",
        servers: state.servers,
      });
      const lockfile = await readLockfile("mcp-lock.json").catch(() => undefined);
      setState((prev) => ({
        ...prev,
        lockfile,
        installing: false,
        commandLog: {
          title: "update",
          command,
          ok: true,
          lines: [
            `updated ${result.updated.length} locked registry-backed server(s)`,
            `skipped ${result.skippedAdoptable.length} unlocked adoptable server(s); use u to adopt and lock them`,
            ...result.updated.slice(0, 4).map((entry) => `${entry.serverName} -> ${entry.targetName}@${entry.toVersion}`),
          ],
        },
        lastAction: `updated ${result.updated.length} installed server(s)`,
      }));
      await refreshInstalledRows(state.servers, lockfile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        installing: false,
        error: message,
        commandLog: { title: "update", command, ok: false, lines: [message] },
      }));
    }
  }

  async function removeInstalledTarget(target: Pick<InstalledServerState, "serverName" | "client" | "scope">): Promise<void> {
    try {
      const configResult = await removeServerConfig(target.serverName, target.client, target.scope);
      const lockResult = await removeLockfileEntry(target.serverName, target.client, "mcp-lock.json");
      const lockfile = lockResult.lockfile;
      setState((prev) => ({
        ...prev,
        lockfile,
        deleteConfirm: undefined,
        commandLog: {
          title: "remove",
          command: `toolpin remove ${target.serverName} --client ${target.client} --scope ${target.scope}`,
          ok: true,
          lines: [`config ${configResult.action}: ${configResult.file}`, `lock ${lockResult.removed ? "removed" : "missing"}`],
        },
        lastAction: `removed ${target.serverName} from ${target.client} ${target.scope}`,
      }));
      await refreshInstalledRows(state.servers, lockfile);
    } catch (error) {
      setState((prev) => ({ ...prev, deleteConfirm: undefined, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function testInstalled(row: InstalledServerState | undefined): Promise<void> {
    if (!row) {
      setState((prev) => ({
        ...prev,
        commandLog: {
          title: "test",
          command: "toolpin test-installed",
          ok: false,
          lines: ["Select an installed server first."],
        },
      }));
      return;
    }

    const command = `toolpin test-installed ${row.serverName} --client ${row.client} --scope ${row.scope}`;
    setState((prev) => ({
      ...prev,
      testing: true,
      error: undefined,
      commandLog: {
        title: "test",
        command,
        ok: true,
        lines: [
          `testing installed ${row.serverName}`,
          `using installed config from ${row.file}`,
          "running MCP initialize handshake and tools/list...",
        ],
      },
    }));

    try {
      const result = await testInstalledServer({ serverName: row.serverName, client: row.client, scope: row.scope, timeoutMs: 15000 });
      const tests = { ...installedTests, [installedId(row.serverName, row.client, row.scope)]: result };
      setInstalledTests(tests);
      setState((prev) => ({
        ...prev,
        testing: false,
        commandLog: {
          title: "test",
          command,
          ok: result.ok,
          lines: [result.message, `target: ${result.target}`, `duration: ${result.durationMs}ms`],
        },
        lastAction: result.ok ? `installed test passed: ${row.serverName}` : `installed test failed: ${row.serverName}`,
      }));
      await refreshInstalledRows(state.servers, state.lockfile, installed.scope, tests);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        testing: false,
        commandLog: { title: "test", command, ok: false, lines: [message] },
      }));
    }
  }

  async function runInstalledDoctor(): Promise<void> {
    setState((prev) => ({
      ...prev,
      checking: true,
      commandLog: {
        title: "doctor",
        command: `toolpin doctor --scope ${installed.scope}`,
        ok: true,
        lines: ["checking installed config entries against mcp-lock.json..."],
      },
      lastAction: "checking installed drift state",
    }));

    try {
      const report = await doctorLockfile("mcp-lock.json", installed.scope);
      await refreshInstalledRows();
      setState((prev) => ({
        ...prev,
        checking: false,
        commandLog: {
          title: "doctor",
          command: `toolpin doctor --scope ${installed.scope}`,
          ok: report.ok,
          lines: report.ok
            ? [`checked ${report.checked} locked entrie(s)`, "no lock/config drift found"]
            : [
                `checked ${report.checked} locked entrie(s)`,
                `${report.issues.length} issue(s) found`,
                ...report.issues.slice(0, 6).map((issue) => `${issue.kind}: ${issue.client}/${issue.serverName} ${issue.scope ?? "all"} - ${issue.message}`),
              ],
        },
        lastAction: report.ok ? "no installed drift found" : `doctor found ${report.issues.length} issue(s)`,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        checking: false,
        commandLog: {
          title: "doctor",
          command: `toolpin doctor --scope ${installed.scope}`,
          ok: false,
          lines: [message],
        },
        lastAction: `doctor failed: ${message}`,
      }));
    }
  }

  async function executeCommand(commandId: TuiCommandId): Promise<void> {
    const commandLine = commandLineFor(commandId, state, selectedServer);
    setState((prev) => ({
      ...prev,
      inputMode: "normal",
      commandQuery: "",
      commandSelected: 0,
      commandLog: {
        title: commandId,
        command: commandLine,
        ok: true,
        lines: ["running command-equivalent action..."],
      },
    }));

    if (commandRequiresServer(commandId) && !selectedServer) {
      setState((prev) => ({
        ...prev,
        commandLog: {
          title: commandId,
          command: commandLine,
          ok: false,
          lines: ["Select a server first."],
        },
      }));
      return;
    }

    switch (commandId) {
      case "ingest":
        await refreshCache();
        break;
      case "installed":
        setState((prev) => ({ ...prev, view: "installed", commandLog: { title: "installed", command: commandLine, ok: true, lines: [`${installed.rows.length} installed server entrie(s) loaded`] } }));
        await refreshInstalledRows();
        break;
      case "sources":
        setState((prev) => ({
          ...prev,
          view: "sources",
          commandLog: {
            title: "sources",
            command: commandLine,
            ok: true,
            lines: [
              `${prev.registrySources.filter((source) => source.enabled).length} connected source(s)`,
              `active source: ${prev.sourceMode}`,
            ],
          },
        }));
        break;
      case "search":
        setState((prev) => ({ ...prev, inputMode: "search", view: "discover", commandLog: undefined }));
        break;
      case "more-results":
        showMoreResults();
        break;
      case "reset-view":
        resetViewDefaults();
        break;
      case "info":
        setState((prev) => ({
          ...prev,
          view: "details",
          commandLog: {
            title: "info",
            command: commandLine,
            ok: true,
            lines: selectedServer ? [
              `${selectedServer.name}@${selectedServer.version}`,
              selectedServer.title,
              selectedServer.description || "No description declared.",
            ] : [],
          },
        }));
        break;
      case "audit":
        setState((prev) => ({
          ...prev,
          view: "details",
          commandLog: {
            title: "audit",
            command: commandLine,
            ok: true,
            lines: selectedResult ? [
              `trust tier: ${trustRiskTone(selectedResult.trust).label}`,
              `metadata completeness: ${selectedResult.trust.score}`,
              `badges: ${selectedResult.trust.badges.join(", ") || "none"}`,
              ...selectedResult.trust.issues.slice(0, 4).map((issue) => `${issue.severity}: ${issue.message}`),
            ] : [],
          },
        }));
        break;
      case "plan":
        setState((prev) => ({ ...prev, view: "plan" }));
        break;
      case "install":
        beginInstallFlow();
        break;
      case "remove":
        await removeSelected();
        break;
      case "doctor": {
        setState((prev) => ({
          ...prev,
          checking: true,
          commandLog: {
            title: "doctor",
            command: commandLine,
            ok: true,
            lines: [`checking ${state.installScope} config against mcp-lock.json...`],
          },
        }));
        try {
          const report = await doctorLockfile("mcp-lock.json", state.installScope);
          setState((prev) => ({
            ...prev,
            checking: false,
            commandLog: {
              title: "doctor",
              command: commandLine,
              ok: report.ok,
              lines: report.ok
                ? [`${report.checked} locked server/client entrie(s) match ${state.installScope} config.`]
                : report.issues.slice(0, 5).map((issue) => `${issue.kind} ${issue.key}: ${issue.message}`),
            },
          }));
        } catch (error) {
          setState((prev) => ({
            ...prev,
            checking: false,
            commandLog: {
              title: "doctor",
              command: commandLine,
              ok: false,
              lines: [error instanceof Error ? error.message : String(error)],
            },
          }));
        }
        break;
      }
      case "test":
        await testSelected();
        break;
      case "ci":
        setState((prev) => ({
          ...prev,
          commandLog: {
            title: "ci",
            command: commandLine,
            ok: true,
            lines: ["Run this command in a shell for live registry drift checks."],
          },
        }));
        break;
      case "lock":
        await writeSelectedLock();
        break;
      case "export-config":
        await saveSelectedConfig();
        break;
      case "tui":
        setState((prev) => ({
          ...prev,
          commandLog: { title: "tui", command: commandLine, ok: true, lines: ["You are already in the TUI."] },
        }));
        break;
      case "help":
        setState((prev) => ({ ...prev, view: "help" }));
        break;
    }
  }

  function showMoreResults(): void {
    setState((prev) => {
      const nextLimit = nextResultLimit(prev.resultLimit, allResults.length);
      const atAllMatches = prev.resultLimit >= allResults.length;
      return {
        ...prev,
        resultLimit: nextLimit,
        commandLog: {
          title: "results",
          command: "toolpin tui",
          ok: true,
          lines: [
            atAllMatches ? `already showing all ${allResults.length} matches` : `showing ${Math.min(nextLimit, allResults.length)} / ${allResults.length} matches`,
            "Use / to edit the search, g to change source, r to refresh listings.",
          ],
        },
        lastAction: atAllMatches ? `showing all ${allResults.length} matches` : `showing ${Math.min(nextLimit, allResults.length)} matches`,
      };
    });
  }

  function resetViewDefaults(): void {
    setState((prev) => ({
      ...prev,
      query: "github",
      commandQuery: "",
      commandSelected: 0,
      selected: 0,
      view: "discover",
      inputMode: "normal",
      sourceMode: "all",
      browseVersionMode: "latest",
      resultLimit: DEFAULT_RESULT_LIMIT,
      client: "claude",
      installScope: "project",
      versionSelections: {},
      pendingRemove: undefined,
      deleteConfirm: undefined,
      commandLog: {
        title: "reset",
        command: "toolpin tui",
        ok: true,
        lines: ["reset search, source, result count, client, and scope to defaults"],
      },
      lastAction: "reset TUI defaults",
    }));
  }

  useInput((input, key) => {
    const mouse = parseMouse(input);
    if (mouse?.pressed && handleMouseClick(mouse.x, mouse.y)) {
      return;
    }

    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (state.deleteConfirm) {
      const confirm = state.deleteConfirm;
      if (key.escape || input === "n" || input === "N") {
        setState((prev) => ({ ...prev, deleteConfirm: undefined, lastAction: "delete cancelled" }));
        return;
      }
      if (input === "y" || input === "Y") {
        setState((prev) => ({ ...prev, deleteConfirm: undefined, lastAction: `deleting ${confirm.serverName}` }));
        void removeInstalledTarget(confirm);
        return;
      }
      if (key.leftArrow || key.rightArrow || input === "h" || input === "l" || input === "j" || input === "k") {
        setState((prev) => (prev.deleteConfirm
          ? {
              ...prev,
              deleteConfirm: {
                ...prev.deleteConfirm,
                selected: prev.deleteConfirm.selected === "no" ? "yes" : "no",
              },
            }
          : prev));
        return;
      }
      if (key.return) {
        setState((prev) => ({ ...prev, deleteConfirm: undefined, lastAction: confirm.selected === "yes" ? `deleting ${confirm.serverName}` : "delete cancelled" }));
        if (confirm.selected === "yes") void removeInstalledTarget(confirm);
        return;
      }
      return;
    }

    if (state.installFlow) {
      const flow = state.installFlow;
      if (key.escape) {
        if (flow.step === "installing") return;
        setState((prev) => ({ ...prev, installFlow: undefined, lastAction: "install cancelled" }));
        return;
      }
      const clientChoices = installClientChoicesForScope(flow.scope ?? "project", flow.preferredClient);
      const optionCount = flow.step === "version" ? flow.versions.length : flow.step === "scope" ? 2 : flow.step === "client" ? clientChoices.length : 1;
      if (key.upArrow || input === "k") {
        setState((prev) => (prev.installFlow ? { ...prev, installFlow: { ...prev.installFlow, selected: Math.max(0, prev.installFlow.selected - 1) } } : prev));
        return;
      }
      if (key.downArrow || input === "j") {
        setState((prev) => (prev.installFlow ? { ...prev, installFlow: { ...prev.installFlow, selected: Math.min(optionCount - 1, prev.installFlow.selected + 1) } } : prev));
        return;
      }
      if (key.return) {
        if (flow.step === "version") {
          const server = flow.versions[Math.min(flow.selected, flow.versions.length - 1)] ?? flow.server;
          setState((prev) => (prev.installFlow
            ? {
                ...prev,
                versionSelections: { ...prev.versionSelections, [server.name]: server.version },
                installFlow: {
                  ...prev.installFlow,
                  step: "scope",
                  server,
                  selected: prev.installScope === "global" ? 1 : 0,
                },
                lastAction: `install ${server.name}@${server.version}: choose scope`,
              }
            : prev));
        } else if (flow.step === "scope") {
          const scope: InstallScope = flow.selected === 1 ? "global" : "project";
          setState((prev) => (prev.installFlow ? { ...prev, installFlow: { ...prev.installFlow, step: "client", scope, selected: 0 } } : prev));
        } else if (flow.step === "client") {
          const scope = flow.scope ?? "project";
          const client = clientChoices[Math.min(flow.selected, clientChoices.length - 1)];
          const clients = client === "all" ? selectedClientsForScope("all", scope) : [client];
          const clientLabel = installClientLabel(client, clients);
          setState((prev) => (prev.installFlow
            ? { ...prev, installFlow: { ...prev.installFlow, step: "installing", selected: 0 }, client, installScope: scope }
            : { ...prev, client, installScope: scope }));
          void installSelected({ server: flow.server, client, clients, scope, clientLabel });
        } else if (flow.step === "complete" || flow.step === "failed") {
          setState((prev) => ({ ...prev, installFlow: undefined }));
        }
        return;
      }
      return;
    }

    if (state.inputMode === "search") {
      if (key.escape) {
        setState((prev) => ({
          ...prev,
          inputMode: "normal",
          query: "",
          selected: 0,
          view: "discover",
          pendingRemove: undefined,
          testResult: undefined,
          commandLog: undefined,
        }));
        return;
      }
      if (key.return) {
        setState((prev) => ({ ...prev, inputMode: "normal", selected: 0, view: "discover", pendingRemove: undefined, testResult: undefined, commandLog: undefined }));
        if (state.dataMode === "live") void loadData("live", state.query);
        return;
      }
      if (key.backspace || key.delete) {
        setState((prev) => ({ ...prev, query: prev.query.slice(0, -1), selected: 0, pendingRemove: undefined, testResult: undefined, commandLog: undefined }));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setState((prev) => ({ ...prev, query: prev.query + input, selected: 0, pendingRemove: undefined, testResult: undefined, commandLog: undefined }));
      }
      return;
    }

    if (state.inputMode === "command") {
      if (key.escape) {
        setState((prev) => ({ ...prev, inputMode: "normal", commandQuery: "", commandSelected: 0 }));
        return;
      }
      if (key.return) {
        if (selectedCommand) void executeCommand(selectedCommand.id);
        return;
      }
      if (key.upArrow || input === "k") {
        setState((prev) => ({ ...prev, commandSelected: Math.max(0, prev.commandSelected - 1) }));
        return;
      }
      if (key.downArrow || input === "j") {
        setState((prev) => ({ ...prev, commandSelected: Math.min(Math.max(0, commandResults.length - 1), prev.commandSelected + 1) }));
        return;
      }
      if (key.backspace || key.delete) {
        setState((prev) => ({ ...prev, commandQuery: prev.commandQuery.slice(0, -1), commandSelected: 0 }));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setState((prev) => ({ ...prev, commandQuery: prev.commandQuery + input, commandSelected: 0 }));
      }
      return;
    }

    if (state.view === "help") {
      if (key.escape) {
        switchToView("discover");
        return;
      }
      if (key.tab) {
        switchToView(nextEnabledView(state.view));
        return;
      }
      if (input === "q") {
        exit();
        return;
      }
      if (input === "h" || input === "?") {
        switchToView("discover");
        return;
      }
      return;
    }

    if (key.escape && state.view !== "discover") {
      switchToView("discover");
      return;
    }
    if (key.tab) {
      switchToView(nextEnabledView(state.view));
      return;
    }
    if (state.view === "installed" && (key.upArrow || input === "k")) {
      dispatchInstalled({ type: "move", delta: -1 });
      return;
    }
    if (state.view === "installed" && (key.downArrow || input === "j")) {
      dispatchInstalled({ type: "move", delta: 1 });
      return;
    }
    if (state.view === "sources" && (key.upArrow || input === "k")) {
      setState((prev) => ({ ...prev, sourceSelected: Math.max(0, prev.sourceSelected - 1) }));
      return;
    }
    if (state.view === "sources" && (key.downArrow || input === "j")) {
      setState((prev) => ({ ...prev, sourceSelected: Math.min(Math.max(0, sourceRows(prev.registrySources).length - 1), prev.sourceSelected + 1) }));
      return;
    }
    if (key.upArrow || input === "k") {
      setState((prev) => ({ ...prev, selected: Math.max(0, prev.selected - 1), pendingRemove: undefined, testResult: undefined, commandLog: undefined }));
      return;
    }
    if (key.downArrow || input === "j") {
      setState((prev) => ({ ...prev, selected: Math.min(Math.max(0, results.length - 1), prev.selected + 1), pendingRemove: undefined, testResult: undefined, commandLog: undefined }));
      return;
    }
    if (key.return) {
      if (state.view === "sources") {
        void toggleSelectedSource();
      } else if ((state.view === "discover" || state.view === "details") && selectedServer) {
        switchToView("plan");
      } else if (state.view === "plan" && selectedServer) {
        beginInstallFlow();
      }
      return;
    }

    switch (input) {
      case "q":
        exit();
        break;
      case "/":
        setState((prev) => ({ ...prev, inputMode: "search", view: "discover" }));
        break;
      case ":":
        setState((prev) => ({ ...prev, inputMode: "command", commandQuery: "", commandSelected: 0 }));
        break;
      case "r":
        void refreshCache(state.view === "sources" ? "all" : state.sourceMode);
        break;
      case "R":
        if (state.view === "sources") void refreshCache("all");
        else resetViewDefaults();
        break;
      case " ":
        if (state.view === "sources") void toggleSelectedSource();
        break;
      case "b":
        setState((prev) => ({
          ...prev,
          browseVersionMode: prev.browseVersionMode === "latest" ? "all" : "latest",
          selected: 0,
          lastAction: `browse ${prev.browseVersionMode === "latest" ? "all cached versions" : "latest servers"}`,
        }));
        break;
      case "I":
        switchToView("installed");
        void refreshInstalledRows();
        break;
      case "i":
        if (state.view !== "installed") beginInstallFlow();
        break;
      case "m":
      case "+":
        showMoreResults();
        break;
      case "f":
        if (state.view === "discover") {
          setState((prev) => ({
            ...prev,
            browseLayout: nextBrowseLayout(prev.browseLayout, hasCategoryMetadata(results)),
            selected: 0,
            pendingRemove: undefined,
            testResult: undefined,
            commandLog: undefined,
          }));
        }
        break;
      case "x":
        if (state.view === "installed") {
          requestInstalledRemoveConfirmation(selectedInstalled);
        } else {
          requestRemoveConfirmation();
        }
        break;
      case "t":
        if (state.view === "installed") {
          void testInstalled(selectedInstalled);
        } else {
          void testSelected();
        }
        break;
      case "u":
        if (state.view === "installed") void updateInstalled(selectedInstalled);
        break;
      case "U":
        if (state.view === "installed") void updateAllInstalled();
        break;
      case "d":
        if (state.view === "installed") {
          void runInstalledDoctor();
        }
        break;
      case "l":
        void loadData(state.dataMode === "cache" ? "live" : "cache");
        break;
      case "g":
        if (state.view === "installed") {
          const nextScope = installed.scope === "all" ? "project" : installed.scope === "project" ? "global" : "all";
          dispatchInstalled({ type: "scope", scope: nextScope });
          void refreshInstalledRows(state.servers, state.lockfile, nextScope);
        } else {
          void loadData(state.dataMode, state.query, nextSource(state.sourceMode));
        }
        break;
      case "G":
        setState((prev) => ({
          ...prev,
          installScope: prev.installScope === "project" ? "global" : "project",
          pendingRemove: undefined,
          lastAction: `install scope ${prev.installScope === "project" ? "global" : "project"}`,
        }));
        break;
      case "v":
        if (state.view === "installed") cycleInstalledVersion(1);
        else cycleSelectedVersion(1);
        break;
      case "V":
        if (state.view === "installed") cycleInstalledVersion(-1);
        else cycleSelectedVersion(-1);
        break;
      case "c":
        setState((prev) => ({ ...prev, client: nextClient(prev.client), pendingRemove: undefined }));
        break;
      case "o":
        setState((prev) => ({ ...prev, client: "opencode", pendingRemove: undefined }));
        break;
      case "w":
        void writeSelectedLock();
        break;
      case "s":
        void saveSelectedConfig();
        break;
      case "S":
        switchToView("sources");
        break;
      case "h":
      case "?":
        setState((prev) => ({ ...prev, view: prev.view === "help" ? "discover" : "help" }));
        break;
      case "1":
        switchToView("discover");
        break;
      case "2":
        switchToView("installed");
        break;
      case "3":
        switchToView("details");
        break;
      case "4":
        switchToView("plan");
        break;
      case "5":
        switchToView("config");
        break;
      case "6":
      case "7":
        switchToView("help");
        break;
    }
  });

  function handleMouseClick(x: number, y: number): boolean {
    if (state.installFlow || state.deleteConfirm) return false;
    const hit = hitTestTui(x, y, buildTuiHitZones({
      width,
      listHeight,
      selectedIndex: state.view === "installed" ? installed.selected : selectedIndex,
      resultCount: state.view === "installed" ? installed.rows.length : results.length,
      hasSelection: Boolean(selectedServer),
      selectedLabel: selectedServer?.title || selectedServer?.name,
      listActive: state.inputMode === "normal" && (state.view === "discover" || state.view === "installed"),
    }));
    if (hit?.kind === "view") {
      setState((prev) => switchView(prev, hit.view));
      return true;
    }
    if (hit?.kind === "server") {
      if (state.view === "installed") {
        dispatchInstalled({ type: "select", selected: hit.index });
      } else {
        setState((prev) => ({ ...prev, selected: hit.index, pendingRemove: undefined, testResult: undefined, commandLog: undefined }));
      }
      return true;
    }

    return false;
  }

  function cycleSelectedVersion(direction: 1 | -1): void {
    if (!selectedResult) return;
    const versions = knownVersions(state.servers, selectedResult.server.name);
    if (versions.length <= 1) {
      setState((prev) => ({
        ...prev,
        commandLog: {
          title: "versions",
          command: commandLineFor("info", prev, selectedServer),
          ok: true,
          lines: [`only one known version for ${selectedResult.server.name}: ${selectedResult.server.version}`],
        },
      }));
      return;
    }
    const currentVersion = selectedServer?.version ?? selectedResult.server.version;
    const currentIndex = Math.max(0, versions.findIndex((entry) => entry.version === currentVersion));
    const nextIndex = (currentIndex + direction + versions.length) % versions.length;
    const nextVersion = versions[nextIndex]?.version ?? selectedResult.server.version;
    setState((prev) => ({
      ...prev,
      versionSelections: {
        ...prev.versionSelections,
        [selectedResult.server.name]: nextVersion,
      },
      testResult: undefined,
      commandLog: {
        title: "versions",
        command: commandLineFor("info", prev, selectedServer),
        ok: true,
        lines: [
          `selected ${selectedResult.server.name}@${nextVersion}`,
          "Install uses the selected version shown in the Install tab.",
        ],
      },
      lastAction: `selected version ${nextVersion}`,
    }));
  }

  function installedVersionServers(row: InstalledServerState | undefined): NormalizedServer[] {
    if (!row) return [];
    const targetName = row.updateServer?.name ?? row.installableServer?.name;
    if (!targetName) return [];
    return knownVersions(state.servers, targetName)
      .map((entry) => state.servers.find((candidate) => candidate.name === targetName && candidate.version === entry.version))
      .filter((server): server is NormalizedServer => Boolean(server?.installable));
  }

  function installedTargetServer(row: InstalledServerState, selectedVersion?: string): NormalizedServer | undefined {
    if (!selectedVersion) return row.updateServer;
    return installedVersionServers(row).find((server) => server.version === selectedVersion);
  }

  function cycleInstalledVersion(direction: 1 | -1): void {
    const row = selectedInstalled;
    if (!row) return;
    if (!row.locked) {
      setState((prev) => ({
        ...prev,
        commandLog: {
          title: "versions",
          command: `toolpin update ${row.serverName} --client ${row.client} --scope ${row.scope}`,
          ok: false,
          lines: ["Version selection is for locked installed entries. Use u to adopt and lock this entry first."],
        },
      }));
      return;
    }
    const versions = installedVersionServers(row);
    if (versions.length <= 1) {
      setState((prev) => ({
        ...prev,
        commandLog: {
          title: "versions",
          command: `toolpin update ${row.serverName} --client ${row.client} --scope ${row.scope}`,
          ok: true,
          lines: [`only one known registry version for ${row.serverName}: ${row.lockedVersion ?? row.latestVersion ?? "unknown"}`],
        },
      }));
      return;
    }
    const currentVersion = state.installedVersionSelections[row.id] ?? row.updateServer?.version ?? row.lockedVersion ?? versions[0]?.version;
    const currentIndex = Math.max(0, versions.findIndex((entry) => entry.version === currentVersion));
    const nextIndex = (currentIndex + direction + versions.length) % versions.length;
    const nextVersion = versions[nextIndex]?.version ?? currentVersion;
    setState((prev) => ({
      ...prev,
      installedVersionSelections: {
        ...prev.installedVersionSelections,
        [row.id]: nextVersion,
      },
      commandLog: {
        title: "versions",
        command: `toolpin update ${row.serverName} --client ${row.client} --scope ${row.scope} --version ${nextVersion}`,
        ok: true,
        lines: [
          `selected installed target ${row.serverName}@${nextVersion}`,
          "Press u to rewrite the client config and mcp-lock.json for this explicit version.",
        ],
      },
      lastAction: `selected installed version ${nextVersion}`,
    }));
  }

  function switchToView(view: View): void {
    if (SERVER_VIEWS.has(view) && !selectedServer) return;
    setState((prev) => switchView(prev, view));
  }

  function nextEnabledView(view: View): View {
    const order: View[] = selectedServer ? ["discover", "installed", "details", "plan", "config", "help"] : ["discover", "installed", "help"];
    return order[(order.indexOf(view) + 1) % order.length] ?? "discover";
  }

  const visibleCommandLog = commandLogForView(state);
  const activityRows = visibleCommandLog?.lines.length ? Math.min(3, visibleCommandLog.lines.length) : 1;
  const paneHeight = Math.max(8, height - 14 - activityRows);
  const listHeight = state.view === "discover" || state.view === "installed" ? paneHeight : Math.min(6, Math.max(3, height - 18 - activityRows));
  const modalWidth = Math.min(width - 4, 104);
  const modalContentWidth = Math.max(40, modalWidth - 4);
  const desiredLeftPaneWidth = Math.max(44, Math.min(88, Math.floor(width * 0.56)));
  const rightPaneWidth = Math.max(40, width - desiredLeftPaneWidth - 4);
  const leftPaneWidth = Math.max(34, width - rightPaneWidth - 4);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ChromeHeader
        state={state}
        resultCount={state.view === "installed" ? installed.rows.length : results.length}
        totalMatches={state.view === "installed" ? installed.rows.length : allResults.length}
        selectedServer={selectedServer}
        width={width}
      />
      <PromptBar state={state} width={width} />
      <ModeLine active={state.view} selectedServer={selectedServer} width={width} />
      <Box flexDirection="column" flexGrow={1}>
        {state.inputMode === "command" ? (
          <Centered width={width}>
            <Box width={modalWidth}>
              <CommandPalette
                commands={commandResults}
                selected={selectedCommandIndex}
                state={state}
                selectedServer={selectedServer}
                width={modalContentWidth}
              />
            </Box>
          </Centered>
        ) : state.view === "help" ? (
          <Box marginX={2} height={paneHeight}>
            <HelpView width={width - 4} height={paneHeight} />
          </Box>
        ) : state.view === "sources" ? (
          <Box marginX={2} height={paneHeight}>
            <SourcesView
              sources={state.registrySources}
              entries={state.entries}
              activeSource={state.sourceMode}
              selectedSource={state.sourceSelected}
              dataMode={state.dataMode}
              width={width - 4}
              height={paneHeight}
            />
          </Box>
        ) : state.view === "installed" ? (
          <Box marginX={2} height={paneHeight}>
            <InstalledServersView
              rows={installed.rows}
              selected={installed.selected}
              height={paneHeight}
              width={leftPaneWidth}
              loading={installed.loading}
            />
            <Box width={rightPaneWidth} height={paneHeight} flexDirection="column">
              <InstalledServerDetails
                row={selectedInstalled}
                width={rightPaneWidth - 4}
                selectedVersion={selectedInstalledTargetVersion}
                selectedTarget={selectedInstalledTarget}
              />
            </Box>
          </Box>
        ) : (
          <Box marginX={2} height={paneHeight}>
            <OptionList
              results={results}
              totalMatches={allResults.length}
              totalServers={latestOnly(state.servers).length}
              totalVersions={state.servers.length}
              selected={selectedIndex}
              height={paneHeight}
              width={leftPaneWidth}
              query={state.query}
              loading={state.loading && state.servers.length === 0}
              browseLayout={browseLayout}
              dimmed={state.view !== "discover"}
            />
            {(state.view === "discover" && selectedServer) || SERVER_VIEWS.has(state.view) || state.installFlow ? (
              <Box width={rightPaneWidth} height={paneHeight} flexDirection="column">
                {state.installFlow ? (
                  <InstallWizard flow={state.installFlow} width={rightPaneWidth - 4} height={paneHeight} />
                ) : (
                  <SelectedServerPanel
                    view={state.view}
                    result={selectedResult}
                    server={selectedServer}
                    client={state.client}
                    installScope={state.installScope}
                    width={rightPaneWidth - 4}
                    testResult={state.testResult}
                    testing={state.testing}
                    versionInfo={selectedVersionInfo}
                  />
                )}
              </Box>
            ) : null}
          </Box>
        )}
      </Box>
      <OperationModal state={state} width={width} height={height} />
      <DeleteConfirmModal state={state} width={width} height={height} />
      <ActivityStrip state={state} width={width} />
      {state.error ? <Text color={ERR} wrap="truncate"> error: {truncate(state.error, width - 8)}</Text> : null}
      <Footer view={state.view} inputMode={state.inputMode} width={width} />
    </Box>
  );
}

function sourceRows(sources: TuiState["registrySources"]): TuiState["registrySources"] {
  return [...sources].sort((left, right) => (
    Number(right.enabled) - Number(left.enabled)
    || sourceTrustRank(left.trust) - sourceTrustRank(right.trust)
    || (left.mode === right.mode ? 0 : left.mode === "installable" ? -1 : 1)
    || left.label.localeCompare(right.label)
  ));
}

function registrySourcesWithFetchResult(
  sources: RegistrySourceInfo[],
  result: RegistryFetchResult & { results?: RegistryFetchResult[] },
): RegistrySourceInfo[] {
  const results = result.results ?? [result];
  const bySource = new Map(results.map((entry) => [entry.source.id, entry]));
  return sources.map((source) => {
    const fetched = bySource.get(source.id);
    if (!fetched) return source;
    return {
      ...source,
      status: fetched.status,
      setupHint: fetched.source.setupHint ?? source.setupHint,
      cacheEntries: fetched.entries.length,
      cachePageInfo: fetched.pageInfo,
    };
  });
}

function sourceTrustRank(trust: TuiState["registrySources"][number]["trust"]): number {
  if (trust === "canonical") return 0;
  if (trust === "curated") return 1;
  if (trust === "directory") return 2;
  return 3;
}

function useTerminalSize(stdout: ReturnType<typeof useStdout>["stdout"]): { width: number; height: number } {
  const readSize = () => ({
    width: Math.max(72, stdout.columns ?? 110),
    height: Math.max(24, stdout.rows ?? 34),
  });
  const [size, setSize] = useState(readSize);

  useEffect(() => {
    const onResize = () => setSize(readSize());
    onResize();
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}

function nextBrowseLayout(current: BrowseLayout, hasCategories: boolean): BrowseLayout {
  if (current === "flat") return "project";
  if (current === "project") return hasCategories ? "category" : "flat";
  return "flat";
}

function hasCategoryMetadata(results: Array<{ server: NormalizedServer }>): boolean {
  return results.some((result) => {
    const sourceMeta = result.server.raw._meta?.["dev.toolpin/source"];
    const category = sourceMeta && typeof sourceMeta === "object" && !Array.isArray(sourceMeta)
      ? (sourceMeta as Record<string, unknown>).category
      : undefined;
    return typeof category === "string" && category.trim().length > 0;
  });
}

function parseMouse(input: string): { x: number; y: number; pressed: boolean } | undefined {
  const match = /^\x1b\[<(\d+);(\d+);(\d+)([mM])$/.exec(input);
  if (!match) return undefined;
  const button = Number(match[1]);
  return {
    x: Number(match[2]),
    y: Number(match[3]),
    pressed: match[4] === "M" && button === 0,
  };
}
