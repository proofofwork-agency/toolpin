import React from "react";
import { Box, Text } from "ink";
import { clientsForScope, exportClientConfig, PROJECT_CLIENTS } from "../../config.js";
import { type InstallScope } from "../../install.js";
import { buildInstallPlan, type InstallPlan } from "../../plan.js";
import { REGISTRY_SOURCES } from "../../registry.js";
import type { ServerTestResult } from "../../tester.js";
import type { NormalizedServer, RegistryEntry, RegistrySourceId, RegistrySourceInfo, SearchResult, TrustTier } from "../../types.js";
import { evidenceStatus, evidenceSummary, scoreServer, trustCapExplanation, trustTier } from "../../trust.js";
import { TOOLPIN_VERSION } from "../../version.js";
import { commandLineFor } from "../command.js";
import { ACCENT, BLUE, CHROME, ERR, MUTED, OK, SURFACE, TUI_COMMANDS, WARN } from "../constants.js";
import { formatClientConfigSnippet } from "../configSnippet.js";
import { asObject, safeJson, shortPath, truncate } from "../format.js";
import { computeMenuLayout, listWindowStart } from "../layout.js";
import { commandLogForView, configTargetLabel, formatVersionChoices, installClientChoicesForScope, installClientLabel, scopeLabel, selectedClientsForScope } from "../selectors.js";
import type { BrowseLayout, ClientSelection, CommandLog, InputMode, InstallFlow, TuiState, TuiVersionInfo, View } from "../types.js";
import { trustBarCells, trustDimensions, trustRiskTone, trustTierScore } from "../ui/trust.js";

export function ChromeHeader({ state, resultCount, totalMatches, selectedServer, width }: { state: TuiState; resultCount: number; totalMatches: number; selectedServer?: NormalizedServer; width: number }) {
  const status = state.installing ? "install" : state.testing ? "test" : state.loading ? "sync" : state.error ? "err" : "ready";
  const statusColor = state.installing || state.testing || state.loading ? WARN : state.error ? ERR : OK;
  const right = `${status} | client:${state.client} | source:${state.sourceMode} | shown:${resultCount}/${totalMatches} matches`;
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
        <Text color={MUTED}>{resultCount} / {totalMatches} matches</Text>
      </Text>
    </Box>
  );
}

export function PromptBar({ state, width }: { state: TuiState; width: number }) {
  const active = state.inputMode === "search";
  const commandActive = state.inputMode === "command";
  const editing = active || commandActive;
  const [cursorVisible, setCursorVisible] = React.useState(true);

  React.useEffect(() => {
    if (!editing) {
      setCursorVisible(false);
      return undefined;
    }
    setCursorVisible(true);
    const interval = setInterval(() => setCursorVisible((visible) => !visible), 520);
    return () => clearInterval(interval);
  }, [editing]);

  const cursor = editing ? (
    <Text color={cursorVisible ? BLUE : SURFACE}>▌</Text>
  ) : null;

  return (
    <Box marginX={2} marginBottom={1} backgroundColor={SURFACE} paddingX={1} paddingY={1}>
      <Box justifyContent="space-between" width={Math.max(1, width - 6)}>
        <Text wrap="truncate">
          {commandActive ? (
            <>
              <Text color={MUTED}>Command </Text>
              <Text color={CHROME}>toolpin </Text>
              <Text color="white">{state.commandQuery || "command"}</Text>
              {cursor}
            </>
          ) : (
            <>
              <Text color={MUTED}>Search: </Text>
              <Text color="white">{state.query || "Search MCP servers"}</Text>
              {cursor}
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
  totalVersions,
  selected,
  height,
  width,
  query,
  loading,
  browseLayout,
  dimmed,
}: {
  results: SearchResult[];
  totalMatches: number;
  totalServers: number;
  totalVersions: number;
  selected: number;
  height: number;
  width: number;
  query: string;
  loading?: boolean;
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
      {results.length === 0 && loading ? (
        <RegistryLoadingPanel height={height} />
      ) : results.length === 0 ? (
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
          {"  "}selected {selected + 1} of {results.length} shown / {totalMatches} matches / {totalServers} latest servers / {totalVersions} cached versions
          <Text color={MUTED}>  layout:{browseLayout}</Text>
          {results.length < totalMatches ? <Text color={MUTED}>  press m for more</Text> : null}
        </Text>
      ) : null}
    </Box>
  );
}

export function RegistryLoadingPanel({ height }: { height: number }) {
  const frames = ["[-]", "[\\]", "[|]", "[/]"];
  const [frame, setFrame] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => setFrame((current) => (current + 1) % frames.length), 140);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box height={height} alignItems="center" justifyContent="center" flexDirection="column">
      <Box flexDirection="column" backgroundColor={SURFACE} paddingX={1}>
        <Text color={CHROME}>+---------------+</Text>
        <Text>
          <Text color={CHROME}>|  </Text>
          <Text bold color={ACCENT}>ToolPin sync</Text>
          <Text color={CHROME}>  |</Text>
        </Text>
        <Text>
          <Text color={CHROME}>|   </Text>
          <Text color={OK}>{frames[frame]}</Text>
          <Text color={MUTED}> registry</Text>
          <Text color={CHROME}> |</Text>
        </Text>
        <Text color={CHROME}>+---------------+</Text>
      </Box>
    </Box>
  );
}

