import type { ClientConfig, NormalizedServer, RegistryPackage, RegistryRemote } from "./types.js";

export type ClientName = "claude" | "cursor" | "vscode" | "codex" | "opencode" | "generic";

export const PROJECT_CLIENTS: ClientName[] = ["claude", "cursor", "vscode", "codex", "opencode"];

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
        headers: headersToInputs(launch.remote),
      }),
      notes,
    };
  }

  const localConfig = packageToLocalConfig(launch.pkg, notes);
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

function packageToLocalConfig(pkg: RegistryPackage, notes: string[]): Record<string, unknown> {
  const env = environmentToPlaceholders(pkg);

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

function environmentToPlaceholders(pkg: RegistryPackage): Record<string, string> {
  const env: Record<string, string> = {};
  for (const variable of pkg.environmentVariables ?? []) {
    env[variable.name] = variable.default ?? `<${variable.name}>`;
  }
  return env;
}

function headersToInputs(remote: RegistryRemote): Record<string, string> | undefined {
  if (!remote.headers?.length) return undefined;
  return Object.fromEntries(remote.headers.map((header) => [header.name, `<${header.name}>`]));
}

function wrapClientConfig(client: ClientName, serverName: string, config: Record<string, unknown>): unknown {
  const mcpServers = { [serverName]: config };

  switch (client) {
    case "vscode":
      return { servers: mcpServers };
    case "codex":
      return { mcp_servers: mcpServers };
    case "opencode":
      return { $schema: "https://opencode.ai/config.json", mcp: { [serverName]: toOpenCodeMcp(config) } };
    case "claude":
    case "cursor":
    case "generic":
    default:
      return { mcpServers };
  }
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
