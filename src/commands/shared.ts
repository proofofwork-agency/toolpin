import { isClientName, type ClientName } from "../config.js";
import { type InstallScope } from "../install.js";
import { type InventoryScope } from "../inventory.js";
import { CacheSchemaError, enrichGlamaTarget, enrichSmitheryTarget, fetchRegistry, latestOnly, listRegistrySources, normalizeEntries, readCache } from "../registry.js";
import { searchServers } from "../search.js";
import { MUTED_COLOR, parseColorMode, terminalStyle } from "../terminalStyle.js";
import type { ToolPinClientSkip } from "../clientSupport.js";
import type { CapabilityManifest, NormalizedServer, RegistryEntry, RegistrySourceId } from "../types.js";

export type ClientSelection = ClientName | "all";
export const CLIENT_USAGE = "claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all";
export const VALUE_FLAGS = new Set([
  "-c",
  "-s",
  "--client",
  "--color",
  "--expect-digest",
  "--file",
  "--key",
  "--limit",
  "--pages",
  "--package-manager",
  "--policy",
  "--public-key",
  "--scope",
  "--signature",
  "--source",
  "--target",
  "--timeout",
  "--version",
]);
export const KNOWN_FLAGS = new Set([
  ...VALUE_FLAGS,
  "--all",
  "--allow-execute",
  "--allow-hosted-directory-targets",
  "--dry-run",
  "--explain",
  "--force",
  "--global",
  "--github",
  "-g",
  "--help",
  "-h",
  "--json",
  "--live",
  "--no-policy",
  "--project",
  "-p",
  "--require-verified",
  "--recommended",
  "--sarif",
  "--skip-live-verification",
  "--skip-live-verify",
  "--strict-tier",
  "--update-lock",
  "--verify",
  "-v",
]);
export const INTERACTIVE_FLAGS = new Set([
  "--source",
  "--live",
  "--limit",
  "--client",
  "--scope",
  "--version",
  "--verify",
  "--require-verified",
  "--timeout",
  "--policy",
  "--no-policy",
  "--no-input",
  "--explain",
  "--color",
  "--help",
  "-h",
]);

let cliArgs: string[] = [];
let cliStyleCache: ReturnType<typeof terminalStyle> | undefined;

export function configureCliOutput(args: string[]): void {
  cliArgs = args;
  cliStyleCache = undefined;
}

export async function findServer(rest: string[], name: string): Promise<NormalizedServer> {
  const servers = await loadServers(rest, { search: name });
  const requestedVersion = serverVersionFlag(rest);
  let resolved: NormalizedServer | undefined;
  if (requestedVersion) {
    resolved = servers.find((server) => server.name === name && server.version === requestedVersion);

    if (!resolved) {
      const matchedName = latestOnly(servers).find((server) => server.name === name)?.name
        ?? searchServers(latestOnly(servers), name, 1)[0]?.server.name;
      resolved = matchedName
        ? servers.find((server) => server.name === matchedName && server.version === requestedVersion)
        : undefined;
    }

    if (!resolved) {
      throw new Error(`No server version ${requestedVersion} found for ${name}. Run \`toolpin versions ${name}\` to list known versions.`);
    }
  } else {
    resolved = latestOnly(servers).find((server) => server.name === name)
      ?? searchServers(latestOnly(servers), name, 1)[0]?.server;
  }

  if (!resolved) {
    throw new Error(`No server found for ${name}. Try \`toolpin ingest\` or pass --live.`);
  }

  return resolveServerTargets(rest, resolved);
}

export async function findExactServer(rest: string[], name: string, source: RegistrySourceId | "all"): Promise<NormalizedServer> {
  const servers = await loadServers(rest, { search: name, source });
  const exact = latestOnly(servers).find((server) => server.name === name);
  if (exact) return resolveServerTargets(rest, exact);
  throw new Error(`No exact server found for ${name} in ${source}. Try \`toolpin ingest\` or pass --live.`);
}

export async function resolveServerTargets(rest: string[], server: NormalizedServer): Promise<NormalizedServer> {
  return enrichGlamaTarget(await enrichSmitheryTarget(server, {
    allowHostedDirectoryTargets: hasFlag(rest, "--allow-hosted-directory-targets"),
  }));
}