function GroupedOptionRow({ result, selected = false, dimmed, width, category }: { result: SearchResult; selected?: boolean; dimmed?: boolean; width: number; category?: string }) {
  const server = result.server;
  const contentWidth = Math.max(24, width - 6);
  const titleWidth = Math.max(14, contentWidth - 24);
  const detailWidth = Math.max(10, contentWidth - 5);
  const project = browseProject(server);
  const detail = `${project}  ${server.registrySource}  ${(server.packageTypes[0] ?? server.remoteTypes[0] ?? "unknown")}`;
  const meterWidth = Math.max(6, Math.min(18, contentWidth - titleWidth - TRUST_TIER_LABEL_WIDTH - 4));
  return (
    <>
      {category ? <Text color={MUTED} wrap="truncate">  category {truncate(category, Math.max(8, width - 15))}</Text> : null}
      <Text wrap="truncate">
        <Text color={selected ? BLUE : dimmed ? CHROME : BLUE}>{selected ? "> " : ": "}</Text>
        <Text bold={selected} color={dimmed ? MUTED : "white"}>{truncate(server.title || server.name, titleWidth).padEnd(titleWidth)}</Text>
        <Text color={CHROME}> </Text>
        <TrustTierMeter tier={result.trust.tier} score={result.trust.score} issues={result.trust.issues} cells={meterWidth} />
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
  const meterWidth = Math.max(6, contentWidth - 2 - 8 - 1 - titleWidth - 1 - 1 - TRUST_TIER_LABEL_WIDTH);
  return (
    <Text wrap="truncate">
      <Text color={selected ? BLUE : dimmed ? CHROME : BLUE}>{selected ? "> " : ": "}</Text>
      <Text color={selected ? BLUE : dimmed ? CHROME : BLUE}>{truncate(server.registrySource, 8).padEnd(8)} </Text>
      <Text bold={selected} color={dimmed ? MUTED : "white"}>{truncate(server.title || server.name, titleWidth).padEnd(titleWidth)}</Text>
      <Text color={CHROME}> </Text>
      <TrustTierMeter tier={result.trust.tier} score={result.trust.score} issues={result.trust.issues} cells={meterWidth} />
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
  selectedSource,
  dataMode,
  width,
  height,
}: {
  sources: RegistrySourceInfo[];
  entries: RegistryEntry[];
  activeSource: RegistrySourceId | "all";
  selectedSource: number;
  dataMode: "cache" | "live";
  width: number;
  height: number;
}) {
  const contentWidth = Math.max(24, width - 4);
  const counts = sourceEntryCounts(entries);
  const sorted = [...sources].sort(compareSources);
  const connected = sorted.filter((source) => source.enabled);
  const legendRows = height >= 18 ? 5 : 3;
  const visibleRows = Math.max(1, height - 9 - legendRows);
  const visible = sorted.slice(0, visibleRows);
  return (
    <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} height={height} flexGrow={1}>
      <ModalTitle title="sources" file="registry list" />
      <Text color={MUTED} wrap="truncate">
        Enabled registry sources feed browse/search. Disabled directories are known, not connected. <Text color={activeSource === "all" ? OK : BLUE}>active:{activeSource}</Text> <Text color={CHROME}>mode:{dataMode}</Text>
      </Text>
      <Spacer />
      <Text wrap="truncate">
        <Text color={OK}>trusted first</Text>
        <Text color={CHROME}>  </Text>
        <Text color={MUTED}>{connected.length} usable / {sources.length} known</Text>
        <Text color={CHROME}>  </Text>
        <Text color={MUTED}>j/k select, Enter/space toggle, r refresh enabled</Text>
      </Text>
      <Divider width={contentWidth} />
      {visible.map((source, index) => (
        <SourceRow
          key={source.id}
          source={source}
          count={counts.get(source.id) ?? 0}
          dataMode={dataMode}
          active={activeSource === source.id || (activeSource === "all" && source.enabled)}
          selected={index === selectedSource}
          width={contentWidth}
        />
      ))}
      {visible.length < sorted.length ? <Text color={CHROME}>{" ".repeat(2)}{sorted.length - visible.length} more source(s) hidden on this terminal height.</Text> : null}
      <Box flexGrow={1} />
      <Divider width={contentWidth} />
      <SourceLegend width={contentWidth} compact={legendRows < 5} />
    </Box>
  );
}

