#!/usr/bin/env node
import { verifyFrozenInstall } from "./ci.js";
import { exportClientConfig, PROJECT_CLIENTS, type ClientName } from "./config.js";
import { codexTomlFromClientConfig } from "./codexToml.js";
import { doctorLockfile } from "./doctor.js";
import { installServerConfig, removeServerConfig, type InstallScope } from "./install.js";
import { buildInstallPlan, readLockfile, removeLockfileEntry, verifyAgainstLockfile, writeLockfile } from "./plan.js";
import { fetchRegistry, latestOnly, normalizeEntries, readCache, writeCache } from "./registry.js";
import { searchServers } from "./search.js";
import { testServer } from "./tester.js";
import { scoreServer } from "./trust.js";
import { verifyServer, type VerificationReport } from "./verify.js";
import type { NormalizedServer, RegistryEntry, RegistrySourceId } from "./types.js";

const args = process.argv.slice(2);
type ClientSelection = ClientName | "all";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const command = args[0] ?? "help";
  const rest = args.slice(1);

  switch (command) {
    case "ingest":
      await ingest(rest);
      return;
    case "search":
      await search(rest);
      return;
    case "info":
      await info(rest);
      return;
    case "audit":
      await audit(rest);
      return;
    case "verify":
      await verify(rest);
      return;
    case "plan":
      await plan(rest);
      return;
    case "install":
      await install(rest);
      return;
    case "remove":
      await remove(rest);
      return;
    case "ci":
      await ci(rest);
      return;
    case "doctor":
      await doctor(rest);
      return;
    case "test":
      await test(rest);
      return;
    case "lock":
      await lock(rest);
      return;
    case "export-config":
      await exportConfig(rest);
      return;
    case "tui":
      await runTui(rest);
      return;
    case "help":
    case "--help":
    case "-h":
      help();
      return;
    default:
      throw new Error(`Unknown command: ${command}. Run \`mpm help\`.`);
  }
}

async function ingest(rest: string[]): Promise<void> {
  const limit = numberFlag(rest, "--limit", 100);
  const pages = numberFlag(rest, "--pages", 10);
  const source = sourceFlag(rest, "all");
  const entries = await fetchRegistry({ limit, maxPages: pages, source });
  await writeCache(entries);
  console.log(`Cached ${entries.length} registry versions from ${source} in .mpm/registry-cache.json`);
}

async function search(rest: string[]): Promise<void> {
  const query = positional(rest).join(" ");
  if (!query) throw new Error("Usage: mpm search <query> [--limit 10] [--live]");

  const limit = numberFlag(rest, "--limit", 10);
  const servers = await loadServers(rest, { search: query });
  const results = searchServers(latestOnly(servers), query, limit);

  for (const result of results) {
    const server = result.server;
    const packages = server.packageTypes.length ? server.packageTypes.join(",") : "none";
    const remotes = server.remoteTypes.length ? server.remoteTypes.join(",") : "none";
    console.log(`${server.name}@${server.version}  score=${result.trust.score} source=${server.registrySource}`);
    console.log(`  ${server.title}`);
    if (server.description) console.log(`  ${truncate(server.description, 140)}`);
    console.log(`  packages=${packages} remotes=${remotes}`);
    if (result.trust.badges.length) console.log(`  badges=${result.trust.badges.join(", ")}`);
  }
}

async function info(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: mpm info <server-name> [--json] [--live]");
  const server = await findServer(rest, name);
  const trust = scoreServer(server);

  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ server, trust }, null, 2));
    return;
  }

  console.log(`${server.name}@${server.version}`);
  console.log(server.title);
  if (server.description) console.log(server.description);
  if (server.repositoryUrl) console.log(`Repository: ${server.repositoryUrl}`);
  console.log(`Packages: ${server.packageTypes.join(", ") || "none"}`);
  console.log(`Remotes: ${server.remoteTypes.join(", ") || "none"}`);
  console.log(`Registry: ${server.registrySource}`);
  console.log(`Trust score: ${trust.score}`);
  if (trust.badges.length) console.log(`Badges: ${trust.badges.join(", ")}`);
  for (const issue of trust.issues) {
    console.log(`${issue.severity.toUpperCase()}: ${issue.message}`);
  }
}

