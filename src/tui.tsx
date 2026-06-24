import React, { useEffect, useMemo, useState } from "react";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import { exportClientConfig, PROJECT_CLIENTS, type ClientName } from "./config.js";
import { codexTomlFromClientConfig } from "./codexToml.js";
import { installServerConfig, type InstallScope } from "./install.js";
import { buildInstallPlan, lockKey, verifyAgainstLockfile, writeLockfile, type InstallPlan } from "./plan.js";
import { fetchRegistry, latestOnly, normalizeEntries, readCache, REGISTRY_SOURCES, writeCache } from "./registry.js";
import { searchServers } from "./search.js";
import { testServer, type ServerTestResult } from "./tester.js";
import type { NormalizedServer, RegistryEntry, RegistrySourceId, SearchResult } from "./types.js";

type View = "discover" | "details" | "plan" | "config" | "help";
type InputMode = "normal" | "search" | "command";
type DataMode = "cache" | "live";
type SourceMode = RegistrySourceId | "all";
type ClientSelection = ClientName | "all";
type TuiCommandId = "ingest" | "search" | "info" | "audit" | "plan" | "install" | "test" | "lock" | "export-config" | "tui" | "help";

const VIEWS: View[] = ["discover", "details", "plan", "config", "help"];
const SERVER_VIEWS = new Set<View>(["details", "plan", "config"]);
const CLIENTS: ClientSelection[] = ["claude", "cursor", "vscode", "codex", "opencode", "all"];
const TUI_COMMANDS: Array<{ id: TuiCommandId; label: string; description: string; requiresServer?: boolean }> = [
  { id: "ingest", label: "Ingest registries", description: "Fetch registry metadata and refresh .mpm/registry-cache.json." },
  { id: "search", label: "Search servers", description: "Edit the current search query." },
  { id: "info", label: "Server info", description: "Open selected server metadata and trust summary.", requiresServer: true },
  { id: "audit", label: "Audit trust", description: "Show selected server trust score, badges, and issues.", requiresServer: true },
  { id: "plan", label: "Install plan", description: "Preview target, trust, secrets, and config writes.", requiresServer: true },
  { id: "install", label: "Install server", description: "Write selected server into the active client config.", requiresServer: true },
  { id: "test", label: "Test server", description: "Connect and run MCP tools/list.", requiresServer: true },
  { id: "lock", label: "Write lockfile", description: "Write selected server to mcp-lock.json.", requiresServer: true },
  { id: "export-config", label: "Export config", description: "Save client config snippets under .mpm/.", requiresServer: true },
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
  const width = Math.max(72, stdout.columns ?? 110);
  const height = Math.max(24, stdout.rows ?? 34);
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
      await mkdir(".mpm", { recursive: true });
      const files: string[] = [];
      for (const client of selectedClients(state.client)) {
        const exported = exportClientConfig(selectedServer, client);
        const formatted = formatClientConfigSnippet(client, exported.config);
        const file = path.join(".mpm", `${safeFileName(selectedServer.name)}.${client}.${formatted.extension}`);
        await writeFile(file, formatted.content, "utf8");
        files.push(file);
      }
      setState((prev) => ({ ...prev, lastAction: `saved ${files.length} config snippet(s)` }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function installSelected(): Promise<void> {
    if (!selectedServer) return;
    setState((prev) => ({ ...prev, installing: true, error: undefined, lastAction: `installing ${selectedServer.name}` }));
    try {
      const files: string[] = [];
      const plans = selectedClients(state.client).map((client) => buildInstallPlan(selectedServer, client));
      const mismatches = [];
      for (const plan of plans) {
        const verification = await verifyAgainstLockfile(plan, "mcp-lock.json");
        if (!verification.ok) mismatches.push(`${verification.key}: ${verification.messages.join("; ")}`);
      }
      if (mismatches.length) {
        throw new Error(`lock drift: ${mismatches.join(" | ")}. Press w to update the lock after review.`);
      }
      for (const [index, client] of selectedClients(state.client).entries()) {
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
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, installing: false, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function testSelected(): Promise<void> {
    if (!selectedServer) return;
    setState((prev) => ({
      ...prev,
      testing: true,
      error: undefined,
      testResult: undefined,
      lastAction: `testing ${selectedServer.name}`,
    }));
    const result = await testServer(selectedServer, 15000);
    setState((prev) => ({
      ...prev,
      testing: false,
      testResult: result,
      lastAction: result.ok ? `test passed: ${result.tools.length} tool(s)` : `test failed: ${result.message}`,
    }));
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
      case "test":
        await testSelected();
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
        setState((prev) => ({ ...prev, inputMode: "normal", selected: 0, view: "discover" }));
        if (state.dataMode === "live") void loadData("live", state.query);
        return;
      }
      if (key.backspace || key.delete) {
        setState((prev) => ({ ...prev, query: prev.query.slice(0, -1), selected: 0 }));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setState((prev) => ({ ...prev, query: prev.query + input, selected: 0 }));
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
      setState((prev) => ({ ...prev, selected: Math.max(0, prev.selected - 1) }));
      return;
    }
    if (key.downArrow || input === "j") {
      setState((prev) => ({ ...prev, selected: Math.min(Math.max(0, results.length - 1), prev.selected + 1) }));
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
          lastAction: `install scope ${prev.installScope === "project" ? "global" : "project"}`,
        }));
        break;
      case "c":
        setState((prev) => ({ ...prev, client: nextClient(prev.client) }));
        break;
      case "o":
        setState((prev) => ({ ...prev, client: "opencode" }));
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

  const listHeight = state.view === "discover" ? Math.max(6, height - 12) : Math.min(6, Math.max(4, height - 18));
  const modalWidth = Math.min(width - 4, 104);
  const modalContentWidth = Math.max(40, modalWidth - 4);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ChromeHeader state={state} resultCount={results.length} selectedServer={selectedServer} width={width} />
      <PromptBar state={state} width={width} />
      <ModeLine active={state.view} selectedServer={selectedServer} width={width} />
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
      {state.error ? <Text color={ERR} wrap="truncate"> error: {truncate(state.error, width - 8)}</Text> : null}
      <Footer view={state.view} inputMode={state.inputMode} />
    </Box>
  );
}

function ChromeHeader({ state, resultCount, selectedServer, width }: { state: TuiState; resultCount: number; selectedServer?: NormalizedServer; width: number }) {
  const status = state.installing ? "install" : state.testing ? "test" : state.loading ? "sync" : state.error ? "err" : "ready";
  const statusColor = state.installing || state.testing || state.loading ? WARN : state.error ? ERR : OK;
  const right = `${state.view === "discover" ? "browse" : state.view} | ${status} | ${state.client} | ${state.sourceMode} | ${resultCount}`;
  const leftWidth = Math.max(18, width - right.length - 7);
  return (
    <Box paddingX={2} marginTop={1} marginBottom={1} justifyContent="space-between">
      <Box width={leftWidth}>
        <Text wrap="truncate">
          <Text color={CHROME}>{shortPath(process.cwd())}</Text>
          <Text color={CHROME}>  /  </Text>
          <Text color={selectedServer ? MUTED : CHROME}>{selectedServer?.name ?? "select an MCP server"}</Text>
        </Text>
      </Box>
      <Text>
        <Text color={MUTED}>{state.view === "discover" ? "browse" : state.view}</Text>
        <Text color={CHROME}> | </Text>
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
    <Box marginX={2} marginBottom={1} backgroundColor={SURFACE_2} paddingX={1} paddingY={1}>
      <Box justifyContent="space-between" width={Math.max(1, width - 6)}>
        <Text wrap="truncate">
          <Text bold color={BLUE}>{">"}</Text>
          <Text> </Text>
          {commandActive ? (
            <>
              <Text color={MUTED}>mpm </Text>
              <Text color="white">{state.commandQuery || "command"}</Text>
            </>
          ) : (
            <>
              <Text color="white">{state.query || "Search MCP servers"}</Text>
              {!active ? <Text color={MUTED}>  / search  : commands</Text> : null}
            </>
          )}
        </Text>
        <Text color={active || commandActive ? BLUE : MUTED}>{commandActive ? "command" : "mpm"}</Text>
      </Box>
    </Box>
  );
}

function ModeLine({ active, selectedServer, width }: { active: View; selectedServer?: NormalizedServer; width: number }) {
  return (
    <Box paddingX={2} marginBottom={1} justifyContent="space-between">
      <Text wrap="truncate">
        <Text bold={active === "discover"} color={active === "discover" ? BLUE : MUTED}>1 Browse</Text>
        <Text color={CHROME}>  </Text>
        <Text bold={active === "details"} color={active === "details" ? BLUE : MUTED}>2 Overview</Text>
        <Text color={CHROME}>  </Text>
        <Text bold={active === "plan"} color={active === "plan" ? BLUE : MUTED}>3 Install</Text>
        <Text color={CHROME}>  </Text>
        <Text bold={active === "config"} color={active === "config" ? BLUE : MUTED}>4 Config</Text>
        <Text color={CHROME}>  </Text>
        <Text bold={active === "help"} color={active === "help" ? BLUE : MUTED}>5 Help</Text>
      </Text>
      <Text color={MUTED} wrap="truncate">{truncate(selectedServer?.title ?? "search and choose from the list", Math.max(12, width - 58))}</Text>
    </Box>
  );
}

function OptionList({ results, selected, height, width, dimmed }: { results: SearchResult[]; selected: number; height: number; width: number; dimmed?: boolean }) {
  const visibleCount = Math.max(2, height - 2);
  const selectedResult = results[selected];
  const start = Math.max(0, Math.min(selected + 1, Math.max(0, results.length - visibleCount)));
  const visible = results.slice(start, start + visibleCount).filter((result) => result !== selectedResult);

  return (
    <Box flexDirection="column" paddingX={3} height={height}>
      {results.length === 0 ? <Text color={MUTED}>No servers matched. Type / to search or l for live results.</Text> : null}
      {selectedResult ? <OptionRow result={selectedResult} selected dimmed={dimmed} width={width} /> : null}
      {visible.map((result) => <OptionRow key={`${result.server.name}:${result.server.version}`} result={result} dimmed={dimmed} width={width} />)}
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
      <Text color={selected ? BLUE : dimmed ? CHROME : BLUE}> {server.registrySource.padEnd(8)}</Text>
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
      <PlanMetric label="writes" value={client === "all" ? `${installScope} configs for ${PROJECT_CLIENTS.join(", ")} + mcp-lock.json` : `${installScope} ${client} config + mcp-lock.json`} width={width} />
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
        {PROJECT_CLIENTS.map((targetClient) => (
          <PlanMetric key={targetClient} label={targetClient} value={projectConfigTargetLabel(targetClient, installScope)} width={width} />
        ))}
      </Box>
    );
  }
  const content = safeString(() => formatClientConfigSnippet(client, exportClientConfig(server, client).config).content.trimEnd());
  const extension = client === "codex" ? "toml" : "json";
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
    ["tab / 1-5", "views", "Switch Browse and selected-server panels."],
    ["/", "search", "Type a registry query; enter applies, esc cancels."],
    ["up/down or j/k", "select", "Move through server options."],
    ["enter", "open", "Open selected-server overview."],
    ["g", "registry", "Cycle all, official, and Docker sources."],
    ["G", "scope", "Toggle project/global install target."],
    ["c", "client", "Cycle clients, including all."],
    ["t", "test", "Connect and run tools/list."],
    ["I", "install", "Install selected server into active scope."],
    ["w", "lock", "Write selected server to mcp-lock.json."],
    ["s", "save", "Save config snippets under .mpm/."],
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
      <ModalTitle title="commands" file="mpm" />
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

function Footer({ view, inputMode }: { view: View; inputMode: InputMode }) {
  const hints = inputMode === "search"
    ? [["Enter", "apply"], ["Esc", "cancel"], ["Backspace", "edit"]]
    : inputMode === "command"
      ? [["Enter", "run"], ["Esc", "close"], ["Type", "filter"], ["j/k", "select"]]
    : view === "discover"
      ? [["Enter", "open"], [":", "commands"], ["/", "search"], ["c", "client"], ["I", "install"], ["q", "quit"]]
      : [["Esc", "close"], ["c", "client"], ["G", "scope"], ["t", "test"], ["I", "install"], ["q", "quit"]];
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

function nextClient(client: ClientSelection): ClientSelection {
  return CLIENTS[(CLIENTS.indexOf(client) + 1) % CLIENTS.length] ?? "claude";
}

function selectedClients(client: ClientSelection): ClientName[] {
  return client === "all" ? PROJECT_CLIENTS : [client];
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
    case "claude":
    case "cursor":
    default:
      return `~/.config/mpm/${client}-mcp.json`;
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
      return `mpm ingest ${source} --pages 6`;
    case "search":
      return `mpm search ${shellQuote(state.query || "mcp")} ${source}${live}`;
    case "info":
      return `mpm info ${serverName} ${source}${live}`;
    case "audit":
      return `mpm audit ${serverName} ${source}${live}`;
    case "plan":
      return `mpm plan ${serverName} --client ${state.client} ${source}${live}`;
    case "install":
      return `mpm install ${serverName} --client ${state.client} --scope ${state.installScope} ${source}${live}`;
    case "test":
      return `mpm test ${serverName} ${source}${live} --timeout 15000`;
    case "lock":
      return `mpm lock ${serverName} --client ${state.client} ${source}${live} --file mcp-lock.json`;
    case "export-config":
      return `mpm export-config ${serverName} --client ${state.client} ${source}${live}`;
    case "tui":
      return "mpm tui";
    case "help":
      return "mpm help";
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

function formatClientConfigSnippet(client: ClientName, config: unknown): { extension: "json" | "toml"; content: string } {
  if (client === "codex") {
    return { extension: "toml", content: `${codexTomlFromClientConfig(config)}\n` };
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
