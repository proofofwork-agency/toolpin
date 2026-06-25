#!/usr/bin/env node
import { verifyFrozenInstall } from "./ci.js";
import { clientsForScope, exportClientConfig, isClientName, PROJECT_CLIENTS, type ClientName } from "./config.js";
import { codexTomlFromClientConfig } from "./codexToml.js";
import { continueYamlFromClientConfig } from "./continueYaml.js";
import { doctorLockfile } from "./doctor.js";
import { adoptInstalledServer, testInstalledServer, updateAllInstalledServers, updateInstalledServer, type InstalledMutationResult, type InstalledUpdateAllResult } from "./installed.js";
import { installServerConfig, removeServerConfig, type InstallScope } from "./install.js";
import { listInstalledServers, type InventoryScope } from "./inventory.js";
import { buildInstallPlan, readLockfile, readLockfileDigest, removeLockfileEntry, verifyAgainstLockfile, writeLockfile } from "./plan.js";
import { enforcePolicy } from "./policy.js";
import { CacheSchemaError, fetchRegistry, latestOnly, listRegistrySources, normalizeEntries, readCache, writeCache } from "./registry.js";
import { searchServers } from "./search.js";
import { auditSecrets } from "./secrets.js";
import { signLockfile, verifyLockfileSignature } from "./signing.js";
import { testServer } from "./tester.js";
import { scoreServer } from "./trust.js";
import { verifyServer, type VerificationReport } from "./verify.js";
import { TOOLPIN_VERSION } from "./version.js";
import { compareLockedToLatest, knownVersions } from "./versions.js";
import type { CapabilityManifest, NormalizedServer, RegistryEntry, RegistrySourceId } from "./types.js";

const args = process.argv.slice(2);
type ClientSelection = ClientName | "all";
const CLIENT_USAGE = "claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all";
const VALUE_FLAGS = new Set([
  "-c",
  "-s",
  "--client",
  "--expect-digest",
  "--file",
  "--key",
  "--limit",
  "--pages",
  "--policy",
  "--public-key",
  "--scope",
  "--signature",
  "--source",
  "--timeout",
]);
const OK_COLOR = "\x1b[32m";
const CYAN_COLOR = "\x1b[36m";
const MUTED_COLOR = "\x1b[90m";

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const command = args[0] ?? "help";
  const rest = args.slice(1);

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      console.log(`toolpin ${TOOLPIN_VERSION}`);
      return;
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
    case "versions":
      await versions(rest);
      return;
    case "registry":
      await registry(rest);
      return;
    case "outdated":
      await outdated(rest);
      return;
    case "list":
    case "ls":
      await listInstalled(rest);
      return;
    case "plan":
      await plan(rest);
      return;
    case "install":
      await install(rest);
      return;
    case "adopt":
      await adoptInstalled(rest);
      return;
    case "update":
      await updateInstalled(rest);
      return;
    case "policy":
      await policy(rest);
      return;
    case "secrets":
      await secrets(rest);
      return;
    case "remove":
      await remove(rest, "remove");
      return;
    case "uninstall":
      await remove(rest, "uninstall");
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
    case "test-installed":
      await testInstalled(rest);
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
      throw new Error(`Unknown command: ${command}. Run \`toolpin help\`.`);
  }
}

async function ingest(rest: string[]): Promise<void> {
  const limit = numberFlag(rest, "--limit", 100);
  const pages = numberFlag(rest, "--pages", 10);
  const source = sourceFlag(rest, "all");
  const entries = await fetchRegistry({ limit, maxPages: pages, source });
  await writeCache(entries);
  console.log(`Cached ${entries.length} registry versions from ${source} in .toolpin/registry-cache.json`);
}

async function search(rest: string[]): Promise<void> {
  const query = positional(rest).join(" ");
  if (!query) throw new Error("Usage: toolpin search <query> [--limit 10] [--live]");

  const limit = numberFlag(rest, "--limit", 10);
  const servers = await loadServers(rest, { search: query });
  const results = searchServers(latestOnly(servers), query, limit);

  printHeader(`Search results for "${query}"`);
  for (const result of results) {
    const server = result.server;
    const packages = server.packageTypes.length ? server.packageTypes.join(",") : "none";
    const remotes = server.remoteTypes.length ? server.remoteTypes.join(",") : "none";
    printSubhead(`${server.name}@${server.version}`);
    printField("title", server.title);
    if (server.description) printField("about", truncate(server.description, 140));
    printField("source", `${server.registrySource}  trust ${result.trust.score}`);
    printField("targets", `packages ${packages}; remotes ${remotes}`);
    if (result.trust.badges.length) printField("badges", result.trust.badges.join(", "));
  }
}

