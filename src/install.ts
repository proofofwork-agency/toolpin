import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exportClientConfig, type ClientName } from "./config.js";
import type { NormalizedServer } from "./types.js";

export type InstallScope = "project" | "global";

export interface InstallResult {
  client: ClientName;
  scope: InstallScope;
  file: string;
  serverName: string;
  action: "created" | "updated";
  notes: string[];
}

export async function installServerConfig(
  server: NormalizedServer,
  client: ClientName,
  scope: InstallScope,
): Promise<InstallResult> {
  const exported = exportClientConfig(server, client);
  const target = resolveConfigTarget(client, scope);
  const existing = await readJsonObject(target.file);
  const next = mergeClientConfig(existing, exported.config, client);

  await mkdir(path.dirname(target.file), { recursive: true });
  await writeFile(target.file, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  return {
    client,
    scope,
    file: target.file,
    serverName: server.name,
    action: Object.keys(existing).length === 0 ? "created" : "updated",
    notes: [...target.notes, ...exported.notes],
  };
}

function resolveConfigTarget(client: ClientName, scope: InstallScope): { file: string; notes: string[] } {
  const cwd = process.cwd();
  const home = os.homedir();

  if (scope === "project") {
    switch (client) {
      case "vscode":
        return { file: path.join(cwd, ".vscode", "mcp.json"), notes: ["Project VS Code MCP config written."] };
      case "codex":
        return { file: path.join(cwd, ".mcp.json"), notes: ["Project Codex-compatible MCP config written."] };
      case "opencode":
        return { file: path.join(cwd, "opencode.json"), notes: ["Project opencode config written. Restart opencode to load it."] };
      case "claude":
      case "cursor":
      case "generic":
      default:
        return { file: path.join(cwd, ".mcp.json"), notes: ["Project MCP config written. Import it into clients that support project MCP config."] };
    }
  }

  switch (client) {
    case "opencode":
      return { file: path.join(home, ".config", "opencode", "opencode.json"), notes: ["Global opencode config written. Restart opencode to load it."] };
    case "vscode":
      return { file: path.join(home, ".config", "Code", "User", "mcp.json"), notes: ["Global VS Code user MCP config path written."] };
    case "codex":
      return { file: path.join(home, ".codex", "mcp.json"), notes: ["Global Codex MCP config path written."] };
    case "claude":
    case "cursor":
    case "generic":
    default:
      return { file: path.join(home, ".config", "mpm", `${client}-mcp.json`), notes: ["Generic global MCP config written; client-specific import may still be required."] };
  }
}

function mergeClientConfig(existing: Record<string, unknown>, incoming: unknown, client: ClientName): Record<string, unknown> {
  const incomingObject = asObject(incoming);
  if (client === "opencode") {
    return {
      ...existing,
      ...incomingObject,
      mcp: {
        ...asObject(existing.mcp),
        ...asObject(incomingObject.mcp),
      },
    };
  }

  if (client === "vscode") {
    return {
      ...existing,
      servers: {
        ...asObject(existing.servers),
        ...asObject(incomingObject.servers),
      },
    };
  }

  if (client === "codex") {
    return {
      ...existing,
      mcp_servers: {
        ...asObject(existing.mcp_servers),
        ...asObject(incomingObject.mcp_servers),
      },
    };
  }

  return {
    ...existing,
    mcpServers: {
      ...asObject(existing.mcpServers),
      ...asObject(incomingObject.mcpServers),
    },
  };
}

async function readJsonObject(file: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(file, "utf8");
    return asObject(JSON.parse(raw));
  } catch {
    return {};
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
