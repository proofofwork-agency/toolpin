import { useEffect, useMemo, useReducer, useState } from "react";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { exportClientConfig } from "../config.js";
import { doctorLockfile } from "../doctor.js";
import { installServerConfig, removeServerConfig } from "../install.js";
import { adoptInstalledServer, testInstalledServer, updateAllInstalledServers, updateInstalledServer } from "../installed.js";
import { buildInstallPlan, lockKey, readLockfile, removeLockfileEntry, verifyAgainstLockfile, writeLockfile, type Lockfile } from "../plan.js";
import { enforcePolicy } from "../policy.js";
import { fetchRegistry, latestOnly, normalizeEntries, readCache, writeCache } from "../registry.js";
import { searchServers } from "../search.js";
import { testServer, type ServerTestResult } from "../tester.js";
import { commandLineFor, commandRequiresServer } from "./command.js";
import {
  DEFAULT_RESULT_LIMIT,
  ERR,
  MAX_RESULT_LIMIT,
  RESULT_LIMIT_STEP,
  SERVER_VIEWS,
  TUI_COMMANDS,
} from "./constants.js";
import { formatClientConfigSnippet } from "./configSnippet.js";
import { clamp, safeFileName, truncate, unique } from "./format.js";
import { buildTuiHitZones, hitTestTui } from "./layout.js";
import {
  buildTuiVersionInfo,
  cacheHasSource,
  commandLogForView,
  filterBySource,
  installClientLabel,
  nextClient,
  nextSource,
  nextView,
  pruneVersionSelections,
  scopeLabel,
  selectedClients,
  selectedClientsForScope,
  selectedServerVersion,
  switchView,
} from "./selectors.js";
import type { DataMode, TuiCommandId, TuiState } from "./types.js";
import { knownVersions } from "../versions.js";
import { installedId, installedViewReducer, loadInstalledServerStates, type InstalledServerState } from "./installedState.js";
import {
  ActivityStrip,
  Centered,
  ChromeHeader,
  CommandPalette,
  Footer,
  HelpView,
  ModeLine,
  OptionList,
  PromptBar,
  SelectedServerPanel,
} from "./views/panels.js";
import { InstalledServerDetails, InstalledServersView } from "./views/installed.js";

