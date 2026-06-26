import React from "react";
import { Box, Text } from "ink";
import { clientsForScope, exportClientConfig, PROJECT_CLIENTS } from "../../config.js";
import { type InstallScope } from "../../install.js";
import { buildInstallPlan, type InstallPlan } from "../../plan.js";
import { REGISTRY_SOURCES } from "../../registry.js";
import type { ServerTestResult } from "../../tester.js";
import type { NormalizedServer, RegistryEntry, RegistrySourceId, RegistrySourceInfo, SearchResult } from "../../types.js";
import { scoreServer } from "../../trust.js";
import { TOOLPIN_VERSION } from "../../version.js";
import { commandLineFor } from "../command.js";
import { ACCENT, BLUE, CHROME, ERR, MUTED, OK, SURFACE, TUI_COMMANDS, WARN } from "../constants.js";
import { formatClientConfigSnippet } from "../configSnippet.js";
import { asObject, safeJson, shortPath, truncate } from "../format.js";
import { computeMenuLayout, listWindowStart } from "../layout.js";
import { commandLogForView, configTargetLabel, formatVersionChoices, installClientChoicesForScope, installClientLabel, scopeLabel, selectedClientsForScope } from "../selectors.js";
import type { BrowseLayout, ClientSelection, CommandLog, InputMode, InstallFlow, TuiState, TuiVersionInfo, View } from "../types.js";
import { riskTone, scoreBreakdown, trustBarCells } from "../ui/trust.js";

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
    <Box marginX={2} marginBottom={1} backgroundColor={SURFACE} paddingX={1} paddingY={1}>
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
              <Text color={MUTED}>Search: </Text>
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
  const segment = (view: View) => layout.segments.find((entry) => entry.view === view);
  return (
    <Box paddingX={2} marginBottom={1} justifyContent="space-between">
      <Text wrap="truncate">
        <Text bold={active === "discover"} color={active === "discover" ? BLUE : MUTED}>{segment("discover")?.label}</Text>
        <Text color={CHROME}>  </Text>
        <Text bold={active === "installed"} color={active === "installed" ? BLUE : MUTED}>{segment("installed")?.label}</Text>
        {segment("sources") ? (
          <>
            <Text color={CHROME}>  </Text>
            <Text bold={active === "sources"} color={active === "sources" ? BLUE : MUTED}>{segment("sources")?.label}</Text>
          </>
        ) : null}
        <Text color={CHROME}>  |  </Text>
        <Text color={hasSelection ? MUTED : CHROME}>Selected: </Text>
        <Text color={hasSelection ? "white" : CHROME}>{layout.selectedLabel}</Text>
        {hasSelection ? (
          <>
            <Text color={CHROME}>  |  </Text>
            <Text bold={active === "details"} color={active === "details" ? BLUE : MUTED}>{segment("details")?.label}</Text>
            <Text color={CHROME}>  </Text>
            <Text bold={active === "plan"} color={active === "plan" ? BLUE : MUTED}>{segment("plan")?.label}</Text>
            <Text color={CHROME}>  </Text>
            <Text bold={active === "config"} color={active === "config" ? BLUE : MUTED}>{segment("config")?.label}</Text>
          </>
        ) : null}
      </Text>
      <Text bold={active === "help"} color={active === "help" ? BLUE : MUTED}>{segment("help")?.label}</Text>
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
  query,
  browseLayout,
  dimmed,
}: {
  results: SearchResult[];
  totalMatches: number;
  totalServers: number;
  selected: number;
  height: number;
  width: number;
  query: string;
  browseLayout: BrowseLayout;
  dimmed?: boolean;
}) {
  const grouped = browseLayout !== "flat";
  const visibleCount = grouped ? Math.max(1, Math.floor((height - 2) / 2)) : Math.max(2, height - 1);
  const start = listWindowStart(selected, visibleCount, results.length);
  const visible = results.slice(start, start + visibleCount);
  let previousCategory = "";
  let usedLines = 0;
  const maxLines = Math.max(1, height - 1);

  return (
    <Box flexDirection="column" paddingX={3} height={height}>
      {results.length === 0 ? (
        <Box flexDirection="column" paddingTop={1}>
          <Text bold color="white">No servers found</Text>
          <Text color={MUTED} wrap="wrap">
            {query.trim()
              ? `No MCP servers match "${query.trim()}". Try a different search, press r to refresh cached registries, or press l to search live sources.`
              : "No MCP servers are available for the current filters. Type / to search, press r to refresh cached registries, or press l to search live sources."}
          </Text>
        </Box>
      ) : null}
      {visible.map((result, index) => {
        if (!grouped) {
          return <OptionRow key={`${result.server.name}:${result.server.version}`} result={result} selected={start + index === selected} dimmed={dimmed} width={width} />;
        }
        const category = browseCategory(result.server);
        const showCategory = browseLayout === "category" && category !== previousCategory;
        const rowLines = showCategory ? 3 : 2;
        previousCategory = category;
        if (usedLines + rowLines > maxLines) return null;
        usedLines += rowLines;
        return (
          <GroupedOptionRow
            key={`${result.server.name}:${result.server.version}`}
            result={result}
            selected={start + index === selected}
            dimmed={dimmed}
            width={width}
            category={showCategory ? category : undefined}
          />
        );
      })}
      {results.length > 0 ? (
        <Text color={CHROME} wrap="truncate">
          {"  "}selected {selected + 1} of {results.length} shown / {totalMatches} matches / {totalServers} cached servers
          <Text color={MUTED}>  layout:{browseLayout}</Text>
          {results.length < totalMatches ? <Text color={MUTED}>  press m for more</Text> : null}
        </Text>
      ) : null}
    </Box>
  );
}