async function audit(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: mpm audit <server-name> [--live]");
  const server = await findServer(rest, name);
  const trust = scoreServer(server);
  console.log(JSON.stringify({ name: server.name, version: server.version, trust }, null, 2));
}

async function verify(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: mpm verify <server-name> [--source official|docker|all] [--live] [--json] [--timeout 15000] [--skip-live-verification]");

  const server = await findServer(rest, name);
  const report = await verifyServer(server, {
    liveRemoteProbe: !hasAnyFlag(rest, ["--skip-live-verification", "--skip-live-verify"]),
    timeoutMs: numberFlag(rest, "--timeout", 15000),
  });

  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printVerificationReport(report);
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function plan(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error("Usage: mpm plan <server-name> --client claude|cursor|vscode|codex|opencode|all [--live]");

  const client = clientFlag(rest, "generic");
  const server = await findServer(rest, name);
  if (client === "all") {
    console.log(JSON.stringify(PROJECT_CLIENTS.map((targetClient) => buildInstallPlan(server, targetClient)), null, 2));
  } else {
    console.log(JSON.stringify(buildInstallPlan(server, client), null, 2));
  }
}

async function lock(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error("Usage: mpm lock <server-name> --client claude|cursor|vscode|codex|opencode|all [--live]");

  const client = clientFlag(rest, "generic");
  const path = stringFlag(rest, "--file", "mcp-lock.json");
  const server = await findServer(rest, name);
  let lockfile;
  if (client === "all") {
    for (const targetClient of PROJECT_CLIENTS) {
      lockfile = await writeLockfile(buildInstallPlan(server, targetClient), path);
    }
  } else {
    lockfile = await writeLockfile(buildInstallPlan(server, client), path);
  }
  console.log(`Locked ${server.name}@${server.version} in ${path}`);
  console.log(`Lockfile now contains ${Object.keys(lockfile?.servers ?? {}).length} server/client entrie(s).`);
}

async function exportConfig(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error("Usage: mpm export-config <server-name> --client claude|cursor|vscode|codex|opencode|all [--live]");

  const client = clientFlag(rest, "generic");
  const server = await findServer(rest, name);
  if (client === "all") {
    const exported = Object.fromEntries(PROJECT_CLIENTS.map((targetClient) => [targetClient, exportClientConfig(server, targetClient).config]));
    console.log(JSON.stringify(exported, null, 2));
    return;
  }
  const exported = exportClientConfig(server, client);

  if (client === "codex") {
    console.log(codexTomlFromClientConfig(exported.config));
  } else {
    console.log(JSON.stringify(exported.config, null, 2));
  }
  if (exported.notes.length) {
    console.error(`Notes: ${exported.notes.join(" ")}`);
  }
}

async function findServer(rest: string[], name: string): Promise<NormalizedServer> {
  const servers = await loadServers(rest, { search: name });
  const exact = latestOnly(servers).find((server) => server.name === name);
  if (exact) return exact;

  const partial = searchServers(latestOnly(servers), name, 1)[0]?.server;
  if (partial) return partial;

  throw new Error(`No server found for ${name}. Try \`mpm ingest\` or pass --live.`);
}

async function findExactServer(rest: string[], name: string, source: RegistrySourceId | "all"): Promise<NormalizedServer> {
  const servers = await loadServers(rest, { search: name, source });
  const exact = latestOnly(servers).find((server) => server.name === name);
  if (exact) return exact;
  throw new Error(`No exact server found for ${name} in ${source}. Try \`mpm ingest\` or pass --live.`);
}

async function loadServers(rest: string[], liveOptions: { search?: string; source?: RegistrySourceId | "all" } = {}): Promise<NormalizedServer[]> {
  let entries: RegistryEntry[];
  const source = liveOptions.source ?? sourceFlag(rest, "all");

  if (hasFlag(rest, "--live")) {
    entries = await fetchRegistry({ maxPages: 3, search: liveOptions.search, source });
  } else {
    try {
      entries = await readCache();
      if (!cacheHasSource(entries, source)) {
        entries = await fetchRegistry({ maxPages: 3, search: liveOptions.search, source });
      }
    } catch {
      entries = await fetchRegistry({ maxPages: 3, search: liveOptions.search, source });
    }
  }

  const servers = normalizeEntries(entries);
  return source === "all" ? servers : servers.filter((server) => server.registrySource === source);
}

async function install(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error("Usage: mpm install <server-name> --client claude|cursor|vscode|codex|opencode|all [--scope project|global] [--live]");

  const client = clientFlag(rest, "generic");
  const scope = (hasFlag(rest, "--global") ? "global" : hasFlag(rest, "--project") ? "project" : stringFlag(rest, "--scope", "project")) as InstallScope;
  const updateLock = hasFlag(rest, "--update-lock");
  const verifyBeforeInstall = hasFlag(rest, "--verify");
  if (scope !== "project" && scope !== "global") {
    throw new Error("--scope must be project or global");
  }

  console.error(`Resolving ${name} from ${sourceFlag(rest, "all")} registry source...`);
  const server = await findServer(rest, name);
  if (verifyBeforeInstall) {
    const report = await verifyServer(server, {
      liveRemoteProbe: !hasAnyFlag(rest, ["--skip-live-verification", "--skip-live-verify"]),
      timeoutMs: numberFlag(rest, "--timeout", 15000),
    });
    if (!report.ok) {
      throw new Error([
        "Install refused because verification failed.",
        ...report.issues.map((issue) => `- ${issue.severity}: ${issue.code}: ${issue.message}`),
      ].join("\n"));
    }
  }
  const clients = client === "all" ? PROJECT_CLIENTS : [client];
  const plans = clients.map((targetClient) => buildInstallPlan(server, targetClient));
  if (!updateLock) {
    const mismatches = [];
    for (const plan of plans) {
      const verification = await verifyAgainstLockfile(plan, "mcp-lock.json");
      if (!verification.ok) {
        mismatches.push(`${verification.key}: ${verification.messages.join("; ")}`);
      }
    }
    if (mismatches.length) {
      throw new Error([
        "Install refused because resolved metadata differs from mcp-lock.json.",
        ...mismatches.map((message) => `- ${message}`),
        "Run `mpm lock <server-name> --client ...` or repeat install with `--update-lock` after reviewing the drift.",
      ].join("\n"));
    }
  }
  console.error(`Installing ${server.name}@${server.version} into ${client} ${scope} config...`);
  for (const [index, targetClient] of clients.entries()) {
    const result = await installServerConfig(server, targetClient, scope);
    await writeLockfile(plans[index], "mcp-lock.json");
    console.log(`${result.action} ${result.client} ${result.scope} config: ${result.file}`);
    for (const note of result.notes) console.log(`- ${note}`);
  }
  console.log(`Installed ${server.name} for ${clients.join(", ")}`);
}

async function remove(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error("Usage: mpm remove <server-name> [--client claude|cursor|vscode|codex|opencode|all] [--scope project|global] [--file mcp-lock.json]");

  const client = hasFlag(rest, "--client") ? clientFlag(rest, "generic") : "all";
  const scope = (hasFlag(rest, "--global") ? "global" : hasFlag(rest, "--project") ? "project" : stringFlag(rest, "--scope", "project")) as InstallScope;
  const path = stringFlag(rest, "--file", "mcp-lock.json");
  if (scope !== "project" && scope !== "global") {
    throw new Error("--scope must be project or global");
  }

  await readLockfile(path);
  const clients = client === "all" ? PROJECT_CLIENTS : [client];
  for (const targetClient of clients) {
    const configResult = await removeServerConfig(name, targetClient, scope);
    const lockResult = await removeLockfileEntry(name, targetClient, path);
    const status = configResult.action === "removed" || lockResult.removed ? "removed" : "missing";
    console.log(`${status} ${targetClient} ${scope}: config=${configResult.action} lock=${lockResult.removed ? "removed" : "missing"}`);
    for (const note of configResult.notes) console.log(`- ${note}`);
  }
}

async function ci(rest: string[]): Promise<void> {
  const path = stringFlag(rest, "--file", "mcp-lock.json");
  const verifyBeforeUse = hasFlag(rest, "--verify");
  const report = await verifyFrozenInstall(path, async (locked) => {
    const server = await findExactServer(rest, locked.name, locked.resolved?.source ?? sourceFlag(rest, "all"));
    if (verifyBeforeUse) {
      const verification = await verifyServer(server, {
        liveRemoteProbe: !hasAnyFlag(rest, ["--skip-live-verification", "--skip-live-verify"]),
        timeoutMs: numberFlag(rest, "--timeout", 15000),
      });
      if (!verification.ok) {
        throw new Error([
          `Verification failed for ${locked.name}:`,
          ...verification.issues.map((issue) => `- ${issue.severity}: ${issue.code}: ${issue.message}`),
        ].join("\n"));
      }
    }
    return buildInstallPlan(server, locked.client);
  });

  if (!report.ok) {
    throw new Error([
      `Frozen install failed for ${path}.`,
      ...report.issues.flatMap((issue) => [`- ${issue.key}:`, ...issue.messages.map((message) => `  - ${message}`)]),
    ].join("\n"));
  }

  console.log(`Frozen install OK: ${report.checked} locked server/client entrie(s) verified.`);
}

async function doctor(rest: string[]): Promise<void> {
  const path = stringFlag(rest, "--file", "mcp-lock.json");
  const scope = (hasFlag(rest, "--global") ? "global" : hasFlag(rest, "--project") ? "project" : stringFlag(rest, "--scope", "project")) as InstallScope;
  if (scope !== "project" && scope !== "global") {
    throw new Error("--scope must be project or global");
  }

  const report = await doctorLockfile(path, scope);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(`Doctor OK: ${report.checked} locked server/client entrie(s) match ${scope} config.`);
  } else {
    console.log(`Doctor found ${report.issues.length} issue(s) across ${report.checked} locked server/client entrie(s).`);
    for (const issue of report.issues) {
      console.log(`- ${issue.kind} ${issue.key}: ${issue.message} (${issue.file})`);
    }
  }

  if (!report.ok) process.exitCode = 1;
}

