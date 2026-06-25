import type { ClientConfig, NormalizedServer, RegistryPackage, RegistryRemote } from "./types.js";

export type ClientName =
  | "claude"
  | "cursor"
  | "vscode"
  | "codex"
  | "opencode"
  | "windsurf"
  | "cline"
  | "gemini"
  | "zed"
  | "roo"
  | "generic";

export const ALL_CLIENTS: ClientName[] = [
  "claude",
  "cursor",
  "vscode",
  "codex",
  "opencode",
  "windsurf",
  "cline",
  "gemini",
  "zed",
  "roo",
  "generic",
];

export const PROJECT_CLIENTS: ClientName[] = ["claude", "cursor", "vscode", "codex", "opencode", "gemini", "roo"];
export const GLOBAL_CLIENTS: ClientName[] = ["claude", "cursor", "vscode", "codex", "opencode", "windsurf", "cline", "gemini"];

export type LaunchTarget = { kind: "remote"; remote: RegistryRemote } | { kind: "package"; pkg: RegistryPackage };

export function exportClientConfig(server: NormalizedServer, client: ClientName): ClientConfig {
  const notes: string[] = [];
  const launch = selectLaunchTarget(server);

  if (!launch) {
    throw new Error(`No package or remote launch target found for ${server.name}@${server.version}`);
  }

  if (launch.kind === "remote") {
    notes.push("Remote server selected; no local runtime install is required.");
    return {
      client,
      serverName: server.name,
      config: wrapClientConfig(client, server.name, {
        type: launch.remote.type,
        url: launch.remote.url,
        headers: headersToInputs(launch.remote, client),
      }),
      notes,
    };
  }

  const localConfig = packageToLocalConfig(launch.pkg, notes, client);
  return {
    client,
    serverName: server.name,
    config: wrapClientConfig(client, server.name, localConfig),
    notes,
  };
}

export function selectLaunchTarget(server: NormalizedServer): LaunchTarget | undefined {
  const remotes = server.raw.remotes ?? [];
  const packages = server.raw.packages ?? [];
  const streamableRemote = remotes.find((remote) => remote.type === "streamable-http");
  if (streamableRemote) return { kind: "remote", remote: streamableRemote };
  if (remotes[0]) return { kind: "remote", remote: remotes[0] };
  const preferredPackage =
    packages.find((pkg) => pkg.registryType === "oci") ??
    packages.find((pkg) => pkg.registryType === "mcpb") ??
    packages[0];
  return preferredPackage ? { kind: "package", pkg: preferredPackage } : undefined;
}

function packageToLocalConfig(pkg: RegistryPackage, notes: string[], client: ClientName): Record<string, unknown> {
  const env = environmentToPlaceholders(pkg, client);

  switch (pkg.registryType) {
    case "npm": {
      const spec = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
      notes.push("Requires Node.js and npm/npx on PATH.");
      return { command: "npx", args: ["-y", spec], env };
    }
    case "pypi": {
      const spec = pkg.version ? `${pkg.identifier}==${pkg.version}` : pkg.identifier;
      notes.push("Requires uv/uvx on PATH.");
      return { command: "uvx", args: [spec], env };
    }
    case "nuget": {
      const spec = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
      notes.push("Requires .NET SDK dnx support on PATH.");
      return { command: "dnx", args: [spec], env };
    }
    case "cargo": {
      notes.push("Requires a prior `cargo install` and compiled binary on PATH.");
      return { command: pkg.identifier, args: [], env };
    }
    case "oci": {
      notes.push("Requires Docker-compatible runtime. Review mounts and network policy before running.");
      return { command: "docker", args: ["run", "--rm", "-i", pkg.identifier], env };
    }
    case "mcpb": {
      notes.push("MCPB bundle requires a compatible MCPB installer/runtime.");
      return { command: "mcpb", args: ["run", pkg.identifier], env };
    }
    default:
      notes.push(`Unknown registry type ${pkg.registryType}; generated a placeholder command.`);
      return { command: pkg.identifier, args: [], env };
  }
}

function environmentToPlaceholders(pkg: RegistryPackage, client: ClientName): Record<string, string> {
  const env: Record<string, string> = {};
  for (const variable of pkg.environmentVariables ?? []) {
    env[variable.name] = variable.default ?? placeholderFor(client, variable.name);
  }
  return env;
}

function headersToInputs(remote: RegistryRemote, client: ClientName): Record<string, string> | undefined {
  if (!remote.headers?.length) return undefined;
  return Object.fromEntries(remote.headers.map((header) => [header.name, placeholderFor(client, header.name)]));
}