async function info(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: toolpin info <server-name> [--json] [--live]");
  const server = await findServer(rest, name);
  const trust = scoreServer(server);

  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ server, trust }, null, 2));
    return;
  }

  printHeader(`${server.name}@${server.version}`);
  printField("title", server.title);
  if (server.description) printField("about", server.description);
  if (server.repositoryUrl) printField("repo", server.repositoryUrl);
  printField("packages", server.packageTypes.join(", ") || "none");
  printField("remotes", server.remoteTypes.join(", ") || "none");
  printField("registry", server.registrySource);
  printField("trust", String(trust.score));
  if (trust.badges.length) printField("badges", trust.badges.join(", "));
  for (const issue of trust.issues) {
    printBullet(`${issue.severity.toUpperCase()}: ${issue.message}`);
  }
}

async function audit(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: toolpin audit <server-name> [--live]");
  const server = await findServer(rest, name);
  const trust = scoreServer(server);
  console.log(JSON.stringify({ name: server.name, version: server.version, trust }, null, 2));
}

async function verify(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: toolpin verify <server-name> [--source official|docker|all] [--live] [--json] [--timeout 15000] [--skip-live-verification]");

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

async function versions(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: toolpin versions <server-name> [--source official|docker|all] [--live] [--limit 10] [--json]");

  const servers = await loadServers(rest, { search: name });
  const exactName = latestOnly(servers).find((server) => server.name === name)?.name
    ?? searchServers(latestOnly(servers), name, 1)[0]?.server.name
    ?? name;
  const entries = knownVersions(servers, exactName).slice(0, numberFlag(rest, "--limit", 10));

  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ name: exactName, versions: entries }, null, 2));
    return;
  }

  printHeader(`Known versions: ${exactName}`);
  if (!entries.length) {
    printField("status", "no versions found in current cache/source");
    return;
  }
  for (const entry of entries) {
    printBullet(`${entry.version}${entry.isLatest ? "  latest" : ""}  ${entry.source}`);
  }
}

async function registry(rest: string[]): Promise<void> {
  const subcommand = rest[0] ?? "list";
  if (subcommand !== "list") {
    throw new Error("Usage: toolpin registry list [--json]");
  }

  const sources = await listRegistrySources();
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ sources }, null, 2));
    return;
  }

  printHeader("Registry sources");
  for (const source of sources) {
    printSubhead(source.id);
    printField("label", source.label);
    printField("type", source.type ?? "unknown");
    printField("mode", source.mode);
    printField("trust", source.trust);
    printField("enabled", source.enabled ? "yes" : "no");
    printField("auth", source.authRequired ? "required" : "none");
    if (source.url) printField("url", source.url);
    printField("about", source.description);
  }
}

async function outdated(rest: string[]): Promise<void> {
  const path = stringFlag(rest, "--file", "mcp-lock.json");
  const lockfile = await readLockfile(path);
  const rows = [];
  for (const [key, locked] of Object.entries(lockfile.servers)) {
    const servers = await loadServers(rest, {
      search: locked.name,
      source: locked.resolved?.source ?? sourceFlag(rest, "all"),
    });
    const comparison = compareLockedToLatest(locked.name, locked.version, servers);
    rows.push({
      key,
      name: locked.name,
      client: locked.client,
      source: locked.resolved?.source ?? "unknown",
      locked: locked.version,
      latest: comparison.latestVersion ?? "unknown",
      status: comparison.status,
      previous: comparison.previousVersions.map((entry) => entry.version),
    });
  }

  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ file: path, checked: rows.length, updates: rows.filter((row) => row.status === "update-available").length, servers: rows }, null, 2));
    return;
  }

  printHeader("Outdated check");
  printField("file", path);
  printField("checked", `${rows.length} locked server/client entrie(s)`);
  if (!rows.length) {
    printField("status", "lockfile has no server entries");
    return;
  }
  for (const row of rows) {
    const marker = row.status === "update-available" ? "update available" : row.status;
    printSubhead(`${row.name} (${row.client})`);
    printField("locked", row.locked);
    printField("latest", row.latest);
    printField("status", marker);
    if (row.previous.length) printField("previous", row.previous.slice(0, 5).join(", "));
  }
}

async function plan(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin plan <server-name> --client ${CLIENT_USAGE} [--live]`);

  const client = clientFlag(rest, "generic");
  const server = await findServer(rest, name);
  if (client === "all") {
    console.log(JSON.stringify(PROJECT_CLIENTS.map((targetClient) => buildInstallPlan(server, targetClient)), null, 2));
  } else {
    console.log(JSON.stringify(buildInstallPlan(server, client), null, 2));
  }
}

async function lock(rest: string[]): Promise<void> {
  if (rest[0] === "digest") {
    await lockDigest(rest.slice(1));
    return;
  }
  if (rest[0] === "sign") {
    await lockSign(rest.slice(1));
    return;
  }
  if (rest[0] === "verify-signature") {
    await lockVerifySignature(rest.slice(1));
    return;
  }

  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin lock <server-name> --client ${CLIENT_USAGE} [--live]\n       toolpin lock digest [--file mcp-lock.json] [--json]\n       toolpin lock sign --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig]\n       toolpin lock verify-signature --key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig]`);

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
  printHeader("Lockfile updated");
  printField("server", `${server.name}@${server.version}`);
  printField("file", path);
  printField("entries", `${Object.keys(lockfile?.servers ?? {}).length} server/client entrie(s)`);
}

