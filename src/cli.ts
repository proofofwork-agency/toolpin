#!/usr/bin/env node
import { spawn } from "node:child_process";
import { verifyFrozenInstall } from "./ci.js";
import { clientsForScope, exportClientConfig, isClientName, PROJECT_CLIENTS, type ClientName } from "./config.js";
import { codexTomlFromClientConfig } from "./codexToml.js";
import { continueYamlFromClientConfig } from "./continueYaml.js";
import { installableClientsForServer, type ToolPinClientSkip } from "./clientSupport.js";
import { doctorLockfile } from "./doctor.js";
import { adoptInstalledServer, testInstalledServer, updateAllInstalledServers, updateInstalledServer, type InstalledMutationResult, type InstalledUpdateAllResult } from "./installed.js";
import { installServerConfig, removeServerConfig, type InstallScope } from "./install.js";
import { listInstalledServers, type InventoryScope } from "./inventory.js";
import { buildInstallPlan, readLockfile, readLockfileDigest, removeLockfileEntry, verifyAgainstLockfile, writeLockfile } from "./plan.js";
import { DEFAULT_LOCKFILE_PATH, DEFAULT_POLICY_PATH, DEFAULT_SIGNATURE_PATH } from "./constants.js";
import { enforcePolicy, evaluatePolicy, readPolicy, readPolicyDigest } from "./policy.js";
import { CacheSchemaError, enrichGlamaTarget, enrichSmitheryTarget, fetchRegistry, latestOnly, listRegistrySources, listRegistrySourceStatuses, normalizeEntries, readCache, readCacheMetadata, refreshCache, updateRegistrySourceEnabled } from "./registry.js";
import { searchServers } from "./search.js";
import { scanServerMetadata, scanToolDescriptions } from "./scan.js";
import { auditSecrets } from "./secrets.js";
import { ciSarifResult, ciSarifResults, sarifLog, scanSarifResults, verificationSarifResults } from "./sarif.js";
import { readPublicKeyFingerprint, signLockfile, verifyLockfileSignature } from "./signing.js";
import { testServer } from "./tester.js";
import { evidenceStatus, evidenceSummary, hasFreshTrustedArtifactEvidence, scoreServer, trustCapExplanation, trustedArtifactEvidenceProblem, trustTier } from "./trust.js";
import { localHttpRuntimeAdvisory } from "./runtimeAdvisory.js";
import { verifyServer, type VerificationReport } from "./verify.js";
import { TOOLPIN_VERSION } from "./version.js";
import { compareLockedToLatest, knownVersions } from "./versions.js";
import type { CapabilityManifest, NormalizedServer, RegistryEntry, RegistrySourceId, ToolDescriptionScan } from "./types.js";

const args = normalizeArgs(process.argv.slice(2));
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
const KNOWN_FLAGS = new Set([
  ...VALUE_FLAGS,
  "--all",
  "--allow-hosted-directory-targets",
  "--dry-run",
  "--global",
  "-g",
  "--help",
  "-h",
  "--json",
  "--live",
  "--no-policy",
  "--project",
  "--require-verified",
  "-p",
  "--sarif",
  "--skip-live-verification",
  "--skip-live-verify",
  "--update-lock",
  "--verify",
  "-v",
]);
const OK_COLOR = "\x1b[32m";
const WARN_COLOR = "\x1b[33m";
const ERR_COLOR = "\x1b[31m";
const CYAN_COLOR = "\x1b[36m";
const MUTED_COLOR = "\x1b[90m";

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const command = args[0] ?? "help";
  const rest = args.slice(1);
  if (command !== "help" && command !== "--help" && command !== "-h") {
    validateFlags(command, rest);
    if (isHelp(rest)) {
      commandHelp(command);
      return;
    }
  }

  switch (command) {
    case "version":
    case "--version":
    case "-v":
      console.log(`toolpin ${TOOLPIN_VERSION}`);
      return;
    case "upgrade":
      await upgrade(rest);
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
    case "scan":
      await scan(rest);
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
    case "sources":
      await registry(["list", ...rest]);
      return;
    case "outdated":
      await outdated(rest);
      return;
    case "list":
    case "ls":
    case "installed":
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

type UpgradePackageManager = "npm" | "pnpm" | "yarn" | "bun";

interface UpgradeCommand {
  packageManager: UpgradePackageManager;
  executable: string;
  args: string[];
  display: string;
}

async function upgrade(rest: string[]): Promise<void> {
  const dryRun = hasFlag(rest, "--dry-run");
  const json = hasFlag(rest, "--json");
  const target = stringFlag(rest, "--target", "latest");
  const packageManager = upgradePackageManager(rest);
  const command = upgradeCommand(packageManager, target);
  const result = {
    package: "toolpin",
    currentVersion: TOOLPIN_VERSION,
    target,
    packageManager,
    command: [command.executable, ...command.args],
    dryRun,
  };

  if (json) {
    if (!dryRun) throw new Error("toolpin upgrade --json requires --dry-run because package-manager output is streamed directly.");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printHeader("ToolPin Upgrade");
  printField("current", TOOLPIN_VERSION);
  printField("target", target);
  printField("command", command.display);

  if (dryRun) {
    printField("status", "dry run; no changes made", WARN_COLOR);
    return;
  }

  await runUpgradeCommand(command);
  printField("status", "upgrade command completed", OK_COLOR);
  printBullet("Run `tpn -v` or `toolpin --version` in a new shell to verify the active binary.");
}

async function ingest(rest: string[]): Promise<void> {
  const limit = numberFlag(rest, "--limit", 100);
  const pages = numberFlag(rest, "--pages", 10);
  const source = sourceFlag(rest, "all");
  const result = await refreshCache({ limit, maxPages: pages, source });
  const entries = result.entries;
  console.log(`Cached ${entries.length} registry versions from ${source} in .toolpin/registry-cache.json`);
  if (result.lastError) console.error(`Source diagnostics: ${result.lastError}`);
}

async function search(rest: string[]): Promise<void> {
  const query = positional(rest).join(" ");
  if (!query) throw new Error("Usage: toolpin search <query> [--limit 10] [--live] [--json]");

  const limit = numberFlag(rest, "--limit", 10);
  const servers = await loadServers(rest, { search: query });
  const results = searchServers(latestOnly(servers), query, limit);

  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ query, count: results.length, results }, null, 2));
    return;
  }

  printHeader(`Search results for "${query}"`);
  for (const result of results) {
    const server = result.server;
    const packages = server.packageTypes.length ? server.packageTypes.join(",") : "none";
    const remotes = server.remoteTypes.length ? server.remoteTypes.join(",") : "none";
    printSubhead(`${server.name}@${server.version}`);
    printField("title", server.title);
    if (server.description) printField("about", truncate(server.description, 140));
    printField("source", `${server.registrySource}  trust ${trustTier(result.trust)} / ${result.trust.score}% complete / ${evidenceStatus(result.trust)}`);
    printField("targets", `packages ${packages}; remotes ${remotes}`);
    printField("evidence", evidenceSummary(result.trust));
    printCapExplanation(result.trust);
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
  if (server.resolutionNote) printField("resolved", server.resolutionNote, WARN_COLOR);
  printField("trust", `${trustTier(trust)} / ${trust.score}% complete / ${evidenceStatus(trust)}`);
  printField("evidence", evidenceSummary(trust));
  printCapExplanation(trust);
  if (trust.gatedBy?.length) printField("gated by", trust.gatedBy.join(", "));
  if (trust.badges.length) printField("badges", trust.badges.join(", "));
  for (const issue of trust.issues) {
    printBullet(`${issue.severity.toUpperCase()}: ${issue.message}`);
  }
}

