import { readFile } from "node:fs/promises";
import { canonicalJson } from "./canonicalJson.js";
import { readCodexServerConfig } from "./codexToml.js";
import { clientConfigRootKey } from "./config.js";
import { readContinueServerConfig } from "./continueYaml.js";
import { resolveConfigTarget, type InstallScope } from "./install.js";
import { readLockfile, type InstallPlan } from "./plan.js";
import type { ClientName } from "./config.js";
import { isRecord } from "./util.js";

export type DoctorIssueKind = "missing" | "drift" | "unreadable" | "invalid";

export interface DoctorIssue {
  key: string;
  kind: DoctorIssueKind;
  client: ClientName;
  serverName: string;
  file: string;
  scope?: InstallScope;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  checked: number;
  issues: DoctorIssue[];
}

export type DoctorScope = InstallScope | "all";

export async function doctorLockfile(lockfilePath = "mcp-lock.json", scope: DoctorScope = "all"): Promise<DoctorReport> {
  const lockfile = await readLockfile(lockfilePath);
  const issues: DoctorIssue[] = [];
  const entries = Object.entries(lockfile.servers);

  for (const [key, plan] of entries) {
    const expected = expectedServerConfig(plan);
    if (!expected) {
      issues.push({
        key,
        kind: "invalid",
        client: plan.client,
        serverName: plan.name,
        file: "",
        message: "locked plan does not contain a comparable client config entry",
      });
      continue;
    }

    const missing: Array<{ scope: InstallScope; file: string }> = [];
    const invalidScopes: string[] = [];
    let foundConfig = false;
    let foundUnreadable = false;

    for (const currentScope of scopesToCheck(scope, plan)) {
      let target: ReturnType<typeof resolveConfigTarget>;
      try {
        target = resolveConfigTarget(plan.client, currentScope);
      } catch (error) {
        invalidScopes.push(`${currentScope}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      const actual = await readInstalledServerConfig(target.file, plan.name, plan.client);
      if (actual.kind === "missing") {
        missing.push({ scope: currentScope, file: target.file });
        continue;
      }
      if (actual.kind === "unreadable") {
        foundUnreadable = true;
        issues.push({
          key,
          kind: "unreadable",
          client: plan.client,
          serverName: plan.name,
          file: target.file,
          scope: currentScope,
          message: actual.message,
        });
        continue;
      }

      foundConfig = true;
      if (stableJson(actual.config) !== stableJson(expected)) {
        issues.push({
          key,
          kind: "drift",
          client: plan.client,
          serverName: plan.name,
          file: target.file,
          scope: currentScope,
          message: `client config entry differs from ${lockfilePath}`,
        });
      }
    }

    if (!foundConfig && !foundUnreadable && missing.length > 0) {
      issues.push({
        key,
        kind: "missing",
        client: plan.client,
        serverName: plan.name,
        file: missing.map((entry) => entry.file).join(", "),
        scope: scope === "all" ? undefined : missing[0]?.scope,
        message: scope === "all"
          ? `missing ${plan.client} config entry for ${plan.name} in checked scopes: ${missing.map((entry) => entry.scope).join(", ")}`
          : `missing ${plan.client} config entry for ${plan.name}`,
      });
      continue;
    }

    if (!foundConfig && !foundUnreadable && missing.length === 0 && invalidScopes.length > 0) {
      issues.push({
        key,
        kind: "invalid",
        client: plan.client,
        serverName: plan.name,
        file: "",
        message: `cannot check ${plan.client} at ${scope} scope: ${invalidScopes.join("; ")}`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    checked: entries.length,
    issues,
  };
}

function scopesToCheck(scope: DoctorScope, plan: InstallPlan): InstallScope[] {
  if (scope !== "all") return [scope];
  return plan.scope ? [plan.scope] : ["project", "global"];
}

function expectedServerConfig(plan: InstallPlan): unknown {
  return serverConfigFromWrapped(plan.locked?.config ?? plan.config, plan.name, plan.client);
}

export async function readInstalledServerConfig(
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

  if (client === "continue") {
    try {
      const config = readContinueServerConfig(raw, serverName);
      return config ? { kind: "ok", config } : { kind: "missing" };
    } catch (error) {
      return {
        kind: "unreadable",
        message: `invalid YAML in ${file}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
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
  if (client === "continue") {
    const servers = asRecord(config).mcpServers;
    return Array.isArray(servers) ? servers.find((server) => asRecord(server).name === serverName) : undefined;
  }

  const root = asRecord(config);
  const section = clientConfigRootKey(client);
  return asRecord(root[section])[serverName];
}

function stableJson(value: unknown): string {
  return canonicalJson(value, { pruneEmptyObjects: true });
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
