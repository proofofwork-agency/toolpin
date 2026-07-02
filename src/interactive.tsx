import React, { useMemo, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import { PROJECT_CLIENTS, clientsForScope, exportClientConfig, isClientName, type ClientName } from "./config.js";
import { codexTomlFromClientConfig } from "./codexToml.js";
import { continueYamlFromClientConfig } from "./continueYaml.js";
import { DEFAULT_LOCKFILE_PATH } from "./constants.js";
import { installableClientsForServer } from "./clientSupport.js";
import { installServerConfig, type InstallScope } from "./install.js";
import { buildInstallPlan, readLockfile, writeLockfile, type Lockfile } from "./plan.js";
import { enforcePolicy } from "./policy.js";
import { CacheSchemaError, enrichGlamaTarget, enrichSmitheryTarget, fetchRegistry, latestOnly, listRegistrySources, normalizeEntries, readCache } from "./registry.js";
import { parseColorMode, terminalStyle, type ColorMode } from "./terminalStyle.js";
import { verifyServer, type VerificationReport } from "./verify.js";
import { knownVersions } from "./versions.js";
import type { CapabilityManifest, NormalizedServer, RegistryEntry, RegistrySourceId } from "./types.js";
import {
  DEFAULT_INTERACTIVE_OPTIONS,
  INTERACTIVE_ACTIONS,
  actionWrites,
  buildCommandPreview,
  buildPrefill,
  buildReview,
  interactiveSearch,
  noInputGuidance,
  registryFetchSearchQuery,
  resultLine,
  selectInitialResult,
  type InteractiveAction,
  type InteractiveClient,
  type InteractiveOptions,
} from "./interactive/workflow.js";

interface ParsedInteractiveArgs extends InteractiveOptions {
  noInput: boolean;
  color: ColorMode;
}

interface InteractiveSelection {
  action: InteractiveAction;
  server: NormalizedServer;
  options: InteractiveOptions;
}

type Step = "search" | "review" | "actions" | "confirm" | "help";

export async function runInteractive(rest: string[]): Promise<void> {
  const parsed = parseInteractiveArgs(rest);
  const style = terminalStyle({
    color: parsed.color,
    isTTY: process.stdout.isTTY,
    machineReadable: false,
  });

  if (parsed.noInput) {
    const servers = parsed.query.trim() ? await loadInteractiveServers(parsed) : [];
    const results = interactiveSearch(latestOnly(servers), parsed.query, parsed.limit);
    process.stdout.write(colorNoInputGuidance(noInputGuidance(parsed, results), style));
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("toolpin interactive requires an interactive terminal: stdin and stdout must both be TTYs. Use --no-input to print command guidance without prompts or writes.");
  }

  const [servers, lockfile] = await Promise.all([
    loadInteractiveServers(parsed),
    readLockfile(DEFAULT_LOCKFILE_PATH).catch(() => undefined),
  ]);

  let selection: InteractiveSelection | undefined;
  const app = render(
    <InteractiveApp
      initialOptions={parsed}
      servers={servers}
      lockfile={lockfile}
      style={style}
      onDone={(next) => {
        selection = next;
      }}
    />,
    {
      exitOnCtrlC: false,
    },
  );
  await app.waitUntilExit();
  if (!selection) return;

  if (selection.action === "cancel") {
    console.log("Cancelled. No files were written.");
    return;
  }
  if (selection.action === "print-command") {
    console.log(buildReview(selection.server, selection.options).commandPreview);
    return;
  }
  await executeInteractiveAction(selection);
}

function InteractiveApp(props: {
  initialOptions: ParsedInteractiveArgs;
  servers: NormalizedServer[];
  lockfile?: Lockfile;
  style: ReturnType<typeof terminalStyle>;
  onDone(selection?: InteractiveSelection): void;
}) {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState(props.initialOptions.query);
  const [selected, setSelected] = useState(() => selectInitialResult(interactiveSearch(props.servers, props.initialOptions.query, props.initialOptions.limit), props.initialOptions.query));
  const [client, setClient] = useState<InteractiveClient | undefined>(props.initialOptions.client);
  const [scope, setScope] = useState<InstallScope | undefined>(props.initialOptions.scope);
  const [version, setVersion] = useState<string | undefined>(props.initialOptions.version);
  const [actionIndex, setActionIndex] = useState(0);
  const [message, setMessage] = useState("");

  const results = useMemo(() => interactiveSearch(latestOnly(props.servers), query, props.initialOptions.limit), [props.servers, query, props.initialOptions.limit]);
  const safeSelected = Math.min(Math.max(0, selected), Math.max(0, results.length - 1));
  const selectedServerBase = results[safeSelected]?.server;
  const selectedVersions = useMemo(() => selectedServerBase ? knownVersions(props.servers, selectedServerBase.name) : [], [props.servers, selectedServerBase]);
  const baseOptions: InteractiveOptions = {
    ...props.initialOptions,
    query,
    client,
    scope,
    version,
  };
  const effectiveVersion = selectedServerBase ? buildPrefill(selectedServerBase, baseOptions, props.lockfile).version : undefined;
  const selectedServer = selectedServerBase
    ? props.servers.find((server) => server.name === selectedServerBase.name && server.version === effectiveVersion) ?? selectedServerBase
    : undefined;
  const currentOptions: InteractiveOptions = {
    ...baseOptions,
    client,
    scope,
    version: effectiveVersion,
  };
  const review = selectedServer ? buildReview(selectedServer, currentOptions, props.lockfile, INTERACTIVE_ACTIONS[actionIndex]?.action ?? "install-lock") : undefined;
  const effectiveOptions: InteractiveOptions = review
    ? {
        ...currentOptions,
        client: review.prefill.client,
        scope: review.prefill.scope,
        version: review.prefill.version,
      }
    : currentOptions;

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      props.onDone(undefined);
      exit();
      return;
    }
    if (input === "?") {
      setStep(step === "help" ? "review" : "help");
      return;
    }
    if (input === "/") {
      setStep("search");
      return;
    }
    if (key.escape) {
      if (step === "search") {
        props.onDone({ action: "cancel", server: selectedServer ?? props.servers[0], options: effectiveOptions });
        exit();
      } else {
        setStep(step === "confirm" ? "actions" : "search");
      }
      return;
    }
    if (input === "c") {
      cycleClient();
      return;
    }
    if (input === "s") {
      setScope((value) => {
        const current = value ?? review?.prefill.scope ?? "project";
        return current === "global" ? "project" : "global";
      });
      return;
    }
    if (input === "v") {
      cycleVersion();
      return;
    }
    if (input === "a") {
      setStep("actions");
      return;
    }
    if (key.tab) {
      setStep(step === "search" ? "review" : step === "review" ? "actions" : "search");
      return;
    }

    if (step === "search") {
      if (key.upArrow) setSelected(Math.max(0, safeSelected - 1));
      else if (key.downArrow) setSelected(Math.min(Math.max(0, results.length - 1), safeSelected + 1));
      else if (key.return && selectedServer) setStep("actions");
      else if (key.backspace || key.delete) {
        setQuery((value) => value.slice(0, -1));
        setSelected(0);
      } else if (input && !key.ctrl && !key.meta) {
        setQuery((value) => `${value}${input}`);
        setSelected(0);
      }
      return;
    }

    if (step === "actions") {
      if (key.upArrow) setActionIndex(Math.max(0, actionIndex - 1));
      else if (key.downArrow) setActionIndex(Math.min(INTERACTIVE_ACTIONS.length - 1, actionIndex + 1));
      else if (key.return && selectedServer) {
        const action = INTERACTIVE_ACTIONS[actionIndex].action;
        if (actionWrites(action)) setStep("confirm");
        else {
          props.onDone({ action, server: selectedServer, options: effectiveOptions });
          exit();
        }
      }
      return;
    }

    if (step === "confirm") {
      if (input.toLowerCase() === "y" && selectedServer) {
        props.onDone({ action: INTERACTIVE_ACTIONS[actionIndex].action, server: selectedServer, options: effectiveOptions });
        exit();
      } else if (input.toLowerCase() === "n" || key.return) {
        setMessage("No files written.");
        setStep("actions");
      }
    } else if (key.return && selectedServer) {
      setStep("actions");
    }
  });

  function cycleClient(): void {
    if (!selectedServer) return;
    const targetScope = scope ?? review?.prefill.scope ?? "project";
    const choices: InteractiveClient[] = [...installableClientsForServer(selectedServer, clientsForScope(targetScope)).clients, "all"];
    const current = client ?? review?.prefill.client ?? choices[0];
    const index = Math.max(0, choices.indexOf(current));
    setClient(choices[(index + 1) % choices.length]);
  }

  function cycleVersion(): void {
    if (!selectedVersions.length) return;
    const current = version ?? selectedServer?.version;
    const index = Math.max(0, selectedVersions.findIndex((entry) => entry.version === current));
    setVersion(selectedVersions[(index + 1) % selectedVersions.length].version);
  }

  return (
    <Box flexDirection="column">
      <Text color="cyan">ToolPin interactive</Text>
      <Text color="gray">Search, review the command preview, then explicitly confirm before writes. Press ? for keys.</Text>
      {step === "help" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>Keys: type to search; up/down move; Enter opens actions for the selected row; Tab cycles sections; / returns to search.</Text>
          <Text>Jumps: c client, s scope, v version, a action. Esc backs up; Ctrl-C exits.</Text>
        </Box>
      ) : (
        <>
          <Box marginTop={1}><Text>{stepLabel(step)} Search: {query || "(type a server name)"}</Text></Box>
          {step === "search" ? (
            <Box flexDirection="column" marginTop={1}>
              {results.length ? results.slice(0, props.initialOptions.limit).map((result, index) => (
                <Text key={`${result.server.name}:${result.server.version}:${index}`} color={index === safeSelected ? "cyan" : undefined}>
                  {index === safeSelected ? ">" : " "} {resultLine(result, query)}
                </Text>
              )) : <Text color="yellow">No results. Try `toolpin ingest` or run interactive with --live.</Text>}
              {results.length ? <Text color="gray">Enter opens actions for the highlighted server. Esc exits.</Text> : null}
            </Box>
          ) : null}
          {review ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="cyan">{review.server.name}@{review.prefill.version}</Text>
              <Text>trust {review.trustTier.toUpperCase()} / {review.profileScore}% profile / {review.evidenceLabel}</Text>
              <Text>evidence {review.evidenceSummary}</Text>
              <Text>target {review.targetLabel}</Text>
              <Text>secrets {review.secretsLabel}</Text>
              <Text>client {review.prefill.client}  scope {review.prefill.scope}  action {review.prefill.recommendation}</Text>
              <Text>policy {review.policyLabel}  verify {review.verificationLabel}</Text>
              <Text color="cyan">command {review.commandPreview}</Text>
              {step === "review" ? <Text color="gray">Enter opens actions. / returns to search.</Text> : null}
            </Box>
          ) : null}
          {step === "actions" || step === "confirm" ? (
            <Box flexDirection="column" marginTop={1}>
              {INTERACTIVE_ACTIONS.map((entry, index) => (
                <Text key={entry.action} color={index === actionIndex ? "cyan" : undefined}>
                  {index === actionIndex ? ">" : " "} {entry.label}
                </Text>
              ))}
              {step === "confirm" ? <Text color="yellow">Confirm write action? y/N</Text> : null}
            </Box>
          ) : null}
          {message ? <Text color="yellow">{message}</Text> : null}
        </>
      )}
    </Box>
  );
}

