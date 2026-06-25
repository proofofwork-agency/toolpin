import React from "react";
import { Box, Text } from "ink";
import { clientsForScope, exportClientConfig, PROJECT_CLIENTS } from "../../config.js";
import { type InstallScope } from "../../install.js";
import { buildInstallPlan, type InstallPlan } from "../../plan.js";
import { REGISTRY_SOURCES } from "../../registry.js";
import type { ServerTestResult } from "../../tester.js";
import type { NormalizedServer, SearchResult } from "../../types.js";
import { TOOLPIN_VERSION } from "../../version.js";
import { commandLineFor } from "../command.js";
import { ACCENT, BLUE, CHROME, ERR, MODAL_BORDER, MUTED, OK, SURFACE, SURFACE_2, TUI_COMMANDS, WARN } from "../constants.js";
import { formatClientConfigSnippet } from "../configSnippet.js";
import { asObject, safeJson, shortPath, truncate } from "../format.js";
import { computeMenuLayout, listWindowStart } from "../layout.js";
import { commandLogForView, configTargetLabel, formatVersionChoices, installClientLabel, scopeLabel, selectedClientsForScope } from "../selectors.js";
import type { ClientSelection, InputMode, TuiState, TuiVersionInfo, View } from "../types.js";

export function ChromeHeader({ state, resultCount, selectedServer, width }: { state: TuiState; resultCount: number; selectedServer?: NormalizedServer; width: number }) {
  const status = state.installing ? "install" : state.testing ? "test" : state.loading ? "sync" : state.error ? "err" : "ready";
  const statusColor = state.installing || state.testing || state.loading ? WARN : state.error ? ERR : OK;
  const right = `${status} | client:${state.client} | source:${state.sourceMode} | shown:${resultCount}`;
  const leftWidth = Math.max(18, width - right.length - 7);
  return (
    <Box paddingX={2} marginTop={1} marginBottom={1} justifyContent="space-between">
      <Box width={leftWidth}>
        <Text wrap="truncate">
          <Text bold color="white">ToolPin</Text>
          <Text color={MUTED}> v{TOOLPIN_VERSION}</Text>
          <Text color={CHROME}>  </Text>
          <Text color={CHROME}>{shortPath(process.cwd())}</Text>
        </Text>
      </Box>
      <Text>
        <Text color={statusColor}>{status}</Text>
        <Text color={CHROME}> | </Text>
        <Text color={CHROME}>client:</Text>
        <Text color="white">{state.client}</Text>
        <Text color={CHROME}> | </Text>
        <Text color={CHROME}>source:</Text>
        <Text color={state.dataMode === "live" ? WARN : OK}>{state.sourceMode}</Text>
        <Text color={CHROME}> | </Text>
        <Text color={CHROME}>shown:</Text>
        <Text color={MUTED}>{resultCount}</Text>
      </Text>
    </Box>
  );
}