function GroupedOptionRow({ result, selected = false, dimmed, width, category }: { result: SearchResult; selected?: boolean; dimmed?: boolean; width: number; category?: string }) {
  const server = result.server;
  const contentWidth = Math.max(24, width - 6);
  const titleWidth = Math.max(14, contentWidth - 20);
  const detailWidth = Math.max(10, contentWidth - 5);
  const project = browseProject(server);
  const detail = `${project}  ${server.registrySource}  ${(server.packageTypes[0] ?? server.remoteTypes[0] ?? "unknown")}`;
  return (
    <>
      {category ? <Text color={MUTED} wrap="truncate">  category {truncate(category, Math.max(8, width - 15))}</Text> : null}
      <Text wrap="truncate">
        <Text color={selected ? BLUE : dimmed ? CHROME : BLUE}>{selected ? "> " : ": "}</Text>
        <Text bold={selected} color={dimmed ? MUTED : "white"}>{truncate(server.title || server.name, titleWidth).padEnd(titleWidth)}</Text>
        <Text color={CHROME}> </Text>
        <TrustMeter score={result.trust.score} cells={Math.max(9, Math.min(18, contentWidth - titleWidth - 4))} />
      </Text>
      <Text color={dimmed ? CHROME : MUTED} wrap="truncate">
        <Text color={CHROME}>    project </Text>
        {truncate(detail, detailWidth)}
      </Text>
    </>
  );
}

function OptionRow({ result, selected = false, dimmed, width }: { result: SearchResult; selected?: boolean; dimmed?: boolean; width: number }) {
  const server = result.server;
  const contentWidth = Math.max(24, width - 6);
  const titleWidth = Math.max(14, Math.min(36, Math.floor(contentWidth * 0.52)));
  const meterWidth = Math.max(9, contentWidth - 2 - 9 - 1 - titleWidth - 1 - 5);
  return (
    <Text wrap="truncate">
      <Text color={selected ? BLUE : dimmed ? CHROME : BLUE}>{selected ? "> " : ": "}</Text>
      <Text color={selected ? BLUE : dimmed ? CHROME : BLUE}>{truncate(server.registrySource, 8).padEnd(8)} </Text>
      <Text bold={selected} color={dimmed ? MUTED : "white"}>{truncate(server.title || server.name, titleWidth).padEnd(titleWidth)}</Text>
      <Text color={CHROME}> </Text>
      <TrustMeter score={result.trust.score} cells={meterWidth} />
    </Text>
  );
}

function browseCategory(server: NormalizedServer): string {
  const sourceMeta = server.raw._meta?.["dev.toolpin/source"];
  const category = sourceMeta && typeof sourceMeta === "object" && !Array.isArray(sourceMeta)
    ? (sourceMeta as Record<string, unknown>).category
    : undefined;
  return typeof category === "string" && category.trim() ? category.trim() : "uncategorized";
}

function browseProject(server: NormalizedServer): string {
  if (!server.repositoryUrl) return "no project declared";
  try {
    const url = new URL(server.repositoryUrl);
    const parts = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join("/") : server.repositoryUrl;
  } catch {
    return server.repositoryUrl;
  }
}