export async function loadServers(rest: string[], liveOptions: { search?: string; source?: RegistrySourceId | "all" } = {}): Promise<NormalizedServer[]> {
  let entries: RegistryEntry[];
  const source = liveOptions.source ?? sourceFlag(rest, "all");
  const registrySources = await listRegistrySources();
  const knownSources = new Set(registrySources.map((entry) => entry.id));
  const enabledSources = new Set(registrySources.filter((entry) => entry.enabled).map((entry) => entry.id));
  if (source !== "all" && !knownSources.has(source)) {
    throw new Error(`Unknown registry source: ${source}. Add it to .toolpin/registries.json or run \`toolpin registry list\`.`);
  }
  if (source !== "all" && !enabledSources.has(source)) {
    throw new Error(`Registry source ${source} is disabled. Run \`toolpin registry enable ${source}\` to enable it.`);
  }

  if (hasFlag(rest, "--live")) {
    entries = await fetchRegistry({ maxPages: 3, search: liveOptions.search, source });
  } else {
    try {
      entries = await readCache();
      if (!cacheHasSource(entries, source, enabledSources)) {
        entries = await fetchRegistry({ maxPages: 3, search: liveOptions.search, source });
      }
    } catch (error) {
      if (error instanceof CacheSchemaError) throw error;
      entries = await fetchRegistry({ maxPages: 3, search: liveOptions.search, source });
    }
  }

  const servers = normalizeEntries(entries);
  return source === "all"
    ? servers.filter((server) => enabledSources.has(server.registrySource))
    : servers.filter((server) => server.registrySource === source);
}

export function printHeader(title: string): void {
  console.log(title);
  console.log("-".repeat(Math.min(72, Math.max(8, title.length))));
}

export function printSubhead(title: string): void {
  console.log(`\n  ${title}`);
}

export function printField(label: string, value: string, color?: string): void {
  console.log(`  ${label.padEnd(10)} ${colorize(value, color)}`);
}

export function printBullet(value: string): void {
  console.log(`  - ${colorize(value, MUTED_COLOR)}`);
}

export function printClientSkips(skipped: ToolPinClientSkip[]): void {
  for (const skip of skipped) {
    console.error(`Skipping ${skip.client}: ${skip.reason}`);
  }
}

export function noInstallableClientsError(serverName: string, skipped: ToolPinClientSkip[]): Error {
  return new Error([
    `No ToolPin-installable clients are available for ${serverName} in the selected scope.`,
    ...skipped.map((skip) => `- ${skip.client}: ${skip.reason}`),
  ].join("\n"));
}

export function scopeDescription(scope: "all" | InstallScope): string {
  return scope === "all" ? "all supported project/global configs" : `${scope} config`;
}

export function hasFlag(values: string[], flag: string): boolean {
  return values.includes(flag);
}

export function normalizeArgs(values: string[]): string[] {
  const normalized: string[] = [];
  for (const value of values) {
    const equalIndex = value.indexOf("=");
    if (value.startsWith("-") && equalIndex > 1) {
      normalized.push(value.slice(0, equalIndex), value.slice(equalIndex + 1));
    } else {
      normalized.push(value);
    }
  }
  return normalized;
}

export function validateFlags(command: string, values: string[]): void {
  const knownFlags = command === "interactive" || command === "i" ? INTERACTIVE_FLAGS : KNOWN_FLAGS;
  for (const value of values) {
    if (!value.startsWith("-")) continue;
    if (knownFlags.has(value)) continue;
    const suggestion = nearestFlag(value, knownFlags);
    throw new Error(`Unknown flag for ${command}: ${value}.${suggestion ? ` Did you mean ${suggestion}?` : ""}`);
  }
}

export function validateColorFlag(values: string[]): void {
  const index = values.indexOf("--color");
  if (index < 0) return;
  const value = values[index + 1];
  if (!value || value.startsWith("-")) throw new Error("--color requires auto, always, or never.");
  parseColorMode(value);
}

export function nearestFlag(value: string, knownFlags: Set<string> = KNOWN_FLAGS): string | undefined {
  let best: { flag: string; distance: number } | undefined;
  for (const flag of knownFlags) {
    const distance = editDistance(value, flag);
    if (!best || distance < best.distance) best = { flag, distance };
  }
  return best && best.distance <= 3 ? best.flag : undefined;
}

