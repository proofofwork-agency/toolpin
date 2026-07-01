import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { clientConfigRootKey, exportClientConfig, type ClientName } from "./config.js";
import { mergeCodexToml, removeCodexServerToml } from "./codexToml.js";
import { mergeContinueYaml, removeContinueServerYaml } from "./continueYaml.js";
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

export interface RemoveResult {
  client: ClientName;
  scope: InstallScope;
  file: string;
  serverName: string;
  action: "removed" | "missing";
  notes: string[];
}

export async function installServerConfig(
  server: NormalizedServer,
  client: ClientName,
  scope: InstallScope,
): Promise<InstallResult> {
  const exported = exportClientConfig(server, client);
  const target = resolveConfigTarget(client, scope);
  if (client === "codex") {
    const existing = await readText(target.file);
    const next = mergeCodexToml(existing, exported.config);

    await mkdir(path.dirname(target.file), { recursive: true });
    await writeFile(target.file, next, "utf8");

    return {
      client,
      scope,
      file: target.file,
      serverName: server.name,
      action: existing.trim().length === 0 ? "created" : "updated",
      notes: [...target.notes, ...exported.notes],
    };
  }

  if (client === "continue") {
    const existing = await readText(target.file);
    const next = mergeContinueYaml(existing, exported.config);

    await mkdir(path.dirname(target.file), { recursive: true });
    await writeFile(target.file, next, "utf8");

    return {
      client,
      scope,
      file: target.file,
      serverName: server.name,
      action: existing.trim().length === 0 ? "created" : "updated",
      notes: [...target.notes, ...exported.notes],
    };
  }

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

export async function removeServerConfig(
  serverName: string,
  client: ClientName,
  scope: InstallScope,
): Promise<RemoveResult> {
  const target = resolveConfigTarget(client, scope);
  if (client === "codex") {
    const existing = await readText(target.file);
    const next = removeCodexServerToml(existing, serverName);
    if (next === existing) {
      return { client, scope, file: target.file, serverName, action: "missing", notes: target.notes };
    }

    await mkdir(path.dirname(target.file), { recursive: true });
    await writeFile(target.file, next, "utf8");
    return { client, scope, file: target.file, serverName, action: "removed", notes: target.notes };
  }

  if (client === "continue") {
    const existing = await readText(target.file);
    const next = removeContinueServerYaml(existing, serverName);
    if (next === existing) {
      return { client, scope, file: target.file, serverName, action: "missing", notes: target.notes };
    }

    await mkdir(path.dirname(target.file), { recursive: true });
    await writeFile(target.file, next, "utf8");
    return { client, scope, file: target.file, serverName, action: "removed", notes: target.notes };
  }

  const existing = await readJsonObject(target.file);
  const { config: next, removed } = removeClientConfig(existing, serverName, client);
  if (!removed) {
    return { client, scope, file: target.file, serverName, action: "missing", notes: target.notes };
  }

  await mkdir(path.dirname(target.file), { recursive: true });
  await writeFile(target.file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { client, scope, file: target.file, serverName, action: "removed", notes: target.notes };
}

export function resolveConfigTarget(client: ClientName, scope: InstallScope): { file: string; notes: string[] } {
  const cwd = process.cwd();
  const home = os.homedir();

  if (scope === "project") {
    switch (client) {
      case "vscode":
        return { file: path.join(cwd, ".vscode", "mcp.json"), notes: ["Project VS Code MCP config written."] };
      case "codex":
        return { file: path.join(cwd, ".codex", "config.toml"), notes: ["Project Codex config.toml written. Project must be trusted by Codex before this layer loads."] };
      case "opencode":
        return { file: path.join(cwd, "opencode.json"), notes: ["Project opencode config written. Restart opencode to load it."] };
      case "cursor":
        return { file: path.join(cwd, ".cursor", "mcp.json"), notes: ["Project Cursor MCP config written. Restart Cursor or reload MCP servers to load it."] };
      case "gemini":
        return { file: path.join(cwd, ".gemini", "settings.json"), notes: ["Project Gemini CLI settings.json written."] };
      case "roo":
        return { file: path.join(cwd, ".roo", "mcp.json"), notes: ["Project Roo Code MCP config written."] };
      case "windsurf":
        throw new Error("Project Windsurf/Cascade MCP config path is not documented; use --scope global.");
      case "cline":
        throw new Error("Project Cline MCP config path is not documented; use --scope global.");
      case "continue":
        throw new Error("Project Continue config path is not documented; use --scope global.");
      case "zed":
        throw new Error("Zed settings path is not verified yet; export the config snippet and add it through Zed settings.");
      case "generic":
      default:
        return { file: path.join(cwd, ".mcp.json"), notes: ["Project MCP config written. Import it into clients that support project MCP config."] };
    }
  }

  switch (client) {
    case "opencode":
      return { file: path.join(home, ".config", "opencode", "opencode.json"), notes: ["Global opencode config written. Restart opencode to load it."] };
    case "cursor":
      return { file: path.join(home, ".cursor", "mcp.json"), notes: ["Global Cursor MCP config written. Restart Cursor or reload MCP servers to load it."] };
    case "vscode":
      return { file: vsCodeGlobalConfigFile(home), notes: ["Global VS Code user MCP config path written."] };
    case "codex":
      return { file: path.join(home, ".codex", "config.toml"), notes: ["Global Codex config.toml written."] };
    case "windsurf":
      return { file: path.join(home, ".codeium", "windsurf", "mcp_config.json"), notes: ["Global Windsurf/Cascade MCP config written. Restart Windsurf to load it."] };
    case "cline":
      return { file: path.join(home, ".cline", "mcp.json"), notes: ["Global Cline CLI MCP config written. Reload Cline to load it."] };
    case "continue":
      return { file: path.join(home, ".continue", "config.yaml"), notes: ["Global Continue config.yaml written. Continue reloads config on save."] };
    case "gemini":
      return { file: path.join(home, ".gemini", "settings.json"), notes: ["Global Gemini CLI settings.json written."] };
    case "zed":
      throw new Error("Zed settings path is not verified yet; export the config snippet and add it through Zed settings.");
    case "roo":
      throw new Error("Global Roo Code mcp_settings.json path is not verified yet; use --scope project.");
    case "claude":
      throw new Error("Claude global MCP config is managed by the Claude CLI and is not written directly by ToolPin; use `toolpin export-config ... --client claude` with `claude mcp add-json --scope user`, or use --scope project.");
    case "generic":
    default:
      return { file: path.join(home, ".config", "toolpin", `${client}-mcp.json`), notes: ["Generic global MCP config written; client-specific import may still be required."] };
  }
}

function removeClientConfig(existing: Record<string, unknown>, serverName: string, client: ClientName): { config: Record<string, unknown>; removed: boolean } {
  const next = { ...existing };
  const key = clientConfigRootKey(client);
  const servers = { ...asObject(next[key]) };
  if (!(serverName in servers)) return { config: existing, removed: false };
  delete servers[serverName];
  next[key] = servers;
  return { config: next, removed: true };
}

function mergeClientConfig(existing: Record<string, unknown>, incoming: unknown, client: ClientName): Record<string, unknown> {
  const incomingObject = asObject(incoming);
  const key = clientConfigRootKey(client);
  const next = { ...existing };
  if (client === "opencode" && typeof next.$schema !== "string" && typeof incomingObject.$schema === "string") {
    next.$schema = incomingObject.$schema;
  }
  next[key] = {
    ...asObject(existing[key]),
    ...asObject(incomingObject[key]),
  };
  return next;
}

export function vsCodeGlobalConfigFile(
  home = os.homedir(),
  platform: NodeJS.Platform = process.platform,
  appData = process.env.APPDATA,
): string {
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Code", "User", "mcp.json");
  }
  if (platform === "win32") {
    return path.join(appData || path.join(home, "AppData", "Roaming"), "Code", "User", "mcp.json");
  }
  return path.join(home, ".config", "Code", "User", "mcp.json");
}

async function readJsonObject(file: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot read existing config at ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (raw.trim().length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Fail closed: never silently treat an unparseable file as empty and
    // overwrite it — that would destroy unrelated server entries the user has.
    throw new Error(`Refusing to overwrite ${file}: it is not valid JSON (${error instanceof Error ? error.message : String(error)}). Fix or remove the file, then retry.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Refusing to overwrite ${file}: expected a JSON object at the top level. Fix or remove the file, then retry.`);
  }
  return parsed as Record<string, unknown>;
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