function SourceRow({ source, count, dataMode, active, selected, width }: { source: RegistrySourceInfo; count: number; dataMode: "cache" | "live"; active: boolean; selected: boolean; width: number }) {
  const trustColorValue = source.trust === "canonical" ? OK : source.trust === "curated" ? BLUE : source.trust === "directory" ? WARN : MUTED;
  const status = source.status ?? (source.enabled ? source.mode === "discovery" ? "discovery-only" : "ready" : "disabled");
  const statusColor = status === "ready" ? OK : status === "auth-missing" || status === "fetch-error" || status === "stale" ? ERR : status === "discovery-only" ? WARN : CHROME;
  const auth = source.authRequired ? "auth required" : "no auth";
  const modeColor = source.mode === "installable" ? OK : WARN;
  const titleWidth = Math.max(16, Math.min(34, Math.floor(width * 0.26)));
  const meta = `${source.trust} / ${source.mode} / ${source.type ?? "custom"} / ${auth}`;
  const rowColor = selected ? BLUE : active ? OK : CHROME;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text wrap="truncate">
        <Text color={rowColor}>{selected ? "> " : active ? "* " : ": "}</Text>
        <Text bold={selected || active} color={selected ? BLUE : active ? OK : "white"}>{truncate(source.label, titleWidth).padEnd(titleWidth)}</Text>
        <Text color={CHROME}> </Text>
        <Text color={trustColorValue}>{source.trust.padEnd(9)}</Text>
        <Text color={CHROME}> </Text>
        <Text color={statusColor}>{status.padEnd(14)}</Text>
        <Text color={CHROME}> </Text>
        <Text color={modeColor}>{source.mode}</Text>
        <Text color={CHROME}> </Text>
        <Text color={MUTED}>{sourceCountLabel(source, count, dataMode)}</Text>
      </Text>
      <Text color={MUTED} wrap="truncate">
        <Text color={CHROME}>    {source.id.padEnd(12)}</Text>
        {truncate(source.setupHint && status === "auth-missing" ? source.setupHint : source.description || meta, Math.max(8, width - 18))}
      </Text>
    </Box>
  );
}

