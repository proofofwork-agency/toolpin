import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { clientsForScope, clientConfigRootKey, type ClientName } from "./config.js";
import { resolveConfigTarget, type InstallScope } from "./install.js";

export type InventoryScope = InstallScope | "all";

export interface InstalledServerEntry {
  client: ClientName;
  scope: InstallScope;
  file: string;
  serverName: string;
}

export interface InventoryIssue {
  client: ClientName;
  scope: InstallScope;
  file?: string;
  kind: "unreadable" | "invalid_scope";
  message: string;
}

export interface InventoryReport {
  ok: boolean;
  checked: number;
  entries: InstalledServerEntry[];
  issues: InventoryIssue[];
}

export async function listInstalledServers(options: { scope?: InventoryScope; client?: ClientName | "all" } = {}): Promise<InventoryReport> {
  const scope = options.scope ?? "all";
  const client = options.client ?? "all";
  const entries: InstalledServerEntry[] = [];
  const issues: InventoryIssue[] = [];
  let checked = 0;

  for (const targetScope of scopesToList(scope)) {
    const clients = client === "all" ? clientsForScope(targetScope) : [client];
    for (const targetClient of clients) {
      let target: { file: string };
      try {
        target = resolveConfigTarget(targetClient, targetScope);
      } catch (error) {
        issues.push({
          client: targetClient,
          scope: targetScope,
          kind: "invalid_scope",
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      checked += 1;
      const names = await readInstalledServerNames(target.file, targetClient);
      if (names.kind === "unreadable") {
        issues.push({
          client: targetClient,
          scope: targetScope,
          file: target.file,
          kind: "unreadable",
          message: names.message,
        });
        continue;
      }

      for (const serverName of names.serverNames) {
        entries.push({ client: targetClient, scope: targetScope, file: target.file, serverName });
      }
    }
  }

  entries.sort((left, right) =>
    left.scope.localeCompare(right.scope)
    || left.client.localeCompare(right.client)
    || left.serverName.localeCompare(right.serverName)
    || left.file.localeCompare(right.file),
  );

  return {
    ok: issues.length === 0,
    checked,
    entries,
    issues,
  };
}

async function readInstalledServerNames(file: string, client: ClientName): Promise<{ kind: "ok"; serverNames: string[] } | { kind: "unreadable"; message: string }> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "ok", serverNames: [] };
    return { kind: "unreadable", message: error instanceof Error ? error.message : String(error) };
  }

  try {
    if (client === "codex") return { kind: "ok", serverNames: listCodexServerNames(raw) };
    if (client === "continue") return { kind: "ok", serverNames: listContinueServerNames(raw) };

    const parsed = parseClientJsonConfig(raw, client);
    const section = asRecord(parsed)[clientConfigRootKey(client)];
    return { kind: "ok", serverNames: Object.keys(asRecord(section)).sort() };
  } catch (error) {
    return {
      kind: "unreadable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseClientJsonConfig(raw: string, client: ClientName): unknown {
  if (!raw.trim()) {
    throw new Error(`${client} MCP config is empty; expected JSON with a "${clientConfigRootKey(client)}" object.`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${client} MCP config is invalid JSON; expected a JSON object with "${clientConfigRootKey(client)}". Parser detail: ${detail}`);
  }
}

function listCodexServerNames(raw: string): string[] {
  const names = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) continue;
    const path = parseTomlPath(trimmed.slice(1, -1).trim());
    if (path[0] === "mcp_servers" && path[1]) names.add(path[1]);
  }
  return [...names].sort();
}

function listContinueServerNames(raw: string): string[] {
  if (!raw.trim()) return [];
  const parsed = parseYaml(raw) as unknown;
  const servers = asRecord(parsed).mcpServers;
  if (!Array.isArray(servers)) return [];
  return servers
    .map((server) => asRecord(server).name)
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .sort();
}

function scopesToList(scope: InventoryScope): InstallScope[] {
  return scope === "all" ? ["project", "global"] : [scope];
}

function parseTomlPath(value: string): string[] {
  const keys: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (const char of value) {
    if (quoted) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        quoted = false;
      }
      continue;
    }

    if (char === ".") {
      keys.push(parseTomlKey(current.trim()) ?? current.trim());
      current = "";
    } else {
      current += char;
      if (char === '"') quoted = true;
    }
  }

  if (current.trim()) keys.push(parseTomlKey(current.trim()) ?? current.trim());
  return keys;
}

function parseTomlKey(value: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
