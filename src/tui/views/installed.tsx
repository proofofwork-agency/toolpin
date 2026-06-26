import React from "react";
import { Box, Text } from "ink";
import { CHROME, ERR, MUTED, OK, SURFACE, WARN } from "../constants.js";
import { listWindowStart } from "../layout.js";
import type { InstalledServerState } from "../installedState.js";
import { shortPath, truncate } from "../format.js";

export function InstalledServersView({
  rows,
  selected,
  height,
  width,
  loading,
}: {
  rows: InstalledServerState[];
  selected: number;
  height: number;
  width: number;
  loading: boolean;
}) {
  const visibleCount = Math.max(3, height - 3);
  const start = listWindowStart(selected, visibleCount, rows.length);
  const visible = rows.slice(start, start + visibleCount);
  const selectedRow = rows[selected];

  return (
    <Box flexDirection="column" paddingX={3} height={height}>
      <Box justifyContent="space-between">
        <Text color={MUTED}>Installed MCP servers</Text>
        <Text color={loading ? WARN : MUTED}>{loading ? "refreshing..." : `${rows.length} found`}</Text>
      </Box>
      {rows.length === 0 ? <Text color={MUTED}>No installed MCP server entries found in checked config files.</Text> : null}
      {visible.map((row, index) => (
        <InstalledRow
          key={row.id}
          row={row}
          selected={start + index === selected}
          width={width}
        />
      ))}
      {selectedRow ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={CHROME}>{"-".repeat(Math.max(0, width - 6))}</Text>
          <Text color={CHROME} wrap="truncate">
            {"  "}selected {selected + 1} of {rows.length}  u registry+lock  U update locked  x delete  t test-installed  d doctor  g scope
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function InstalledServerDetails({ row, width }: { row?: InstalledServerState; width: number }) {
  if (!row) {
    return (
      <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
        <Text color={MUTED}>No installed server selected.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" backgroundColor={SURFACE} paddingX={2} paddingY={1} flexGrow={1}>
      <Text bold color="white" wrap="truncate">{row.serverName}</Text>
      <Text color={MUTED} wrap="truncate">{row.client}  {scopeText(row.scope)}  {shortPath(row.file)}</Text>
      <Spacer />
      <Metric label="lock" value={row.locked ? row.lockDrift ? "drift" : "locked" : "unlocked"} color={row.lockDrift ? ERR : row.locked ? OK : WARN} />
      <Metric label="version" value={versionText(row)} color={row.updateAvailable ? WARN : row.locked ? OK : MUTED} />
      <Metric label="source" value={row.source ?? "unknown"} />
      <Metric label="runtime" value={row.runningStatus} color={row.runningStatus === "reachable" ? OK : row.runningStatus === "stale" ? WARN : MUTED} />
      <Metric label="match" value={matchText(row)} color={row.registryMatch ? OK : MUTED} />
      <Metric label="actions" value={actionText(row)} color={row.canUpdate ? WARN : MUTED} />
      {row.lifecycleAction !== "none" ? <Metric label="u action" value={lifecycleExplanation(row)} color={WARN} /> : null}
      <Metric label="test target" value={row.testSource === "config" ? `installed config: ${shortPath(row.file)}` : row.testSource} color={row.canTest ? OK : MUTED} />
      {row.updateServer ? <Metric label="target" value={`${row.updateServer.name}@${row.updateServer.version}`} color={row.lifecycleAction === "none" ? MUTED : WARN} /> : null}
      {row.issue ? <Text color={WARN} wrap="truncate">drift       {truncate(row.issue, width - 18)}</Text> : null}
      {row.testResult ? (
        <>
          <Spacer />
          <Text color={row.testResult.ok ? OK : ERR} wrap="truncate">test        {row.testResult.ok ? "passed" : "failed"}: {truncate(row.testResult.message, width - 20)}</Text>
          <Text color={MUTED} wrap="truncate">target      {truncate(row.testResult.target, width - 18)}</Text>
          {row.testResult.tools.slice(0, 4).map((tool) => (
            <Text key={tool.name} color="white" wrap="truncate">tool        {tool.name}{tool.description ? <Text color={MUTED}> - {truncate(tool.description, width - tool.name.length - 20)}</Text> : null}</Text>
          ))}
        </>
      ) : null}
    </Box>
  );
}

function InstalledRow({ row, selected, width }: { row: InstalledServerState; selected: boolean; width: number }) {
  const nameWidth = width < 90 ? 26 : 38;
  const fileWidth = width < 90 ? 18 : 28;
  const version = row.updateAvailable
    ? `${row.lockedVersion ?? "unknown"} -> ${row.latestVersion}`
    : row.lockedVersion ?? row.currentVersion ?? "unknown";
  const lock = row.lockDrift ? "drift" : row.locked ? "locked" : "unlocked";
  const registry = `registry:${row.registryStatus}`;
  const action = `action:${row.lifecycleAction}`;
  const test = `test:${row.testSource}`;

  return (
    <Text wrap="truncate">
      <Text color={selected ? OK : CHROME}>{selected ? ">" : ":"}</Text>
      <Text color={scopeColor(row.scope)}> {row.scope.padEnd(7)}</Text>
      <Text color={MUTED}> {row.client.padEnd(9)}</Text>
      <Text bold={selected} color="white"> {truncate(row.serverName, nameWidth).padEnd(nameWidth + 1)}</Text>
      <Text color={lock === "drift" ? ERR : lock === "locked" ? OK : WARN}>{lock.padEnd(9)}</Text>
      <Text color={row.updateAvailable ? WARN : MUTED}> {truncate(version, 18).padEnd(19)}</Text>
      <Text color={row.registryStatus === "none" ? MUTED : OK}>{registry.padEnd(15)}</Text>
      <Text color={row.lifecycleAction === "none" ? MUTED : WARN}>{action.padEnd(14)}</Text>
      <Text color={row.testSource === "none" ? MUTED : OK}>{test.padEnd(12)}</Text>
      <Text color={CHROME}> {truncate(shortPath(row.file), fileWidth)}</Text>
    </Text>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Text wrap="truncate">
      <Text color={MUTED}>{label.padEnd(12)}</Text>
      <Text color={color ?? "white"}>{value}</Text>
    </Text>
  );
}

function versionText(row: InstalledServerState): string {
  if (row.updateAvailable) return `${row.lockedVersion ?? "unknown"} -> ${row.latestVersion}`;
  if (row.lockedVersion) return row.latestVersion && row.latestVersion !== row.lockedVersion ? `${row.lockedVersion} latest ${row.latestVersion}` : row.lockedVersion;
  return row.latestVersion ? `unlocked latest ${row.latestVersion}` : "unknown";
}

function actionText(row: InstalledServerState): string {
  const actions = [];
  if (row.lifecycleAction !== "none") actions.push(row.lifecycleAction);
  if (row.canDelete) actions.push("delete");
  if (row.canTest) actions.push("test-installed");
  return actions.join(", ") || "none";
}

function lifecycleExplanation(row: InstalledServerState): string {
  if (row.lifecycleAction === "adopt") return "find registry match, replace alias if needed, write mcp-lock.json";
  if (row.lifecycleAction === "update") return "resolve locked server in registry, update config, update mcp-lock.json";
  return "none";
}

function matchText(row: InstalledServerState): string {
  if (row.registryCandidates?.length) return `ambiguous alias: ${row.registryCandidates.join(", ")}`;
  return row.registryMatch ? `${row.registryMatch} registry` : "none";
}

function scopeText(scope: InstalledServerState["scope"]): string {
  return scope === "project" ? "folder/project" : "global/user";
}

function scopeColor(scope: InstalledServerState["scope"]): string {
  return scope === "project" ? OK : WARN;
}

function Spacer() {
  return <Text> </Text>;
}