export function SourcesView({
  sources,
  entries,
  activeSource,
  dataMode,
  width,
  height,
}: {
  sources: RegistrySourceInfo[];
  entries: RegistryEntry[];
  activeSource: RegistrySourceId | "all";
  dataMode: "cache" | "live";
  width: number;
  height: number;
}) {
  const contentWidth = Math.max(24, width - 4);
  const counts = sourceEntryCounts(entries);
  const sorted = [...sources].sort(compareSources);
  const connected = sorted.filter((source) => source.enabled);
  const visibleRows = Math.max(1, height - 9);
  const visible = sorted.slice(0, visibleRows);
  return (
    <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} height={height} flexGrow={1}>
      <ModalTitle title="sources" file="registry list" />
      <Text color={MUTED} wrap="truncate">
        Connected registry sources, ordered by trust. <Text color={activeSource === "all" ? OK : BLUE}>active:{activeSource}</Text> <Text color={CHROME}>mode:{dataMode}</Text>
      </Text>
      <Spacer />
      <Text wrap="truncate">
        <Text color={OK}>trusted first</Text>
        <Text color={CHROME}>  </Text>
        <Text color={MUTED}>{connected.length} connected / {sources.length} known</Text>
        <Text color={CHROME}>  </Text>
        <Text color={MUTED}>g changes active source, l toggles cache/live</Text>
      </Text>
      <Divider width={contentWidth} />
      {visible.map((source) => (
        <SourceRow
          key={source.id}
          source={source}
          count={counts.get(source.id) ?? 0}
          active={activeSource === source.id || (activeSource === "all" && source.enabled && source.mode === "installable")}
          width={contentWidth}
        />
      ))}
      {visible.length < sorted.length ? <Text color={CHROME}>{" ".repeat(2)}{sorted.length - visible.length} more source(s) hidden on this terminal height.</Text> : null}
      <Box flexGrow={1} />
      <Divider width={contentWidth} />
      <Text color={MUTED} wrap="truncate">
        Trust tiers: <Text color={OK}>canonical</Text> official source, <Text color={BLUE}>curated</Text> reviewed catalog, <Text color={WARN}>directory</Text> discovery/index source, <Text color={MUTED}>private</Text> configured source.
      </Text>
    </Box>
  );
}

function SourceRow({ source, count, active, width }: { source: RegistrySourceInfo; count: number; active: boolean; width: number }) {
  const trustColorValue = source.trust === "canonical" ? OK : source.trust === "curated" ? BLUE : source.trust === "directory" ? WARN : MUTED;
  const status = source.enabled ? "connected" : "not connected";
  const statusColor = source.enabled ? OK : CHROME;
  const auth = source.authRequired ? "auth required" : "no auth";
  const modeColor = source.mode === "installable" ? OK : WARN;
  const titleWidth = Math.max(16, Math.min(34, Math.floor(width * 0.26)));
  const meta = `${source.trust} / ${source.mode} / ${source.type ?? "custom"} / ${auth}`;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text wrap="truncate">
        <Text color={active ? OK : CHROME}>{active ? "> " : ": "}</Text>
        <Text bold={active} color={active ? OK : "white"}>{truncate(source.label, titleWidth).padEnd(titleWidth)}</Text>
        <Text color={CHROME}> </Text>
        <Text color={trustColorValue}>{source.trust.padEnd(9)}</Text>
        <Text color={CHROME}> </Text>
        <Text color={statusColor}>{status.padEnd(13)}</Text>
        <Text color={CHROME}> </Text>
        <Text color={modeColor}>{source.mode}</Text>
        <Text color={CHROME}> </Text>
        <Text color={MUTED}>{count} cached</Text>
      </Text>
      <Text color={MUTED} wrap="truncate">
        <Text color={CHROME}>    {source.id.padEnd(12)}</Text>
        {truncate(source.description || meta, Math.max(8, width - 18))}
      </Text>
    </Box>
  );
}

function sourceEntryCounts(entries: RegistryEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const source = entry.source ?? entry._meta?.source;
    if (typeof source === "string") counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return counts;
}

function compareSources(left: RegistrySourceInfo, right: RegistrySourceInfo): number {
  return Number(right.enabled) - Number(left.enabled)
    || sourceTrustRank(left.trust) - sourceTrustRank(right.trust)
    || sourceModeRank(left.mode) - sourceModeRank(right.mode)
    || left.label.localeCompare(right.label);
}

function sourceTrustRank(trust: RegistrySourceInfo["trust"]): number {
  if (trust === "canonical") return 0;
  if (trust === "curated") return 1;
  if (trust === "directory") return 2;
  return 3;
}

function sourceModeRank(mode: RegistrySourceInfo["mode"]): number {
  return mode === "installable" ? 0 : 1;
}

