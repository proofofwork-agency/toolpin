import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { selectLaunchTarget } from "./config.js";
import { DEFAULT_PROBE_TIMEOUT_MS } from "./constants.js";
import { assertSafeUrl, isLoopbackHostname, pinnedFetch } from "./safeFetch.js";
import type { NormalizedServer, RegistryRemote } from "./types.js";
import { TOOLPIN_VERSION } from "./version.js";

export interface ServerTestTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface ServerTestResult {
  ok: boolean;
  serverName: string;
  target: string;
  durationMs: number;
  tools: ServerTestTool[];
  message: string;
}

export interface ServerLaunchPreview {
  kind: "remote" | "stdio";
  target: string;
  envNames: string[];
}

// What `toolpin test` is about to do, so the CLI can print the exact command
// (or remote endpoint) and env var names before anything is executed.
export function previewServerLaunch(server: NormalizedServer): ServerLaunchPreview | undefined {
  const launch = selectLaunchTarget(server);
  if (!launch) return undefined;
  if (launch.kind === "remote") {
    const envNames = (launch.remote.headers ?? [])
      .map((header) => (typeof header.env === "string" ? header.env : extractEnvName(typeof header.value === "string" ? header.value : undefined) ?? header.name))
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    return { kind: "remote", target: launch.remote.url, envNames: [...new Set(envNames)] };
  }
  const local = packageToStdio(launch.pkg);
  return { kind: "stdio", target: [local.command, ...local.args].join(" "), envNames: Object.keys(local.env) };
}

export async function testServer(server: NormalizedServer, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<ServerTestResult> {
  const startedAt = Date.now();
  const launch = selectLaunchTarget(server);

  if (!launch) {
    return fail(server, "none", startedAt, `No launch target is available for ${server.name}.`);
  }

  let client: Client | undefined;
  try {
    if (launch.kind === "remote") {
      await assertRemoteProbeUrlSafe(launch.remote.url);
      const headers = resolveRemoteHeaders(launch.remote);
      if (headers.missing.length) {
        return fail(server, `remote:${launch.remote.type}`, startedAt, `Missing required header/env value: ${headers.missing.join(", ")}`);
      }

      const probeFetch = remoteProbeFetch(launch.remote.url);
      const transport = launch.remote.type === "sse"
        ? new SSEClientTransport(new URL(launch.remote.url), { requestInit: { headers: headers.values }, fetch: probeFetch })
        : new StreamableHTTPClientTransport(new URL(launch.remote.url), { requestInit: { headers: headers.values }, fetch: probeFetch });

      client = new Client({ name: "toolpin", version: TOOLPIN_VERSION });
      await withTimeout(client.connect(transport), timeoutMs, "Timed out connecting to remote MCP server.");
    } else {
      const local = packageToStdio(launch.pkg);
      if (local.missing.length) {
        return fail(server, `stdio:${local.command}`, startedAt, `Missing required env value: ${local.missing.join(", ")}`);
      }

      const transport = new StdioClientTransport({
        command: local.command,
        args: local.args,
        env: { ...minimalSpawnEnv(), ...local.env },
        stderr: "pipe",
      });

      client = new Client({ name: "toolpin", version: TOOLPIN_VERSION });
      await withTimeout(client.connect(transport), timeoutMs, "Timed out starting local MCP server.");
    }

    const response = await withTimeout(client.listTools(), timeoutMs, "Timed out listing MCP tools.");
    const tools = response.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));

    return {
      ok: true,
      serverName: server.name,
      target: launch.kind === "remote" ? `remote:${launch.remote.type}` : `stdio:${launch.pkg.registryType}`,
      durationMs: Date.now() - startedAt,
      tools,
      message: `Connected and listed ${tools.length} tool(s).`,
    };
  } catch (error) {
    return fail(server, launch.kind === "remote" ? `remote:${launch.remote.type}` : `stdio:${launch.pkg.registryType}`, startedAt, error instanceof Error ? error.message : String(error));
  } finally {
    await client?.close().catch(() => undefined);
  }
}

