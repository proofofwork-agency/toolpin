import React, { useEffect, useMemo, useState } from "react";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import { ALL_CLIENTS, clientsForScope, exportClientConfig, PROJECT_CLIENTS, type ClientName } from "./config.js";
import { codexTomlFromClientConfig } from "./codexToml.js";
import { continueYamlFromClientConfig } from "./continueYaml.js";
import { doctorLockfile } from "./doctor.js";
import { installServerConfig, removeServerConfig, type InstallScope } from "./install.js";
import { buildInstallPlan, lockKey, readLockfile, removeLockfileEntry, verifyAgainstLockfile, writeLockfile, type InstallPlan } from "./plan.js";
import { enforcePolicy } from "./policy.js";
import { fetchRegistry, latestOnly, normalizeEntries, readCache, REGISTRY_SOURCES, writeCache } from "./registry.js";
import { searchServers } from "./search.js";
import { testServer, type ServerTestResult } from "./tester.js";
import type { NormalizedServer, RegistryEntry, RegistrySourceId, SearchResult } from "./types.js";

export type View = "discover" | "details" | "plan" | "config" | "help";
type InputMode = "normal" | "search" | "command";
type DataMode = "cache" | "live";
type SourceMode = RegistrySourceId | "all";
type ClientSelection = ClientName | "all";
type TuiCommandId = "ingest" | "search" | "info" | "audit" | "plan" | "install" | "remove" | "ci" | "doctor" | "test" | "lock" | "export-config" | "tui" | "help";

const VIEWS: View[] = ["discover", "details", "plan", "config", "help"];
const SERVER_VIEWS = new Set<View>(["details", "plan", "config"]);
const CLIENTS: ClientSelection[] = [...ALL_CLIENTS.filter((client) => client !== "generic"), "all"];
const TUI_COMMANDS: Array<{ id: TuiCommandId; label: string; description: string; requiresServer?: boolean }> = [
  { id: "ingest", label: "Ingest registries", description: "Fetch registry metadata and refresh .toolpin/registry-cache.json." },
  { id: "search", label: "Search servers", description: "Edit the current search query." },
  { id: "info", label: "Server info", description: "Open selected server metadata and trust summary.", requiresServer: true },
  { id: "audit", label: "Audit trust", description: "Show selected server trust score, badges, and issues.", requiresServer: true },
  { id: "plan", label: "Install plan", description: "Preview target, trust, secrets, and config writes.", requiresServer: true },
  { id: "install", label: "Install server", description: "Write selected server into the active client config.", requiresServer: true },
  { id: "remove", label: "Remove server", description: "Delete selected server from active client config and lockfile.", requiresServer: true },
  { id: "doctor", label: "Check config drift", description: "Compare mcp-lock.json against active-scope client configs." },
  { id: "test", label: "Test server", description: "Connect and run MCP tools/list.", requiresServer: true },
  { id: "ci", label: "Frozen lock check", description: "Re-resolve lockfile entries and reject metadata drift." },
  { id: "lock", label: "Write lockfile", description: "Write selected server to mcp-lock.json.", requiresServer: true },
  { id: "export-config", label: "Export config", description: "Save client config snippets under .toolpin/.", requiresServer: true },
  { id: "tui", label: "Open TUI", description: "Current interactive session." },
  { id: "help", label: "Help", description: "Open keyboard and command reference." },
];

const BLUE = "#8aa7ff";
const ACCENT = "#22d3ee";
const MUTED = "#8b8b94";
const CHROME = "#52525b";
const SURFACE = "#171719";
const SURFACE_2 = "#202023";
const MODAL_BORDER = "#3f3f46";
const OK = "#4ade80";
const WARN = "#fbbf24";
const ERR = "#f87171";
const MENU_ROW = 6;
const LIST_ROW_START = 8;

interface TuiState {
  entries: RegistryEntry[];
  servers: NormalizedServer[];
  query: string;
  commandQuery: string;
  commandSelected: number;
  selected: number;
  view: View;
  inputMode: InputMode;
  dataMode: DataMode;
  sourceMode: SourceMode;
  client: ClientSelection;
  installScope: InstallScope;
  loading: boolean;
  installing: boolean;
  testing: boolean;
  testResult?: ServerTestResult;
  error?: string;
  lastAction?: string;
  commandLog?: CommandLog;
  pendingRemove?: {
    serverName: string;
    client: ClientSelection;
    scope: InstallScope;
  };
}

interface CommandLog {
  title: string;
  command: string;
  ok: boolean;
  lines: string[];
}

export function runTui(): void {
  render(<MpmTui />, { alternateScreen: Boolean(process.stdout.isTTY) });
}