function TrustMeter({ score, showScore = true, cells: cellCount = 9 }: { score: number; showScore?: boolean; cells?: number }) {
  const cells = cellCount === 9
    ? trustBarCells(score)
    : {
        filled: Math.max(0, Math.min(cellCount, Math.round((score / 100) * cellCount))),
        empty: Math.max(0, cellCount - Math.max(0, Math.min(cellCount, Math.round((score / 100) * cellCount)))),
      };
  const color = trustColor(score);
  return (
    <Text>
      <Text color={color}>{"▓".repeat(cells.filled)}</Text>
      <Text color={CHROME}>{"░".repeat(cells.empty)}</Text>
      {showScore ? <Text color={color}>{" " + `${score}%`.padStart(4)}</Text> : null}
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
  const trust = scoreServer(server);
  const risk = riskTone(trust.score);
  const deltas = scoreBreakdown(trust);
  return (
    <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
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
          <Metric label="locked" value={`${versionInfo.lockedLabel} (${versionInfo.status})`} valueColor={lockStatusColor(versionInfo.status)} />
          {versionInfo.versions.length > 1 ? <Metric label="versions" value={formatVersionChoices(versionInfo, 6)} /> : null}
        </>
      ) : null}
      <Metric label="badges" value={trust.badges.join(", ") || "no badges"} />
      <Divider width={width} marginBottom={1} />
      <Box flexDirection="column">
        <Text>
          <Text color={MUTED}>trust       </Text>
          <Text color={trustColor(trust.score)}>{trust.score}%</Text>
          <Text color={CHROME}>  </Text>
          <TrustMeter score={trust.score} showScore={false} />
          <Text color={CHROME}>  </Text>
          <Text color={MUTED}>{risk.label}</Text>
        </Text>
        <Text color={MUTED} wrap="truncate">
          breakdown  {deltas.map((delta) => delta.label).join("  ")}
        </Text>
        <IssueRows issues={trust.issues} width={width} />
      </Box>
      <Divider width={width} marginBottom={1} />
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
      <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
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
    <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title="install" file="plan" />
      <Box justifyContent="space-between">
        <Text color={MUTED}>target <Text color="white">{clientLabel}</Text>  <Text color="white">{scopeLabel(installScope)}</Text></Text>
        <Text color={MUTED}>i install  w lock</Text>
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
      <IssueRows issues={plan.trust.issues} width={width} />
    </Box>
  );
}