export function MpmTui() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { width, height } = useTerminalSize(stdout);
  const [state, setState] = useState<TuiState>(() => ({
    entries: [],
    servers: [],
    query: "github",
    commandQuery: "",
    commandSelected: 0,
    selected: 0,
    versionSelections: {},
    view: "discover",
    inputMode: "normal",
    dataMode: "cache",
    sourceMode: "all",
    resultLimit: DEFAULT_RESULT_LIMIT,
    client: "claude",
    installScope: "project",
    loading: true,
    installing: false,
    testing: false,
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

  const allResults = useMemo(() => {
    const latest = latestOnly(state.servers);
    return searchServers(latest, state.query || "mcp", MAX_RESULT_LIMIT);
  }, [state.servers, state.query]);
  const results = useMemo(() => allResults.slice(0, state.resultLimit), [allResults, state.resultLimit]);

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

  async function loadData(mode: DataMode, query = state.query, sourceMode = state.sourceMode): Promise<void> {
    setState((prev) => ({ ...prev, loading: true, error: undefined, dataMode: mode }));
    try {
      const entries = mode === "live"
        ? await fetchRegistry({ maxPages: 4, search: query || undefined, source: sourceMode })
        : await readCache().then(async (cached) => {
            if (!cacheHasSource(cached, sourceMode)) {
              const fetched = await fetchRegistry({ maxPages: 3, search: query || undefined, source: sourceMode });
              await writeCache(fetched);
              return fetched;
            }
            return cached;
          }).catch(async () => {
            const fetched = await fetchRegistry({ maxPages: 3, search: query || undefined, source: sourceMode });
            await writeCache(fetched);
            return fetched;
          });
      const servers = normalizeEntries(entries);
      const lockfile = await readLockfile("mcp-lock.json").catch(() => undefined);
      void refreshInstalledRows(servers, lockfile);
      setState((prev) => ({
        ...prev,
        entries,
        servers: filterBySource(servers, sourceMode),
        lockfile,
        selected: 0,
        versionSelections: pruneVersionSelections(prev.versionSelections, servers),
        resultLimit: DEFAULT_RESULT_LIMIT,
        loading: false,
        error: undefined,
        dataMode: mode,
        sourceMode,
        lastAction: mode === "live" ? `loaded live ${sourceMode}` : `loaded cache ${sourceMode}`,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function refreshCache(): Promise<void> {
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const entries = await fetchRegistry({ maxPages: 6, search: state.query || undefined, source: state.sourceMode });
      await writeCache(entries);
      const servers = normalizeEntries(entries);
      const lockfile = await readLockfile("mcp-lock.json").catch(() => undefined);
      void refreshInstalledRows(servers, lockfile);
      setState((prev) => ({
        ...prev,
        entries,
        servers: filterBySource(servers, state.sourceMode),
        lockfile,
        selected: 0,
        versionSelections: pruneVersionSelections(prev.versionSelections, servers),
        resultLimit: DEFAULT_RESULT_LIMIT,
        loading: false,
        error: undefined,
        dataMode: "cache",
        lastAction: `ingested ${entries.length} ${state.sourceMode} versions`,
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
          buildInstallPlan(selectedServer, client),
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

  async function installSelected(): Promise<void> {
    if (!selectedServer) {
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
    const targetClients = selectedClientsForScope(state.client, state.installScope);
    const command = commandLineFor("install", state, selectedServer);
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
          `starting install for ${selectedServer.name}`,
          `target: ${installClientLabel(state.client, targetClients)} / ${scopeLabel(state.installScope)}`,
          "checking policy and lock drift...",
        ],
      },
      lastAction: `installing ${selectedServer.name}`,
    }));
    try {
      const files: string[] = [];
      let lockfile: Lockfile | undefined;
      const plans = targetClients.map((client) => buildInstallPlan(selectedServer, client));
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
            `writing ${scopeLabel(state.installScope)} config and mcp-lock.json...`,
          ],
        },
      }));
      for (const [index, client] of targetClients.entries()) {
        const result = await installServerConfig(selectedServer, client, state.installScope);
        lockfile = await writeLockfile(
          plans[index],
          "mcp-lock.json",
          lockKey(selectedServer.name, client),
        );
        files.push(result.file);
      }
      setState((prev) => ({
        ...prev,
        lockfile,
        installing: false,
        lastAction: `installed for ${state.client} -> ${unique(files).join(", ")}`,
        commandLog: {
          title: "install",
          command,
          ok: true,
          lines: [
            `installed for ${installClientLabel(state.client, targetClients)}`,
            `scope: ${scopeLabel(state.installScope)}`,
            `paths: ${unique(files).join(", ")}`,
            "updated mcp-lock.json",
          ],
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        installing: false,
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
    if (!row.canUpdate || !row.updateServer || row.lifecycleAction === "none") {
      setState((prev) => ({
        ...prev,
        commandLog: {
          title: "update",
          command: row.locked
            ? `toolpin update ${row.serverName} --client ${row.client} --scope ${row.scope}`
            : `toolpin adopt ${row.serverName} --client ${row.client} --scope ${row.scope}`,
          ok: false,
          lines: [
            `No installable registry match is loaded for ${row.serverName}.`,
            "Load live registry data or search the registry first, then retry the lifecycle action.",
          ],
        },
      }));
      return;
    }

    const updateServer = row.updateServer;
    const command = row.lifecycleAction === "update"
      ? `toolpin update ${row.serverName} --client ${row.client} --scope ${row.scope}`
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
          row.serverName !== updateServer.name ? `will replace installed alias ${row.serverName} with ${updateServer.name}` : `registry entry ${updateServer.name}`,
          `version ${row.lockedVersion ?? "unlocked"} -> ${updateServer.version}`,
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
            result.lockfileWritten ? "lockfile updated" : "lockfile unchanged",
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
            `updated ${result.updated.length} locked server(s)`,
            `skipped ${result.skippedAdoptable.length} unlocked adoptable server(s)`,
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

  async function removeInstalled(row: InstalledServerState | undefined): Promise<void> {
    if (!row) return;
    try {
      const configResult = await removeServerConfig(row.serverName, row.client, row.scope);
      const lockResult = await removeLockfileEntry(row.serverName, row.client, "mcp-lock.json");
      const lockfile = lockResult.lockfile;
      setState((prev) => ({
        ...prev,
        lockfile,
        commandLog: {
          title: "remove",
          command: `toolpin remove ${row.serverName} --client ${row.client} --scope ${row.scope}`,
          ok: true,
          lines: [`config ${configResult.action}: ${configResult.file}`, `lock ${lockResult.removed ? "removed" : "missing"}`],
        },
        lastAction: `removed ${row.serverName} from ${row.client} ${row.scope}`,
      }));
      await refreshInstalledRows(state.servers, lockfile);
    } catch (error) {
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
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
              `trust score: ${selectedResult.trust.score}`,
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
        await installSelected();
        break;
      case "remove":
        await removeSelected();
        break;
      case "doctor": {
        try {
          const report = await doctorLockfile("mcp-lock.json", state.installScope);
          setState((prev) => ({
            ...prev,
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
      const nextLimit = Math.min(MAX_RESULT_LIMIT, prev.resultLimit + RESULT_LIMIT_STEP);
      return {
        ...prev,
        resultLimit: nextLimit,
        commandLog: {
          title: "results",
          command: "toolpin tui",
          ok: true,
          lines: [
            nextLimit === prev.resultLimit ? `already showing the maximum ${MAX_RESULT_LIMIT} matches` : `showing up to ${nextLimit} matches`,
            "Use / to edit the search, g to change source, i to refresh listings.",
          ],
        },
        lastAction: nextLimit === prev.resultLimit ? `showing maximum ${MAX_RESULT_LIMIT} matches` : `showing up to ${nextLimit} matches`,
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
      resultLimit: DEFAULT_RESULT_LIMIT,
      client: "claude",
      installScope: "project",
      versionSelections: {},
      pendingRemove: undefined,
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

    if (state.inputMode === "search") {
      if (key.escape) {
        setState((prev) => ({ ...prev, inputMode: "normal" }));
        return;
      }
      if (key.return) {
        setState((prev) => ({ ...prev, inputMode: "normal", selected: 0, view: "discover", pendingRemove: undefined }));
        if (state.dataMode === "live") void loadData("live", state.query);
        return;
      }
      if (key.backspace || key.delete) {
        setState((prev) => ({ ...prev, query: prev.query.slice(0, -1), selected: 0, pendingRemove: undefined }));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setState((prev) => ({ ...prev, query: prev.query + input, selected: 0, pendingRemove: undefined }));
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

    if (key.escape && state.view !== "discover") {
      setState((prev) => switchView(prev, "discover"));
      return;
    }
    if (key.tab) {
      setState((prev) => switchView(prev, nextView(prev.view)));
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
    if (key.upArrow || input === "k") {
      setState((prev) => ({ ...prev, selected: Math.max(0, prev.selected - 1), pendingRemove: undefined }));
      return;
    }
    if (key.downArrow || input === "j") {
      setState((prev) => ({ ...prev, selected: Math.min(Math.max(0, results.length - 1), prev.selected + 1), pendingRemove: undefined }));
      return;
    }
    if (key.return) {
      setState((prev) => switchView(prev, prev.view === "discover" ? "details" : prev.view));
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
        void loadData(state.dataMode);
        break;
      case "R":
        resetViewDefaults();
        break;
      case "i":
        void refreshCache();
        break;
      case "m":
      case "+":
        showMoreResults();
        break;
      case "I":
        void installSelected();
        break;
      case "x":
        if (state.view === "installed") {
          void removeInstalled(selectedInstalled);
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
        cycleSelectedVersion(1);
        break;
      case "V":
        cycleSelectedVersion(-1);
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
      case "h":
      case "?":
        setState((prev) => ({ ...prev, view: prev.view === "help" ? "discover" : "help" }));
        break;
      case "1":
        setState((prev) => switchView(prev, "discover"));
        break;
      case "2":
        setState((prev) => switchView(prev, "installed"));
        break;
      case "3":
        setState((prev) => switchView(prev, "details"));
        break;
      case "4":
        setState((prev) => switchView(prev, "plan"));
        break;
      case "5":
        setState((prev) => switchView(prev, "config"));
        break;
      case "6":
        setState((prev) => switchView(prev, "help"));
        break;
    }
  });

  function handleMouseClick(x: number, y: number): boolean {
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
        setState((prev) => ({ ...prev, selected: hit.index, pendingRemove: undefined }));
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

  const visibleCommandLog = commandLogForView(state);
  const activityRows = visibleCommandLog?.lines.length ? Math.min(3, visibleCommandLog.lines.length) : 1;
  const listHeight = state.view === "discover" || state.view === "installed" ? Math.max(4, height - 12 - activityRows) : Math.min(6, Math.max(3, height - 18 - activityRows));
  const modalWidth = Math.min(width - 4, 104);
  const modalContentWidth = Math.max(40, modalWidth - 4);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ChromeHeader state={state} resultCount={state.view === "installed" ? installed.rows.length : results.length} selectedServer={selectedServer} width={width} />
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
          <Centered width={width}>
            <Box width={modalWidth}>
              <HelpView width={modalContentWidth} />
            </Box>
          </Centered>
        ) : state.view === "installed" ? (
          <>
            <InstalledServersView
              rows={installed.rows}
              selected={installed.selected}
              height={Math.max(6, Math.floor(listHeight * 0.58))}
              width={width}
              loading={installed.loading}
            />
            <Centered width={width}>
              <Box width={modalWidth}>
                <InstalledServerDetails row={selectedInstalled} width={modalContentWidth} />
              </Box>
            </Centered>
          </>
        ) : (
          <>
            <OptionList
              results={results}
              totalMatches={allResults.length}
              totalServers={latestOnly(state.servers).length}
              selected={selectedIndex}
              height={listHeight}
              width={width}
              dimmed={state.view !== "discover"}
            />
            {SERVER_VIEWS.has(state.view) ? (
              <Centered width={width}>
                <Box width={modalWidth}>
                  <SelectedServerPanel
                    view={state.view}
                    result={selectedResult}
                    server={selectedServer}
                    client={state.client}
                    installScope={state.installScope}
                    width={modalContentWidth}
                    testResult={state.testResult}
                    testing={state.testing}
                    versionInfo={selectedVersionInfo}
                  />
                </Box>
              </Centered>
            ) : null}
          </>
        )}
      </Box>
      <ActivityStrip state={state} width={width} />
      {state.error ? <Text color={ERR} wrap="truncate"> error: {truncate(state.error, width - 8)}</Text> : null}
      <Footer view={state.view} inputMode={state.inputMode} />
    </Box>
  );
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