function MpmTui() {
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
    view: "discover",
    inputMode: "normal",
    dataMode: "cache",
    sourceMode: "all",
    client: "claude",
    installScope: "project",
    loading: true,
    installing: false,
    testing: false,
  }));

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

  const results = useMemo(() => {
    const latest = latestOnly(state.servers);
    return searchServers(latest, state.query || "mcp", 50);
  }, [state.servers, state.query]);

  const selectedIndex = clamp(state.selected, 0, Math.max(0, results.length - 1));
  const selectedResult = results[selectedIndex];
  const selectedServer = selectedResult?.server;
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
      setState((prev) => ({
        ...prev,
        entries,
        servers: filterBySource(servers, sourceMode),
        selected: 0,
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
      setState((prev) => ({
        ...prev,
        entries,
        servers: filterBySource(servers, state.sourceMode),
        selected: 0,
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
      for (const client of selectedClients(state.client)) {
        await writeLockfile(
          buildInstallPlan(selectedServer, client),
          "mcp-lock.json",
          lockKey(selectedServer.name, client),
        );
      }
      setState((prev) => ({ ...prev, lastAction: `locked ${selectedServer.name} for ${state.client}` }));
    } catch (error) {
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
      installing: true,
      error: undefined,
      commandLog: {
        title: "install",
        command,
        ok: true,
        lines: [
          `starting install for ${selectedServer.name}`,
          `target clients: ${targetClients.join(", ")}`,
          "checking policy and lock drift...",
        ],
      },
      lastAction: `installing ${selectedServer.name}`,
    }));
    try {
      const files: string[] = [];
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
            "writing client config and mcp-lock.json...",
          ],
        },
      }));
      for (const [index, client] of targetClients.entries()) {
        const result = await installServerConfig(selectedServer, client, state.installScope);
        await writeLockfile(
          plans[index],
          "mcp-lock.json",
          lockKey(selectedServer.name, client),
        );
        files.push(result.file);
      }
      setState((prev) => ({
        ...prev,
        installing: false,
        lastAction: `installed for ${state.client} -> ${unique(files).join(", ")}`,
        commandLog: {
          title: "install",
          command,
          ok: true,
          lines: [
            `installed ${selectedServer.name}`,
            ...unique(files).map((file) => `wrote ${file}`),
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
      setState((prev) => ({
        ...prev,
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
      testing: true,
      error: undefined,
      testResult: undefined,
      commandLog: {
        title: "test",
        command,
        ok: true,
        lines: [
          `connecting to ${selectedServer.name}`,
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
        error: message,
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
      case "search":
        setState((prev) => ({ ...prev, inputMode: "search", view: "discover", commandLog: undefined }));
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
      setState((prev) => ({ ...prev, view: "discover" }));
      return;
    }
    if (key.tab) {
      setState((prev) => ({ ...prev, view: nextView(prev.view) }));
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
      setState((prev) => ({ ...prev, view: prev.view === "discover" ? "details" : prev.view }));
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
      case "i":
        void refreshCache();
        break;
      case "I":
        void installSelected();
        break;
      case "x":
        requestRemoveConfirmation();
        break;
      case "t":
        void testSelected();
        break;
      case "l":
        void loadData(state.dataMode === "cache" ? "live" : "cache");
        break;
      case "g":
        void loadData(state.dataMode, state.query, nextSource(state.sourceMode));
        break;
      case "G":
        setState((prev) => ({
          ...prev,
          installScope: prev.installScope === "project" ? "global" : "project",
          pendingRemove: undefined,
          lastAction: `install scope ${prev.installScope === "project" ? "global" : "project"}`,
        }));
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
        setState((prev) => ({ ...prev, view: "discover" }));
        break;
      case "2":
        setState((prev) => ({ ...prev, view: "details" }));
        break;
      case "3":
        setState((prev) => ({ ...prev, view: "plan" }));
        break;
      case "4":
        setState((prev) => ({ ...prev, view: "config" }));
        break;
      case "5":
        setState((prev) => ({ ...prev, view: "help" }));
        break;
    }
  });

  function handleMouseClick(x: number, y: number): boolean {
    const hit = hitTestTui(x, y, buildTuiHitZones({
      width,
      listHeight,
      selectedIndex,
      resultCount: results.length,
      hasSelection: Boolean(selectedServer),
      selectedLabel: selectedServer?.title || selectedServer?.name,
      listActive: state.inputMode === "normal" && state.view === "discover",
    }));
    if (hit?.kind === "view") {
      setState((prev) => ({ ...prev, view: hit.view }));
      return true;
    }
    if (hit?.kind === "server") {
      setState((prev) => ({ ...prev, selected: hit.index, pendingRemove: undefined }));
      return true;
    }

    return false;
  }

  const activityRows = state.commandLog?.lines.length ? Math.min(3, state.commandLog.lines.length) : 1;
  const listHeight = state.view === "discover" ? Math.max(4, height - 12 - activityRows) : Math.min(6, Math.max(3, height - 18 - activityRows));
  const modalWidth = Math.min(width - 4, 104);
  const modalContentWidth = Math.max(40, modalWidth - 4);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ChromeHeader state={state} resultCount={results.length} selectedServer={selectedServer} width={width} />
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
        ) : (
          <>
            <OptionList results={results} selected={selectedIndex} height={listHeight} width={width} dimmed={state.view !== "discover"} />
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

export type TuiHitAction = { kind: "view"; view: View } | { kind: "server"; index: number };
export interface TuiMenuSegment {
  view: View;
  label: string;
  from: number;
  to: number;
  enabled: boolean;
}

export interface TuiMenuLayout {
  selectedLabel: string;
  selectedFrom: number;
  selectedTo: number;
  segments: TuiMenuSegment[];
}

export interface TuiHitZones {
  menuY: number;
  menu: TuiMenuSegment[];
  list?: {
    fromY: number;
    toY: number;
    start: number;
    total: number;
  };
}

export function buildTuiHitZones({
  width,
  listHeight,
  selectedIndex,
  resultCount,
  hasSelection,
  selectedLabel,
  listActive,
}: {
  width: number;
  listHeight: number;
  selectedIndex: number;
  resultCount: number;
  hasSelection: boolean;
  selectedLabel?: string;
  listActive: boolean;
}): TuiHitZones {
  const visibleCount = Math.max(2, listHeight - 2);
  const listStart = listWindowStart(selectedIndex, visibleCount, resultCount);
  const menuLayout = computeMenuLayout({ width, hasSelection, selectedLabel });
  return {
    menuY: MENU_ROW,
    menu: menuLayout.segments,
    list: listActive ? {
      fromY: LIST_ROW_START,
      toY: LIST_ROW_START + visibleCount - 1,
      start: listStart,
      total: resultCount,
    } : undefined,
  };
}

export function computeMenuLayout({ width, hasSelection, selectedLabel }: { width: number; hasSelection: boolean; selectedLabel?: string }): TuiMenuLayout {
  const contentStart = 3;
  const helpLabel = "Help";
  const helpTo = Math.max(contentStart + helpLabel.length - 1, width - 2);
  const helpFrom = Math.max(contentStart, helpTo - helpLabel.length + 1);
  const labelWidth = Math.max(8, Math.min(34, width - 61));
  const chosenLabel = truncate(selectedLabel || "select a server", labelWidth);
  const segments: TuiMenuSegment[] = [];
  let cursor = contentStart;

  const push = (view: View, label: string, enabled: boolean) => {
    segments.push({ view, label, from: cursor, to: cursor + label.length - 1, enabled });
    cursor += label.length;
  };

  push("discover", "Browse", true);
  cursor += "  |  ".length;
  cursor += "Selected: ".length;
  const selectedFrom = cursor;
  const selectedTo = cursor + chosenLabel.length - 1;
  cursor += chosenLabel.length;
  cursor += "  |  ".length;
  push("details", "Overview", hasSelection);
  cursor += "  ".length;
  push("plan", "Install", hasSelection);
  cursor += "  ".length;
  push("config", "Config", hasSelection);

  segments.push({ view: "help", label: helpLabel, from: helpFrom, to: helpTo, enabled: true });
  return { selectedLabel: chosenLabel, selectedFrom, selectedTo, segments };
}

export function hitTestTui(x: number, y: number, zones: TuiHitZones): TuiHitAction | undefined {
  if (y === zones.menuY) {
    const zone = zones.menu.find((entry) => x >= entry.from && x <= entry.to);
    return zone?.enabled ? { kind: "view", view: zone.view } : undefined;
  }

  if (zones.list && y >= zones.list.fromY && y <= zones.list.toY) {
    const index = zones.list.start + (y - zones.list.fromY);
    return index < zones.list.total ? { kind: "server", index } : undefined;
  }

  return undefined;
}

function ChromeHeader({ state, resultCount, selectedServer, width }: { state: TuiState; resultCount: number; selectedServer?: NormalizedServer; width: number }) {
  const status = state.installing ? "install" : state.testing ? "test" : state.loading ? "sync" : state.error ? "err" : "ready";
  const statusColor = state.installing || state.testing || state.loading ? WARN : state.error ? ERR : OK;
  const right = `${status} | ${state.client} | ${state.sourceMode} | ${resultCount}`;
  const leftWidth = Math.max(18, width - right.length - 7);
  return (
    <Box paddingX={2} marginTop={1} marginBottom={1} justifyContent="space-between">
      <Box width={leftWidth}>
        <Text wrap="truncate">
          <Text bold color="white">ToolPin</Text>
          <Text color={CHROME}>  </Text>
          <Text color={CHROME}>{shortPath(process.cwd())}</Text>
        </Text>
      </Box>
      <Text>
        <Text color={statusColor}>{status}</Text>
        <Text color={CHROME}> | </Text>
        <Text color="white">{state.client}</Text>
        <Text color={CHROME}> | </Text>
        <Text color={state.dataMode === "live" ? WARN : OK}>{state.sourceMode}</Text>
        <Text color={CHROME}> | </Text>
        <Text color={MUTED}>{resultCount}</Text>
      </Text>
    </Box>
  );
}

function PromptBar({ state, width }: { state: TuiState; width: number }) {
  const active = state.inputMode === "search";
  const commandActive = state.inputMode === "command";
  return (
    <Box marginX={2} marginBottom={1} backgroundColor={SURFACE_2} paddingX={1}>
      <Box justifyContent="space-between" width={Math.max(1, width - 6)}>
        <Text wrap="truncate">
          {commandActive ? (
            <>
              <Text color={MUTED}>Command </Text>
              <Text color={CHROME}>toolpin </Text>
              <Text color="white">{state.commandQuery || "command"}</Text>
            </>
          ) : (
            <>
              <Text color={MUTED}>Search </Text>
              <Text color="white">{state.query || "Search MCP servers"}</Text>
            </>
          )}
        </Text>
        <Text color={active || commandActive ? BLUE : MUTED}>{commandActive ? "Enter runs, Esc closes" : active ? "Enter applies, Esc cancels" : "/ edit search  : commands"}</Text>
      </Box>
    </Box>
  );
}

function ModeLine({ active, selectedServer, width }: { active: View; selectedServer?: NormalizedServer; width: number }) {
  const hasSelection = Boolean(selectedServer);
  const layout = computeMenuLayout({ width, hasSelection, selectedLabel: selectedServer?.title || selectedServer?.name });
  return (
    <Box paddingX={2} marginBottom={1} justifyContent="space-between">
      <Text wrap="truncate">
        <Text bold={active === "discover"} color={active === "discover" ? BLUE : MUTED}>{layout.segments[0]?.label}</Text>
        <Text color={CHROME}>  |  </Text>
        <Text color={hasSelection ? MUTED : CHROME}>Selected: </Text>
        <Text color={hasSelection ? "white" : CHROME}>{layout.selectedLabel}</Text>
        <Text color={CHROME}>  |  </Text>
        <Text bold={active === "details"} color={!hasSelection ? CHROME : active === "details" ? BLUE : MUTED}>{layout.segments[1]?.label}</Text>
        <Text color={CHROME}>  </Text>
        <Text bold={active === "plan"} color={!hasSelection ? CHROME : active === "plan" ? BLUE : MUTED}>{layout.segments[2]?.label}</Text>
        <Text color={CHROME}>  </Text>
        <Text bold={active === "config"} color={!hasSelection ? CHROME : active === "config" ? BLUE : MUTED}>{layout.segments[3]?.label}</Text>
      </Text>
      <Text bold={active === "help"} color={active === "help" ? BLUE : MUTED}>{layout.segments[4]?.label}</Text>
    </Box>
  );
}

function OptionList({ results, selected, height, width, dimmed }: { results: SearchResult[]; selected: number; height: number; width: number; dimmed?: boolean }) {
  const visibleCount = Math.max(2, height - 2);
  const start = listWindowStart(selected, visibleCount, results.length);
  const visible = results.slice(start, start + visibleCount);

  return (
    <Box flexDirection="column" paddingX={3} height={height}>
      {results.length === 0 ? <Text color={MUTED}>No servers matched. Type / to search or l for live results.</Text> : null}
      {visible.map((result, index) => <OptionRow key={`${result.server.name}:${result.server.version}`} result={result} selected={start + index === selected} dimmed={dimmed} width={width} />)}
      {results.length > 0 ? <Text color={CHROME}>  selected {selected + 1} of {results.length}</Text> : null}
    </Box>
  );
}

function OptionRow({ result, selected = false, dimmed, width }: { result: SearchResult; selected?: boolean; dimmed?: boolean; width: number }) {
  const server = result.server;
  const runtime = server.packageTypes.join(",") || server.remoteTypes.join(",") || "none";
  const titleWidth = width < 90 ? 26 : 34;
  const nameWidth = width < 90 ? 26 : 36;
  return (
    <Text wrap="truncate">
      <Text color={selected ? BLUE : dimmed ? CHROME : BLUE}>{selected ? ">" : ":"}</Text>
      <Text color={selected ? BLUE : dimmed ? CHROME : BLUE}> {server.registrySource.padEnd(8)}  </Text>
      <Text bold={selected} color={dimmed ? MUTED : "white"}>{truncate(server.title, titleWidth).padEnd(titleWidth + 2)}</Text>
      <Text color={CHROME}> </Text>
      <Text color={dimmed ? CHROME : MUTED}>{truncate(server.name, nameWidth)}</Text>
      <Text color={CHROME}>  </Text>
      <Text color={trustColor(result.trust.score)}>trust {result.trust.score}</Text>
      <Text color={CHROME}>  </Text>
      <Text color={dimmed ? CHROME : MUTED}>{runtime}</Text>
    </Text>
  );
}

function Centered({ width, children }: { width: number; children: React.ReactNode }) {
  const margin = Math.max(0, Math.floor((width - Math.min(width - 4, 104)) / 2));
  return (
    <Box marginLeft={margin} marginRight={margin}>
      {children}
    </Box>
  );
}

function SelectedServerPanel({
  view,
  result,
  server,
  client,
  installScope,
  width,
  testResult,
  testing,
}: {
  view: View;
  result?: SearchResult;
  server?: NormalizedServer;
  client: ClientSelection;
  installScope: InstallScope;
  width: number;
  testResult?: ServerTestResult;
  testing: boolean;
}) {
  switch (view) {
    case "plan":
      return <PlanView server={server} client={client} installScope={installScope} width={width} />;
    case "config":
      return <ConfigView server={server} client={client} installScope={installScope} width={width} />;
    case "details":
    case "discover":
    default:
      return <DetailsView result={result} width={width} testResult={testResult} testing={testing} />;
  }
}

function DetailsView({ result, width, testResult, testing }: { result?: SearchResult; width: number; testResult?: ServerTestResult; testing: boolean }) {
  if (!result) return <EmptyPanel title="Overview" />;
  const server = result.server;
  const trust = result.trust;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={MODAL_BORDER} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title="overview" file="server.json" />
      <Text bold color="white" wrap="truncate">{server.name}@{server.version}</Text>
      <Text color={MUTED} wrap="wrap">{server.description || "No description declared."}</Text>
      <Spacer />
      <Metric label="title" value={server.title} />
      <Metric label="registry" value={server.registrySource} valueColor={server.registrySource === "docker" ? WARN : OK} />
      <Metric label="runtime" value={server.packageTypes.join(", ") || server.remoteTypes.join(", ") || "none"} />
      <Metric label="transport" value={server.transports.join(", ") || "none"} />
      <Metric label="secrets" value={server.requiresSecrets ? "declared" : "none declared"} valueColor={server.requiresSecrets ? WARN : OK} />
      <Text>
        <Text color={MUTED}>trust       </Text>
        <Text color={trustColor(trust.score)}>{trust.score}</Text>
        <Text color={CHROME}>  </Text>
        <Text color={MUTED}>{trust.badges.join(", ") || "no badges"}</Text>
      </Text>
      {trust.issues.slice(0, 4).map((issue) => (
        <Text key={issue.code} color={issue.severity === "critical" ? ERR : issue.severity === "warning" ? WARN : MUTED} wrap="truncate">
          {issue.severity}: {truncate(issue.message, width - 12)}
        </Text>
      ))}
      <Spacer />
      <Text>
        <Text color={MUTED}>test        </Text>
        {testing ? <Text color={WARN}>running MCP handshake and tools/list...</Text> : testResult ? (
          <Text color={testResult.ok ? OK : ERR}>{testResult.ok ? "passed" : "failed"}: {truncate(testResult.message, width - 20)}</Text>
        ) : <Text color={MUTED}>press t to connect and list tools</Text>}
      </Text>
      {testResult?.tools.slice(0, 4).map((tool) => (
        <Text key={tool.name} color="white" wrap="truncate">tool        {tool.name}{tool.description ? <Text color={MUTED}> - {truncate(tool.description, width - tool.name.length - 20)}</Text> : null}</Text>
      ))}
    </Box>
  );
}

function PlanView({ server, client, installScope, width }: { server?: NormalizedServer; client: ClientSelection; installScope: InstallScope; width: number }) {
  if (!server) return <EmptyPanel title="Install" />;
  const planClient = client === "all" ? PROJECT_CLIENTS[0] ?? "claude" : client;
  const content = safeJson(() => buildInstallPlan(server, planClient));
  if ("error" in asObject(content)) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={ERR} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
        <ModalTitle title="install" file="plan" />
        <Text color={ERR}>{String(asObject(content).error)}</Text>
      </Box>
    );
  }
  const plan = content as InstallPlan;
  const target = asObject(plan.selectedTarget);
  const targetKind = String(target.kind ?? "unknown");
  const targetLabel = targetKind === "remote"
    ? `${String(target.type ?? "remote")} ${String(target.url ?? "")}`
    : `${String(target.registryType ?? "package")} ${String(target.identifier ?? "")}`;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={MODAL_BORDER} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title="install" file="plan" />
      <Box justifyContent="space-between">
        <Text color={MUTED}>client <Text color="white">{client}</Text>  scope <Text color="white">{installScope}</Text></Text>
        <Text color={MUTED}>I install  w lock</Text>
      </Box>
      <Spacer />
      <PlanMetric label="target" value={targetLabel} width={width} valueColor={targetKind === "remote" ? OK : WARN} />
      <PlanMetric label="trust" value={`${plan.trust.score} ${plan.trust.badges.join(", ") || "no badges"}`} width={width} valueColor={trustColor(plan.trust.score)} />
      <PlanMetric label="writes" value={client === "all" ? `${installScope} configs for ${clientsForScope(installScope).join(", ")} + mcp-lock.json` : `${installScope} ${client} config + mcp-lock.json`} width={width} />
      {server.requiresSecrets ? <PlanMetric label="secrets" value="required before runtime/test can succeed" width={width} valueColor={WARN} /> : null}
      {plan.trust.issues.slice(0, 4).map((issue) => (
        <Text key={issue.code} color={issue.severity === "critical" ? ERR : issue.severity === "warning" ? WARN : MUTED} wrap="truncate">
          {issue.severity}: {truncate(issue.message, width - 12)}
        </Text>
      ))}
    </Box>
  );
}

function ConfigView({ server, client, installScope, width }: { server?: NormalizedServer; client: ClientSelection; installScope: InstallScope; width: number }) {
  if (!server) return <EmptyPanel title="Config" />;
  if (client === "all") {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={MODAL_BORDER} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
        <ModalTitle title="config" file="targets" />
        <Text color={MUTED}>client <Text color="white">all</Text>  scope <Text color="white">{installScope}</Text></Text>
        <Spacer />
        {clientsForScope(installScope).map((targetClient) => (
          <PlanMetric key={targetClient} label={targetClient} value={projectConfigTargetLabel(targetClient, installScope)} width={width} />
        ))}
      </Box>
    );
  }
  const formatted = safeJson(() => formatClientConfigSnippet(client, exportClientConfig(server, client).config));
  const formattedError = asObject(formatted).error;
  const content = typeof formattedError === "string"
    ? JSON.stringify(formatted, null, 2)
    : (formatted as ReturnType<typeof formatClientConfigSnippet>).content.trimEnd();
  const extension = typeof formattedError === "string"
    ? "json"
    : (formatted as ReturnType<typeof formatClientConfigSnippet>).extension;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={MODAL_BORDER} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title="config" file={`${client}.${extension}`} />
      <Text color={MUTED}>client <Text color="white">{client}</Text>  scope <Text color="white">{installScope}</Text>  I install  s save</Text>
      <CodeBlock content={content} width={width} maxLines={16} />
    </Box>
  );
}

function HelpView({ width }: { width: number }) {
  const rows: Array<[string, string, string]> = [
    [":", "commands", "Open CLI-equivalent command palette."],
    ["tab", "menu", "Cycle Browse, selected-server panels, and Help."],
    ["/", "search", "Edit the Search field; Enter applies, Esc cancels."],
    ["up/down or j/k", "select", "Move through server options."],
    ["enter", "open", "Open the selected server overview."],
    ["g", "registry", "Cycle all, official, and Docker sources."],
    ["G", "scope", "Toggle project/global install target."],
    ["c", "client", "Cycle clients, including all."],
    ["t", "test", "Connect and run tools/list."],
    ["I", "install", "Install selected server into active scope."],
    ["x", "remove", "Remove selected server from config and lockfile."],
    ["w", "lock", "Write selected server to mcp-lock.json."],
    ["s", "save", "Save config snippets under .toolpin/."],
    ["q / ctrl-c", "quit", "Close the TUI."],
  ];
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={MODAL_BORDER} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title="help" file="shortcuts" />
      <Text color={MUTED} wrap="wrap">Sources: {REGISTRY_SOURCES.map((source) => `${source.id}${source.enabled ? "" : " (known)"}`).join(", ")}.</Text>
      <Spacer />
      {rows.map(([keyName, label, description]) => (
        <Text key={keyName} wrap="truncate">
          <Text bold color={BLUE}>{keyName.padEnd(13)}</Text>
          <Text color="white">{label.padEnd(10)}</Text>
          <Text color={MUTED}>{truncate(description, width - 26)}</Text>
        </Text>
      ))}
    </Box>
  );
}