async function audit(rest: string[]): Promise<void> {
  const values = positional(rest);
  if (values[0] === "server") {
    await auditServer(rest.filter((value, index) => index !== 0));
    return;
  }
  if (values[0]) {
    console.error("Warning: `toolpin audit <server>` is deprecated; use `toolpin audit server <server>` for a one-server trust report.");
    await auditServer(rest);
    return;
  }

  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const policyPath = stringFlag(rest, "--policy", DEFAULT_POLICY_PATH);
  const scope = scopeFlag(rest, "all");
  const client = hasAnyFlag(rest, ["--client", "-c"]) ? clientFlag(rest, "all" as ClientName) : "all";
  if (scope !== "all" && scope !== "project" && scope !== "global") throw new Error("--scope must be all, project, or global");
  const findings: Array<{ code: string; severity: "info" | "warning" | "critical"; message: string; key?: string }> = [];

  const [inventory, doctorReport, secretsReport, lockfile, policyConfig] = await Promise.all([
    listInstalledServers({ scope, client }),
    doctorLockfile(path, scope).catch((error) => ({ ok: false, checked: 0, issues: [{ key: path, kind: "unreadable" as const, client: "generic" as ClientName, serverName: path, file: path, message: error instanceof Error ? error.message : String(error) }] })),
    auditSecrets(path, scope).catch((error) => ({ ok: false, checked: 0, findings: [{ kind: "unreadable_config" as const, key: path, client: "generic" as ClientName, serverName: path, file: path, message: error instanceof Error ? error.message : String(error) }] })),
    readLockfile(path).catch((error) => {
      findings.push({ code: "lockfile_unreadable", severity: "critical", message: error instanceof Error ? error.message : String(error), key: path });
      return undefined;
    }),
    readPolicy(policyPath).catch((error) => {
      findings.push({ code: "policy_unreadable", severity: "critical", message: error instanceof Error ? error.message : String(error), key: policyPath });
      return undefined;
    }),
  ]);

  for (const issue of inventory.issues) findings.push({ code: `inventory_${issue.kind}`, severity: "critical", message: issue.message, key: issue.file });
  for (const issue of doctorReport.issues) findings.push({ code: `doctor_${issue.kind}`, severity: issue.kind === "drift" || issue.kind === "unreadable" ? "critical" : "warning", message: issue.message, key: issue.key });
  for (const finding of secretsReport.findings) findings.push({ code: `secret_${finding.kind}`, severity: finding.kind === "plaintext_secret" || finding.kind === "secret_prefix" ? "critical" : "warning", message: finding.message, key: finding.key });

  const policyReports = [];
  const verificationReports = [];
  if (lockfile) {
    for (const [key, locked] of Object.entries(lockfile.servers)) {
      const problem = trustedArtifactEvidenceProblem(locked.trust.evidence ?? []);
      const hasArtifactEvidence = (locked.trust.evidence ?? []).some((entry) => entry.code === "oci_digest_verified" || entry.code === "mcpb_sha256_verified" || entry.code === "npm_integrity_verified");
      if (hasArtifactEvidence && problem) findings.push({ code: "verified_evidence_incomplete", severity: "warning", message: `${key}: ${problem}`, key });
      if (hasFlag(rest, "--require-verified") && (locked.trust.verifiedProvenance !== true || !hasFreshTrustedArtifactEvidence(locked.trust.evidence ?? []))) {
        findings.push({ code: "require_verified_failed", severity: "critical", message: `${key}: ${locked.trust.verifiedProvenance === true ? problem : "missing verified provenance"}`, key });
      }

      if (policyConfig) {
        const policyReport = evaluatePolicy(locked, policyConfig);
        policyReports.push(policyReport);
        for (const issue of policyReport.issues) findings.push({ code: `policy_${issue.code}`, severity: "critical", message: issue.message, key: policyReport.key });
      }

      if (hasFlag(rest, "--verify")) {
        try {
          const server = await findExactServer(rest, locked.name, locked.resolved?.source ?? sourceFlag(rest, "all"));
          const liveVerification = liveVerificationEnabled(rest);
          const verification = await verifyServer(server, {
            liveRemoteProbe: liveVerification,
            livePackageProbe: liveVerification,
            timeoutMs: numberFlag(rest, "--timeout", 15000),
            requireVerified: hasFlag(rest, "--require-verified"),
          });
          verificationReports.push(verification);
          if (!verification.ok) findings.push({ code: "verification_failed", severity: "critical", message: `${key}: verification failed`, key });
          if (hasFlag(rest, "--require-verified") && verificationOutcome(verification) !== "verified") {
            findings.push({ code: "require_verified_failed", severity: "critical", message: `${key}: verification is ${verificationOutcome(verification)}`, key });
          }
        } catch (error) {
          findings.push({ code: "verification_unavailable", severity: hasFlag(rest, "--require-verified") ? "critical" : "warning", message: `${key}: ${error instanceof Error ? error.message : String(error)}`, key });
        }
      }
    }
  }

  const report = {
    ok: !findings.some((finding) => finding.severity === "critical"),
    checked: {
      lockfile: lockfile ? Object.keys(lockfile.servers).length : 0,
      inventory: inventory.checked,
      doctor: doctorReport.checked,
      secrets: secretsReport.checked,
    },
    findings,
    inventory,
    doctor: doctorReport,
    secrets: secretsReport,
    policy: policyConfig ? { ok: policyReports.every((entry) => entry.ok), reports: policyReports } : undefined,
    verification: hasFlag(rest, "--verify") ? { ok: verificationReports.every((entry) => entry.ok), reports: verificationReports } : undefined,
  };

  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHeader(report.ok ? "Audit OK" : "Audit findings");
    printField("lockfile", path);
    printField("checked", `${report.checked.lockfile} locked, ${report.checked.inventory} config file(s)`);
    for (const finding of findings) printBullet(`${finding.severity.toUpperCase()}: ${finding.code}${finding.key ? ` ${finding.key}` : ""}: ${finding.message}`);
  }
  if (!report.ok) process.exitCode = 1;
}

