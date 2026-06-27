import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { selectLaunchTarget } from "./config.js";
import type { NormalizedServer, RegistryRemote } from "./types.js";

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

export async function testServer(server: NormalizedServer, timeoutMs = 15000): Promise<ServerTestResult> {
  const startedAt = Date.now();
  const launch = selectLaunchTarget(server);

  if (!launch) {
    return fail(server, "none", startedAt, `No launch target is available for ${server.name}.`);
  }

  let client: Client | undefined;
  try {
    if (launch.kind === "remote") {
      const headers = resolveRemoteHeaders(launch.remote);
      if (headers.missing.length) {
        return fail(server, `remote:${launch.remote.type}`, startedAt, `Missing required header/env value: ${headers.missing.join(", ")}`);
      }

      const transport = launch.remote.type === "sse"
        ? new SSEClientTransport(new URL(launch.remote.url), { requestInit: { headers: headers.values } })
        : new StreamableHTTPClientTransport(new URL(launch.remote.url), { requestInit: { headers: headers.values } });

      client = new Client({ name: "toolpin", version: "0.1.0" });
      await withTimeout(client.connect(transport), timeoutMs, "Timed out connecting to remote MCP server.");
    } else {
      const local = packageToStdio(launch.pkg);
      if (local.missing.length) {
        return fail(server, `stdio:${local.command}`, startedAt, `Missing required env value: ${local.missing.join(", ")}`);
      }

      const transport = new StdioClientTransport({
        command: local.command,
        args: local.args,
        env: { ...definedProcessEnv(), ...local.env },
        stderr: "pipe",
      });

      client = new Client({ name: "toolpin", version: "0.1.0" });
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

export async function testInstalledClientConfig(serverName: string, config: unknown, timeoutMs = 15000): Promise<ServerTestResult> {
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
      const transport = launch.type === "sse"
        ? new SSEClientTransport(new URL(launch.url), { requestInit: { headers: launch.headers } })
        : new StreamableHTTPClientTransport(new URL(launch.url), { requestInit: { headers: launch.headers } });

      client = new Client({ name: "toolpin", version: "0.1.0" });
      await withTimeout(client.connect(transport), timeoutMs, "Timed out connecting to installed remote MCP server.");
    } else {
      const transport = new StdioClientTransport({
        command: launch.command,
        args: launch.args,
        env: { ...definedProcessEnv(), ...launch.env },
        stderr: "pipe",
      });

      client = new Client({ name: "toolpin", version: "0.1.0" });
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
      return { command: "docker", args: ["run", "--rm", "-i", pkg.identifier], env: env.values, missing: env.missing };
    case "mcpb":
      return { command: "mcpb", args: ["run", pkg.identifier], env: env.values, missing: env.missing };
    default:
      return { command: pkg.identifier, args: packageArgs, env: env.values, missing: env.missing };
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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

function definedProcessEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
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