function CommandPalette({
  commands,
  selected,
  state,
  selectedServer,
  width,
}: {
  commands: typeof TUI_COMMANDS;
  selected: number;
  state: TuiState;
  selectedServer?: NormalizedServer;
  width: number;
}) {
  const selectedCommand = commands[selected];
  const commandRows = commands.map((command, index) => {
    const disabled = command.requiresServer && !selectedServer;
    const marker = index === selected ? ">" : ":";
    const suffix = disabled ? "  select a server first" : "";
    return truncate(`${marker} ${command.id.padEnd(13)} ${command.label}${suffix}`, width - 4);
  }).join("\n");
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={MODAL_BORDER} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title="commands" file="toolpin" />
      <Text color={MUTED} wrap="truncate">Enter runs the selected CLI-equivalent command with the active server/client/source.</Text>
      {commands.length === 0 ? <Text color={MUTED}>No command matched.</Text> : null}
      {commands.length > 0 ? <Text color="white">{commandRows}</Text> : null}
      {selectedCommand ? (
        <>
          <Text color={ACCENT} wrap="truncate">{truncate(commandLineFor(selectedCommand.id, state, selectedServer), width - 4)}</Text>
          <Text color={MUTED} wrap="truncate">{truncate(selectedCommand.description, width - 4)}</Text>
        </>
      ) : null}
      {state.commandLog ? (
        <>
          <Spacer />
          <Text color={state.commandLog.ok ? OK : ERR} wrap="truncate">{state.commandLog.command}</Text>
          {state.commandLog.lines.slice(0, 4).map((line, index) => (
            <Text key={`${index}:${line}`} color={MUTED} wrap="truncate">  {truncate(line, width - 4)}</Text>
          ))}
        </>
      ) : null}
    </Box>
  );
}

