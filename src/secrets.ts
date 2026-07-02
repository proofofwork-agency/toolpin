import { readInstalledServerConfig } from "./doctor.js";
import { DEFAULT_LOCKFILE_PATH } from "./constants.js";
import { resolveConfigTarget, type InstallScope } from "./install.js";
import { readLockfile } from "./plan.js";
import type { ClientName } from "./config.js";
import type { CapabilitySecret } from "./types.js";

export type SecretAuditFindingKind = "plaintext_secret" | "secret_prefix" | "missing_config" | "unreadable_config" | "invalid_scope";
export type SecretAuditScope = InstallScope | "all";

export interface SecretAuditFinding {
  kind: SecretAuditFindingKind;
  key: string;
  client: ClientName;
  serverName: string;
  file: string;
  scope?: InstallScope;
  secretName?: string;
  secretSource?: CapabilitySecret["source"];
  message: string;
  redactedValue?: string;
}

export interface SecretAuditReport {
  ok: boolean;
  checked: number;
  findings: SecretAuditFinding[];
}

const SECRET_PREFIXES: Array<{ label: string; pattern: RegExp }> = [
  { label: "GitHub token", pattern: /^(ghp_|github_pat_)/ },
  { label: "OpenAI-style token", pattern: /^sk-[A-Za-z0-9_-]{8,}/ },
  { label: "AWS access key", pattern: /^AKIA[A-Z0-9]{12,}/ },
  { label: "Slack token", pattern: /^xox[baprs]-/ },
  { label: "Google API key", pattern: /^AIza[0-9A-Za-z_-]{8,}/ },
  { label: "private key", pattern: /^-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

export async function auditSecrets(lockfilePath = DEFAULT_LOCKFILE_PATH, scope: SecretAuditScope = "all"): Promise<SecretAuditReport> {
  const lockfile = await readLockfile(lockfilePath);
  const findings: SecretAuditFinding[] = [];
  const entries = Object.entries(lockfile.servers);

  for (const [key, plan] of entries) {
    const missing: Array<{ scope: InstallScope; file: string }> = [];
    const invalidScopes: string[] = [];
    let foundConfig = false;
    let foundUnreadable = false;

    for (const currentScope of scopesToAudit(scope)) {
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
        findings.push({
          kind: "unreadable_config",
          key,
          client: plan.client,
          serverName: plan.name,
          file: target.file,
          scope: currentScope,
          message: actual.message,
        });
        continue;
      }

      foundConfig = true;
      findings.push(...auditConfigSecrets(key, plan.client, plan.name, target.file, currentScope, actual.config, plan.capabilityManifest?.secrets ?? []));
    }

    if (!foundConfig && !foundUnreadable && missing.length > 0) {
      findings.push({
        kind: "missing_config",
        key,
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
      findings.push({
        kind: "invalid_scope",
        key,
        client: plan.client,
        serverName: plan.name,
        file: "",
        message: `cannot audit ${plan.client} at ${scope} scope: ${invalidScopes.join("; ")}`,
      });
    }
  }

  return {
    ok: findings.length === 0,
    checked: entries.length,
    findings,
  };
}

function auditConfigSecrets(
  key: string,
  client: ClientName,
  serverName: string,
  file: string,
  scope: InstallScope,
  config: unknown,
  secretHints: CapabilitySecret[],
): SecretAuditFinding[] {
  const findings: SecretAuditFinding[] = [];
  const plaintextKeys = new Set<string>();

  for (const secret of secretHints) {
    const value = secretValue(config, secret);
    if (typeof value !== "string" || !value) continue;
    if (!isSecretReference(value, secret.name)) {
      plaintextKeys.add(`${secret.source}:${secret.name}`);
      findings.push({
        kind: "plaintext_secret",
        key,
        client,
        serverName,
        file,
        scope,
        secretName: secret.name,
        secretSource: secret.source,
        message: `${secret.source}:${secret.name} is stored as a plaintext value; replace it with a placeholder or external secret reference`,
        redactedValue: redact(value),
      });
    }
  }

  for (const candidate of collectSecretCandidates(config)) {
    if (plaintextKeys.has(`${candidate.source}:${candidate.name}`)) continue;
    const matched = SECRET_PREFIXES.find((prefix) => prefix.pattern.test(candidate.value));
    if (matched) {
      findings.push({
        kind: "secret_prefix",
        key,
        client,
        serverName,
        file,
        scope,
        secretName: candidate.name,
        secretSource: candidate.source,
        message: `${candidate.source}:${candidate.name} resembles a ${matched.label}; replace it with a placeholder or external secret reference`,
        redactedValue: redact(candidate.value),
      });
    }
  }

  return findings;
}

function scopesToAudit(scope: SecretAuditScope): InstallScope[] {
  return scope === "all" ? ["project", "global"] : [scope];
}

function secretValue(config: unknown, secret: CapabilitySecret): unknown {
  const root = asRecord(config);
  if (secret.source === "env") return asRecord(root.env)[secret.name] ?? asRecord(root.environment)[secret.name];
  return asRecord(root.headers)[secret.name] ?? asRecord(root.http_headers)[secret.name] ?? asRecord(asRecord(root.requestOptions).headers)[secret.name];
}

function collectSecretCandidates(config: unknown): Array<{ source: CapabilitySecret["source"]; name: string; value: string }> {
  const root = asRecord(config);
  return [
    ...valuesFromObject(asRecord(root.env), "env"),
    ...valuesFromObject(asRecord(root.environment), "env"),
    ...valuesFromObject(asRecord(root.headers), "header"),
    ...valuesFromObject(asRecord(root.http_headers), "header"),
    ...valuesFromObject(asRecord(asRecord(root.requestOptions).headers), "header"),
  ];
}

function valuesFromObject(value: Record<string, unknown>, source: CapabilitySecret["source"]): Array<{ source: CapabilitySecret["source"]; name: string; value: string }> {
  return Object.entries(value).flatMap(([name, child]) => (typeof child === "string" ? [{ source, name, value: child }] : []));
}

function isSecretReference(value: string, name: string): boolean {
  const trimmed = value.trim();
  const escaped = escapeRegExp(name);
  return (
    trimmed === `<${name}>` ||
    new RegExp(`^\\$\\{env:${escaped}\\}$`).test(trimmed) ||
    new RegExp(`^\\$\\{${escaped}\\}$`).test(trimmed) ||
    new RegExp(`^\\$\\{\\{\\s*secrets\\.${escaped}\\s*\\}\\}$`).test(trimmed) ||
    /^(op|vault|doppler):\/\//.test(trimmed)
  );
}

function redact(_value: string): string {
  return "[REDACTED]";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asRecord(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