async function lockDigest(rest: string[]): Promise<void> {
  const path = stringFlag(rest, "--file", "mcp-lock.json");
  const digest = await readLockfileDigest(path);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ file: path, digest }, null, 2));
  } else {
    console.log(digest);
  }
}

async function lockSign(rest: string[]): Promise<void> {
  const keyPath = stringFlag(rest, "--key", "");
  if (!keyPath) throw new Error("Usage: toolpin lock sign --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig]");
  const path = stringFlag(rest, "--file", "mcp-lock.json");
  const signaturePath = stringFlag(rest, "--signature", "mcp-lock.sig");
  const envelope = await signLockfile(path, keyPath, signaturePath);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ file: path, signature: signaturePath, envelope }, null, 2));
  } else {
    printHeader(`Signed ${path}`);
    printField("file", path);
    printField("digest", envelope.lockfileDigest);
    printField("signature", signaturePath);
  }
}

async function lockVerifySignature(rest: string[]): Promise<void> {
  const keyPath = stringFlag(rest, "--key", "");
  if (!keyPath) throw new Error("Usage: toolpin lock verify-signature --key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig]");
  const path = stringFlag(rest, "--file", "mcp-lock.json");
  const signaturePath = stringFlag(rest, "--signature", "mcp-lock.sig");
  const report = await verifyLockfileSignature(path, keyPath, signaturePath);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ file: path, signature: signaturePath, report }, null, 2));
  } else {
    printHeader(`${report.ok ? "OK" : "FAILED"} ${report.message.replace(/\.$/, "")}`);
    printField("file", path);
    printField("signature", signaturePath);
    printField("result", report.message);
  }
  if (!report.ok) process.exitCode = 1;
}

async function exportConfig(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin export-config <server-name> --client ${CLIENT_USAGE} [--live]`);

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
  } else if (client === "continue") {
    console.log(continueYamlFromClientConfig(exported.config));
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

  throw new Error(`No server found for ${name}. Try \`toolpin ingest\` or pass --live.`);
}

async function findExactServer(rest: string[], name: string, source: RegistrySourceId | "all"): Promise<NormalizedServer> {
  const servers = await loadServers(rest, { search: name, source });
  const exact = latestOnly(servers).find((server) => server.name === name);
  if (exact) return exact;
  throw new Error(`No exact server found for ${name} in ${source}. Try \`toolpin ingest\` or pass --live.`);
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
    } catch (error) {
      if (error instanceof CacheSchemaError) throw error;
      entries = await fetchRegistry({ maxPages: 3, search: liveOptions.search, source });
    }
  }

  const servers = normalizeEntries(entries);
  return source === "all" ? servers : servers.filter((server) => server.registrySource === source);
}

async function install(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin install <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--live]`);

  const client = clientFlag(rest, "generic");
  const scope = scopeFlag(rest, "project") as InstallScope;
  const updateLock = hasFlag(rest, "--update-lock");
  const verifyBeforeInstall = hasFlag(rest, "--verify");
  const policyPath = stringFlag(rest, "--policy", ".toolpin/policy.json");
  if (scope !== "project" && scope !== "global") {
    throw new Error("--scope must be project or global");
  }

  console.error(`Resolving ${name} from ${sourceFlag(rest, "all")} registry source...`);
  const server = await findServer(rest, name);
  let verifiedCapabilityManifest: CapabilityManifest | undefined;
  let verificationReport: VerificationReport | undefined;
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
    verificationReport = report;
    verifiedCapabilityManifest = report.capabilityManifest;
  }
  const clients = client === "all" ? clientsForScope(scope) : [client];
  const plans = clients.map((targetClient) => buildInstallPlan(server, targetClient, { capabilityManifest: verifiedCapabilityManifest }));
  if (!hasFlag(rest, "--no-policy")) {
    const violations = [];
    for (const plan of plans) {
      const report = await enforcePolicy(plan, policyPath);
      if (!report.ok) {
        violations.push(`${report.key}: ${report.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
      }
    }
    if (violations.length) {
      throw new Error([
        `Install refused by policy ${policyPath}.`,
        ...violations.map((violation) => `- ${violation}`),
      ].join("\n"));
    }
  }
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
        "Run `toolpin lock <server-name> --client ...` or repeat install with `--update-lock` after reviewing the drift.",
      ].join("\n"));
    }
  }
  console.error(`Installing ${server.name}@${server.version} into ${client} ${scope} config...`);
  printHeader("Install");
  printField("server", `${server.name}@${server.version}`, OK_COLOR);
  printField("registry", server.registrySource, CYAN_COLOR);
  printField("trust", `${scoreServer(server).score}/100`, OK_COLOR);
  printField("verify", verificationStatus(verifyBeforeInstall, verificationReport), verifyBeforeInstall ? OK_COLOR : MUTED_COLOR);
  printField("scope", scope === "project" ? "project folder" : "global current user");
  printField("clients", clients.join(", "));
  for (const [index, targetClient] of clients.entries()) {
    const result = await installServerConfig(server, targetClient, scope);
    await writeLockfile(plans[index], "mcp-lock.json");
    printSubhead(`${result.client} ${result.scope}`);
    printField("config", `${result.action}: ${result.file}`, OK_COLOR);
    printField("lock", "mcp-lock.json updated", OK_COLOR);
    for (const note of result.notes) printBullet(note);
  }
  printField("done", `installed for ${client === "all" ? "all supported clients in this scope" : clients.join(", ")}`, OK_COLOR);
}