export function PromptBar({ state, width }: { state: TuiState; width: number }) {
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

export function ModeLine({ active, selectedServer, width }: { active: View; selectedServer?: NormalizedServer; width: number }) {
  const hasSelection = Boolean(selectedServer);
  const layout = computeMenuLayout({ width, hasSelection, selectedLabel: selectedServer?.title || selectedServer?.name });
  return (
    <Box paddingX={2} marginBottom={1} justifyContent="space-between">
      <Text wrap="truncate">
        <Text bold={active === "discover"} color={active === "discover" ? BLUE : MUTED}>{layout.segments[0]?.label}</Text>
        <Text color={CHROME}>  </Text>
        <Text bold={active === "installed"} color={active === "installed" ? BLUE : MUTED}>{layout.segments[1]?.label}</Text>
        <Text color={CHROME}>  |  </Text>
        <Text color={hasSelection ? MUTED : CHROME}>Selected: </Text>
        <Text color={hasSelection ? "white" : CHROME}>{layout.selectedLabel}</Text>
        <Text color={CHROME}>  |  </Text>
        <Text bold={active === "details"} color={!hasSelection ? CHROME : active === "details" ? BLUE : MUTED}>{layout.segments[2]?.label}</Text>
        <Text color={CHROME}>  </Text>
        <Text bold={active === "plan"} color={!hasSelection ? CHROME : active === "plan" ? BLUE : MUTED}>{layout.segments[3]?.label}</Text>
        <Text color={CHROME}>  </Text>
        <Text bold={active === "config"} color={!hasSelection ? CHROME : active === "config" ? BLUE : MUTED}>{layout.segments[4]?.label}</Text>
      </Text>
      <Text bold={active === "help"} color={active === "help" ? BLUE : MUTED}>{layout.segments[5]?.label}</Text>
    </Box>
  );
}

export function OptionList({
  results,
  totalMatches,
  totalServers,
  selected,
  height,
  width,
  dimmed,
}: {
  results: SearchResult[];
  totalMatches: number;
  totalServers: number;
  selected: number;
  height: number;
  width: number;
  dimmed?: boolean;
}) {
  const visibleCount = Math.max(2, height - 2);
  const start = listWindowStart(selected, visibleCount, results.length);
  const visible = results.slice(start, start + visibleCount);

  return (
    <Box flexDirection="column" paddingX={3} height={height}>
      {results.length === 0 ? <Text color={MUTED}>No servers matched. Type / to search or l for live results.</Text> : null}
      {visible.map((result, index) => <OptionRow key={`${result.server.name}:${result.server.version}`} result={result} selected={start + index === selected} dimmed={dimmed} width={width} />)}
      {results.length > 0 ? (
        <Text color={CHROME} wrap="truncate">
          {"  "}selected {selected + 1} of {results.length} shown / {totalMatches} matches / {totalServers} cached servers
          {results.length < totalMatches ? <Text color={MUTED}>  press m for more</Text> : null}
        </Text>
      ) : null}
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

export function Centered({ width, children }: { width: number; children: React.ReactNode }) {
  const margin = Math.max(0, Math.floor((width - Math.min(width - 4, 104)) / 2));
  return (
    <Box marginLeft={margin} marginRight={margin}>
      {children}
    </Box>
  );
}

export function SelectedServerPanel({
  view,
  result,
  server,
  client,
  installScope,
  width,
  testResult,
  testing,
  versionInfo,
}: {
  view: View;
  result?: SearchResult;
  server?: NormalizedServer;
  client: ClientSelection;
  installScope: InstallScope;
  width: number;
  testResult?: ServerTestResult;
  testing: boolean;
  versionInfo?: TuiVersionInfo;
}) {
  switch (view) {
    case "plan":
      return <PlanView server={server} client={client} installScope={installScope} width={width} versionInfo={versionInfo} />;
    case "config":
      return <ConfigView server={server} client={client} installScope={installScope} width={width} />;
    case "details":
    case "discover":
    default:
      return <DetailsView result={result} server={server} width={width} testResult={testResult} testing={testing} versionInfo={versionInfo} />;
  }
}

function DetailsView({ result, server: selectedServer, width, testResult, testing, versionInfo }: { result?: SearchResult; server?: NormalizedServer; width: number; testResult?: ServerTestResult; testing: boolean; versionInfo?: TuiVersionInfo }) {
  if (!result) return <EmptyPanel title="Overview" />;
  const server = selectedServer ?? result.server;
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
      {versionInfo ? (
        <>
          <Metric label="selected" value={versionInfo.selectedVersion} valueColor={versionInfo.selectedVersion === versionInfo.latestVersion ? OK : WARN} />
          <Metric label="latest" value={versionInfo.latestVersion} valueColor={versionInfo.status === "update available" ? WARN : OK} />
          <Metric label="locked" value={`${versionInfo.lockedLabel} (${versionInfo.status})`} valueColor={versionInfo.status === "update available" ? WARN : versionInfo.status === "current" ? OK : MUTED} />
          {versionInfo.versions.length > 1 ? <Metric label="versions" value={formatVersionChoices(versionInfo, 6)} /> : null}
        </>
      ) : null}
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

function PlanView({ server, client, installScope, width, versionInfo }: { server?: NormalizedServer; client: ClientSelection; installScope: InstallScope; width: number; versionInfo?: TuiVersionInfo }) {
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
  const targetClients = selectedClientsForScope(client, installScope);
  const clientLabel = installClientLabel(client, targetClients);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={MODAL_BORDER} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title="install" file="plan" />
      <Box justifyContent="space-between">
        <Text color={MUTED}>target <Text color="white">{clientLabel}</Text>  <Text color="white">{scopeLabel(installScope)}</Text></Text>
        <Text color={MUTED}>I install  w lock</Text>
      </Box>
      <Spacer />
      <PlanMetric label="target" value={targetLabel} width={width} valueColor={targetKind === "remote" ? OK : WARN} />
      {versionInfo ? <PlanMetric label="version" value={`selected ${versionInfo.selectedVersion} / locked ${versionInfo.lockedLabel} / latest ${versionInfo.latestVersion} / ${versionInfo.status}`} width={width} valueColor={versionInfo.selectedVersion === versionInfo.latestVersion ? OK : WARN} /> : null}
      {versionInfo && versionInfo.versions.length > 1 ? <PlanMetric label="versions" value={`${formatVersionChoices(versionInfo, 8)}  (v/V cycle)`} width={width} /> : null}
      <PlanMetric label="trust" value={`${plan.trust.score} ${plan.trust.badges.join(", ") || "no badges"}`} width={width} valueColor={trustColor(plan.trust.score)} />
      <PlanMetric label="writes" value={client === "all" ? `${scopeLabel(installScope)} configs for ${targetClients.join(", ")} + mcp-lock.json` : `${scopeLabel(installScope)} ${client} config + mcp-lock.json`} width={width} />
      {targetClients.map((targetClient) => (
        <PlanMetric key={targetClient} label={targetClient} value={configTargetLabel(targetClient, installScope)} width={width} />
      ))}
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
          <PlanMetric key={targetClient} label={targetClient} value={configTargetLabel(targetClient, installScope)} width={width} />
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
      <Text color={MUTED}>client <Text color="white">{client}</Text>  scope <Text color="white">{installScope}</Text>  target <Text color="white">{configTargetLabel(client, installScope)}</Text></Text>
      <Text color={MUTED}>I install  s save</Text>
      <CodeBlock content={content} width={width} maxLines={16} />
    </Box>
  );
}

export function HelpView({ width }: { width: number }) {
  const lines: Array<[string, string]> = [
    ["what", "trusted install, lockfile, and governance for MCP servers; not a host"],
    ["sources", `enabled: ${REGISTRY_SOURCES.filter((source) => source.enabled).map((source) => source.id).join(", ")}; cache .toolpin/registry-cache.json`],
    ["results", "50 shown first; m/+ adds more up to 500; i refreshes; g filters source"],
    ["installed", "Installed tab shows folder/project and global/user configs, lock drift, updates, delete, and test"],
    ["score", "0-100 advisory trust from source, hashes, transport, secrets, and scans"],
    ["test", "t runs initialize + tools/list; tokens, APIs, or local services may be needed"],
    ["install", "I writes project-folder or global/current-user config; all writes all clients"],
    ["lock", "mcp-lock.json pins target/config/trust; ci catches drift; digest/signature pin it"],
    ["versions", "Overview/Install show locked vs latest; toolpin versions lists older releases"],
    ["keys", "/ search, j/k move, c/G client+scope, t/I test+install, u update installed, : commands"],
    ["files", "w lock, s save snippets, x remove config+lock, R reset, q quit"],
  ];
  const lineWidth = Math.max(24, width - 8);
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={MODAL_BORDER} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      {lines.map(([label, description]) => (
        <Text key={label} color={MUTED} wrap="truncate">
          {truncate(`${label.padEnd(8)} ${description}`, lineWidth).padEnd(lineWidth)}
        </Text>
      ))}
    </Box>
  );
}

export function CommandPalette({
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

export function ActivityStrip({ state, width }: { state: TuiState; width: number }) {
  const active = state.installing || state.testing || state.loading;
  const log = commandLogForView(state);
  const color = state.error || log?.ok === false ? ERR : active ? WARN : log ? OK : MUTED;
  const label = active ? "working" : log ? log.title : "status";
  const activeMessage = state.loading
    ? "loading registry data..."
    : state.installing
      ? "installing selected server..."
      : state.testing
        ? "testing selected MCP server..."
        : undefined;
  const primary = activeMessage ?? log?.lines[0] ?? state.lastAction ?? "ready";
  const secondary = active ? log?.lines.slice(0, 2) ?? [] : log?.lines.slice(1, 3) ?? [];

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

export function Footer({ view, inputMode }: { view: View; inputMode: InputMode }) {
  const hints = inputMode === "search"
    ? [["Enter", "apply"], ["Esc", "cancel"], ["Backspace", "edit"]]
    : inputMode === "command"
      ? [["Enter", "run"], ["Esc", "close"], ["Type", "filter"], ["j/k", "select"]]
    : view === "discover"
      ? [["/", "search"], ["m", "more"], ["i", "refresh"], ["R", "reset"], ["j/k", "move"], ["q", "quit"]]
      : view === "installed"
        ? [["j/k", "move"], ["u", "update/adopt"], ["U", "all"], ["x", "delete"], ["t", "test"], ["d", "drift"], ["q", "quit"]]
      : view === "details"
        ? [["Esc", "browse"], ["c", "client"], ["G", "scope"], ["v/V", "version"], ["t", "test"], ["I", "install"], ["q", "quit"]]
        : [["Esc", "browse"], ["c", "client"], ["G", "scope"], ["v/V", "version"], ["I", "install"], ["q", "quit"]];
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

function trustColor(score: number): string {
  if (score >= 80) return OK;
  if (score >= 60) return WARN;
  return ERR;
}