function ActivityStrip({ state, width }: { state: TuiState; width: number }) {
  const active = state.installing || state.testing || state.loading;
  const log = state.commandLog;
  const color = state.error || log?.ok === false ? ERR : active ? WARN : log ? OK : MUTED;
  const label = active ? "working" : log ? log.title : "status";
  const primary = log?.lines[0] ?? state.lastAction ?? "ready";
  const secondary = log?.lines.slice(1, 3) ?? [];

  return (
    <Box flexDirection="column" paddingX={2} marginTop={1} flexShrink={0}>
      <Text wrap="truncate">
        <Text bold color={color}>{label.padEnd(8)}</Text>
        <Text color="white">{truncate(primary, width - 14)}</Text>
      </Text>
      {secondary.map((line, index) => (
        <Text key={`${index}:${line}`} color={MUTED} wrap="truncate">
          <Text color={CHROME}>         </Text>
          {truncate(line, width - 11)}
        </Text>
      ))}
    </Box>
  );
}

function Footer({ view, inputMode }: { view: View; inputMode: InputMode }) {
  const hints = inputMode === "search"
    ? [["Enter", "apply"], ["Esc", "cancel"], ["Backspace", "edit"]]
    : inputMode === "command"
      ? [["Enter", "run"], ["Esc", "close"], ["Type", "filter"], ["j/k", "select"]]
    : view === "discover"
      ? [["/", "search"], ["Enter", "open"], ["click", "select"], [":", "commands"], ["j/k", "move"], ["q", "quit"]]
      : [["Esc", "browse"], ["click", "menu"], ["c", "client"], ["G", "scope"], ["t", "test"], ["I", "install"], ["q", "quit"]];
  return (
    <Box paddingX={2} marginTop={1} flexShrink={0}>
      <Text wrap="truncate">
        {hints.map(([keyName, label], index) => (
          <React.Fragment key={keyName}>
            {index > 0 ? <Text color={CHROME}>  |  </Text> : null}
            <Text bold color="white">{keyName}</Text>
            <Text color={MUTED}>:{label}</Text>
          </React.Fragment>
        ))}
      </Text>
    </Box>
  );
}