async function testInstalled(rest: string[]): Promise<void> {
  if (isHelp(rest)) {
    console.log(`Usage: toolpin test-installed <server-name> --client ${CLIENT_USAGE.replace("|all", "")} --scope project|global [--timeout 15000] [--json]`);
    return;
  }

  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin test-installed <server-name> --client ${CLIENT_USAGE.replace("|all", "")} --scope project|global [--timeout 15000] [--json]`);

  const client = clientFlag(rest, "generic");
  if (client === "all") throw new Error("test-installed requires one --client value, not all.");
  const scope = scopeFlag(rest, "project") as InstallScope;
  if (scope !== "project" && scope !== "global") throw new Error("--scope must be project or global");
  const timeoutMs = numberFlag(rest, "--timeout", 15000);

  const result = await testInstalledServer({ serverName: name, client, scope, timeoutMs });
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHeader(result.ok ? "Installed test OK" : "Installed test failed");
    printField("server", result.serverName);
    printField("client", client);
    printField("scope", scope);
    printField("target", result.target);
    printField("duration", `${result.durationMs}ms`);
    printField("message", result.message);
    if (result.tools.length) {
      printSubhead("Tools");
      for (const tool of result.tools) {
        printBullet(`${tool.name}${tool.description ? `: ${truncate(tool.description, 120)}` : ""}`);
      }
    }
  }
  if (!result.ok) process.exitCode = 1;
}

async function adoptInstalled(rest: string[]): Promise<void> {
  if (isHelp(rest)) {
    console.log(`Usage: toolpin adopt <installed-name> --client ${CLIENT_USAGE.replace("|all", "")} --scope project|global [--source all] [--live] [--file mcp-lock.json] [--verify] [--policy .toolpin/policy.json] [--no-policy] [--dry-run] [--json]`);
    return;
  }

  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin adopt <installed-name> --client ${CLIENT_USAGE.replace("|all", "")} --scope project|global [--source all] [--live] [--file mcp-lock.json] [--verify] [--policy .toolpin/policy.json] [--no-policy] [--dry-run] [--json]`);

  const client = clientFlag(rest, "generic");
  if (client === "all") throw new Error("adopt requires one --client value, not all.");
  const scope = scopeFlag(rest, "project") as InstallScope;
  if (scope !== "project" && scope !== "global") throw new Error("--scope must be project or global");
  const servers = await loadServers(rest, { source: sourceFlag(rest, "all") });
  const result = await adoptInstalledServer({
    installedName: name,
    client,
    scope,
    servers,
    lockfilePath: stringFlag(rest, "--file", "mcp-lock.json"),
    verify: hasFlag(rest, "--verify"),
    timeoutMs: numberFlag(rest, "--timeout", 15000),
    policyPath: stringFlag(rest, "--policy", ".toolpin/policy.json"),
    enforcePolicy: !hasFlag(rest, "--no-policy"),
    dryRun: hasFlag(rest, "--dry-run"),
  });

  printInstalledMutationResult(result, hasFlag(rest, "--json"));
}

