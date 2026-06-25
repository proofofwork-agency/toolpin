import { readFile } from "node:fs/promises";
import { readCodexServerConfig } from "./codexToml.js";
import { resolveConfigTarget, type InstallScope } from "./install.js";
import { readLockfile, type InstallPlan } from "./plan.js";
import type { ClientName } from "./config.js";

export type DoctorIssueKind = "missing" | "drift" | "unreadable" | "invalid";

export interface DoctorIssue {
  key: string;
  kind: DoctorIssueKind;
  client: ClientName;
  serverName: string;
  file: string;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  checked: number;
  issues: DoctorIssue[];
}

export async function doctorLockfile(lockfilePath = "mcp-lock.json", scope: InstallScope = "project"): Promise<DoctorReport> {
  const lockfile = await readLockfile(lockfilePath);
  const issues: DoctorIssue[] = [];
  const entries = Object.entries(lockfile.servers);

  for (const [key, plan] of entries) {
    const target = resolveConfigTarget(plan.client, scope);
    const expected = expectedServerConfig(plan);
    if (!expected) {
      issues.push({
        key,
        kind: "invalid",
        client: plan.client,
        serverName: plan.name,
        file: target.file,
        message: "locked plan does not contain a comparable client config entry",
      });
      continue;
    }

    const actual = await readInstalledServerConfig(target.file, plan.name, plan.client);
    if (actual.kind === "missing") {
      issues.push({
        key,
        kind: "missing",
        client: plan.client,
        serverName: plan.name,
        file: target.file,
        message: `missing ${plan.client} config entry for ${plan.name}`,
      });
      continue;
    }
    if (actual.kind === "unreadable") {
      issues.push({
        key,
        kind: "unreadable",
        client: plan.client,
        serverName: plan.name,
        file: target.file,
        message: actual.message,
      });
      continue;
    }
    if (stableJson(actual.config) !== stableJson(expected)) {
      issues.push({
        key,
        kind: "drift",
        client: plan.client,
        serverName: plan.name,
        file: target.file,
        message: `client config entry differs from ${lockfilePath}`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    checked: entries.length,
    issues,
  };
}

function expectedServerConfig(plan: InstallPlan): unknown {
  return serverConfigFromWrapped(plan.locked?.config ?? plan.config, plan.name, plan.client);
}

async function readInstalledServerConfig(
  file: string,
  serverName: string,
  client: ClientName,
): Promise<{ kind: "ok"; config: unknown } | { kind: "missing" } | { kind: "unreadable"; message: string }> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    return { kind: "unreadable", message: error instanceof Error ? error.message : String(error) };
  }

  if (client === "codex") {
    const config = readCodexServerConfig(raw, serverName);
    return config ? { kind: "ok", config } : { kind: "missing" };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const config = serverConfigFromWrapped(parsed, serverName, client);
    return config ? { kind: "ok", config } : { kind: "missing" };
  } catch (error) {
    return {
      kind: "unreadable",
      message: `invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function serverConfigFromWrapped(config: unknown, serverName: string, client: ClientName): unknown {
  const root = asRecord(config);
  const section = client === "opencode" ? "mcp" : client === "vscode" ? "servers" : client === "codex" ? "mcp_servers" : "mcpServers";
  return asRecord(root[section])[serverName];
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(pruneEmptyObjects(value)));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortJson(child)]));
}

function pruneEmptyObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pruneEmptyObjects);
  if (!isRecord(value)) return value;

  const entries = Object.entries(value)
    .map(([key, child]) => [key, pruneEmptyObjects(child)] as const)
    .filter(([, child]) => !isRecord(child) || Object.keys(child).length > 0);

  return Object.fromEntries(entries);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