function EmptyPanel({ title }: { title: string }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={MODAL_BORDER} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title={title.toLowerCase()} file="empty" />
      <Text color={MUTED}>No server selected. Search and select a server first.</Text>
    </Box>
  );
}

function ModalTitle({ title, file }: { title: string; file: string }) {
  return (
    <Box justifyContent="space-between">
      <Text color={CHROME}>----------------</Text>
      <Text bold color={ACCENT}> {title} </Text>
      <Text color={CHROME}>{file}</Text>
    </Box>
  );
}

function Metric({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Text wrap="truncate">
      <Text color={MUTED}>{label.padEnd(12)}</Text>
      <Text color={valueColor ?? "white"}>{value}</Text>
    </Text>
  );
}

function PlanMetric({ label, value, width, valueColor }: { label: string; value: string; width: number; valueColor?: string }) {
  const valueWidth = Math.max(8, width - 18);
  return (
    <Text>
      <Text color={MUTED}>{label.padEnd(12)}</Text>
      <Text color={valueColor ?? "white"}>{truncate(value, valueWidth).padEnd(valueWidth)}</Text>
    </Text>
  );
}

function CodeBlock({ content, width, maxLines }: { content: string; width: number; maxLines: number }) {
  const lines = content.split("\n");
  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.slice(0, maxLines).map((line, index) => (
        <Text key={`${index}:${line}`} color={line.trim().startsWith('"') || line.includes("=") ? "white" : MUTED} wrap="truncate">
          {truncate(line, width - 6)}
        </Text>
      ))}
      {lines.length > maxLines ? <Text color={MUTED}>... {lines.length - maxLines} more lines</Text> : null}
    </Box>
  );
}