export async function testInstalledClientConfig(serverName: string, config: unknown, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<ServerTestResult> {
  const startedAt = Date.now();
  const launch = installedConfigToLaunch(config);
  if (!launch) {
    return {
      ok: false,
      serverName,
      target: "installed-config",
      durationMs: Date.now() - startedAt,
      tools: [],
      message: `No stdio or remote launch target is available in the installed config for ${serverName}.`,
    };
  }

  let client: Client | undefined;
  try {
    if (launch.kind === "remote") {
      await assertRemoteProbeUrlSafe(launch.url);
      const probeFetch = remoteProbeFetch(launch.url);
      const transport = launch.type === "sse"
        ? new SSEClientTransport(new URL(launch.url), { requestInit: { headers: launch.headers }, fetch: probeFetch })
        : new StreamableHTTPClientTransport(new URL(launch.url), { requestInit: { headers: launch.headers }, fetch: probeFetch });

      client = new Client({ name: "toolpin", version: TOOLPIN_VERSION });
      await withTimeout(client.connect(transport), timeoutMs, "Timed out connecting to installed remote MCP server.");
    } else {
      const transport = new StdioClientTransport({
        command: launch.command,
        args: launch.args,
        env: { ...minimalSpawnEnv(), ...launch.env },
        stderr: "pipe",
      });

      client = new Client({ name: "toolpin", version: TOOLPIN_VERSION });
      await withTimeout(client.connect(transport), timeoutMs, "Timed out starting installed local MCP server.");
    }

    const response = await withTimeout(client.listTools(), timeoutMs, "Timed out listing MCP tools.");
    const tools = response.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));

    return {
      ok: true,
      serverName,
      target: launch.kind === "remote" ? `installed-remote:${launch.type}` : `installed-stdio:${launch.command}`,
      durationMs: Date.now() - startedAt,
      tools,
      message: `Connected and listed ${tools.length} tool(s).`,
    };
  } catch (error) {
    return {
      ok: false,
      serverName,
      target: launch.kind === "remote" ? `installed-remote:${launch.type}` : `installed-stdio:${launch.command}`,
      durationMs: Date.now() - startedAt,
      tools: [],
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client?.close().catch(() => undefined);
  }
}

type InstalledLaunch =
  | { kind: "remote"; type: string; url: string; headers: Record<string, string> }
  | { kind: "stdio"; command: string; args: string[]; env: Record<string, string> };

function installedConfigToLaunch(config: unknown): InstalledLaunch | undefined {
  const record = asRecord(config);
  const url = firstString(record.url, record.httpUrl, record.serverUrl);
  if (url) {
    const headers = asStringRecord(record.headers) ?? asStringRecord(record.http_headers) ?? asStringRecord(asRecord(record.requestOptions).headers) ?? {};
    return { kind: "remote", type: typeof record.type === "string" ? record.type : "streamable-http", url, headers };
  }

  const commandArray = Array.isArray(record.command) ? record.command.filter((value): value is string => typeof value === "string") : undefined;
  const command = typeof record.command === "string" ? record.command : commandArray?.[0];
  if (!command) return undefined;

  const args = Array.isArray(record.args)
    ? record.args.filter((value): value is string => typeof value === "string")
    : commandArray?.slice(1) ?? [];
  const env = asStringRecord(record.env) ?? asStringRecord(record.environment) ?? {};
  return { kind: "stdio", command, args, env };
}

