import { clientsForScope, PROJECT_CLIENTS, type ClientName } from "../config.js";
import { installableClientsForServer } from "../clientSupport.js";
import { DEFAULT_POLICY_PATH, DEFAULT_PROBE_TIMEOUT_MS } from "../constants.js";
import { shellQuote } from "../shellQuote.js";
import { buildInstallPlan, type Lockfile } from "../plan.js";
import { searchServers } from "../search.js";
import { evidenceStatus, evidenceSummary, scoreServer, trustProfileScore, trustTier } from "../trust.js";
import type { InstallScope } from "../install.js";
import type { NormalizedServer, RegistrySourceId, SearchResult } from "../types.js";

export type InteractiveAction = "install-lock" | "lock-only" | "export-config" | "print-command" | "cancel";
export type InteractiveRecommendation = "Install + lock" | "Review" | "Update lock/install";
export type InteractiveClient = ClientName | "all";

export interface InteractiveOptions {
  query: string;
  source: RegistrySourceId | "all";
  live: boolean;
  limit: number;
  client?: InteractiveClient;
  scope?: InstallScope;
  version?: string;
  verify: boolean;
  requireVerified: boolean;
  timeoutMs: number;
  policyPath: string;
  enforcePolicy: boolean;
}

export interface InteractivePrefill {
  client: InteractiveClient;
  scope: InstallScope;
  version: string;
  lockedVersion?: string;
  lockedCurrent: boolean;
  lockedOutdated: boolean;
  recommendation: InteractiveRecommendation;
}

export interface InteractiveReview {
  server: NormalizedServer;
  trustTier: string;
  profileScore: number;
  evidenceLabel: string;
  evidenceSummary: string;
  secretsLabel: string;
  targetLabel: string;
  clientSupportLabel: string;
  policyLabel: string;
  verificationLabel: string;
  prefill: InteractivePrefill;
  commandPreview: string;
}

export interface CommandPreviewOptions {
  action: InteractiveAction;
  server: NormalizedServer;
  client: InteractiveClient;
  scope: InstallScope;
  source: RegistrySourceId | "all";
  version?: string;
  live?: boolean;
  verify?: boolean;
  requireVerified?: boolean;
  timeoutMs?: number;
  policyPath?: string;
  enforcePolicy?: boolean;
}

export const INTERACTIVE_ACTIONS: Array<{ action: InteractiveAction; label: string }> = [
  { action: "install-lock", label: "Install + lock" },
  { action: "lock-only", label: "Lock only" },
  { action: "export-config", label: "Export config" },
  { action: "print-command", label: "Print command" },
  { action: "cancel", label: "Cancel" },
];

export const DEFAULT_INTERACTIVE_OPTIONS: Omit<InteractiveOptions, "query"> = {
  source: "all",
  live: false,
  limit: 10,
  verify: false,
  requireVerified: false,
  timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
  policyPath: DEFAULT_POLICY_PATH,
  enforcePolicy: true,
};

export function interactiveSearch(servers: NormalizedServer[], query: string, limit: number): SearchResult[] {
  const source = query.trim() ? searchServers(servers, query, limit) : servers.slice(0, limit).map((server) => ({
    server,
    relevance: 1,
    trust: scoreServer(server),
  }));
  return source;
}

export function registryFetchSearchQuery(query: string, knownSources: Set<RegistrySourceId>): string | undefined {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const textTerms = terms.filter((term) => !knownSources.has(term.toLowerCase() as RegistrySourceId));
  return textTerms.length ? textTerms.join(" ") : undefined;
}

export function selectInitialResult(results: SearchResult[], query: string): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return 0;
  const exact = results.findIndex((result) => result.server.name.toLowerCase() === normalized || result.server.title.toLowerCase() === normalized);
  return exact >= 0 ? exact : 0;
}

