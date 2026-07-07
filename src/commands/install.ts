import { clientsForScope, exportClientConfig, PROJECT_CLIENTS, type ClientName } from "../config.js";
import { codexTomlFromClientConfig } from "../codexToml.js";
import { continueYamlFromClientConfig } from "../continueYaml.js";
import { installableClientsForServer } from "../clientSupport.js";
import { adoptInstalledServer, testInstalledServer, updateAllInstalledServers, updateInstalledServer, type InstalledMutationResult, type InstalledUpdateAllResult } from "../installed.js";
import { installServerConfig, removeServerConfig, type InstallScope } from "../install.js";
import { listInstalledServers } from "../inventory.js";
import { buildInstallPlan, readLockfile, removeLockfileEntry, verifyAgainstLockfile, writeLockfile } from "../plan.js";
import { DEFAULT_LOCKFILE_PATH, DEFAULT_POLICY_PATH, DEFAULT_PROBE_TIMEOUT_MS } from "../constants.js";
import { enforcePolicy } from "../policy.js";
import { localHttpRuntimeAdvisory } from "../runtimeAdvisory.js";
import { OK_COLOR, CYAN_COLOR, MUTED_COLOR, WARN_COLOR } from "../terminalStyle.js";
import { evidenceStatus, evidenceSummary, scoreServer, trustProfileScore, trustTier } from "../trust.js";
import { truncate } from "../util.js";
import { verifyServer, type VerificationReport } from "../verify.js";
import type { CapabilityManifest } from "../types.js";
import { CLIENT_USAGE, clientFlag, findServer, hasAnyFlag, hasFlag, isHelp, liveVerificationEnabled, loadServers, noInstallableClientsError, numberFlag, positional, printBullet, printCapExplanation, printClientSkips, printField, printHeader, printSubhead, scopeDescription, scopeFlag, sourceFlag, stringFlag, verificationOutcome, verificationStatus, trustTierColor } from "./shared.js";
export async function plan(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin plan <server-name> --client ${CLIENT_USAGE} [--live]`);

  const client = clientFlag(rest, "generic");
  const server = await findServer(rest, name);
  if (client === "all") {
    const { clients, skipped } = installableClientsForServer(server, PROJECT_CLIENTS);
    printClientSkips(skipped);
    if (!clients.length) throw noInstallableClientsError(server.name, skipped);
    console.log(JSON.stringify(clients.map((targetClient) => buildInstallPlan(server, targetClient)), null, 2));
  } else {
    console.log(JSON.stringify(buildInstallPlan(server, client), null, 2));
  }
}

export async function exportConfig(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin export-config <server-name> --client ${CLIENT_USAGE} [--live]`);

  const client = clientFlag(rest, "generic");
  const server = await findServer(rest, name);
  if (client === "all") {
    const { clients, skipped } = installableClientsForServer(server, PROJECT_CLIENTS);
    printClientSkips(skipped);
    const exported = Object.fromEntries(clients.map((targetClient) => [targetClient, exportClientConfig(server, targetClient).config]));
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

export async function install(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin install <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--live]`);

  const client = clientFlag(rest, "generic");
  const scope = scopeFlag(rest, "project") as InstallScope;
  const updateLock = hasFlag(rest, "--update-lock");
  const verifyBeforeInstall = hasFlag(rest, "--verify");
  const requireVerified = hasFlag(rest, "--require-verified");
  const policyPath = stringFlag(rest, "--policy", DEFAULT_POLICY_PATH);
  if (scope !== "project" && scope !== "global") {
    throw new Error("--scope must be project or global");
  }

  console.error(`Resolving ${name} from ${sourceFlag(rest, "all")} registry source...`);
  const server = await findServer(rest, name);
  let verifiedCapabilityManifest: CapabilityManifest | undefined;
  let verificationReport: VerificationReport | undefined;
  if (verifyBeforeInstall) {
    const liveVerification = liveVerificationEnabled(rest);
    const report = await verifyServer(server, {
      liveRemoteProbe: liveVerification,
      livePackageProbe: liveVerification,
      allowExecute: hasFlag(rest, "--allow-execute"),
      timeoutMs: numberFlag(rest, "--timeout", DEFAULT_PROBE_TIMEOUT_MS),
      requireVerified,
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
  const allClients = client === "all" ? installableClientsForServer(server, clientsForScope(scope)) : undefined;
  if (allClients) {
    printClientSkips(allClients.skipped);
    if (!allClients.clients.length) throw noInstallableClientsError(server.name, allClients.skipped);
  }
  const clients: ClientName[] = allClients?.clients ?? [client as ClientName];
  const plans = clients.map((targetClient) => buildInstallPlan(server, targetClient, { capabilityManifest: verifiedCapabilityManifest, verificationReport, scope }));
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
  // Default install preserves an existing, matching lock entry byte-for-byte so
  // signed / --expect-digest lockfiles are not invalidated by a no-op install.
  // Only write when --update-lock is set or the entry is new (or when drift was
  // explicitly accepted via --update-lock, handled below).
  const lockWriteNeeded: boolean[] = plans.map(() => true);
  if (!updateLock) {
    const mismatches = [];
    for (const [index, plan] of plans.entries()) {
      const verification = await verifyAgainstLockfile(plan, DEFAULT_LOCKFILE_PATH);
      if (!verification.ok) {
        mismatches.push(`${verification.key}: ${verification.messages.join("; ")}`);
      } else if (verification.locked) {
        lockWriteNeeded[index] = false;
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
  if (server.resolutionNote) printField("resolved", server.resolutionNote, WARN_COLOR);
  const installTrust = plans[0]?.trust ?? scoreServer(server);
  printField("trust", `${trustTier(installTrust)} / ${trustProfileScore(installTrust)}% profile / ${evidenceStatus(installTrust)}`, trustTierColor(trustTier(installTrust)));
  printField("evidence", evidenceSummary(installTrust));
  printCapExplanation(installTrust);
  printField("verify", verificationStatus(verifyBeforeInstall, verificationReport), verifyBeforeInstall ? (verificationOutcome(verificationReport) === "verified" ? OK_COLOR : WARN_COLOR) : MUTED_COLOR);
  printField("scope", scope === "project" ? "project folder" : "global current user");
  printField("clients", clients.join(", "));
  for (const [index, targetClient] of clients.entries()) {
    const result = await installServerConfig(server, targetClient, scope);
    const wroteLock = lockWriteNeeded[index];
    if (wroteLock) await writeLockfile(plans[index], DEFAULT_LOCKFILE_PATH);
    printSubhead(`${result.client} ${result.scope}`);
    printField("config", `${result.action}: ${result.file}`, OK_COLOR);
    printField("lock", wroteLock ? "mcp-lock.json updated" : "mcp-lock.json unchanged (matches lock)", wroteLock ? OK_COLOR : MUTED_COLOR);
    for (const note of result.notes) printBullet(note);
  }
  printField("done", `installed for ${client === "all" ? "all supported clients in this scope" : clients.join(", ")}`, OK_COLOR);
}

export async function testInstalled(rest: string[]): Promise<void> {
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
  const timeoutMs = numberFlag(rest, "--timeout", DEFAULT_PROBE_TIMEOUT_MS);

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

export async function adoptInstalled(rest: string[]): Promise<void> {
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
    lockfilePath: stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH),
    verify: hasFlag(rest, "--verify"),
    requireVerified: hasFlag(rest, "--require-verified"),
    timeoutMs: numberFlag(rest, "--timeout", DEFAULT_PROBE_TIMEOUT_MS),
    policyPath: stringFlag(rest, "--policy", DEFAULT_POLICY_PATH),
    enforcePolicy: !hasFlag(rest, "--no-policy"),
    dryRun: hasFlag(rest, "--dry-run"),
  });

  printInstalledMutationResult(result, hasFlag(rest, "--json"));
}

export async function updateInstalled(rest: string[]): Promise<void> {
  if (isHelp(rest)) {
    console.log(`Usage: toolpin update <server-name> --client ${CLIENT_USAGE.replace("|all", "")} --scope project|global [--version <server-version>] [--source all] [--live] [--file mcp-lock.json] [--verify] [--policy .toolpin/policy.json] [--no-policy] [--dry-run] [--json]
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
      lockfilePath: stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH),
      verify: hasFlag(rest, "--verify"),
      requireVerified: hasFlag(rest, "--require-verified"),
      timeoutMs: numberFlag(rest, "--timeout", DEFAULT_PROBE_TIMEOUT_MS),
      policyPath: stringFlag(rest, "--policy", DEFAULT_POLICY_PATH),
      enforcePolicy: !hasFlag(rest, "--no-policy"),
      dryRun: hasFlag(rest, "--dry-run"),
    });
    printInstalledUpdateAllResult(result, hasFlag(rest, "--json"));
    return;
  }

  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin update <server-name> --client ${CLIENT_USAGE.replace("|all", "")} --scope project|global [--version <server-version>] [--source all] [--live] [--file mcp-lock.json] [--dry-run] [--json]`);

  const client = clientFlag(rest, "generic");
  if (client === "all") throw new Error("update <server-name> requires one --client value, not all.");
  const scope = scopeFlag(rest, "project") as InstallScope;
  if (scope !== "project" && scope !== "global") throw new Error("--scope must be project or global");
  const result = await updateInstalledServer({
    serverName: name,
    client,
    scope,
    servers,
    version: stringFlag(rest, "--version", ""),
    lockfilePath: stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH),
    verify: hasFlag(rest, "--verify"),
    requireVerified: hasFlag(rest, "--require-verified"),
    timeoutMs: numberFlag(rest, "--timeout", DEFAULT_PROBE_TIMEOUT_MS),
    policyPath: stringFlag(rest, "--policy", DEFAULT_POLICY_PATH),
    enforcePolicy: !hasFlag(rest, "--no-policy"),
    dryRun: hasFlag(rest, "--dry-run"),
  });

  printInstalledMutationResult(result, hasFlag(rest, "--json"));
}

export async function remove(rest: string[], command: "remove" | "uninstall" = "remove"): Promise<void> {
  if (isHelp(rest)) {
    console.log(`Usage: toolpin ${command} <server-name> [--client ${CLIENT_USAGE}] [--scope project|global] [--file mcp-lock.json]`);
    return;
  }

  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin ${command} <server-name> [--client ${CLIENT_USAGE}] [--scope project|global] [--file mcp-lock.json]`);

  const client = hasAnyFlag(rest, ["--client", "-c"]) ? clientFlag(rest, "generic") : "all";
  const scope = scopeFlag(rest, "project") as InstallScope;
  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  if (scope !== "project" && scope !== "global") {
    throw new Error("--scope must be project or global");
  }

  await readLockfile(path);
  const clients = client === "all" ? clientsForScope(scope) : [client];
  printHeader("Remove");
  printField("server", name);
  printField("scope", scope);
  for (const targetClient of clients) {
    const runtimeAdvisory = await localHttpRuntimeAdvisory(name, targetClient, scope).catch(() => undefined);
    const configResult = await removeServerConfig(name, targetClient, scope);
    const lockResult = await removeLockfileEntry(name, targetClient, path);
    const status = configResult.action === "removed" || lockResult.removed ? "removed" : "missing";
    printSubhead(`${targetClient}: ${status}`);
    printField("config", configResult.action);
    printField("lock", lockResult.removed ? "removed" : "missing");
    if (runtimeAdvisory && configResult.action === "removed") printField("runtime", runtimeAdvisory.message, WARN_COLOR);
    if (configResult.action === "removed") {
      for (const note of configResult.notes) printBullet(note);
    }
  }
}

export async function listInstalled(rest: string[]): Promise<void> {
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