export function editDistance(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[left.length][right.length];
}

export function hasAnyFlag(values: string[], flags: string[]): boolean {
  return flags.some((flag) => hasFlag(values, flag));
}

export function isHelp(values: string[]): boolean {
  return hasAnyFlag(values, ["--help", "-h"]);
}

// Returns the token after `flag`, or undefined if the flag is absent. Throws if
// the flag is present but its value is missing or looks like another flag, so a
// typo like `--file --source official` fails loudly instead of silently using
// `--source` as the file path (or falling back and ignoring the intent).

export function flagValue(values: string[], flag: string): string | undefined {
  const index = values.indexOf(flag);
  if (index < 0) return undefined;
  const value = values[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function stringFlag(values: string[], flag: string, fallback: string): string {
  return flagValue(values, flag) ?? fallback;
}

export function stringAnyFlag(values: string[], flags: string[], fallback: string): string {
  for (const flag of flags) {
    const value = flagValue(values, flag);
    if (value !== undefined) return value;
  }
  return fallback;
}

export function numberFlag(values: string[], flag: string, fallback: number): number {
  const raw = flagValue(values, flag);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${flag} requires a non-negative integer (received "${raw}").`);
  }
  return Number.parseInt(raw, 10);
}

export function clientFlag(values: string[], fallback: ClientName): ClientSelection {
  const value = stringAnyFlag(values, ["--client", "-c"], fallback);
  if (value === "all" || isClientName(value)) {
    return value as ClientSelection;
  }
  throw new Error(`--client/-c must be ${CLIENT_USAGE.replaceAll("|", ", ")}`);
}

export function sourceFlag(values: string[], fallback: RegistrySourceId | "all"): RegistrySourceId | "all" {
  const value = stringFlag(values, "--source", fallback);
  if (/^[a-zA-Z0-9._/-]+$/.test(value)) {
    return value as RegistrySourceId | "all";
  }
  throw new Error("--source must be all or a registry source id");
}

export function serverVersionFlag(values: string[]): string | undefined {
  const index = values.indexOf("--version");
  if (index < 0) return undefined;
  const value = values[index + 1];
  if (!value || value.startsWith("-")) throw new Error("--version requires a server version value.");
  return value;
}

export function scopeFlag(values: string[], fallback: InventoryScope): InventoryScope {
  const value = hasAnyFlag(values, ["--global", "-g"])
    ? "global"
    : hasAnyFlag(values, ["--project", "-p"])
      ? "project"
      : stringAnyFlag(values, ["--scope", "-s"], fallback);
  if (["all", "project", "global"].includes(value)) return value as InventoryScope;
  throw new Error("--scope/-s must be all, project, or global");
}

export function cacheHasSource(entries: RegistryEntry[], source: RegistrySourceId | "all", enabledSources = new Set<RegistrySourceId>()): boolean {
  const sources = new Set(normalizeEntries(entries).map((server) => server.registrySource));
  return source === "all" ? [...enabledSources].every((enabled) => sources.has(enabled)) : sources.has(source);
}

export function positional(values: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value.startsWith("-")) {
      if (VALUE_FLAGS.has(value)) index += 1;
      continue;
    }
    result.push(value);
  }
  return result;
}

export function lockedHasLivePins(locked: { capabilityManifest?: CapabilityManifest }): boolean {
  return Boolean(locked.capabilityManifest?.toolSurfaceHash || locked.capabilityManifest?.toolDescriptionHash || locked.capabilityManifest?.toolManifestHash);
}

export function liveVerificationEnabled(values: string[]): boolean {
  return !hasAnyFlag(values, ["--skip-live-verification", "--skip-live-verify"]);
}

export function colorize(value: string, color?: string): string {
  cliStyleCache ??= terminalStyle({
    color: parseColorMode(stringFlag(cliArgs, "--color", "auto")),
    isTTY: process.stdout.isTTY,
    machineReadable: hasAnyFlag(cliArgs, ["--json", "--sarif"]),
  });
  return cliStyleCache.colorize(value, color);
}