async function updateInstalled(rest: string[]): Promise<void> {
  if (isHelp(rest)) {
    console.log(`Usage: toolpin update <server-name> --client ${CLIENT_USAGE.replace("|all", "")} --scope project|global [--source all] [--live] [--file mcp-lock.json] [--verify] [--policy .toolpin/policy.json] [--no-policy] [--dry-run] [--json]
       toolpin update --all [--scope all|project|global] [--client <client|all>] [--source all] [--live] [--file mcp-lock.json] [--dry-run] [--json]`);
    return;
  }

  const servers = await loadServers(rest, { source: sourceFlag(rest, "all") });
  if (hasFlag(rest, "--all")) {
    const client = hasAnyFlag(rest, ["--client", "-c"]) ? clientFlag(rest, "generic") : "all";
    const result = await updateAllInstalledServers({
      scope: scopeFlag(rest, "all"),
      client,
      servers,
      lockfilePath: stringFlag(rest, "--file", "mcp-lock.json"),
      verify: hasFlag(rest, "--verify"),
      timeoutMs: numberFlag(rest, "--timeout", 15000),
      policyPath: stringFlag(rest, "--policy", ".toolpin/policy.json"),
      enforcePolicy: !hasFlag(rest, "--no-policy"),
      dryRun: hasFlag(rest, "--dry-run"),
    });
    printInstalledUpdateAllResult(result, hasFlag(rest, "--json"));
    return;
  }

  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin update <server-name> --client ${CLIENT_USAGE.replace("|all", "")} --scope project|global [--source all] [--live] [--file mcp-lock.json] [--dry-run] [--json]`);

  const client = clientFlag(rest, "generic");
  if (client === "all") throw new Error("update <server-name> requires one --client value, not all.");
  const scope = scopeFlag(rest, "project") as InstallScope;
  if (scope !== "project" && scope !== "global") throw new Error("--scope must be project or global");
  const result = await updateInstalledServer({
    serverName: name,
    client,
    scope,
    servers,
    lockfilePath: stringFlag(rest, "--file", "mcp-lock.json"),
    verify: hasFlag(rest, "--verify"),
    timeoutMs: numberFlag(rest, "--timeout", 15000),
    policyPath: stringFlag(rest, "--policy", ".toolpin/policy.json"),
    enforcePolicy: !hasFlag(rest, "--no-policy"),
    dryRun: hasFlag(rest, "--dry-run"),
  });

  printInstalledMutationResult(result, hasFlag(rest, "--json"));
}

async function remove(rest: string[], command: "remove" | "uninstall" = "remove"): Promise<void> {
  if (isHelp(rest)) {
    console.log(`Usage: toolpin ${command} <server-name> [--client ${CLIENT_USAGE}] [--scope project|global] [--file mcp-lock.json]`);
    return;
  }

  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin ${command} <server-name> [--client ${CLIENT_USAGE}] [--scope project|global] [--file mcp-lock.json]`);

  const client = hasAnyFlag(rest, ["--client", "-c"]) ? clientFlag(rest, "generic") : "all";
  const scope = scopeFlag(rest, "project") as InstallScope;
  const path = stringFlag(rest, "--file", "mcp-lock.json");
  if (scope !== "project" && scope !== "global") {
    throw new Error("--scope must be project or global");
  }

  await readLockfile(path);
  const clients = client === "all" ? clientsForScope(scope) : [client];
  printHeader("Remove");
  printField("server", name);
  printField("scope", scope);
  for (const targetClient of clients) {
    const configResult = await removeServerConfig(name, targetClient, scope);
    const lockResult = await removeLockfileEntry(name, targetClient, path);
    const status = configResult.action === "removed" || lockResult.removed ? "removed" : "missing";
    printSubhead(`${targetClient}: ${status}`);
    printField("config", configResult.action);
    printField("lock", lockResult.removed ? "removed" : "missing");
    for (const note of configResult.notes) printBullet(note);
  }
}

async function listInstalled(rest: string[]): Promise<void> {
  if (isHelp(rest)) {
    console.log(`Usage: toolpin list [--scope all|project|global] [--client ${CLIENT_USAGE}] [--json]`);
    return;
  }

  const scope = scopeFlag(rest, "all");
  const client = hasAnyFlag(rest, ["--client", "-c"]) ? clientFlag(rest, "generic") : "all";
  const report = await listInstalledServers({ scope, client });

  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  printHeader("Installed MCP servers");
  printField("scope", scopeDescription(scope));
  printField("client", client === "all" ? "all supported clients" : client);
  printField("checked", `${report.checked} config file(s)`);

  if (!report.entries.length) {
    printField("status", "no installed MCP server entries found");
  } else {
    let previousGroup = "";
    for (const entry of report.entries) {
      const group = `${entry.scope} ${entry.client}`;
      if (group !== previousGroup) {
        printSubhead(group);
        printField("file", entry.file);
        previousGroup = group;
      }
      printBullet(entry.serverName);
    }
  }

  for (const issue of report.issues) {
    printSubhead(`${issue.scope} ${issue.client}: ${issue.kind}`);
    if (issue.file) printField("file", issue.file);
    printField("message", issue.message);
  }
}

async function ci(rest: string[]): Promise<void> {
  const path = stringFlag(rest, "--file", "mcp-lock.json");
  const expectedDigest = stringFlag(rest, "--expect-digest", "");
  const signaturePath = stringFlag(rest, "--signature", "");
  const publicKeyPath = stringFlag(rest, "--public-key", "");
  const verifyBeforeUse = hasFlag(rest, "--verify");
  const policyPath = stringFlag(rest, "--policy", ".toolpin/policy.json");
  const enforcePolicies = !hasFlag(rest, "--no-policy");
  if (signaturePath || publicKeyPath) {
    if (!signaturePath || !publicKeyPath) throw new Error("toolpin ci requires both --signature and --public-key when verifying a lock signature.");
    const signature = await verifyLockfileSignature(path, publicKeyPath, signaturePath);
    if (!signature.ok) {
      throw new Error(`Lockfile signature verification failed for ${path}: ${signature.message}`);
    }
  }
  if (expectedDigest) {
    const actualDigest = await readLockfileDigest(path);
    if (actualDigest !== expectedDigest) {
      throw new Error(`Lockfile digest mismatch for ${path}: expected ${expectedDigest}, got ${actualDigest}`);
    }
  }
  const report = await verifyFrozenInstall(path, async (locked) => {
    const server = await findExactServer(rest, locked.name, locked.resolved?.source ?? sourceFlag(rest, "all"));
    let verifiedCapabilityManifest: CapabilityManifest | undefined;
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
      verifiedCapabilityManifest = verification.capabilityManifest;
    }
    const plan = buildInstallPlan(server, locked.client, { capabilityManifest: verifiedCapabilityManifest });
    if (enforcePolicies) {
      const policy = await enforcePolicy(plan, policyPath);
      if (!policy.ok) {
        throw new Error(policy.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
      }
    }
    return plan;
  });

  if (!report.ok) {
    throw new Error([
      `Frozen install failed for ${path}.`,
      ...report.issues.flatMap((issue) => [`- ${issue.key}:`, ...issue.messages.map((message) => `  - ${message}`)]),
    ].join("\n"));
  }

  printHeader("Frozen install OK");
  printField("file", path);
  printField("checked", `${report.checked} locked server/client entrie(s)`);
}