function packageToStdio(pkg: {
  registryType: string;
  identifier: string;
  version?: string;
  runtimeHint?: string;
  command?: string;
  args?: string[];
  packageArguments?: string[];
  environmentVariables?: Array<{ name: string; default?: string; isRequired?: boolean }>;
}): {
  command: string;
  args: string[];
  env: Record<string, string>;
  missing: string[];
} {
  const env = resolvePackageEnv(pkg.environmentVariables ?? []);
  if (typeof pkg.command === "string" && pkg.command.length > 0) {
    return { command: pkg.command, args: Array.isArray(pkg.args) ? pkg.args.filter(isNonEmptyString) : [], env: env.values, missing: env.missing };
  }
  const packageArgs = Array.isArray(pkg.packageArguments) ? pkg.packageArguments.filter(isNonEmptyString) : [];
  switch (pkg.registryType) {
    case "npm": {
      const spec = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
      return pkg.runtimeHint === "bun"
        ? { command: "bunx", args: [spec, ...packageArgs], env: env.values, missing: env.missing }
        : { command: "npx", args: ["-y", spec, ...packageArgs], env: env.values, missing: env.missing };
    }
    case "pypi": {
      const spec = pkg.version ? `${pkg.identifier}==${pkg.version}` : pkg.identifier;
      return { command: "uvx", args: [spec], env: env.values, missing: env.missing };
    }
    case "nuget": {
      const spec = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
      return { command: "dnx", args: [spec], env: env.values, missing: env.missing };
    }
    case "cargo":
      return { command: pkg.identifier, args: packageArgs, env: env.values, missing: env.missing };
    case "oci":
      return {
        command: "docker",
        args: ["run", "--rm", "-i", ...dockerEnvArgs(pkg.environmentVariables ?? []), pkg.identifier],
        env: env.values,
        missing: env.missing,
      };
    case "mcpb":
      return { command: "mcpb", args: ["run", pkg.identifier], env: env.values, missing: env.missing };
    default:
      return { command: pkg.identifier, args: packageArgs, env: env.values, missing: env.missing };
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// Mirror config.ts dockerEnvArgs so a live OCI probe passes declared env vars
// into the container exactly as the installed launcher would (`-e NAME`).
function dockerEnvArgs(variables: Array<{ name: string }>): string[] {
  const names = [...new Set(variables.map((variable) => variable.name).filter(Boolean))];
  return names.flatMap((name) => ["-e", name]);
}

// Before opening a transport to a registry-declared remote MCP URL, apply the
// same SSRF firewall used for artifact fetches. Loopback targets are permitted
// as intentional local runtime/dev fixtures (consistent with verify.ts), but
// every other host must be HTTPS and resolve to a public address — this blocks
// cloud metadata endpoints (169.254.169.254) and internal/private services.
async function assertRemoteProbeUrlSafe(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (isLoopbackHostname(url.hostname)) return;
  await assertSafeUrl(url);
}

// Non-loopback probes route every transport request through pinnedFetch so the
// SSRF check is enforced at connect time (DNS rebinding cannot swap in a
// private address after the preflight). Loopback targets are intentional local
// fixtures and keep the platform fetch.
function remoteProbeFetch(rawUrl: string): typeof pinnedFetch | undefined {
  return isLoopbackHostname(new URL(rawUrl).hostname) ? undefined : pinnedFetch;
}

function resolvePackageEnv(variables: Array<{ name: string; default?: string; isRequired?: boolean }>): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const variable of variables) {
    const current = process.env[variable.name] ?? variable.default;
    if (current) {
      values[variable.name] = current;
    } else if (variable.isRequired !== false) {
      missing.push(variable.name);
    }
  }

  return { values, missing };
}

function resolveRemoteHeaders(remote: RegistryRemote): { values: Record<string, string>; missing: string[] } {
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const header of remote.headers ?? []) {
    const rawValue = typeof header.value === "string" ? header.value : undefined;
    const envName = typeof header.env === "string" ? header.env : extractEnvName(rawValue);
    const envValue = envName ? process.env[envName] : process.env[header.name];
    const resolved = rawValue && envName && envValue ? rawValue.replace(`\${${envName}}`, envValue) : envValue;

    if (resolved) {
      values[header.name] = resolved;
    } else if (header.isRequired !== false) {
      missing.push(envName ?? header.name);
    }
  }

  return { values, missing };
}

function extractEnvName(value?: string): string | undefined {
  const match = value?.match(/\$\{([^}]+)\}/);
  return match?.[1];
}

// Environment passed to spawned MCP server processes. ToolPin probes untrusted
// packages, so we must NOT hand them the caller's full environment (which in CI
// includes GITHUB_TOKEN, npm/cloud credentials, etc.). Start from a minimal set
// of non-secret system variables the runtimes need to function; the caller then
// layers only the server's explicitly-declared env vars on top.
const SPAWN_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LANGUAGE",
  "TERM",
  "TZ",
  // Non-secret infrastructure config that runtimes need to reach daemons and
  // trust stores. These are paths / daemon URLs, not credentials, so they are
  // safe to pass to an untrusted child (unlike proxy vars, which can embed
  // credentials and require the explicit opt-in below).
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
  // Windows
  "SystemRoot",
  "SystemDrive",
  "ComSpec",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "windir",
];

function minimalSpawnEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of SPAWN_ENV_ALLOWLIST) {
    const value = process.env[name];
    if (typeof value === "string") env[name] = value;
  }
  // Locale variables (LC_ALL, LC_CTYPE, ...) are non-secret and affect output.
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith("LC_") && typeof value === "string") env[name] = value;
  }
  // Explicit opt-in passthrough for operators who must expose extra variables
  // to spawned servers (e.g. HTTPS_PROXY with embedded credentials on a
  // corporate network). Off by default so ambient secrets never leak implicitly.
  const extra = process.env.TOOLPIN_SPAWN_ENV_ALLOW;
  if (extra) {
    for (const name of extra.split(",").map((entry) => entry.trim()).filter(Boolean)) {
      const value = process.env[name];
      if (typeof value === "string") env[name] = value;
    }
  }
  return env;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length ? Object.fromEntries(entries) : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fail(server: NormalizedServer, target: string, startedAt: number, message: string): ServerTestResult {
  return {
    ok: false,
    serverName: server.name,
    target,
    durationMs: Date.now() - startedAt,
    tools: [],
    message,
  };
}