function ConfigView({ server, client, installScope, width }: { server?: NormalizedServer; client: ClientSelection; installScope: InstallScope; width: number }) {
  if (!server) return <EmptyPanel title="Config" />;
  if (client === "all") {
    return (
      <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
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
    <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title="config" file={`${client}.${extension}`} />
      <Text color={MUTED}>client <Text color="white">{client}</Text>  scope <Text color="white">{installScope}</Text>  target <Text color="white">{configTargetLabel(client, installScope)}</Text></Text>
      <Text color={MUTED}>i install  s save</Text>
      <CodeBlock content={content} width={width} maxLines={16} />
    </Box>
  );
}

export function HelpView({ width, height }: { width: number; height: number }) {
  const lines: Array<[string, string, string]> = [
    ["Browse", "/", "Edit the search text. Press Esc while searching to clear it."],
    ["Browse", "j/k", "Move through the current server list."],
    ["Browse", "f", "Change list layout: flat, grouped by project, or grouped by category when categories exist."],
    ["Browse", "m / +", "Show more results, up to the maximum cached set."],
    ["Browse", "r", "Refresh the current registry data."],
    ["Browse", "g", `Change registry source: all, official, or docker. Enabled sources: ${REGISTRY_SOURCES.filter((source) => source.enabled).map((source) => source.id).join(", ")}.`],
    ["Installed", "I", "Show installed MCP servers and refresh the installed inventory."],
    ["Sources", "3", "Show connected registry sources, trust tiers, auth status, and cached entries."],
    ["Review", "Enter", "Open the install plan for the selected server."],
    ["Review", "t", "Test the selected server with initialize and tools/list."],
    ["Review", "v / V", "Cycle selected server version."],
    ["Install", "i", "Open the install wizard; choose version when available, then folder/global and client."],
    ["Install", "w", "Write only the lockfile entry for the selected server."],
    ["Config", "s", "Save the shown client config snippet under .toolpin/ for manual review."],
    ["Installed", "u", "Resolve the installed entry in the registry, make it registry-backed, and write/update mcp-lock.json."],
    ["Installed", "U", "Update all locked installed entries; unlocked adoptable entries are reported separately."],
    ["Installed", "x", "Open a Yes/No confirmation before removing the selected config and lock entry."],
    ["Installed", "d", "Run doctor against installed config and mcp-lock.json."],
    ["Global", "c / G", "Cycle target client and project/global install scope."],
    ["Global", ":", "Open the command palette."],
    ["Global", "R", "Reset search, source, result count, client, and scope."],
    ["Global", "q", "Quit ToolPin."],
  ];
  const lineWidth = Math.max(24, width - 8);
  const showExplanations = height >= 16;
  const shortcutRows = showExplanations
    ? Math.max(2, Math.min(lines.length, height - 22))
    : Math.max(1, height - 4);
  const visibleShortcuts = lines.slice(0, shortcutRows);
  const hiddenShortcutCount = Math.max(0, lines.length - visibleShortcuts.length);
  return (
    <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} height={height} flexGrow={1}>
      <ModalTitle title="help" file="shortcuts + trust" />
      <Text color={MUTED} wrap="truncate">Keyboard shortcuts and what each action changes.</Text>
      <Spacer />
      <Text bold color={BLUE}>shortcuts</Text>
      {visibleShortcuts.map(([section, keys, description]) => (
        <Text key={`${section}:${keys}`} wrap="truncate">
          <Text color={MUTED}>{section.padEnd(10)}</Text>
          <Text bold color={OK}>{keys.padEnd(10)}</Text>
          <Text color="white">{truncate(description, lineWidth - 20)}</Text>
        </Text>
      ))}
      {hiddenShortcutCount > 0 ? <Text color={CHROME}>{" ".repeat(10)}{hiddenShortcutCount} more shortcut(s) hidden on this terminal height.</Text> : null}
      {showExplanations ? (
        <>
          <Divider width={width} />
          <Text bold color={BLUE}>about toolpin</Text>
          <HelpNote width={lineWidth} label="created" text="ToolPin is the review gate between MCP registries and AI clients that run servers with your credentials." />
          <HelpNote width={lineWidth} label="goal" text="Make MCP installs reviewable and repeatable: inspect the plan, write client config, commit mcp-lock.json, fail CI on drift." />
          <HelpNote width={lineWidth} label="needed" text="MCP servers can add tools, local process access, network access, and secrets; copied JSON alone leaves no reviewed artifact." />
          <HelpNote width={lineWidth} label="not" text="ToolPin is not a catalog, runtime sandbox, gateway, or secret vault; it is the repo-owned install and governance layer." />
          <Spacer />
          <Text bold color={BLUE}>scoring</Text>
          <HelpNote width={lineWidth} label="score" text="0-100 advisory trust score for review priority, not a security guarantee or install blocker." />
          <HelpNote width={lineWidth} label="inputs" text="Source trust, repository metadata, namespace, transport, package pinning, secrets, and description-scan findings." />
          <HelpNote width={lineWidth} label="colors" text="Green is high confidence, yellow needs review, red means critical mutable or risky package evidence." />
          <Spacer />
          <Text bold color={BLUE}>locking</Text>
          <HelpNote width={lineWidth} label="lockfile" text="mcp-lock.json records the selected server, version, client, resolved launch target, trust data, and integrity digest." />
          <HelpNote width={lineWidth} label="install" text="Install writes client config and the matching lock entry after policy and drift checks pass." />
          <HelpNote width={lineWidth} label="doctor/ci" text="Doctor and CI compare client config with mcp-lock.json so config drift, digest drift, and signature failures are visible." />
          <HelpNote width={lineWidth} label="adopt/update" text="Installed u resolves an existing config entry in the registry and locks it; U updates already locked entries." />
        </>
      ) : null}
    </Box>
  );
}