async function policy(rest: string[]): Promise<void> {
  const subcommand = rest[0] ?? "help";
  const values = rest.slice(1);
  if (subcommand !== "check") {
    throw new Error(`Usage: toolpin policy check <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--policy .toolpin/policy.json] [--json] [--live]`);
  }

  const name = positional(values)[0];
  if (!name) throw new Error(`Usage: toolpin policy check <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--policy .toolpin/policy.json] [--json] [--live]`);

  const client = clientFlag(values, "generic");
  const scope = scopeFlag(values, "project") as InstallScope;
  const policyPath = stringFlag(values, "--policy", ".toolpin/policy.json");
  if (scope !== "project" && scope !== "global") {
    throw new Error("--scope must be project or global");
  }
  const server = await findServer(values, name);
  const clients = client === "all" ? clientsForScope(scope) : [client];
  const reports = await Promise.all(clients.map(async (targetClient) => enforcePolicy(buildInstallPlan(server, targetClient), policyPath)));

  if (hasFlag(values, "--json")) {
    console.log(JSON.stringify({ ok: reports.every((report) => report.ok), reports }, null, 2));
  } else {
    for (const report of reports) {
      printSubhead(`${report.ok ? "OK" : "DENIED"} ${report.key}`);
      for (const issue of report.issues) printBullet(`${issue.code}: ${issue.message}`);
    }
  }

  if (reports.some((report) => !report.ok)) process.exitCode = 1;
}

async function secrets(rest: string[]): Promise<void> {
  const subcommand = rest[0] ?? "help";
  const values = rest.slice(1);
  if (subcommand !== "audit") {
    throw new Error("Usage: toolpin secrets audit [--file mcp-lock.json] [--scope all|project|global] [--json]");
  }

  const path = stringFlag(values, "--file", "mcp-lock.json");
  const scope = scopeFlag(values, "all");
  if (scope !== "all" && scope !== "project" && scope !== "global") {
    throw new Error("--scope must be all, project, or global");
  }

  const report = await auditSecrets(path, scope);
  if (hasFlag(values, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    printHeader("Secrets audit OK");
    printField("checked", `${report.checked} locked server/client entrie(s)`);
    printField("scope", scopeDescription(scope));
  } else {
    printHeader("Secrets audit findings");
    printField("findings", String(report.findings.length));
    printField("checked", `${report.checked} locked server/client entrie(s)`);
    for (const finding of report.findings) {
      const secret = finding.secretName ? ` ${finding.secretSource}:${finding.secretName}` : "";
      const scopeLabel = finding.scope ? ` [${finding.scope}]` : "";
      printBullet(`${finding.kind} ${finding.key}${scopeLabel}${secret}: ${finding.message}`);
      printField("file", finding.file || "no file");
      if (finding.redactedValue) printField("value", finding.redactedValue);
    }
  }

  if (!report.ok) process.exitCode = 1;
}

async function doctor(rest: string[]): Promise<void> {
  const path = stringFlag(rest, "--file", "mcp-lock.json");
  const scope = scopeFlag(rest, "all");
  if (scope !== "all" && scope !== "project" && scope !== "global") {
    throw new Error("--scope must be all, project, or global");
  }

  const report = await doctorLockfile(path, scope);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    printHeader("Doctor OK");
    printField("checked", `${report.checked} locked server/client entrie(s)`);
    printField("scope", scopeDescription(scope));
  } else {
    printHeader("Doctor issues");
    printField("issues", String(report.issues.length));
    printField("checked", `${report.checked} locked server/client entrie(s)`);
    for (const issue of report.issues) {
      const scopeLabel = issue.scope ? ` [${issue.scope}]` : "";
      printBullet(`${issue.kind} ${issue.key}${scopeLabel}: ${issue.message}`);
      printField("file", issue.file);
    }
  }

  if (!report.ok) process.exitCode = 1;
}

async function test(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error("Usage: toolpin test <server-name> [--source official|docker|all] [--live] [--timeout 15000]");

  const timeout = numberFlag(rest, "--timeout", 15000);
  const server = await findServer(rest, name);
  console.error(`Testing ${server.name}@${server.version} (${server.registrySource}) with ${timeout}ms timeout...`);
  const result = await testServer(server, timeout);

  printHeader(result.ok ? "Test OK" : "Test failed");
  printField("server", result.serverName);
  printField("target", result.target);
  printField("duration", `${result.durationMs}ms`);
  printField("message", result.message);
  if (result.tools.length) {
    printSubhead("Tools");
    for (const tool of result.tools) {
      printBullet(`${tool.name}${tool.description ? `: ${truncate(tool.description, 120)}` : ""}`);
    }
  }
}