export function sourceCountLabel(source: RegistrySourceInfo, count: number, dataMode: "cache" | "live"): string {
  const label = dataMode === "live" ? "loaded" : "cached";
  return `${count}${source.cachePageInfo?.hasMore ? "+" : ""} ${label}`;
}

function SourceLegend({ width, compact }: { width: number; compact: boolean }) {
  return (
    <Box flexDirection="column">
      <Text color={MUTED} wrap="truncate">
        <Text color={OK}>installable</Text> means ToolPin has package/remote metadata it can review, lock, and write.
      </Text>
      <Text color={MUTED} wrap="truncate">
        <Text color={WARN}>discovery-only</Text> means browse/search only; no install or lock until metadata is normalized.
      </Text>
      <Text color={MUTED} wrap="truncate">
        <Text color={CHROME}>cached/loaded</Text> is the number of entries currently stored or fetched for that source.
      </Text>
      {!compact ? (
        <>
          <Text color={MUTED} wrap="truncate">
            <Text color={OK}>canonical</Text>/<Text color={BLUE}>curated</Text> can carry install metadata; <Text color={WARN}>directory</Text> is broad discovery such as Glama.
          </Text>
          <Text color={MUTED} wrap="truncate">
            Verified metadata comes from official/Docker or an official-compatible curated registry with pinned package/remotes.
          </Text>
        </>
      ) : null}
      {compact ? <Text color={CHROME} wrap="truncate">{truncate("Verified metadata requires an installable source with pinned package/remotes.", width)}</Text> : null}
    </Box>
  );
}

function sourceEntryCounts(entries: RegistryEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const meta = entry._meta?.["dev.toolpin/source"];
    const source = entry.source ?? (meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>).source : undefined);
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

const TRUST_TIER_LABEL_WIDTH = 10;