function HelpNote({ label, text, width }: { label: string; text: string; width: number }) {
  return (
    <Text wrap="truncate">
      <Text color={MUTED}>{label.padEnd(10)}</Text>
      <Text color="white">{truncate(text, width - 10)}</Text>
    </Text>
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
    <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title="commands" file="toolpin" />
      <Text color={MUTED} wrap="truncate">Enter runs the selected command; install opens the scope/client wizard.</Text>
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

export function InstallWizard({ flow, width, height }: { flow: InstallFlow; width: number; height: number }) {
  const contentWidth = Math.max(24, width - 6);
  const progress = installProgress(flow);
  const versionStepEnabled = flow.versions.length > 1;
  const totalSteps = versionStepEnabled ? 3 : 2;
  const versionOptions = flow.versions.map((server, index) => ({
    id: server.version,
    label: server.version,
    hint: index === 0 ? "latest version" : `older version from ${server.registrySource}`,
  }));
  const scopeOptions = [
    { id: "project", label: "folder (project)", hint: "config in this folder" },
    { id: "global", label: "global (user)", hint: "current-user config" },
  ];
  const clientOptions = installClientChoicesForScope(flow.scope ?? "project", flow.preferredClient).map((client) => ({
    id: client,
    label: client,
    hint: client === "all" ? "every supported client for the chosen scope" : "",
  }));
  const options = flow.step === "version" ? versionOptions : flow.step === "scope" ? scopeOptions : clientOptions;
  const scopeText = flow.scope === "global" ? "global/user" : "folder/project";
  const stepLabel = flow.step === "version"
    ? `Step 1 of ${totalSteps}: choose version`
    : flow.step === "scope"
    ? `Step ${versionStepEnabled ? 2 : 1} of ${totalSteps}: choose where to install`
    : flow.step === "client"
      ? `Step ${versionStepEnabled ? 3 : 2} of ${totalSteps}: choose client (${scopeText})`
      : flow.step === "complete"
        ? "Install complete"
        : flow.step === "failed"
          ? "Install failed"
          : "Installing selected MCP server";
  const visibleCount = Math.max(3, height - 10);
  const start = listWindowStart(flow.selected, visibleCount, options.length);
  const visible = options.slice(start, start + visibleCount);

  return (
    <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} height={height}>
      <ModalTitle title="install" file={flow.server.name} />
      <Text color={MUTED} wrap="truncate">{stepLabel}</Text>
      {flow.step === "version" || flow.step === "scope" || flow.step === "client" ? (
        <Text color={OK} wrap="truncate">Select an option, then press Enter to continue.</Text>
      ) : null}
      <Spacer />
      {flow.step === "installing" ? (
        <Text color={MUTED}>Writing config and mcp-lock.json...</Text>
      ) : flow.step === "complete" ? (
        <Text color={MUTED}>Press Enter or Esc to close.</Text>
      ) : flow.step === "failed" ? (
        <Text color={ERR}>Review the status message, then press Enter or Esc.</Text>
      ) : visible.map((option, index) => {
          const isSelected = start + index === flow.selected;
          return (
            <Text key={option.id} wrap="truncate">
              <Text color={isSelected ? OK : CHROME}>{isSelected ? ">" : ":"}</Text>
              <Text bold={isSelected} color={isSelected ? OK : "white"}> {option.label.padEnd(18)}</Text>
              <Text color={isSelected ? OK : MUTED}>{truncate(option.hint, Math.max(0, contentWidth - 22))}</Text>
            </Text>
          );
        })}
      <Box flexGrow={1} />
      <Box marginTop={1} marginBottom={1}>
        <ProgressBar percent={progress} width={contentWidth} tone={flow.step === "failed" ? ERR : progress === 100 ? OK : ACCENT} />
      </Box>
      <Text color={CHROME} wrap="truncate">  j/k or arrows move  Enter continue  Esc cancel</Text>
    </Box>
  );
}

function installProgress(flow: InstallFlow): number {
  const hasVersionStep = flow.versions.length > 1;
  if (flow.step === "version") return 0;
  if (flow.step === "scope") return hasVersionStep ? 33 : 0;
  if (flow.step === "client") return hasVersionStep ? 66 : 50;
  if (flow.step === "installing") return 75;
  if (flow.step === "complete") return 100;
  return 100;
}

function ProgressBar({ percent, width, tone }: { percent: number; width: number; tone: string }) {
  const barWidth = Math.max(6, Math.min(36, width - 10));
  const filled = Math.max(0, Math.min(barWidth, Math.round((percent / 100) * barWidth)));
  const empty = Math.max(0, barWidth - filled);
  return (
    <Box flexDirection="column" width={width}>
      <Text wrap="truncate">
        <Text color={MUTED}> 0% </Text>
        <Text color={tone}>{"▓".repeat(filled)}</Text>
        <Text color={CHROME}>{"░".repeat(empty)}</Text>
        <Text color={MUTED}> 100%</Text>
      </Text>
      <Text color={tone} wrap="truncate">progress {percent}%</Text>
    </Box>
  );
}

export function ActivityStrip({ state, width }: { state: TuiState; width: number }) {
  const active = state.installing || state.testing || state.loading || state.checking;
  const log = commandLogForView(state);
  const color = state.error || log?.ok === false ? ERR : active ? WARN : log ? OK : MUTED;
  const label = active ? "working" : log ? log.title : "status";
  const activeMessage = state.loading
    ? "loading registry data..."
    : state.installing
      ? "installing reviewed server..."
      : state.testing
        ? "testing selected MCP server..."
        : state.checking
          ? "checking installed config drift..."
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
          <Text color={CHROME}>{" ".repeat(8)}</Text>
          {truncate(line, width - 11)}
        </Text>
      ))}
    </Box>
  );
}