async function test(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error("Usage: mpm test <server-name> [--source official|docker|all] [--live] [--timeout 15000]");

  const timeout = numberFlag(rest, "--timeout", 15000);
  const server = await findServer(rest, name);
  console.error(`Testing ${server.name}@${server.version} (${server.registrySource}) with ${timeout}ms timeout...`);
  const result = await testServer(server, timeout);

  console.log(`${result.ok ? "OK" : "FAILED"} ${result.serverName}`);
  console.log(`Target: ${result.target}`);
  console.log(`Duration: ${result.durationMs}ms`);
  console.log(result.message);
  if (result.tools.length) {
    console.log("Tools:");
    for (const tool of result.tools) {
      console.log(`- ${tool.name}${tool.description ? `: ${truncate(tool.description, 120)}` : ""}`);
    }
  }
}

function help(): void {
  console.log(`mpm - MCP package manager prototype

Commands:
  mpm ingest [--source official|docker|all] [--limit 100] [--pages 10]
  mpm search <query> [--source official|docker|all] [--limit 10] [--live]
  mpm info <server-name> [--source official|docker|all] [--json] [--live]
  mpm audit <server-name> [--source official|docker|all] [--live]
  mpm verify <server-name> [--source official|docker|all] [--live] [--json] [--timeout 15000] [--skip-live-verification]
  mpm plan <server-name> --client claude|cursor|vscode|codex|opencode|all [--source official|docker|all] [--live]
  mpm install <server-name> --client claude|cursor|vscode|codex|opencode|all [--scope project|global] [--source official|docker|all] [--live] [--update-lock] [--verify]
  mpm remove <server-name> [--client claude|cursor|vscode|codex|opencode|all] [--scope project|global] [--file mcp-lock.json]
  mpm ci [--file mcp-lock.json] [--source official|docker|all] [--live] [--verify]
  mpm doctor [--file mcp-lock.json] [--scope project|global] [--json]
  mpm test <server-name> [--source official|docker|all] [--live] [--timeout 15000]
  mpm lock <server-name> --client claude|cursor|vscode|codex|opencode|all [--source official|docker|all] [--file mcp-lock.json] [--live]
  mpm export-config <server-name> --client claude|cursor|vscode|codex|opencode|all [--source official|docker|all] [--live]
  mpm tui
`);
}