async function auditServer(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: toolpin audit [--file mcp-lock.json] [--scope all|project|global] [--client all] [--verify] [--require-verified] [--json]\n       toolpin audit server <server-name> [--live] [--json]");
  const server = await findServer(rest, name);
  const trust = scoreServer(server);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ kind: "server_trust_report", name: server.name, version: server.version, trust }, null, 2));
    return;
  }
  printHeader(`Server trust report: ${server.name}@${server.version}`);
  printField("trust", `${trustTier(trust)} / ${trust.score}% complete / ${evidenceStatus(trust)}`);
  printField("evidence", evidenceSummary(trust));
  printCapExplanation(trust);
}

async function scan(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: toolpin scan <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--sarif] [--timeout 15000]");

  const server = await findServer(rest, name);
  const generatedAt = new Date().toISOString();
  const scans: ToolDescriptionScan[] = [scanServerMetadata(server, generatedAt)];
  let liveProbe;
  if (hasFlag(rest, "--live")) {
    liveProbe = await testServer(server, numberFlag(rest, "--timeout", 15000));
    if (liveProbe.ok) {
      scans.push(scanToolDescriptions(liveProbe.tools, { generatedAt }));
    } else if (!hasAnyFlag(rest, ["--json", "--sarif"])) {
      console.error(`Live probe skipped tool-description scan: ${liveProbe.message}`);
    }
  }

  const findings = scans.flatMap((entry) => entry.findings);
  if (hasFlag(rest, "--sarif")) {
    console.log(JSON.stringify(sarifLog(scanSarifResults(scans), { generatedAt, executionSuccessful: true }), null, 2));
    return;
  }
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({
      server: {
        name: server.name,
        version: server.version,
        registrySource: server.registrySource,
      },
      liveProbe: liveProbe ? { ok: liveProbe.ok, message: liveProbe.message, toolCount: liveProbe.tools.length } : undefined,
      scannedDescriptions: scans.reduce((count, entry) => count + entry.scannedDescriptions, 0),
      findings,
      scans,
    }, null, 2));
    return;
  }

  printHeader(`Description scan: ${server.name}@${server.version}`);
  printField("registry", `${server.registrySource} metadata`);
  printField("scanned", `${scans.reduce((count, entry) => count + entry.scannedDescriptions, 0)} description(s)`);
  printField("findings", `${findings.length} advisory finding(s)`);
  for (const finding of findings) {
    printBullet(`${finding.severity.toUpperCase()}: ${finding.code}: ${finding.subject}: ${finding.message}`);
  }
}