function Spacer() {
  return <Text> </Text>;
}

function nextView(view: View): View {
  return VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length] ?? "discover";
}

export function listWindowStart(selected: number, visibleCount: number, total: number): number {
  const maxStart = Math.max(0, total - visibleCount);
  const preferred = selected < visibleCount ? 0 : selected - visibleCount + 1;
  return Math.max(0, Math.min(preferred, maxStart));
}

function nextClient(client: ClientSelection): ClientSelection {
  return CLIENTS[(CLIENTS.indexOf(client) + 1) % CLIENTS.length] ?? "claude";
}

function selectedClients(client: ClientSelection): ClientName[] {
  return client === "all" ? PROJECT_CLIENTS : [client];
}

function selectedClientsForScope(client: ClientSelection, scope: InstallScope): ClientName[] {
  return client === "all" ? clientsForScope(scope) : [client];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function projectConfigTargetLabel(client: ClientName, scope: InstallScope): string {
  if (scope === "project") {
    switch (client) {
      case "vscode":
        return ".vscode/mcp.json";
      case "opencode":
        return "opencode.json";
      case "codex":
        return ".codex/config.toml";
      case "gemini":
        return ".gemini/settings.json";
      case "roo":
        return ".roo/mcp.json";
      case "windsurf":
        return "global-only";
      case "cline":
        return "global-only";
      case "continue":
        return "global-only";
      case "zed":
        return "path not verified";
      case "claude":
      case "cursor":
      default:
        return ".mcp.json (mcpServers)";
    }
  }

  switch (client) {
    case "vscode":
      return "~/.config/Code/User/mcp.json";
    case "opencode":
      return "~/.config/opencode/opencode.json";
    case "codex":
      return "~/.codex/config.toml";
    case "windsurf":
      return "~/.codeium/windsurf/mcp_config.json";
    case "cline":
      return "~/.cline/mcp.json";
    case "continue":
      return "~/.continue/config.yaml";
    case "gemini":
      return "~/.gemini/settings.json";
    case "roo":
      return "project-only";
    case "zed":
      return "path not verified";
    case "claude":
    case "cursor":
    default:
      return `~/.config/toolpin/${client}-mcp.json`;
  }
}

function commandRequiresServer(commandId: TuiCommandId): boolean {
  return TUI_COMMANDS.find((command) => command.id === commandId)?.requiresServer === true;
}

function commandLineFor(commandId: TuiCommandId, state: TuiState, server?: NormalizedServer): string {
  const source = `--source ${state.sourceMode}`;
  const live = state.dataMode === "live" ? " --live" : "";
  const serverName = server ? shellQuote(server.name) : "<server-name>";
  switch (commandId) {
    case "ingest":
      return `toolpin ingest ${source} --pages 6`;
    case "search":
      return `toolpin search ${shellQuote(state.query || "mcp")} ${source}${live}`;
    case "info":
      return `toolpin info ${serverName} ${source}${live}`;
    case "audit":
      return `toolpin audit ${serverName} ${source}${live}`;
    case "plan":
      return `toolpin plan ${serverName} --client ${state.client} ${source}${live}`;
    case "install":
      return `toolpin install ${serverName} --client ${state.client} --scope ${state.installScope} ${source}${live}`;
    case "remove":
      return `toolpin remove ${serverName} --client ${state.client} --scope ${state.installScope} --file mcp-lock.json`;
    case "doctor":
      return `toolpin doctor --scope ${state.installScope} --file mcp-lock.json`;
    case "ci":
      return `toolpin ci --file mcp-lock.json ${source}${live}`;
    case "test":
      return `toolpin test ${serverName} ${source}${live} --timeout 15000`;
    case "lock":
      return `toolpin lock ${serverName} --client ${state.client} ${source}${live} --file mcp-lock.json`;
    case "export-config":
      return `toolpin export-config ${serverName} --client ${state.client} ${source}${live}`;
    case "tui":
      return "toolpin tui";
    case "help":
      return "toolpin help";
  }
}

function shellQuote(value: string): string {
  return /^[a-zA-Z0-9_./:@-]+$/.test(value) ? value : JSON.stringify(value);
}

function nextSource(source: SourceMode): SourceMode {
  const sources: SourceMode[] = ["all", "official", "docker"];
  return sources[(sources.indexOf(source) + 1) % sources.length] ?? "all";
}

function filterBySource(servers: NormalizedServer[], source: SourceMode): NormalizedServer[] {
  return source === "all" ? servers : servers.filter((server) => server.registrySource === source);
}

function cacheHasSource(entries: RegistryEntry[], source: SourceMode): boolean {
  const sources = new Set(normalizeEntries(entries).map((server) => server.registrySource));
  return source === "all" ? sources.has("official") && sources.has("docker") : sources.has(source);
}

function trustColor(score: number): string {
  if (score >= 80) return OK;
  if (score >= 60) return WARN;
  return ERR;
}

function safeJson<T>(factory: () => T): T | { error: string } {
  try {
    return factory();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function safeString(factory: () => string): string {
  try {
    return factory();
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2);
  }
}

function formatClientConfigSnippet(client: ClientName, config: unknown): { extension: "json" | "toml" | "yaml"; content: string } {
  if (client === "codex") {
    return { extension: "toml", content: `${codexTomlFromClientConfig(config)}\n` };
  }
  if (client === "continue") {
    return { extension: "yaml", content: continueYamlFromClientConfig(config) };
  }
  return { extension: "json", content: `${JSON.stringify(config, null, 2)}\n` };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}

function shortPath(value: string): string {
  const home = process.env.HOME;
  const pathValue = home && value.startsWith(home) ? `~${value.slice(home.length)}` : value;
  const parts = pathValue.split("/");
  return parts.length > 4 ? `.../${parts.slice(-3).join("/")}` : pathValue;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncate(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}