async function runTui(rest: string[]): Promise<void> {
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log("Usage: mpm tui\n\nOpens the MPM full-screen terminal UI.");
    return;
  }
  const { runTui: renderTui } = await import("./tui.js");
  renderTui();
}

function hasFlag(values: string[], flag: string): boolean {
  return values.includes(flag);
}

function hasAnyFlag(values: string[], flags: string[]): boolean {
  return flags.some((flag) => hasFlag(values, flag));
}

function stringFlag(values: string[], flag: string, fallback: string): string {
  const index = values.indexOf(flag);
  return index >= 0 ? (values[index + 1] ?? fallback) : fallback;
}

function numberFlag(values: string[], flag: string, fallback: number): number {
  const value = stringFlag(values, flag, String(fallback));
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clientFlag(values: string[], fallback: ClientName): ClientSelection {
  const value = stringFlag(values, "--client", fallback);
  if (["claude", "cursor", "vscode", "codex", "opencode", "generic", "all"].includes(value)) {
    return value as ClientSelection;
  }
  throw new Error("--client must be claude, cursor, vscode, codex, opencode, generic, or all");
}

function sourceFlag(values: string[], fallback: RegistrySourceId | "all"): RegistrySourceId | "all" {
  const value = stringFlag(values, "--source", fallback);
  if (["official", "docker", "pulse", "smithery", "glama", "all"].includes(value)) {
    return value as RegistrySourceId | "all";
  }
  throw new Error("--source must be official, docker, pulse, smithery, glama, or all");
}

function cacheHasSource(entries: RegistryEntry[], source: RegistrySourceId | "all"): boolean {
  const sources = new Set(normalizeEntries(entries).map((server) => server.registrySource));
  return source === "all" ? sources.has("official") && sources.has("docker") : sources.has(source);
}

function positional(values: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value.startsWith("--")) {
      if (!["--live", "--json", "--global", "--project", "--update-lock", "--verify", "--skip-live-verification", "--skip-live-verify"].includes(value)) index += 1;
      continue;
    }
    result.push(value);
  }
  return result;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function printVerificationReport(report: VerificationReport): void {
  console.log(`${report.ok ? "OK" : "FAILED"} ${report.serverName}@${report.serverVersion}`);
  if (report.badges.length) console.log(`Badges: ${report.badges.join(", ")}`);
  console.log(`Capability manifest: ${report.capabilityManifest.packageTypes.join(", ") || "no packages"} / ${report.capabilityManifest.transports.join(", ") || "no transports"}`);
  if (report.capabilityManifest.remoteHosts.length) console.log(`Remote hosts: ${report.capabilityManifest.remoteHosts.join(", ")}`);
  if (report.capabilityManifest.secrets.length) {
    console.log(`Secrets: ${report.capabilityManifest.secrets.map((secret) => `${secret.source}:${secret.name}`).join(", ")}`);
  }
  if (report.capabilityManifest.toolDescriptionHash) {
    const hash = report.capabilityManifest.toolDescriptionHash;
    console.log(`Tool descriptions: ${hash.algorithm}-${hash.value} (${hash.toolCount} tool(s))`);
  }
  for (const issue of report.issues) {
    console.log(`${issue.severity.toUpperCase()}: ${issue.code}: ${issue.message}`);
  }
}