function stepLabel(step: Step): string {
  if (step === "actions") return "[actions]";
  if (step === "confirm") return "[confirm]";
  if (step === "review") return "[review]";
  return "[search]";
}

async function executeInteractiveAction(selection: InteractiveSelection): Promise<void> {
  const { action, server, options } = selection;
  const client = options.client ?? "generic";
  const scope = options.scope ?? "project";
  const clients = client === "all"
    ? installableClientsForServer(server, action === "install-lock" ? clientsForScope(scope) : PROJECT_CLIENTS).clients
    : [client];
  if (!clients.length) throw new Error(`No ToolPin-installable clients are available for ${server.name}.`);

  let verifiedCapabilityManifest: CapabilityManifest | undefined;
  let verificationReport: VerificationReport | undefined;
  if (options.verify) {
    verificationReport = await verifyServer(server, {
      liveRemoteProbe: true,
      livePackageProbe: true,
      // The guided flow never executes a package implicitly; verification uses
      // network artifact checks and remote probes only.
      allowExecute: false,
      timeoutMs: options.timeoutMs,
      requireVerified: options.requireVerified,
    });
    if (!verificationReport.ok) {
      throw new Error([
        `${action === "lock-only" ? "Lock" : "Install"} refused because verification failed.`,
        ...verificationReport.issues.map((issue) => `- ${issue.severity}: ${issue.code}: ${issue.message}`),
      ].join("\n"));
    }
    verifiedCapabilityManifest = verificationReport.capabilityManifest;
  }

  const plans = clients.map((targetClient) => buildInstallPlan(server, targetClient, { scope, capabilityManifest: verifiedCapabilityManifest, verificationReport }));
  if (action === "install-lock" && options.enforcePolicy) {
    for (const plan of plans) {
      const report = await enforcePolicy(plan, options.policyPath);
      if (!report.ok) {
        throw new Error(`Install refused by policy ${options.policyPath}: ${report.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
      }
    }
  }

  if (action === "export-config") {
    if (client === "all") {
      const exported = Object.fromEntries(clients.map((targetClient) => [targetClient, exportClientConfig(server, targetClient).config]));
      console.log(JSON.stringify(exported, null, 2));
      return;
    }
    for (const targetClient of clients) printExportedConfig(server, targetClient);
    return;
  }

  for (const [index, targetClient] of clients.entries()) {
    if (action === "install-lock") {
      const installed = await installServerConfig(server, targetClient, scope);
      console.log(`${installed.action}: ${installed.file}`);
    }
    await writeLockfile(plans[index], DEFAULT_LOCKFILE_PATH);
  }
  console.log(`${action === "lock-only" ? "Locked" : "Installed and locked"} ${server.name}@${server.version} for ${clients.join(", ")}.`);
}

function printExportedConfig(server: NormalizedServer, client: ClientName): void {
  const exported = exportClientConfig(server, client);
  if (client === "codex") {
    console.log(codexTomlFromClientConfig(exported.config));
  } else if (client === "continue") {
    console.log(continueYamlFromClientConfig(exported.config));
  } else {
    console.log(JSON.stringify(exported.config, null, 2));
  }
}

function colorNoInputGuidance(value: string, style: ReturnType<typeof terminalStyle>): string {
  if (!style.color) return value;
  return value
    .replace("ToolPin interactive guidance", style.cyan("ToolPin interactive guidance"))
    .replace("Top result:", style.cyan("Top result:"))
    .replace("Trust:", style.warn("Trust:"))
    .replace("Equivalent one-shot command:", style.cyan("Equivalent one-shot command:"))
    .replace("No files were written.", style.warn("No files were written."));
}

function parseInteractiveArgs(rest: string[]): ParsedInteractiveArgs {
  const query = positional(rest).join(" ");
  const clientValue = stringFlag(rest, "--client", "");
  const scopeValue = stringFlag(rest, "--scope", "");
  const color = parseColorMode(stringFlag(rest, "--color", "auto"));
  const client = clientValue ? parseInteractiveClient(clientValue) : undefined;
  const scope = scopeValue ? parseInteractiveScope(scopeValue) : undefined;
  return {
    ...DEFAULT_INTERACTIVE_OPTIONS,
    query,
    source: sourceFlag(rest, DEFAULT_INTERACTIVE_OPTIONS.source),
    live: hasFlag(rest, "--live"),
    limit: numberFlag(rest, "--limit", DEFAULT_INTERACTIVE_OPTIONS.limit),
    client,
    scope,
    version: stringFlag(rest, "--version", "") || undefined,
    verify: hasFlag(rest, "--verify"),
    requireVerified: hasFlag(rest, "--require-verified"),
    timeoutMs: numberFlag(rest, "--timeout", DEFAULT_INTERACTIVE_OPTIONS.timeoutMs),
    policyPath: stringFlag(rest, "--policy", DEFAULT_INTERACTIVE_OPTIONS.policyPath),
    enforcePolicy: !hasFlag(rest, "--no-policy"),
    noInput: hasFlag(rest, "--no-input"),
    color,
  };
}

async function loadInteractiveServers(options: InteractiveOptions): Promise<NormalizedServer[]> {
  const source = options.source;
  const registrySources = await listRegistrySources();
  const knownSources = new Set(registrySources.map((entry) => entry.id));
  const enabledSources = new Set(registrySources.filter((entry) => entry.enabled).map((entry) => entry.id));
  if (source !== "all" && !knownSources.has(source)) {
    throw new Error(`Unknown registry source: ${source}. Add it to .toolpin/registries.json or run \`toolpin registry list\`.`);
  }
  if (source !== "all" && !enabledSources.has(source)) {
    throw new Error(`Registry source ${source} is disabled. Run \`toolpin registry enable ${source}\` to enable it.`);
  }

  let entries: RegistryEntry[];
  if (options.live) {
    entries = await fetchRegistry({ maxPages: 3, search: registryFetchSearchQuery(options.query, knownSources), source });
  } else {
    try {
      entries = await readCache(undefined, { quiet: true });
      if (!cacheHasSource(entries, source, enabledSources)) {
        entries = await fetchRegistry({ maxPages: 3, search: registryFetchSearchQuery(options.query, knownSources), source });
      }
    } catch (error) {
      if (error instanceof CacheSchemaError) throw error;
      entries = await fetchRegistry({ maxPages: 3, search: registryFetchSearchQuery(options.query, knownSources), source });
    }
  }
  const servers = normalizeEntries(entries);
  const filtered = source === "all"
    ? servers.filter((server) => enabledSources.has(server.registrySource))
    : servers.filter((server) => server.registrySource === source);
  return Promise.all(filtered.map(async (server) => enrichGlamaTarget(await enrichSmitheryTarget(server))));
}

function cacheHasSource(entries: RegistryEntry[], source: RegistrySourceId | "all", enabledSources = new Set<RegistrySourceId>()): boolean {
  const sources = new Set(normalizeEntries(entries).map((server) => server.registrySource));
  return source === "all" ? [...enabledSources].every((enabled) => sources.has(enabled)) : sources.has(source);
}


function parseInteractiveClient(value: string): InteractiveClient {
  if (value === "all" || isClientName(value)) return value as InteractiveClient;
  throw new Error(`--client must be ${CLIENT_USAGE}`);
}

function parseInteractiveScope(value: string): InstallScope {
  if (value === "project" || value === "global") return value;
  throw new Error("--scope must be project or global");
}

function sourceFlag(values: string[], fallback: RegistrySourceId | "all"): RegistrySourceId | "all" {
  const value = stringFlag(values, "--source", fallback);
  if (/^[a-zA-Z0-9._/-]+$/.test(value)) return value as RegistrySourceId | "all";
  throw new Error("--source must be all or a registry source id");
}

function positional(values: string[]): string[] {
  const result: string[] = [];
  const valueFlags = new Set(["--source", "--limit", "--client", "--scope", "--version", "--timeout", "--policy", "--color"]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value.startsWith("-")) {
      if (valueFlags.has(value)) index += 1;
      continue;
    }
    result.push(value);
  }
  return result;
}

function hasFlag(values: string[], flag: string): boolean {
  return values.includes(flag);
}

function stringFlag(values: string[], flag: string, fallback: string): string {
  const index = values.indexOf(flag);
  return index >= 0 ? (values[index + 1] ?? fallback) : fallback;
}

function numberFlag(values: string[], flag: string, fallback: number): number {
  const index = values.indexOf(flag);
  if (index < 0) return fallback;
  const value = values[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a numeric value.`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== value) throw new Error(`${flag} must be a number.`);
  return parsed;
}

const CLIENT_USAGE = "claude|cursor|vscode|codex|opencode|windsurf|cline|continue|gemini|zed|roo|generic|all";