async function verify(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: toolpin verify <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--sarif] [--timeout 15000] [--skip-live-verification] [--require-verified]");

  const server = await findServer(rest, name);
  const liveVerification = liveVerificationEnabled(rest);
  const report = await verifyServer(server, {
    liveRemoteProbe: liveVerification,
    livePackageProbe: liveVerification,
    timeoutMs: numberFlag(rest, "--timeout", 15000),
    requireVerified: hasFlag(rest, "--require-verified"),
  });

  if (hasFlag(rest, "--sarif")) {
    console.log(JSON.stringify(sarifLog(verificationSarifResults(report), { executionSuccessful: report.ok }), null, 2));
  } else if (hasFlag(rest, "--json")) {
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
  if (!name) throw new Error("Usage: toolpin versions <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--limit 10] [--json]");

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
  if (subcommand === "enable" || subcommand === "disable") {
    const sourceId = rest[1];
    if (!sourceId) throw new Error("Usage: toolpin registry enable <source-id>\n       toolpin registry disable <source-id>");
    await updateRegistrySourceEnabled(sourceId, subcommand === "enable");
    printHeader("Registry source updated");
    printField("source", sourceId);
    printField("enabled", subcommand === "enable" ? "yes" : "no");
    return;
  }
  if (subcommand !== "list") {
    throw new Error("Usage: toolpin registry list [--json]\n       toolpin registry enable <source-id>\n       toolpin registry disable <source-id>");
  }

  const sources = await listRegistrySourceStatuses();
  const cache = await readCacheMetadata().catch(() => undefined);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ sources, cache }, null, 2));
    return;
  }

  printHeader("Registry sources");
  for (const source of sources) {
    const partition = cache?.sources[source.id];
    printSubhead(source.id);
    printField("label", source.label);
    printField("type", source.type ?? "unknown");
    if (source.adapter) printField("adapter", source.adapter);
    printField("mode", source.mode);
    printField("status", partition?.status ?? source.status ?? (source.enabled ? "ready" : "disabled"));
    printField("trust", source.trust);
    printField("enabled", source.enabled ? "yes" : "no");
    if (source.pinned) printField("pinned", "required");
    printField("auth", source.authRequired ? "required" : "none");
    if (source.url) printField("url", source.url);
    if (partition) {
      printField("cached", `${partition.entries.length} versions / ${latestOnly(normalizeEntries(partition.entries)).length} latest servers`);
      printField("last fetched", partition.generatedAt);
      printField("fetched", `accepted ${partition.accepted}, skipped ${partition.skipped}, malformed ${partition.malformed}, failed ${partition.failed}`);
      if (partition.pageInfo) printField("pages", `${partition.pageInfo.fetchedPages}/${partition.pageInfo.maxPages} hasMore=${partition.pageInfo.hasMore}`);
      if (partition.lastError) printField("last error", partition.lastError);
    }
    if (source.setupHint) printField("setup", source.setupHint);
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
    const { clients, skipped } = installableClientsForServer(server, PROJECT_CLIENTS);
    printClientSkips(skipped);
    if (!clients.length) throw noInstallableClientsError(server.name, skipped);
    console.log(JSON.stringify(clients.map((targetClient) => buildInstallPlan(server, targetClient)), null, 2));
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
  if (rest[0] === "key-fingerprint") {
    await lockKeyFingerprint(rest.slice(1));
    return;
  }

  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin lock <server-name> --client ${CLIENT_USAGE} [--live] [--verify [--skip-live-verification | --skip-live-verify] [--timeout 15000]]\n       toolpin lock digest [--file mcp-lock.json] [--json]\n       toolpin lock key-fingerprint --public-key public.pem [--json]\n       toolpin lock sign --policy .toolpin/policy.json --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig]\n       toolpin lock verify-signature --policy .toolpin/policy.json --public-key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig]`);

  const client = clientFlag(rest, "generic");
  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const scope = scopeFlag(rest, "project") as InstallScope;
  const server = await findServer(rest, name);
  let verifiedCapabilityManifest: CapabilityManifest | undefined;
  let verificationReport: VerificationReport | undefined;
  if (hasFlag(rest, "--verify")) {
    const liveVerification = liveVerificationEnabled(rest);
    const report = await verifyServer(server, {
      liveRemoteProbe: liveVerification,
      livePackageProbe: liveVerification,
      timeoutMs: numberFlag(rest, "--timeout", 15000),
      requireVerified: hasFlag(rest, "--require-verified"),
    });
    if (!report.ok) {
      throw new Error([
        "Lock refused because verification failed.",
        ...report.issues.map((issue) => `- ${issue.severity}: ${issue.code}: ${issue.message}`),
      ].join("\n"));
    }
    verifiedCapabilityManifest = report.capabilityManifest;
    verificationReport = report;
  }
  let lockfile;
  if (client === "all") {
    const { clients, skipped } = installableClientsForServer(server, PROJECT_CLIENTS);
    printClientSkips(skipped);
    if (!clients.length) throw noInstallableClientsError(server.name, skipped);
    for (const targetClient of clients) {
      lockfile = await writeLockfile(buildInstallPlan(server, targetClient, { scope, capabilityManifest: verifiedCapabilityManifest, verificationReport }), path);
    }
  } else {
    lockfile = await writeLockfile(buildInstallPlan(server, client, { scope, capabilityManifest: verifiedCapabilityManifest, verificationReport }), path);
  }
  printHeader("Lockfile updated");
  printField("server", `${server.name}@${server.version}`);
  printField("file", path);
  printField("entries", `${Object.keys(lockfile?.servers ?? {}).length} server/client entrie(s)`);
}

async function lockKeyFingerprint(rest: string[]): Promise<void> {
  const keyPath = stringAnyFlag(rest, ["--public-key", "--key"], "");
  if (!keyPath) throw new Error("Usage: toolpin lock key-fingerprint --public-key public.pem [--json]");
  const fingerprint = await readPublicKeyFingerprint(keyPath);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ publicKey: keyPath, fingerprint }, null, 2));
  } else {
    console.log(fingerprint);
  }
}

async function lockDigest(rest: string[]): Promise<void> {
  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const digest = await readLockfileDigest(path);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ file: path, digest }, null, 2));
  } else {
    console.log(digest);
  }
}

async function lockSign(rest: string[]): Promise<void> {
  const keyPath = stringFlag(rest, "--key", "");
  const policyPath = stringFlag(rest, "--policy", "");
  if (!keyPath || !policyPath) throw new Error("Usage: toolpin lock sign --policy .toolpin/policy.json --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig]");
  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const signaturePath = stringFlag(rest, "--signature", DEFAULT_SIGNATURE_PATH);
  const envelope = await signLockfile(path, keyPath, signaturePath, { policyPath });
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ file: path, signature: signaturePath, envelope }, null, 2));
  } else {
    printHeader(`Signed ${path}`);
    printField("file", path);
    printField("digest", envelope.lockfileDigest);
    printField("policy", envelope.policyDigest ?? "none");
    printField("key", envelope.publicKeyFingerprint);
    printField("signature", signaturePath);
  }
}

async function lockVerifySignature(rest: string[]): Promise<void> {
  const keyPath = stringAnyFlag(rest, ["--public-key", "--key"], "");
  const policyPath = stringFlag(rest, "--policy", "");
  if (!keyPath || !policyPath) throw new Error("Usage: toolpin lock verify-signature --policy .toolpin/policy.json --public-key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig]");
  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const signaturePath = stringFlag(rest, "--signature", DEFAULT_SIGNATURE_PATH);
  const report = await verifyLockfileSignature(path, keyPath, signaturePath, { policyPath });
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ file: path, signature: signaturePath, report }, null, 2));
  } else {
    printHeader(`${report.ok ? "OK" : "FAILED"} ${report.message.replace(/\.$/, "")}`);
    printField("file", path);
    printField("signature", signaturePath);
    printField("policy", report.policyDigest ?? "none");
    if (report.publicKeyFingerprint) printField("key", report.publicKeyFingerprint);
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

async function findServer(rest: string[], name: string): Promise<NormalizedServer> {
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

async function findExactServer(rest: string[], name: string, source: RegistrySourceId | "all"): Promise<NormalizedServer> {
  const servers = await loadServers(rest, { search: name, source });
  const exact = latestOnly(servers).find((server) => server.name === name);
  if (exact) return resolveServerTargets(rest, exact);
  throw new Error(`No exact server found for ${name} in ${source}. Try \`toolpin ingest\` or pass --live.`);
}