function help(): void {
  console.log(`ToolPin ${TOOLPIN_VERSION}
  Trusted install, lockfile, and governance for MCP servers.

Quick start
  toolpin tui
  toolpin --version
  tpn -v
  toolpin ingest
  toolpin search github
  toolpin install <server> --client claude --update-lock

Discovery
  toolpin ingest [--source official|docker|all|custom-id] [--limit 100] [--pages 10]
  toolpin registry list [--json]
  toolpin search <query> [--source official|docker|all|custom-id] [--limit 10] [--live]
  toolpin info <server> [--json] [--live]
  toolpin audit <server> [--live]
  toolpin verify <server> [--live] [--json] [--timeout 15000] [--skip-live-verification]
  toolpin versions <server> [--live] [--limit 10] [--json]
  toolpin test <server> [--live] [--timeout 15000]
  toolpin test-installed <server> --client|-c <client> --scope|-s project|global [--timeout 15000] [--json]

Install and config
  toolpin list [--scope|-s all|project|global] [--client|-c <client|all>] [--json]
  toolpin plan <server> --client|-c <client> [--live]
  toolpin install <server> --client|-c <client|all> [--scope|-s project|global] [--global|-g] [--update-lock] [--verify] [--policy .toolpin/policy.json] [--no-policy]
  toolpin adopt <installed> --client|-c <client> --scope|-s project|global [--dry-run] [--json]
  toolpin update <server> --client|-c <client> --scope|-s project|global [--dry-run] [--json]
  toolpin update --all [--scope|-s all|project|global] [--client|-c <client|all>] [--dry-run] [--json]
  toolpin remove <server> [--client|-c <client|all>] [--scope|-s project|global] [--global|-g]
  toolpin uninstall <server> [--client|-c <client|all>] [--scope|-s project|global] [--global|-g]
  toolpin export-config <server> --client|-c <client|all> [--live]

Lock and governance
  toolpin ci [--file mcp-lock.json] [--expect-digest sha256-...] [--signature mcp-lock.sig --public-key public.pem] [--policy .toolpin/policy.json] [--no-policy] [--live] [--verify]
  toolpin outdated [--file mcp-lock.json] [--live] [--json]
  toolpin doctor [--file mcp-lock.json] [--scope|-s all|project|global] [--global|-g] [--json]
  toolpin secrets audit [--file mcp-lock.json] [--scope|-s all|project|global] [--global|-g] [--json]
  toolpin policy check <server> --client|-c <client|all> [--policy .toolpin/policy.json]
  toolpin lock <server> --client|-c <client|all> [--file mcp-lock.json]
  toolpin lock digest [--file mcp-lock.json] [--json]
  toolpin lock sign --key private.pem [--signature mcp-lock.sig]
  toolpin lock verify-signature --key public.pem [--signature mcp-lock.sig]

Common options
  --source official|docker|all|id    choose registry source
  --live                            fetch instead of cache
  --json                            machine-readable output
  --version, -v                     print ToolPin version
  --scope, -s project|global        project folder vs current-user config
  --global, -g                      npm-style shortcut for --scope global
  --project, -p                     shortcut for --scope project
  --client, -c <client|all>         target client config

Clients
  ${CLIENT_USAGE.replaceAll("|", ", ")}
`);
}

function printHeader(title: string): void {
  console.log(title);
  console.log("-".repeat(Math.min(72, Math.max(8, title.length))));
}

function printSubhead(title: string): void {
  console.log(`\n  ${title}`);
}

function printField(label: string, value: string, color?: string): void {
  console.log(`  ${label.padEnd(10)} ${colorize(value, color)}`);
}

function printBullet(value: string): void {
  console.log(`  - ${colorize(value, MUTED_COLOR)}`);
}

function scopeDescription(scope: "all" | InstallScope): string {
  return scope === "all" ? "all supported project/global configs" : `${scope} config`;
}

function printInstalledMutationResult(result: InstalledMutationResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHeader(`${result.dryRun ? "Dry run" : "Installed"} ${result.action}`);
  printField("server", result.serverName);
  printField("target", `${result.targetName}@${result.toVersion}`);
  printField("client", result.client);
  printField("scope", result.scope);
  if (result.fromVersion) printField("version", `${result.fromVersion} -> ${result.toVersion}`);
  printField("lockfile", result.lockfileWritten ? `${result.lockfilePath} updated` : `${result.lockfilePath} not written`);
  printSubhead("Plan");
  for (const line of result.planned) printBullet(line);
  if (result.removedAlias) printField("alias", `${result.removedAlias.action}: ${result.removedAlias.file}`);
  if (result.config) printField("config", `${result.config.action}: ${result.config.file}`);
}

