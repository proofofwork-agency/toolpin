import { readInstalledServerConfig } from "./doctor.js";
import { resolveConfigTarget, type InstallScope } from "./install.js";
import { readLockfile } from "./plan.js";
import type { CapabilitySecret } from "./types.js";
import type { ClientName } from "./config.js";

export type SecretAuditFindingKind = "plaintext_secret" | "secret_prefix" | "missing_config" | "unreadable_config" | "invalid_scope";

export interface SecretAuditFinding {
  kind: SecretAuditFindingKind;
  key: string;
  client: ClientName;
  serverName: string;
  file: string;
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

export async function auditSecrets(lockfilePath = "mcp-lock.json", scope: InstallScope = "project"): Promise<SecretAuditReport> {
  const lockfile = await readLockfile(lockfilePath);
  const findings: SecretAuditFinding[] = [];
  const entries = Object.entries(lockfile.servers);

  for (const [key, plan] of entries) {
    let target: ReturnType<typeof resolveConfigTarget>;
    try {
      target = resolveConfigTarget(plan.client, scope);
    } catch (error) {
      findings.push({
        kind: "invalid_scope",
        key,
        client: plan.client,
        serverName: plan.name,
        file: "",
        message: `cannot audit ${plan.client} at ${scope} scope: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const actual = await readInstalledServerConfig(target.file, plan.name, plan.client);
    if (actual.kind === "missing") {
      findings.push({
        kind: "missing_config",
        key,
        client: plan.client,
        serverName: plan.name,
        file: target.file,
        message: `missing ${plan.client} config entry for ${plan.name}`,
      });
      continue;
    }
    if (actual.kind === "unreadable") {
      findings.push({
        kind: "unreadable_config",
        key,
        client: plan.client,
        serverName: plan.name,
        file: target.file,
        message: actual.message,
      });
      continue;
    }

    const secretHints = plan.capabilityManifest?.secrets ?? [];
    for (const secret of secretHints) {
      const value = secretValue(actual.config, secret);
      if (typeof value !== "string" || !value) continue;
      if (!isSecretReference(value, secret.name)) {
        findings.push({
          kind: "plaintext_secret",
          key,
          client: plan.client,
          serverName: plan.name,
          file: target.file,
          secretName: secret.name,
          secretSource: secret.source,
          message: `${secret.source}:${secret.name} is stored as a plaintext value; replace it with a placeholder or external secret reference`,
          redactedValue: redact(value),
        });
      }
    }

    for (const candidate of collectSecretCandidates(actual.config)) {
      const matched = SECRET_PREFIXES.find((prefix) => prefix.pattern.test(candidate.value));
      if (matched) {
        findings.push({
          kind: "secret_prefix",
          key,
          client: plan.client,
          serverName: plan.name,
          file: target.file,
          secretName: candidate.name,
          secretSource: candidate.source,
          message: `${candidate.source}:${candidate.name} resembles a ${matched.label}; replace it with a placeholder or external secret reference`,
          redactedValue: redact(candidate.value),
        });
      }
    }
  }

  return {
    ok: findings.length === 0,
    checked: entries.length,
    findings,
  };
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
