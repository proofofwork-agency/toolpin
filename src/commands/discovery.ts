import { DEFAULT_PROBE_TIMEOUT_MS } from "../constants.js";
import { selectLaunchTarget } from "../config.js";
import { latestOnly, listRegistrySourceStatuses, normalizeEntries, readCacheMetadata, refreshCache, updateRegistrySourceEnabled } from "../registry.js";
import { searchServers } from "../search.js";
import { scanServerMetadata, scanToolDescriptions } from "../scan.js";
import { scanSarifResults, sarifLog, verificationSarifResults } from "../sarif.js";
import { CYAN_COLOR, WARN_COLOR } from "../terminalStyle.js";
import { previewServerLaunch, testServer } from "../tester.js";
import { evidenceStatus, evidenceSummary, scoreServer, trustProfileScore, trustTier } from "../trust.js";
import { truncate } from "../util.js";
import { knownVersions } from "../versions.js";
import { verifyServer } from "../verify.js";
import type { ToolDescriptionScan } from "../types.js";
import { findServer, hasAnyFlag, hasFlag, liveVerificationEnabled, loadServers, numberFlag, positional, printBullet, printCapExplanation, printField, printHeader, printSubhead, printVerificationReport, sourceFlag, verificationOutcome } from "./shared.js";
export async function ingest(rest: string[]): Promise<void> {
  const limit = numberFlag(rest, "--limit", 100);
  const pages = numberFlag(rest, "--pages", 10);
  const source = sourceFlag(rest, "all");
  const result = await refreshCache({ limit, maxPages: pages, source });
  const entries = result.entries;
  console.log(`Cached ${entries.length} registry versions from ${source} in .toolpin/registry-cache.json`);
  if (result.lastError) console.error(`Source diagnostics: ${result.lastError}`);
}

export async function search(rest: string[]): Promise<void> {
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
    printField("source", `${server.registrySource}  trust ${trustTier(result.trust)} / ${trustProfileScore(result.trust)}% profile / ${evidenceStatus(result.trust)}`);
    printField("targets", `packages ${packages}; remotes ${remotes}`);
    printField("evidence", evidenceSummary(result.trust));
    printCapExplanation(result.trust);
    if (result.trust.badges.length) printField("badges", result.trust.badges.join(", "));
  }
}

export async function info(rest: string[]): Promise<void> {
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
  printField("trust", `${trustTier(trust)} / ${trustProfileScore(trust)}% profile / ${evidenceStatus(trust)}`);
  printField("evidence", evidenceSummary(trust));
  printCapExplanation(trust);
  if (trust.gatedBy?.length) printField("gated by", trust.gatedBy.join(", "));
  if (trust.badges.length) printField("badges", trust.badges.join(", "));
  for (const issue of trust.issues) {
    printBullet(`${issue.severity.toUpperCase()}: ${issue.message}`);
  }
}

export async function scan(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: toolpin scan <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--allow-execute] [--json] [--sarif] [--timeout 15000]");

  const server = await findServer(rest, name);
  const generatedAt = new Date().toISOString();
  const scans: ToolDescriptionScan[] = [scanServerMetadata(server, generatedAt)];
  let liveProbe;
  let liveProbeSkipped: string | undefined;
  if (hasFlag(rest, "--live")) {
    // A live probe of a package target executes the package (npx/uvx/docker/...).
    // Like verification, scan must not execute untrusted code implicitly; require
    // --allow-execute. Remote targets connect over the SSRF-guarded transport and
    // never execute anything, so they always probe.
    const isPackageTarget = selectLaunchTarget(server)?.kind === "package";
    if (isPackageTarget && !hasFlag(rest, "--allow-execute")) {
      liveProbeSkipped = "live tool-description scan requires executing the package; rerun with --allow-execute";
      if (!hasAnyFlag(rest, ["--json", "--sarif"])) {
        console.error(`Live probe skipped: ${liveProbeSkipped}. Metadata scan still ran.`);
      }
    } else {
      liveProbe = await testServer(server, numberFlag(rest, "--timeout", DEFAULT_PROBE_TIMEOUT_MS));
      if (liveProbe.ok) {
        scans.push(scanToolDescriptions(liveProbe.tools, { generatedAt }));
      } else if (!hasAnyFlag(rest, ["--json", "--sarif"])) {
        console.error(`Live probe skipped tool-description scan: ${liveProbe.message}`);
      }
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
      liveProbe: liveProbe ? { ok: liveProbe.ok, message: liveProbe.message, toolCount: liveProbe.tools.length } : (liveProbeSkipped ? { ok: false, skipped: true, message: liveProbeSkipped, toolCount: 0 } : undefined),
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

export async function verify(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: toolpin verify <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--json] [--sarif] [--timeout 15000] [--skip-live-verification] [--allow-execute] [--require-verified]");

  const server = await findServer(rest, name);
  const liveVerification = liveVerificationEnabled(rest);
  const report = await verifyServer(server, {
    liveRemoteProbe: liveVerification,
    livePackageProbe: liveVerification,
    allowExecute: hasFlag(rest, "--allow-execute"),
    timeoutMs: numberFlag(rest, "--timeout", DEFAULT_PROBE_TIMEOUT_MS),
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

export async function versions(rest: string[]): Promise<void> {
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

export async function registry(rest: string[]): Promise<void> {
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

export async function test(rest: string[]): Promise<void> {
  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error("Usage: toolpin test <server-name> [--source toolpin|official|docker|all|custom-id] [--live] [--timeout 15000] [--json]");

  const timeout = numberFlag(rest, "--timeout", DEFAULT_PROBE_TIMEOUT_MS);
  const server = await findServer(rest, name);
  const json = hasFlag(rest, "--json");
  if (!json) {
    console.error(`Testing ${server.name}@${server.version} (${server.registrySource}) with ${timeout}ms timeout...`);
  }
  // `test` is an explicit execution command; be transparent about exactly what
  // it runs (or connects to) and which env var names it passes, before launch.
  const preview = previewServerLaunch(server);
  if (preview) {
    const envSuffix = preview.envNames.length ? ` (env: ${preview.envNames.join(", ")})` : "";
    console.error(preview.kind === "stdio"
      ? `Executing: ${preview.target}${envSuffix}`
      : `Connecting to remote MCP endpoint: ${preview.target}${envSuffix}`);
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