function printInstalledUpdateAllResult(result: InstalledUpdateAllResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHeader(`${result.dryRun ? "Dry run" : "Installed"} update all`);
  printField("scope", scopeDescription(result.scope));
  printField("client", result.client === "all" ? "all supported clients" : result.client);
  printField("updated", String(result.updated.length));
  printField("adoptable", `${result.skippedAdoptable.length} skipped`);
  if (result.updated.length) {
    printSubhead("Updated");
    for (const entry of result.updated) {
      printBullet(`${entry.serverName} -> ${entry.targetName}@${entry.toVersion} (${entry.client}/${entry.scope})`);
    }
  }
  if (result.skippedAdoptable.length) {
    printSubhead("Skipped adoptable");
    for (const entry of result.skippedAdoptable) {
      printBullet(`${entry.serverName} -> ${entry.targetName} (${entry.client}/${entry.scope}); run toolpin adopt ${entry.serverName} --client ${entry.client} --scope ${entry.scope}`);
    }
  }
}

async function runTui(rest: string[]): Promise<void> {
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(`Usage: toolpin tui\n\nOpens the ToolPin ${TOOLPIN_VERSION} full-screen terminal UI.`);
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

function isHelp(values: string[]): boolean {
  return hasAnyFlag(values, ["--help", "-h"]);
}

function stringFlag(values: string[], flag: string, fallback: string): string {
  const index = values.indexOf(flag);
  return index >= 0 ? (values[index + 1] ?? fallback) : fallback;
}

function stringAnyFlag(values: string[], flags: string[], fallback: string): string {
  for (const flag of flags) {
    const index = values.indexOf(flag);
    if (index >= 0) return values[index + 1] ?? fallback;
  }
  return fallback;
}

function numberFlag(values: string[], flag: string, fallback: number): number {
  const value = stringFlag(values, flag, String(fallback));
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clientFlag(values: string[], fallback: ClientName): ClientSelection {
  const value = stringAnyFlag(values, ["--client", "-c"], fallback);
  if (value === "all" || isClientName(value)) {
    return value as ClientSelection;
  }
  throw new Error(`--client/-c must be ${CLIENT_USAGE.replaceAll("|", ", ")}`);
}

function sourceFlag(values: string[], fallback: RegistrySourceId | "all"): RegistrySourceId | "all" {
  const value = stringFlag(values, "--source", fallback);
  if (/^[a-zA-Z0-9._/-]+$/.test(value)) return value as RegistrySourceId | "all";
  throw new Error("--source must be all or a registry source id");
}

function scopeFlag(values: string[], fallback: InventoryScope): InventoryScope {
  const value = hasAnyFlag(values, ["--global", "-g"])
    ? "global"
    : hasAnyFlag(values, ["--project", "-p"])
      ? "project"
      : stringAnyFlag(values, ["--scope", "-s"], fallback);
  if (["all", "project", "global"].includes(value)) return value as InventoryScope;
  throw new Error("--scope/-s must be all, project, or global");
}

function cacheHasSource(entries: RegistryEntry[], source: RegistrySourceId | "all"): boolean {
  const sources = new Set(normalizeEntries(entries).map((server) => server.registrySource));
  return source === "all" ? sources.has("official") && sources.has("docker") : sources.has(source);
}

function positional(values: string[]): string[] {
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

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function verificationStatus(verifyRequested: boolean, report?: VerificationReport): string {
  if (!verifyRequested) return "skipped";
  return report?.ok ? "passed" : "failed";
}

function colorize(value: string, color?: string): string {
  if (!color || !process.stdout.isTTY || process.env.NO_COLOR) return value;
  return `${color}${value}\x1b[0m`;
}

function printVerificationReport(report: VerificationReport): void {
  printHeader(`${report.ok ? "Verification OK" : "Verification failed"}: ${report.serverName}@${report.serverVersion}`);
  if (report.badges.length) printField("badges", report.badges.join(", "));
  printField("packages", report.capabilityManifest.packageTypes.join(", ") || "none");
  printField("transport", report.capabilityManifest.transports.join(", ") || "none");
  if (report.capabilityManifest.remoteHosts.length) printField("hosts", report.capabilityManifest.remoteHosts.join(", "));
  if (report.capabilityManifest.secrets.length) {
    printField("secrets", report.capabilityManifest.secrets.map((secret) => `${secret.source}:${secret.name}`).join(", "));
  }
  if (report.capabilityManifest.toolDescriptionHash) {
    const hash = report.capabilityManifest.toolDescriptionHash;
    printField("tools hash", `${hash.algorithm}-${hash.value} (${hash.toolCount} tool(s))`);
  }
  if (report.capabilityManifest.toolDescriptionScan) {
    const scan = report.capabilityManifest.toolDescriptionScan;
    printField("scan", `${scan.findings.length} advisory finding(s) across ${scan.scannedDescriptions} description(s)`);
  }
  for (const issue of report.issues) {
    printBullet(`${issue.severity.toUpperCase()}: ${issue.code}: ${issue.message}`);
  }
}