function TrustTierMeter({ tier, score, issues, cells: cellCount = 9, showLabel = true }: { tier?: TrustTier; score: number; issues: SearchResult["trust"]["issues"]; cells?: number; showLabel?: boolean }) {
  const tone = trustRiskTone({ score, issues, tier });
  const filled = tierFill(tone.tier, cellCount);
  const label = tone.tier === "verified" ? "EVIDENCE" : tone.label;
  return (
    <Text>
      <Text color={tierColor(tone.tier)}>{"▓".repeat(filled)}</Text>
      <Text color={CHROME}>{"░".repeat(Math.max(0, cellCount - filled))}</Text>
      {showLabel ? <Text color={tierColor(tone.tier)}> {truncate(label, TRUST_TIER_LABEL_WIDTH).padStart(TRUST_TIER_LABEL_WIDTH)}</Text> : null}
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
  const risk = trustRiskTone(trust);
  const dimensions = trustDimensions(trust);
  const trustRowWidth = Math.max(28, width - 6);
  const trustBarCells = Math.max(9, Math.min(16, trustRowWidth - 34));
  const overallScore = trust.overallScore ?? trust.score;
  const metadataScore = trust.metadataCompleteness ?? trust.score;
  const capExplanation = trustCapExplanation(trust);
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
      <Metric label="evidence" value={evidenceSummary(trust)} />
      <Spacer />
      <CompactDivider width={width} />
      <Spacer />
      <Box flexDirection="column">
        <TrustTierRow
          label="evidence"
          value={risk.label}
          tier={risk.tier}
          score={trust.score}
          issues={trust.issues}
          cells={trustBarCells}
          suffix={`${trustTier(trust)} tier`}
          width={trustRowWidth}
        />
        <TrustScoreRow label="overall" score={overallScore} cells={trustBarCells} suffix="gated trust score" width={trustRowWidth} />
        <TrustScoreRow label="metadata" score={metadataScore} cells={trustBarCells} suffix="profile completeness" width={trustRowWidth} />
        {dimensions.map((dimension) => (
          <TrustScoreRow
            key={dimension.label}
            label={dimension.label}
            score={dimension.score}
            cells={trustBarCells}
            suffix="pillar"
            width={trustRowWidth}
          />
        ))}
        {capExplanation ? <Text color={WARN} wrap="wrap">cap note    {truncate(capExplanation, width - 13)}</Text> : null}
        {trust.gatedBy?.length ? <Text color={WARN} wrap="truncate">gated by   {truncate(trust.gatedBy.join(", "), width - 12)}</Text> : null}
        {trust.issues.length > 0 ? <IssueRows issues={trust.issues} width={width} rows={Math.min(4, trust.issues.length)} /> : null}
      </Box>
      <Spacer />
      <CompactDivider width={width} />
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

const TRUST_ROW_LABEL_WIDTH = 12;
const TRUST_ROW_VALUE_WIDTH = 12;

function TrustTierRow({
  label,
  value,
  tier,
  score,
  issues,
  cells,
  suffix,
  width,
}: {
  label: string;
  value: string;
  tier: TrustTier;
  score: number;
  issues: SearchResult["trust"]["issues"];
  cells: number;
  suffix: string;
  width: number;
}) {
  const suffixWidth = Math.max(0, width - TRUST_ROW_LABEL_WIDTH - TRUST_ROW_VALUE_WIDTH - cells - 4);
  return (
    <Text wrap="truncate">
      <Text color={MUTED}>{label.padEnd(TRUST_ROW_LABEL_WIDTH)}</Text>
      <Text color={tierColor(tier)}>{truncate(value, TRUST_ROW_VALUE_WIDTH).padEnd(TRUST_ROW_VALUE_WIDTH)}</Text>
      <Text color={CHROME}>  </Text>
      <TrustTierMeter tier={tier} score={score} issues={issues} cells={cells} showLabel={false} />
      <Text color={CHROME}>  </Text>
      <Text color={MUTED}>{truncate(suffix, suffixWidth)}</Text>
    </Text>
  );
}

function TrustScoreRow({ label, score, cells, suffix, width }: { label: string; score: number; cells: number; suffix: string; width: number }) {
  const suffixWidth = Math.max(0, width - TRUST_ROW_LABEL_WIDTH - TRUST_ROW_VALUE_WIDTH - cells - 4);
  const value = `${Math.round(score)}%`;
  return (
    <Text wrap="truncate">
      <Text color={MUTED}>{label.padEnd(TRUST_ROW_LABEL_WIDTH)}</Text>
      <Text color={trustColor(score)}>{value.padStart(4).padEnd(TRUST_ROW_VALUE_WIDTH)}</Text>
      <Text color={CHROME}>  </Text>
      <TrustMeter score={score} showScore={false} cells={cells} />
      <Text color={CHROME}>  </Text>
      <Text color={MUTED}>{truncate(suffix, suffixWidth)}</Text>
    </Text>
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
  const targetRuntime = targetKind === "remote"
    ? String(target.type ?? "remote")
    : String(target.registryType ?? "package");
  const targetLocator = targetKind === "remote"
    ? String(target.url ?? "")
    : String(target.identifier ?? "");
  const targetClients = selectedClientsForScope(client, installScope);
  const clientLabel = installClientLabel(client, targetClients);
  const trustTone = trustRiskTone(plan.trust);
  const writeSummary = client === "all"
    ? `${scopeLabel(installScope)} configs for ${targetClients.join(", ")} plus mcp-lock.json`
    : `${scopeLabel(installScope)} ${client} config plus mcp-lock.json`;

  return (
    <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <ModalTitle title="install" file="plan" />
      <Text color={MUTED}>client      <Text color="white">{clientLabel}</Text></Text>
      <Text color={MUTED}>scope       <Text color="white">{scopeLabel(installScope)}</Text></Text>
      <Text color={MUTED}>actions     <Text color="white">i install</Text>  <Text color="white">w lock</Text></Text>
      <Spacer />
      <PlanMetric label="target" value={targetRuntime} width={width} valueColor={targetKind === "remote" ? OK : WARN} />
      <PlanMetric label="locator" value={targetLocator} width={width} valueColor={targetKind === "remote" ? OK : WARN} />
      {versionInfo ? (
        <>
          <Spacer />
          <PlanMetric label="selected" value={versionInfo.selectedVersion} width={width} valueColor={versionInfo.selectedVersion === versionInfo.latestVersion ? OK : WARN} />
          <PlanMetric label="locked" value={versionInfo.lockedLabel} width={width} valueColor={versionInfo.lockedLabel === "none" ? MUTED : OK} />
          <PlanMetric label="latest" value={versionInfo.latestVersion} width={width} valueColor={versionInfo.status === "update available" ? WARN : OK} />
          <PlanMetric label="status" value={versionInfo.status} width={width} valueColor={versionInfo.selectedVersion === versionInfo.latestVersion ? OK : WARN} />
        </>
      ) : null}
      {versionInfo && versionInfo.versions.length > 1 ? <PlanMetric label="versions" value={`${formatVersionChoices(versionInfo, 8)}  (v/V cycle)`} width={width} /> : null}
      <Spacer />
      <PlanMetric label="tier" value={`${trustTone.label} / ${trustTier(plan.trust)}`} width={width} valueColor={trustColor(trustTierScore(plan.trust))} />
      <PlanMetric label="metadata" value={`${plan.trust.score}% complete / ${evidenceStatus(plan.trust)}`} width={width} valueColor={trustColor(plan.trust.score)} />
      <PlanMetric label="evidence" value={evidenceSummary(plan.trust)} width={width} />
      <Spacer />
      <PlanMetric label="writes" value={writeSummary} width={width} />
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
    ["Browse", "m / +", "Show 50 more matches until every loaded or cached match is visible."],
    ["Browse", "r", "Refresh enabled registry sources into .toolpin/registry-cache.json."],
    ["Browse", "l", "Toggle live session loading without writing the registry cache."],
    ["Browse", "g", `Change registry source: all, official, or docker. Enabled sources: ${REGISTRY_SOURCES.filter((source) => source.enabled).map((source) => source.id).join(", ")}.`],
    ["Installed", "I", "Show installed MCP servers and refresh the installed inventory."],
    ["Sources", "S", "Show installable vs discovery-only sources, auth status, cache/live counts, and the source legend."],
    ["Review", "Enter", "Open the install plan for the selected server."],
    ["Review", "t", "Test the selected server with initialize and tools/list."],
    ["Review", "v / V", "Cycle selected server version."],
    ["Install", "i", "Open the install wizard; choose version when available, then folder/global and client."],
    ["Install", "w", "Write only the lockfile entry for the selected server."],
    ["Config", "s", "Save the shown client config snippet under .toolpin/ for manual review."],
    ["Installed", "u", "Resolve the installed entry in the registry, make it registry-backed, and write/update mcp-lock.json."],
    ["Installed", "v / V", "Cycle the selected locked install target version; press u to rewrite config and lockfile for that explicit version."],
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
    ? Math.max(2, Math.min(lines.length, height - 25))
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
          <HelpNote width={lineWidth} label="score" text="0-100 metadata completeness score for review priority, not a security guarantee or install blocker." />
          <HelpNote width={lineWidth} label="inputs" text="Source trust, repository metadata, namespace, transport, package pinning, secrets, and description-scan findings." />
          <HelpNote width={lineWidth} label="tiers" text="Verified requires a pinned install target plus artifact proof; conditional means useful metadata exists but proof is incomplete." />
          <HelpNote width={lineWidth} label="cap notes" text="Cap notes appear below the score bars and explain why the overall score was limited." />
          <HelpNote width={lineWidth} label="colors" text="Green is verified evidence, yellow needs review, red means blocked or unverified evidence." />
          <Spacer />
          <Text bold color={BLUE}>locking</Text>
          <HelpNote width={lineWidth} label="lockfile" text="mcp-lock.json records the selected server, version, client, resolved launch target, trust data, and integrity digest." />
          <HelpNote width={lineWidth} label="install" text="Install writes client config and the matching lock entry after policy and drift checks pass." />
          <HelpNote width={lineWidth} label="doctor/ci" text="Doctor and CI compare client config with mcp-lock.json so config drift, digest drift, and signature failures are visible." />
          <HelpNote width={lineWidth} label="adopt / update" text="Installed u resolves an existing config entry in the registry and locks it; U updates already locked entries." />
          <Spacer />
          <Text bold color={BLUE}>sources</Text>
          <HelpNote width={lineWidth} label="installable" text="Official/Docker or official-compatible entries with package/remote metadata can be reviewed, installed, and locked." />
          <HelpNote width={lineWidth} label="discovery" text="Directory entries such as Glama are browse/search only until normalized into installable metadata." />
          <HelpNote width={lineWidth} label="cached" text="Cached/loaded is the number of entries currently stored or fetched for that source." />
          <Spacer />
          <Text bold color={BLUE}>installed actions</Text>
          <HelpNote width={lineWidth} label="action:update" text="The row is locked and a newer registry version is loaded; u updates config and mcp-lock.json." />
          <HelpNote width={lineWidth} label="action:adopt" text="The row is installed but not locked; u finds the registry match and writes the reviewed lock entry." />
          <HelpNote width={lineWidth} label="action:none" text="No safe registry lifecycle action is loaded; refresh, switch source/live, or inspect the row first." />
        </>
      ) : null}
    </Box>
  );
}

function HelpNote({ label, text, width }: { label: string; text: string; width: number }) {
  const labelWidth = 15;
  return (
    <Text wrap="truncate">
      <Text color={MUTED}>{label.padEnd(labelWidth)}</Text>
      <Text color="white">{truncate(text, width - labelWidth)}</Text>
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
  const versionStepEnabled = flow.versions.length > 1;
  const totalSteps = versionStepEnabled ? 3 : 2;
  const stepIndex = installStepIndex(flow, versionStepEnabled);
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
    ? "Choose version"
    : flow.step === "scope"
    ? "Choose where to install"
    : flow.step === "client"
      ? `Choose client (${scopeText})`
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
      {stepIndex ? <Text color={CHROME} wrap="truncate">Step {stepIndex} of {totalSteps}</Text> : null}
      {flow.step === "version" || flow.step === "scope" || flow.step === "client" ? (
        <Text color={OK} wrap="truncate">Select an option, then press Enter to continue.</Text>
      ) : null}
      <Spacer />
      {flow.step === "installing" ? (
        <Box flexDirection="column">
          <Text color={MUTED}>Writing config and mcp-lock.json...</Text>
          <Box marginTop={1}>
            <InstallActivityBar width={contentWidth} />
          </Box>
        </Box>
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
      {flow.step === "version" || flow.step === "scope" || flow.step === "client" ? (
        <Text color={CHROME} wrap="truncate">  j/k or arrows move  Enter continue  Esc cancel</Text>
      ) : flow.step === "installing" ? (
        <Text color={CHROME} wrap="truncate">  Installing. Keep this session open.</Text>
      ) : (
        <Text color={CHROME} wrap="truncate">  Enter close  Esc close</Text>
      )}
    </Box>
  );
}

function installStepIndex(flow: InstallFlow, hasVersionStep: boolean): number | undefined {
  if (flow.step === "version") return 1;
  if (flow.step === "scope") return hasVersionStep ? 2 : 1;
  if (flow.step === "client") return hasVersionStep ? 3 : 2;
  return undefined;
}

function InstallActivityBar({ width }: { width: number }) {
  const barWidth = Math.max(10, Math.min(36, width - 2));
  const filled = Math.max(3, Math.floor(barWidth * 0.55));
  const empty = Math.max(0, barWidth - filled);
  return (
    <Box flexDirection="column" width={width}>
      <Text wrap="truncate">
        <Text color={ACCENT}>{"▓".repeat(filled)}</Text>
        <Text color={CHROME}>{"░".repeat(empty)}</Text>
      </Text>
      <Text color={ACCENT} wrap="truncate">installing</Text>
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

export function buildOperationSnapshot({ active, log, state }: { active: boolean; log?: CommandLog; state: TuiState }): OperationSnapshot | undefined {
  if (!active && !log) return undefined;
  if (!active && log && !isOperationLog(log.title)) return undefined;
  const activeTitle = state.testing
    ? "testing"
    : state.checking
      ? "checking"
      : activeOperationTitle(log?.title ?? "install");
  const title = active ? activeTitle : settledOperationTitle(log?.title ?? "operation", log?.ok ?? true);
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

function activeOperationTitle(title: string): string {
  if (title === "test") return "testing";
  if (title === "install") return "installing";
  if (title === "update") return "updating";
  if (title === "adopt") return "adopting";
  if (title === "doctor") return "checking";
  return title;
}

function settledOperationTitle(title: string, ok: boolean): string {
  const suffix = ok ? "complete" : "failed";
  if (title === "test") return `test ${suffix}`;
  if (title === "install") return `install ${suffix}`;
  if (title === "update") return `update ${suffix}`;
  if (title === "adopt") return `adopt ${suffix}`;
  if (title === "doctor") return `check ${suffix}`;
  if (title === "remove") return `remove ${suffix}`;
  return `${title} ${suffix}`;
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
      ? [["/", "search"], ["f", "layout"], ["g", "source"], ["S", "sources"], ["m", "more"], ["i", "install"], ["I", "installed"], ["r", "cache-refresh"], ["l", "live/cache"], ["R", "reset"], ["j/k", "move"], ["q", "quit"]]
      : view === "installed"
        ? [["j/k", "move"], ["I", "refresh list"], ["S", "sources"], ["u", "registry+lock"], ["v/V", "version"], ["U", "update locked"], ["x", "delete"], ["t", "test-installed"], ["d", "doctor"], ["q", "quit"]]
      : view === "sources"
        ? [["Esc", "browse"], ["g", "source"], ["l", "cache/live"], ["r", "refresh"], ["1", "browse"], ["2", "installed"], ["q", "quit"]]
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
  const lines = wrapValue(value, valueWidth);
  return (
    <>
      {lines.map((line, index) => (
        <Text key={`${label}:${index}:${line}`} wrap="truncate">
          <Text color={MUTED}>{index === 0 ? label.padEnd(12) : "".padEnd(12)}</Text>
          <Text color={valueColor ?? "white"}>{line}</Text>
        </Text>
      ))}
    </>
  );
}

function wrapValue(value: string, width: number): string[] {
  if (width <= 0) return [""];
  const words = value.split(/(\s+)/).filter((part) => part.length > 0);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (/^\s+$/.test(word)) {
      if (line && !line.endsWith(" ")) line += " ";
      continue;
    }
    if (word.length > width) {
      if (line.trimEnd()) lines.push(line.trimEnd());
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      line = "";
      continue;
    }
    const candidate = line ? `${line}${word}` : word;
    if (candidate.length > width) {
      if (line.trimEnd()) lines.push(line.trimEnd());
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line.trimEnd()) lines.push(line.trimEnd());
  return lines.length ? lines : [""];
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

function CompactDivider({ width }: { width: number }) {
  const lineWidth = Math.max(8, width - 6);
  return <Text color={CHROME}>{"─".repeat(lineWidth)}</Text>;
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

function tierColor(tier: TrustTier): string {
  if (tier === "verified") return OK;
  if (tier === "conditional") return WARN;
  return ERR;
}

function tierFill(tier: TrustTier, cells: number): number {
  if (tier === "verified") return cells;
  if (tier === "conditional") return Math.max(1, Math.round(cells * 0.66));
  if (tier === "unverified") return Math.max(1, Math.round(cells * 0.33));
  return 0;
}