async function resolveServerTargets(rest: string[], server: NormalizedServer): Promise<NormalizedServer> {
  return enrichGlamaTarget(await enrichSmitheryTarget(server, {
    allowHostedDirectoryTargets: hasFlag(rest, "--allow-hosted-directory-targets"),
  }));
}

async function loadServers(rest: string[], liveOptions: { search?: string; source?: RegistrySourceId | "all" } = {}): Promise<NormalizedServer[]> {
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

async function install(rest: string[]): Promise<void> {
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
      timeoutMs: numberFlag(rest, "--timeout", 15000),
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
  if (!updateLock) {
    const mismatches = [];
    for (const plan of plans) {
      const verification = await verifyAgainstLockfile(plan, DEFAULT_LOCKFILE_PATH);
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
  if (server.resolutionNote) printField("resolved", server.resolutionNote, WARN_COLOR);
  const installTrust = plans[0]?.trust ?? scoreServer(server);
  printField("trust", `${trustTier(installTrust)} / ${installTrust.score}% complete / ${evidenceStatus(installTrust)}`, trustTierColor(trustTier(installTrust)));
  printField("evidence", evidenceSummary(installTrust));
  printCapExplanation(installTrust);
  printField("verify", verificationStatus(verifyBeforeInstall, verificationReport), verifyBeforeInstall ? (verificationOutcome(verificationReport) === "verified" ? OK_COLOR : WARN_COLOR) : MUTED_COLOR);
  printField("scope", scope === "project" ? "project folder" : "global current user");
  printField("clients", clients.join(", "));
  for (const [index, targetClient] of clients.entries()) {
    const result = await installServerConfig(server, targetClient, scope);
    await writeLockfile(plans[index], DEFAULT_LOCKFILE_PATH);
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
    requireVerified: hasFlag(rest, "--require-verified"),
    timeoutMs: numberFlag(rest, "--timeout", 15000),
    policyPath: stringFlag(rest, "--policy", ".toolpin/policy.json"),
    enforcePolicy: !hasFlag(rest, "--no-policy"),
    dryRun: hasFlag(rest, "--dry-run"),
  });

  printInstalledMutationResult(result, hasFlag(rest, "--json"));
}

async function updateInstalled(rest: string[]): Promise<void> {
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
      lockfilePath: stringFlag(rest, "--file", "mcp-lock.json"),
      verify: hasFlag(rest, "--verify"),
      requireVerified: hasFlag(rest, "--require-verified"),
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
    lockfilePath: stringFlag(rest, "--file", "mcp-lock.json"),
    verify: hasFlag(rest, "--verify"),
    requireVerified: hasFlag(rest, "--require-verified"),
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
    const runtimeAdvisory = await localHttpRuntimeAdvisory(name, targetClient, scope).catch(() => undefined);
    const configResult = await removeServerConfig(name, targetClient, scope);
    const lockResult = await removeLockfileEntry(name, targetClient, path);
    const status = configResult.action === "removed" || lockResult.removed ? "removed" : "missing";
    printSubhead(`${targetClient}: ${status}`);
    printField("config", configResult.action);
    printField("lock", lockResult.removed ? "removed" : "missing");
    if (runtimeAdvisory && configResult.action === "removed") printField("runtime", runtimeAdvisory.message, WARN_COLOR);
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
  if (isHelp(rest)) {
    ciHelp();
    return;
  }

  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const expectedDigest = stringFlag(rest, "--expect-digest", "");
  const signaturePath = stringFlag(rest, "--signature", "");
  const publicKeyPath = stringFlag(rest, "--public-key", "");
  const verifyBeforeUse = hasFlag(rest, "--verify");
  const requireVerified = hasFlag(rest, "--require-verified");
  const policyPath = stringFlag(rest, "--policy", DEFAULT_POLICY_PATH);
  const enforcePolicies = !hasFlag(rest, "--no-policy");
  const sarif = hasFlag(rest, "--sarif");
  if (signaturePath || publicKeyPath) {
    if (!signaturePath || !publicKeyPath) throw new Error("toolpin ci requires both --signature and --public-key when verifying a lock signature.");
    let signature;
    try {
      signature = await verifyLockfileSignature(path, publicKeyPath, signaturePath, { policyPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sarif) {
        console.log(JSON.stringify(sarifLog([ciSarifResult("ci_signature_failed", `Lockfile signature verification failed for ${path}: ${message}`, path)], { executionSuccessful: false }), null, 2));
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    if (!signature.ok) {
      if (sarif) {
        console.log(JSON.stringify(sarifLog([ciSarifResult("ci_signature_failed", `Lockfile signature verification failed for ${path}: ${signature.message}`, path)], { executionSuccessful: false }), null, 2));
        process.exitCode = 1;
        return;
      }
      throw new Error(`Lockfile signature verification failed for ${path}: ${signature.message}`);
    }
  }
  if (expectedDigest) {
    const actualDigest = await readLockfileDigest(path);
    if (actualDigest !== expectedDigest) {
      if (sarif) {
        console.log(JSON.stringify(sarifLog([ciSarifResult("ci_digest_mismatch", `Lockfile digest mismatch for ${path}: expected ${expectedDigest}, got ${actualDigest}`, path)], { executionSuccessful: false }), null, 2));
        process.exitCode = 1;
        return;
      }
      throw new Error(`Lockfile digest mismatch for ${path}: expected ${expectedDigest}, got ${actualDigest}`);
    }
  }
  const report = await verifyFrozenInstall(path, async (locked) => {
    const server = await findExactServer(rest, locked.name, locked.resolved?.source ?? sourceFlag(rest, "all"));
    let verifiedCapabilityManifest: CapabilityManifest | undefined;
    let verification: VerificationReport | undefined;
    if (hasAnyFlag(rest, ["--skip-live-verification", "--skip-live-verify"]) && lockedHasLivePins(locked)) {
      throw new Error(`${locked.name} has live capability pins in ${path}; --skip-live-verification is not allowed for pinned CI entries.`);
    }
    if (verifyBeforeUse) {
      const liveVerification = liveVerificationEnabled(rest);
      verification = await verifyServer(server, {
        liveRemoteProbe: liveVerification,
        livePackageProbe: liveVerification,
        timeoutMs: numberFlag(rest, "--timeout", 15000),
        requireVerified,
      });
      if (!verification.ok) {
        throw new Error([
          `Verification failed for ${locked.name}:`,
          ...verification.issues.map((issue) => `- ${issue.severity}: ${issue.code}: ${issue.message}`),
        ].join("\n"));
      }
      verifiedCapabilityManifest = verification.capabilityManifest;
    }
    const plan = buildInstallPlan(server, locked.client, { capabilityManifest: verifiedCapabilityManifest, verificationReport: verification, scope: locked.scope ?? "project" });
    if (enforcePolicies) {
      const policy = await enforcePolicy(plan, policyPath);
      if (!policy.ok) {
        throw new Error(policy.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
      }
    }
    return plan;
  });

  if (sarif) {
    console.log(JSON.stringify(sarifLog(ciSarifResults(report, path), { executionSuccessful: report.ok }), null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

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
  if (subcommand === "digest") {
    const policyPath = stringFlag(values, "--policy", stringFlag(values, "--file", DEFAULT_POLICY_PATH));
    const digest = await readPolicyDigest(policyPath);
    if (!digest) throw new Error(`Policy file not found: ${policyPath}`);
    if (hasFlag(values, "--json")) {
      console.log(JSON.stringify({ file: policyPath, digest }, null, 2));
    } else {
      console.log(digest);
    }
    return;
  }
  if (subcommand !== "check") {
    throw new Error(`Usage: toolpin policy digest [--policy .toolpin/policy.json] [--json]\n       toolpin policy check <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--policy .toolpin/policy.json] [--json] [--live]`);
  }

  const name = positional(values)[0];
  if (!name) throw new Error(`Usage: toolpin policy check <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--policy .toolpin/policy.json] [--json] [--live]`);

  const client = clientFlag(values, "generic");
  const scope = scopeFlag(values, "project") as InstallScope;
  const policyPath = stringFlag(values, "--policy", DEFAULT_POLICY_PATH);
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
  if (isHelp(rest)) {
    doctorHelp();
    return;
  }

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

function ciHelp(): void {
  console.log("Usage: toolpin ci [--file mcp-lock.json] [--expect-digest sha256-...] [--signature mcp-lock.sig --public-key public.pem] [--policy .toolpin/policy.json] [--no-policy] [--source toolpin|official|docker|all|id] [--live] [--verify [--require-verified] [--skip-live-verification | --skip-live-verify] [--timeout 15000]] [--sarif]");
}

function doctorHelp(): void {
  console.log("Usage: toolpin doctor [--file mcp-lock.json] [--scope|-s all|project|global] [--global|-g] [--json]");
}

function commandHelp(command: string): void {
  switch (command) {
    case "upgrade":
      upgradeHelp();
      return;
    case "search":
      console.log("Usage: toolpin search <query> [--source toolpin|official|docker|all|custom-id] [--limit 10] [--live] [--json]");
      return;
    case "ci":
      ciHelp();
      return;
    case "registry":
    case "sources":
      console.log("Usage: toolpin registry list [--json]\n       toolpin registry enable <source-id>\n       toolpin registry disable <source-id>");
      return;
    case "audit":
      console.log("Usage: toolpin audit [--file mcp-lock.json] [--scope all|project|global] [--client all] [--policy .toolpin/policy.json] [--verify] [--require-verified] [--json]\n       toolpin audit server <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--json]");
      return;
    case "scan":
      console.log("Usage: toolpin scan <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--sarif] [--timeout 15000]\nDescription scan only; use `toolpin verify` for artifact evidence verification and `toolpin audit` for local install audit.");
      return;
    case "verify":
      console.log("Usage: toolpin verify <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--sarif] [--timeout 15000] [--skip-live-verification] [--require-verified]");
      return;
    case "doctor":
      doctorHelp();
      return;
    case "list":
    case "ls":
    case "installed":
      console.log(`Usage: toolpin list [--scope all|project|global] [--client ${CLIENT_USAGE}] [--json]`);
      return;
    case "remove":
    case "uninstall":
      console.log(`Usage: toolpin ${command} <server-name> [--client ${CLIENT_USAGE}] [--scope project|global] [--file mcp-lock.json]`);
      return;
    case "lock":
      console.log(`Usage: toolpin lock <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--file mcp-lock.json] [--verify [--skip-live-verification | --skip-live-verify] [--timeout 15000]]
       toolpin lock digest [--file mcp-lock.json] [--json]
       toolpin lock key-fingerprint --public-key public.pem [--json]
       toolpin lock sign --policy .toolpin/policy.json --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig]
       toolpin lock verify-signature --policy .toolpin/policy.json --public-key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig]`);
      return;
    case "policy":
      console.log(`Usage: toolpin policy digest [--policy .toolpin/policy.json] [--json]
       toolpin policy check <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--policy .toolpin/policy.json] [--json] [--live]`);
      return;
    case "tui":
      printTuiHelp();
      return;
    default:
      help();
  }
}

function upgradeHelp(): void {
  console.log("Usage: toolpin upgrade [--target latest|<version>] [--package-manager npm|pnpm|yarn|bun] [--dry-run] [--json]\n       tpn upgrade [--target latest]");
}

async function test(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error("Usage: toolpin test <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--timeout 15000] [--json]");

  const timeout = numberFlag(rest, "--timeout", 15000);
  const server = await findServer(rest, name);
  const json = hasFlag(rest, "--json");
  if (!json) {
    console.error(`Testing ${server.name}@${server.version} (${server.registrySource}) with ${timeout}ms timeout...`);
  }
  const result = await testServer(server, timeout);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
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
  if (!result.ok) process.exitCode = 1;
}

function help(): void {
  console.log(`ToolPin ${TOOLPIN_VERSION}
  Trusted install, lockfile, and governance for MCP servers.

Quick start
  toolpin tui
  tpn upgrade
  toolpin --version
  tpn -v
  toolpin ingest
  toolpin search github
  toolpin install <server> --client claude --update-lock

Discovery
  toolpin ingest [--source toolpin|official|docker|all|custom-id] [--limit 100] [--pages 10]
  toolpin registry list [--json]
  toolpin registry enable <source-id>
  toolpin registry disable <source-id>
  toolpin sources [--json]
  toolpin search <query> [--source toolpin|official|docker|all|custom-id] [--limit 10] [--live] [--json]
  toolpin info <server> [--version <server-version>] [--json] [--live]
  toolpin scan <server> [--version <server-version>] [--live] [--json] [--sarif] [--timeout 15000]  # description scan
  toolpin verify <server> [--version <server-version>] [--live] [--json] [--sarif] [--timeout 15000] [--skip-live-verification] [--require-verified]
  toolpin versions <server> [--live] [--limit 10] [--json]
  toolpin test <server> [--version <server-version>] [--live] [--timeout 15000] [--json]
  toolpin test-installed <server> --client|-c <client> --scope|-s project|global [--timeout 15000] [--json]

Install and config
  toolpin list|installed [--scope|-s all|project|global] [--client|-c <client|all>] [--json]
  toolpin plan <server> --client|-c <client> [--version <server-version>] [--live]
  toolpin install <server> --client|-c <client|all> [--version <server-version>] [--scope|-s project|global] [--global|-g] [--update-lock] [--verify] [--require-verified] [--policy .toolpin/policy.json] [--no-policy]
  toolpin adopt <installed> --client|-c <client> --scope|-s project|global [--dry-run] [--json]
  toolpin update <server> --client|-c <client> --scope|-s project|global [--version <server-version>] [--dry-run] [--json]
  toolpin update --all [--scope|-s all|project|global] [--client|-c <client|all>] [--dry-run] [--json]
  toolpin remove <server> [--client|-c <client|all>] [--scope|-s project|global] [--global|-g]
  toolpin uninstall <server> [--client|-c <client|all>] [--scope|-s project|global] [--global|-g]
  toolpin export-config <server> --client|-c <client|all> [--version <server-version>] [--live]

Lock and governance
  toolpin audit [--file mcp-lock.json] [--scope|-s all|project|global] [--client|-c <client|all>] [--verify] [--require-verified] [--json]
  toolpin audit server <server> [--version <server-version>] [--live] [--json]
  toolpin ci [--file mcp-lock.json] [--expect-digest sha256-...] [--signature mcp-lock.sig --public-key public.pem] [--policy .toolpin/policy.json] [--no-policy] [--source toolpin|official|docker|all|id] [--live] [--verify [--require-verified] [--skip-live-verification | --skip-live-verify] [--timeout 15000]] [--sarif]
  toolpin outdated [--file mcp-lock.json] [--live] [--json]
  toolpin doctor [--file mcp-lock.json] [--scope|-s all|project|global] [--global|-g] [--json]
  toolpin secrets audit [--file mcp-lock.json] [--scope|-s all|project|global] [--global|-g] [--json]
  toolpin policy digest [--policy .toolpin/policy.json] [--json]
  toolpin policy check <server> --client|-c <client|all> [--version <server-version>] [--policy .toolpin/policy.json]
  toolpin lock <server> --client|-c <client|all> [--version <server-version>] [--scope project|global] [--file mcp-lock.json]
  toolpin lock digest [--file mcp-lock.json] [--json]
  toolpin lock key-fingerprint --public-key public.pem [--json]
  toolpin lock sign --policy .toolpin/policy.json --key private.pem [--signature mcp-lock.sig] [--json]
  toolpin lock verify-signature --policy .toolpin/policy.json --public-key public.pem [--signature mcp-lock.sig] [--json]

Maintenance
  toolpin upgrade [--target latest|<version>] [--package-manager npm|pnpm|yarn|bun] [--dry-run]
  tpn upgrade
  tpn -v

Trust output
  score is metadata completeness; tier is evidence-gated
  verified requires a pinned target plus artifact proof
  cap explains why an otherwise strong score was limited

Common options
  --source toolpin|official|docker|all|id
                                    choose registry source; all means enabled sources
  --live                            fetch instead of cache
  --json                            machine-readable output where supported
  --sarif                           SARIF 2.1.0 output where supported
  --allow-hosted-directory-targets  opt in to hosted Smithery directory targets
  toolpin --version, -v             print ToolPin version
  --version <server-version>        select a known server version for server commands
  --scope, -s project|global        project folder vs current-user config
  --global, -g                      npm-style shortcut for --scope global
  --project, -p                     shortcut for --scope project
  --client, -c <client|all>         target client config
  --target latest|<version>         package target for toolpin upgrade

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

function printCapExplanation(report: Parameters<typeof trustCapExplanation>[0]): void {
  const explanation = trustCapExplanation(report);
  if (explanation) printField("cap", explanation, WARN_COLOR);
}

function printBullet(value: string): void {
  console.log(`  - ${colorize(value, MUTED_COLOR)}`);
}

function printClientSkips(skipped: ToolPinClientSkip[]): void {
  for (const skip of skipped) {
    console.error(`Skipping ${skip.client}: ${skip.reason}`);
  }
}

function noInstallableClientsError(serverName: string, skipped: ToolPinClientSkip[]): Error {
  return new Error([
    `No ToolPin-installable clients are available for ${serverName} in the selected scope.`,
    ...skipped.map((skip) => `- ${skip.client}: ${skip.reason}`),
  ].join("\n"));
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
    printTuiHelp();
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("toolpin tui requires an interactive terminal: stdin and stdout must both be TTYs.");
  }
  const { runTui: renderTui } = await import("./tui.js");
  renderTui();
}

function printTuiHelp(): void {
  console.log(`Usage: toolpin tui

Opens the ToolPin ${TOOLPIN_VERSION} full-screen terminal UI.
Browse rows show full evidence labels (REVIEW, UNVERIFIED, BLOCKED, EVIDENCE).
Browse defaults to source-first ordering: toolpin, official, docker, then other enabled sources.
Use g for the exact source filter and a to cycle sort modes.
Overview separates evidence tier, gated overall score, metadata completeness,
and pillar scores; cap explains why a score was limited.`);
}

function hasFlag(values: string[], flag: string): boolean {
  return values.includes(flag);
}

function normalizeArgs(values: string[]): string[] {
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

function validateFlags(command: string, values: string[]): void {
  for (const value of values) {
    if (!value.startsWith("-")) continue;
    if (KNOWN_FLAGS.has(value)) continue;
    const suggestion = nearestFlag(value);
    throw new Error(`Unknown flag for ${command}: ${value}.${suggestion ? ` Did you mean ${suggestion}?` : ""}`);
  }
}

function nearestFlag(value: string): string | undefined {
  let best: { flag: string; distance: number } | undefined;
  for (const flag of KNOWN_FLAGS) {
    const distance = editDistance(value, flag);
    if (!best || distance < best.distance) best = { flag, distance };
  }
  return best && best.distance <= 3 ? best.flag : undefined;
}

function editDistance(left: string, right: string): number {
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
  if (/^[a-zA-Z0-9._/-]+$/.test(value)) {
    return value as RegistrySourceId | "all";
  }
  throw new Error("--source must be all or a registry source id");
}

function upgradePackageManager(values: string[]): UpgradePackageManager {
  const requested = stringFlag(values, "--package-manager", detectPackageManager());
  if (requested === "npm" || requested === "pnpm" || requested === "yarn" || requested === "bun") return requested;
  throw new Error("--package-manager must be npm, pnpm, yarn, or bun");
}

function detectPackageManager(): UpgradePackageManager {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("yarn/")) return "yarn";
  if (userAgent.startsWith("bun/")) return "bun";
  return "npm";
}

function upgradeCommand(packageManager: UpgradePackageManager, target: string): UpgradeCommand {
  if (!target || target.startsWith("-")) throw new Error("--target requires a package version or dist-tag.");
  const spec = `toolpin@${target}`;
  const executable = packageManagerExecutable(packageManager);
  const args = packageManager === "npm"
    ? ["install", "-g", spec]
    : packageManager === "pnpm"
      ? ["add", "-g", spec]
      : packageManager === "yarn"
        ? ["global", "add", spec]
        : ["add", "-g", spec];
  return {
    packageManager,
    executable,
    args,
    display: [executable, ...args].join(" "),
  };
}

function packageManagerExecutable(packageManager: UpgradePackageManager): string {
  return process.platform === "win32" ? `${packageManager}.cmd` : packageManager;
}

async function runUpgradeCommand(command: UpgradeCommand): Promise<void> {
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command.executable, command.args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`Upgrade command failed with exit code ${exitCode ?? "unknown"}: ${command.display}`);
  }
}

function serverVersionFlag(values: string[]): string | undefined {
  const index = values.indexOf("--version");
  if (index < 0) return undefined;
  const value = values[index + 1];
  if (!value || value.startsWith("-")) throw new Error("--version requires a server version value.");
  return value;
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

function cacheHasSource(entries: RegistryEntry[], source: RegistrySourceId | "all", enabledSources = new Set<RegistrySourceId>()): boolean {
  const sources = new Set(normalizeEntries(entries).map((server) => server.registrySource));
  return source === "all" ? [...enabledSources].every((enabled) => sources.has(enabled)) : sources.has(source);
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

function lockedHasLivePins(locked: { capabilityManifest?: CapabilityManifest }): boolean {
  return Boolean(locked.capabilityManifest?.toolDescriptionHash || locked.capabilityManifest?.toolManifestHash);
}

function liveVerificationEnabled(values: string[]): boolean {
  return !hasAnyFlag(values, ["--skip-live-verification", "--skip-live-verify"]);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
}

function verificationStatus(verifyRequested: boolean, report?: VerificationReport): string {
  if (!verifyRequested) return "skipped";
  return verificationOutcome(report);
}

function verificationOutcome(report?: VerificationReport): "verified" | "incomplete" | "failed" {
  if (!report || !report.ok) return "failed";
  const hasPin = report.evidence.some((entry) => (entry.status === "passed" || entry.status === "declared") && ["package_pin", "digest_present", "file_hash_present"].includes(entry.code));
  if (report.verifiedProvenance === true && hasPin && hasFreshTrustedArtifactEvidence(report.evidence)) return "verified";
  return "incomplete";
}

function trustTierColor(tier: ReturnType<typeof trustTier>): string {
  if (tier === "verified") return OK_COLOR;
  if (tier === "conditional") return MUTED_COLOR;
  return ERR_COLOR;
}

function colorize(value: string, color?: string): string {
  if (!color || !process.stdout.isTTY || process.env.NO_COLOR) return value;
  return `${color}${value}\x1b[0m`;
}

function printVerificationReport(report: VerificationReport): void {
  printHeader(`Verification ${verificationOutcome(report)}: ${report.serverName}@${report.serverVersion}`);
  if (report.badges.length) printField("badges", report.badges.join(", "));
  printField("evidence", evidenceSummary(report));
  for (const entry of report.evidence) {
    if (entry.verificationMethod) {
      const anchor = entry.trustAnchor ? ` via ${entry.trustAnchor}` : "";
      printField("method", `${entry.code}: ${entry.verificationMethod}${anchor}`);
    }
  }
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