export function resultLine(result: SearchResult, query = ""): string {
  const server = result.server;
  const packages = server.packageTypes.length ? server.packageTypes.join(",") : "none";
  const remotes = server.remoteTypes.length ? server.remoteTypes.join(",") : "none";
  return [
    `${highlightMatch(server.name, query)}@${server.version}`,
    server.title && server.title !== server.name ? highlightMatch(server.title, query) : "",
    `source ${server.registrySource}`,
    `target ${packages}${remotes !== "none" ? `/${remotes}` : ""}`,
    `trust ${trustTier(result.trust).toUpperCase()} ${trustProfileScore(result.trust)}%`,
    `evidence ${evidenceStatus(result.trust).toUpperCase()}`,
    `secrets ${server.requiresSecrets ? "REQUIRED" : "none"}`,
  ].filter(Boolean).join("  ");
}

export function highlightMatch(value: string, query: string): string {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return value;
  let highlighted = value;
  for (const term of terms.sort((a, b) => b.length - a.length)) {
    highlighted = highlighted.replace(new RegExp(escapeRegExp(term), "ig"), (match) => `[${match}]`);
  }
  return highlighted;
}

export function buildPrefill(server: NormalizedServer, options: InteractiveOptions, lockfile?: Lockfile): InteractivePrefill {
  const lockedEntries = Object.values(lockfile?.servers ?? {}).filter((entry) => entry.name === server.name);
  const requestedClient = options.client;
  const scopedEntries = options.scope ? lockedEntries.filter((entry) => entry.scope === options.scope) : lockedEntries;
  const selectedLocked = requestedClient && requestedClient !== "all"
    ? scopedEntries.find((entry) => entry.client === requestedClient)
    : scopedEntries[0] ?? lockedEntries[0];
  const scope = options.scope ?? selectedLocked?.scope ?? "project";
  const client = requestedClient ?? selectedLocked?.client ?? defaultClient(server, scope);
  const lockedVersion = selectedLocked?.version;
  const version = options.version ?? lockedVersion ?? server.version;
  const lockedCurrent = Boolean(selectedLocked && lockedVersion === server.version);
  const lockedOutdated = Boolean(selectedLocked && lockedVersion !== server.version);
  return {
    client,
    scope,
    version,
    lockedVersion,
    lockedCurrent,
    lockedOutdated,
    recommendation: lockedOutdated ? "Update lock/install" : lockedCurrent ? "Review" : "Install + lock",
  };
}

export function buildReview(server: NormalizedServer, options: InteractiveOptions, lockfile?: Lockfile, action: InteractiveAction = "install-lock"): InteractiveReview {
  const trust = scoreServer(server);
  const prefill = buildPrefill(server, options, lockfile);
  return {
    server,
    trustTier: trustTier(trust),
    profileScore: trustProfileScore(trust),
    evidenceLabel: evidenceStatus(trust),
    evidenceSummary: evidenceSummary(trust),
    secretsLabel: secretLabel(server),
    targetLabel: targetLabel(server),
    clientSupportLabel: clientSupportLabel(server, prefill.client, prefill.scope),
    policyLabel: options.enforcePolicy ? `enabled (${options.policyPath})` : "skipped (--no-policy)",
    verificationLabel: options.verify ? `${options.requireVerified ? "required verified" : "requested"} (${options.timeoutMs}ms)` : "skipped",
    prefill,
    commandPreview: buildCommandPreview({
      action,
      server,
      client: prefill.client,
      scope: prefill.scope,
      source: options.source,
      version: prefill.version,
      live: options.live,
      verify: options.verify,
      requireVerified: options.requireVerified,
      timeoutMs: options.timeoutMs,
      policyPath: options.policyPath,
      enforcePolicy: options.enforcePolicy,
    }),
  };
}