export function OperationModal({ state, width, height }: { state: TuiState; width: number; height: number }) {
  const active = state.installing || state.testing || state.checking;
  const log = commandLogForView(state);
  const candidate = buildOperationSnapshot({ active, log, state });
  const [snapshot, setSnapshot] = React.useState<OperationSnapshot | undefined>(candidate);
  const candidateKey = candidate?.key;

  React.useEffect(() => {
    if (state.installFlow || !candidate) {
      setSnapshot(undefined);
      return undefined;
    }
    setSnapshot(candidate);
    if (candidate.active) return undefined;
    const timer = setTimeout(() => {
      setSnapshot((current) => current?.key === candidate.key ? undefined : current);
    }, 3000);
    return () => clearTimeout(timer);
  }, [candidateKey, state.installFlow]);

  if (!snapshot || state.installFlow) return null;
  const modalWidth = Math.min(Math.max(44, Math.floor(width * 0.44)), 86);
  const lines = snapshot.lines.slice(0, 4);
  const modalHeight = lines.length + 6;
  const left = Math.max(0, Math.floor((width - modalWidth) / 2));
  const top = Math.max(0, Math.floor((height - modalHeight) / 2));
  const lineWidth = Math.max(8, modalWidth - 4);
  return (
    <Box position="absolute" left={left} top={top} width={modalWidth} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexDirection="column">
      <Text bold color={BLUE} wrap="truncate">{truncate(snapshot.title, modalWidth - 4)}</Text>
      <Box marginTop={1}>
        <Text color={CHROME}>{"─".repeat(lineWidth)}</Text>
      </Box>
      <Spacer />
      {lines.map((line, index) => (
        <Text key={`${index}:${line}`} color={MUTED} wrap="truncate">
          {truncate(line, modalWidth - 4)}
        </Text>
      ))}
    </Box>
  );
}

export function DeleteConfirmModal({ state, width, height }: { state: TuiState; width: number; height: number }) {
  const confirm = state.deleteConfirm;
  if (!confirm) return null;
  const modalWidth = Math.min(Math.max(54, Math.floor(width * 0.42)), 84);
  const modalHeight = 12;
  const left = Math.max(0, Math.floor((width - modalWidth) / 2));
  const top = Math.max(0, Math.floor((height - modalHeight) / 2));
  const lineWidth = Math.max(8, modalWidth - 4);
  const selectedNo = confirm.selected === "no";
  const selectedYes = confirm.selected === "yes";
  return (
    <Box position="absolute" left={left} top={top} width={modalWidth} backgroundColor={SURFACE} paddingX={2} paddingY={1} flexDirection="column">
      <Text bold color={BLUE}>delete installed server?</Text>
      <Box marginTop={1}>
        <Text color={CHROME}>{"─".repeat(lineWidth)}</Text>
      </Box>
      <Spacer />
      <Text color={MUTED} wrap="wrap">
        This will remove the client config entry and matching mcp-lock.json entry.
      </Text>
      <Text color="white" wrap="truncate">{truncate(confirm.serverName, modalWidth - 4)}</Text>
      <Text color={MUTED} wrap="truncate">
        {confirm.client} / {confirm.scope}
      </Text>
      <Spacer />
      <Text>
        <Text bold={selectedNo} color={selectedNo ? OK : MUTED}>{selectedNo ? "> " : "  "}No, keep it</Text>
        <Text color={CHROME}>    </Text>
        <Text bold={selectedYes} color={selectedYes ? ERR : MUTED}>{selectedYes ? "> " : "  "}Yes, delete</Text>
      </Text>
      <Spacer />
      <Text color={CHROME}>Left/right or j/k choose  Enter confirm  y yes  n/Esc no</Text>
    </Box>
  );
}

interface OperationSnapshot {
  key: string;
  title: string;
  lines: string[];
  active: boolean;
}

function buildOperationSnapshot({ active, log, state }: { active: boolean; log?: CommandLog; state: TuiState }): OperationSnapshot | undefined {
  if (!active && !log) return undefined;
  if (!active && log && !isOperationLog(log.title)) return undefined;
  const activeTitle = state.testing
    ? "testing"
    : state.checking
      ? "checking"
      : operationTitle(log?.title ?? "install");
  const title = active ? activeTitle : operationTitle(log?.title ?? "operation");
  const activeMessage = state.testing
    ? "testing selected MCP server..."
    : state.checking
      ? "checking config and lock drift..."
      : "installing or updating MCP server...";
  const outcome = !active && log ? (log.ok ? "complete" : "failed") : undefined;
  const lines = [
    active ? activeMessage : outcome,
    ...(log?.lines ?? []),
  ].filter((line): line is string => Boolean(line));
  const key = [
    active ? "active" : "settled",
    title,
    log?.ok === false ? "error" : "ok",
    log?.command ?? "",
    lines.join("\u0000"),
  ].join("\u0001");
  return { key, title, lines, active };
}