function wrapClientConfig(client: ClientName, serverName: string, config: Record<string, unknown>): unknown {
  switch (client) {
    case "vscode":
      return { servers: { [serverName]: config } };
    case "codex":
      return { mcp_servers: { [serverName]: toCodexMcp(config) } };
    case "opencode":
      return { $schema: "https://opencode.ai/config.json", mcp: { [serverName]: toOpenCodeMcp(config) } };
    case "windsurf":
      return { mcpServers: { [serverName]: toWindsurfMcp(config) } };
    case "cline":
      return { mcpServers: { [serverName]: toClineMcp(config) } };
    case "gemini":
      return { mcpServers: { [serverName]: toGeminiMcp(config) } };
    case "zed":
      return { context_servers: { [serverName]: toZedMcp(config) } };
    case "roo":
      return { mcpServers: { [serverName]: toRooMcp(config) } };
    case "claude":
    case "cursor":
    case "generic":
    default:
      return { mcpServers: { [serverName]: config } };
  }
}

export function clientConfigRootKey(client: ClientName): "mcp" | "mcpServers" | "mcp_servers" | "servers" | "context_servers" {
  switch (client) {
    case "opencode":
      return "mcp";
    case "vscode":
      return "servers";
    case "codex":
      return "mcp_servers";
    case "zed":
      return "context_servers";
    case "claude":
    case "cursor":
    case "windsurf":
    case "cline":
    case "gemini":
    case "roo":
    case "generic":
    default:
      return "mcpServers";
  }
}

export function clientsForScope(scope: "project" | "global"): ClientName[] {
  return scope === "project" ? PROJECT_CLIENTS : GLOBAL_CLIENTS;
}

export function isClientName(value: unknown): value is ClientName {
  return ALL_CLIENTS.includes(String(value) as ClientName);
}

function toCodexMcp(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.url === "string") {
    const headers = config.headers;
    return {
      url: config.url,
      ...(headers && typeof headers === "object" && !Array.isArray(headers) ? { http_headers: headers } : {}),
    };
  }

  return {
    command: config.command,
    args: config.args,
    env: config.env,
  };
}

function toOpenCodeMcp(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.url === "string") {
    return {
      type: "remote",
      url: config.url,
      enabled: true,
      headers: config.headers,
    };
  }

  const command = typeof config.command === "string" ? config.command : undefined;
  const args = Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === "string") : [];
  return {
    type: "local",
    command: command ? [command, ...args] : args,
    enabled: true,
    environment: config.env,
  };
}

function toWindsurfMcp(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.url === "string") {
    return omitUndefined({
      serverUrl: config.url,
      headers: config.headers,
    });
  }

  return omitUndefined({
    command: config.command,
    args: config.args,
    env: config.env,
  });
}

function toClineMcp(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.url === "string") {
    return omitUndefined({
      type: config.type === "streamable-http" ? "streamableHttp" : config.type,
      url: config.url,
      headers: config.headers,
      disabled: false,
      autoApprove: [],
    });
  }

  return omitUndefined({
    command: config.command,
    args: config.args,
    env: config.env,
    disabled: false,
    autoApprove: [],
  });
}

function toGeminiMcp(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.url === "string") {
    return omitUndefined({
      ...(config.type === "streamable-http" ? { httpUrl: config.url } : { url: config.url }),
      headers: config.headers,
    });
  }

  return omitUndefined({
    command: config.command,
    args: config.args,
    env: config.env,
  });
}

function toZedMcp(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.url === "string") {
    return omitUndefined({
      url: config.url,
      headers: config.headers,
    });
  }

  return omitUndefined({
    command: config.command,
    args: config.args,
    env: config.env,
  });
}

function toRooMcp(config: Record<string, unknown>): Record<string, unknown> {
  if (typeof config.url === "string") {
    return omitUndefined({
      type: config.type,
      url: config.url,
      headers: config.headers,
      disabled: false,
    });
  }

  return omitUndefined({
    command: config.command,
    args: config.args,
    env: config.env,
    disabled: false,
  });
}

function placeholderFor(client: ClientName, name: string): string {
  switch (client) {
    case "windsurf":
      return `\${env:${name}}`;
    case "gemini":
      return `\${${name}}`;
    case "roo":
      return `<${name}>`;
    case "cline":
    case "zed":
    case "claude":
    case "cursor":
    case "vscode":
    case "codex":
    case "opencode":
    case "generic":
    default:
      return `<${name}>`;
  }
}

function omitUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}
