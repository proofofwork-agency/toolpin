export function codexTomlFromClientConfig(config: unknown): string {
  const servers = codexServers(config);
  return Object.entries(servers).map(([serverName, serverConfig]) => serverToToml(serverName, serverConfig)).join("\n\n");
}

export function mergeCodexToml(existing: string, incoming: unknown): string {
  const servers = codexServers(incoming);
  if (Object.keys(servers).length === 0) return existing;

  let next = existing;
  for (const serverName of Object.keys(servers)) {
    next = removeServerTables(next, serverName).toml;
  }

  const prefix = next.trimEnd();
  const fragment = codexTomlFromClientConfig(incoming);
  return `${prefix ? `${prefix}\n\n` : ""}${fragment}\n`;
}

export function removeCodexServerToml(existing: string, serverName: string): string {
  const result = removeServerTables(existing, serverName);
  if (!result.removed) return existing;
  return result.toml ? `${result.toml}\n` : "";
}

function codexServers(config: unknown): Record<string, Record<string, unknown>> {
  const root = asRecord(config);
  const servers = asRecord(root.mcp_servers);
  return Object.fromEntries(
    Object.entries(servers).flatMap(([serverName, value]) => {
      const serverConfig = asRecord(value);
      return Object.keys(serverConfig).length > 0 ? [[serverName, serverConfig]] : [];
    }),
  );
}

function serverToToml(serverName: string, config: Record<string, unknown>): string {
  const table = `mcp_servers.${tomlKey(serverName)}`;
  const scalarLines: string[] = [];
  const nestedTables: string[] = [];

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (isPlainObject(value)) {
      const entries = Object.entries(value).filter((entry): entry is [string, TomlValue] => isTomlValue(entry[1]));
      if (entries.length > 0) {
        nestedTables.push([`[${table}.${tomlKey(key)}]`, ...entries.map(([childKey, childValue]) => `${tomlKey(childKey)} = ${tomlValue(childValue)}`)].join("\n"));
      }
    } else if (isTomlValue(value)) {
      scalarLines.push(`${tomlKey(key)} = ${tomlValue(value)}`);
    }
  }

  return [`[${table}]`, ...scalarLines, ...nestedTables].join("\n");
}

function removeServerTables(existing: string, serverName: string): { toml: string; removed: boolean } {
  // Codex's documented writer uses [mcp_servers.<name>] headers; preserve unrelated TOML forms.
  const lines = existing.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  let removed = false;

  for (const line of lines) {
    const header = line.trim();
    if (header.startsWith("[") && header.endsWith("]")) {
      skipping = isServerTableHeader(header, serverName);
      if (skipping) removed = true;
      if (!skipping) kept.push(line);
      continue;
    }
    if (!skipping) kept.push(line);
  }

  return { toml: kept.join("\n").trimEnd(), removed };
}

function isServerTableHeader(header: string, serverName: string): boolean {
  const tableName = header.slice(1, -1).trim();
  const quoted = tomlKey(serverName);
  const keys = [quoted];
  if (isBareKey(serverName)) keys.push(serverName);
  return keys.some((key) => {
    const prefix = `mcp_servers.${key}`;
    return tableName === prefix || tableName.startsWith(`${prefix}.`);
  });
}

type TomlValue = string | number | boolean | string[];

function isTomlValue(value: unknown): value is TomlValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

function tomlValue(value: TomlValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (typeof value === "boolean") return String(value);
  return `[${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
}

function tomlKey(key: string): string {
  return isBareKey(key) ? key : JSON.stringify(key);
}

function isBareKey(key: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}