export function buildCommandPreview(options: CommandPreviewOptions): string {
  if (options.action === "cancel") return "No command; cancel exits without writes.";
  const action = options.action === "print-command" ? "install-lock" : options.action;
  const args = action === "install-lock"
    ? ["toolpin", "install", options.server.name, "--client", options.client, "--scope", options.scope, "--update-lock"]
    : action === "lock-only"
      ? ["toolpin", "lock", options.server.name, "--client", options.client, "--scope", options.scope]
      : ["toolpin", "export-config", options.server.name, "--client", options.client];

  if (action !== "export-config") {
    args.push("--source", options.source);
  } else {
    args.push("--source", options.source);
  }
  if (options.version) args.push("--version", options.version);
  if (options.live) args.push("--live");
  if (options.verify && action !== "export-config") {
    args.push("--verify");
    if (options.requireVerified) args.push("--require-verified");
    if (options.timeoutMs && options.timeoutMs !== DEFAULT_PROBE_TIMEOUT_MS) args.push("--timeout", String(options.timeoutMs));
  }
  if (action === "install-lock") {
    if (options.enforcePolicy === false) args.push("--no-policy");
    else if (options.policyPath && options.policyPath !== DEFAULT_POLICY_PATH) args.push("--policy", options.policyPath);
  }
  return args.map(shellQuote).join(" ");
}

export function noInputGuidance(options: InteractiveOptions, results: SearchResult[]): string {
  const lines = ["ToolPin interactive guidance (--no-input)", ""];
  if (!options.query.trim()) {
    lines.push("Provide a query to preview a one-shot install command:");
    lines.push("  toolpin interactive <query> --no-input");
    return `${lines.join("\n")}\n`;
  }
  if (!results.length) {
    lines.push(`No registry results found for "${options.query}".`);
    lines.push(`Try: toolpin search ${shellQuote(options.query)} --source ${shellQuote(options.source)}${options.live ? " --live" : ""}`);
    return `${lines.join("\n")}\n`;
  }
  const result = results[selectInitialResult(results, options.query)];
  const review = buildReview(result.server, options);
  lines.push(`Top result: ${result.server.name}@${result.server.version}`);
  lines.push(`Trust: ${review.trustTier.toUpperCase()} ${review.profileScore}% profile; ${review.evidenceLabel}`);
  lines.push(`Secrets: ${review.secretsLabel}`);
  lines.push("");
  lines.push("Equivalent one-shot command:");
  lines.push(`  ${review.commandPreview}`);
  lines.push("");
  lines.push("No files were written.");
  return `${lines.join("\n")}\n`;
}

export function actionWrites(action: InteractiveAction): boolean {
  return action === "install-lock" || action === "lock-only";
}

function defaultClient(server: NormalizedServer, scope: InstallScope): ClientName {
  const installable = installableClientsForServer(server, clientsForScope(scope)).clients;
  const projectFirst = PROJECT_CLIENTS.find((client) => installable.includes(client));
  if (projectFirst) return projectFirst;
  if (installable.includes("claude")) return "claude";
  return installable[0] ?? "generic";
}

function targetLabel(server: NormalizedServer): string {
  const packages = server.packageTypes.length ? `packages ${server.packageTypes.join(",")}` : "";
  const remotes = server.remoteTypes.length ? `remotes ${server.remoteTypes.join(",")}` : "";
  return [packages, remotes].filter(Boolean).join("; ") || "none";
}

function secretLabel(server: NormalizedServer): string {
  const names = [
    ...(server.raw.packages ?? []).flatMap((pkg) => (pkg.environmentVariables ?? []).filter((entry) => entry.isSecret || entry.isRequired).map((entry) => `env:${entry.name}`)),
    ...(server.raw.remotes ?? []).flatMap((remote) => (remote.headers ?? []).filter((entry) => entry.isSecret || entry.isRequired).map((entry) => `header:${entry.name}`)),
  ];
  return names.length ? names.join(", ") : "none";
}

function clientSupportLabel(server: NormalizedServer, client: InteractiveClient, scope: InstallScope): string {
  const clients = client === "all" ? installableClientsForServer(server, clientsForScope(scope)).clients : [client];
  if (!clients.length) return "no ToolPin-installable clients";
  try {
    for (const targetClient of clients) buildInstallPlan(server, targetClient, { scope });
    return `${clients.join(", ")} installable`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