function operationTitle(title: string): string {
  if (title === "test") return "testing";
  if (title === "install") return "installing";
  if (title === "update") return "updating";
  if (title === "adopt") return "adopting";
  if (title === "doctor") return "checking";
  return title;
}

function isOperationLog(title: string): boolean {
  return ["install", "update", "adopt", "test", "doctor", "remove"].includes(title);
}

export function Footer({ view, inputMode, width }: { view: View; inputMode: InputMode; width: number }) {
  const hints = inputMode === "search"
    ? [["Enter", "apply"], ["Esc", "cancel"], ["Backspace", "edit"]]
    : inputMode === "command"
      ? [["Enter", "run"], ["Esc", "close"], ["Type", "filter"], ["j/k", "select"]]
    : view === "discover"
      ? [["/", "search"], ["f", "layout"], ["g", "source"], ["m", "more"], ["i", "install"], ["I", "installed"], ["r", "refresh"], ["R", "reset"], ["j/k", "move"], ["q", "quit"]]
      : view === "installed"
        ? [["j/k", "move"], ["I", "refresh list"], ["u", "registry+lock"], ["U", "update locked"], ["x", "delete"], ["t", "test-installed"], ["d", "doctor"], ["q", "quit"]]
      : view === "sources"
        ? [["g", "source"], ["l", "cache/live"], ["r", "refresh"], ["1", "browse"], ["2", "installed"], ["q", "quit"]]
      : view === "details"
        ? [["Enter", "plan"], ["Esc", "browse"], ["c", "client"], ["G", "scope"], ["v/V", "version"], ["t", "test"], ["i", "install"], ["q", "quit"]]
      : view === "plan"
        ? [["Enter", "install"], ["Esc", "browse"], ["c", "client"], ["G", "scope"], ["v/V", "version"], ["i", "install"], ["q", "quit"]]
        : [["Esc", "browse"], ["c", "client"], ["G", "scope"], ["v/V", "version"], ["i", "install"], ["q", "quit"]];
  const copyright = "© 2026 Proofofwork Agency · https://github.com/proofofwork-agency/toolpin";
  const copyrightWidth = Math.min(copyright.length, Math.max(0, width - 8));
  const hintWidth = Math.max(10, width - copyrightWidth - 8);
  return (
    <Box paddingX={2} marginTop={1} flexShrink={0} justifyContent="space-between">
      <Box width={hintWidth}>
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
      <Text color={CHROME} wrap="truncate">{truncate(copyright, copyrightWidth)}</Text>
    </Box>
  );
}

function EmptyPanel({ title }: { title: string }) {
  return (
    <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title={title.toLowerCase()} file="empty" />
      <Text color={MUTED}>No server selected. Search and select a server first.</Text>
    </Box>
  );
}

function ModalTitle({ title, file }: { title: string; file: string }) {
  return (
    <Box justifyContent="space-between">
      <Text bold color={ACCENT}>{title}</Text>
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

function Divider({ width, marginBottom = 0 }: { width: number; marginBottom?: number }) {
  const lineWidth = Math.max(8, width - 6);
  return (
    <Box marginTop={1} marginBottom={marginBottom}>
      <Text color={CHROME}>{"─".repeat(lineWidth)}</Text>
    </Box>
  );
}

function IssueRows({ issues, width, rows = 4 }: { issues: Array<{ severity: "info" | "warning" | "critical"; code: string; message: string }>; width: number; rows?: number }) {
  const visible = issues.slice(0, rows);
  const blank = " ".repeat(Math.max(1, width - 4));
  return (
    <>
      {Array.from({ length: rows }, (_, index) => {
        const issue = visible[index];
        if (!issue) {
          return <Text key={`issue-empty-${index}`}>{blank}</Text>;
        }
        return (
          <Text key={`${issue.code}-${index}`} color={issue.severity === "critical" ? ERR : issue.severity === "warning" ? WARN : MUTED} wrap="truncate">
            {issue.severity}: {truncate(issue.message, width - 12)}
          </Text>
        );
      })}
    </>
  );
}

function lockStatusColor(status: TuiVersionInfo["status"]): string {
  if (status === "current") return OK;
  if (status === "not locked") return ERR;
  if (status === "update available" || status === "ahead of registry") return WARN;
  return MUTED;
}

function trustColor(score: number): string {
  if (score >= 80) return OK;
  if (score >= 60) return WARN;
  return ERR;
}
