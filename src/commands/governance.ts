import { clientsForScope, PROJECT_CLIENTS, selectLaunchTarget, type ClientName } from "../config.js";
import { installableClientsForServer } from "../clientSupport.js";
import { verifyFrozenInstall } from "../ci.js";
import { doctorLockfile } from "../doctor.js";
import { type InstallScope } from "../install.js";
import { listInstalledServers } from "../inventory.js";
import { buildInstallPlan, readLockfile, readLockfileDigest, writeLockfile } from "../plan.js";
import { DEFAULT_LOCKFILE_PATH, DEFAULT_POLICY_PATH, DEFAULT_PROBE_TIMEOUT_MS, DEFAULT_SIGNATURE_PATH } from "../constants.js";
import { enforcePolicy, evaluatePolicy, readPolicy, readPolicyDigest } from "../policy.js";
import { auditSecrets } from "../secrets.js";
import { ciSarifResult, ciSarifResults, sarifLog } from "../sarif.js";
import { readPublicKeyFingerprint, signLockfile, verifyLockfileSignature } from "../signing.js";
import { OK_COLOR, WARN_COLOR } from "../terminalStyle.js";
import { evidenceStatus, evidenceSummary, hasFreshTrustedArtifactEvidence, scoreServer, trustProfileScore, trustTier, trustedArtifactEvidenceProblem } from "../trust.js";
import { compareLockedToLatest } from "../versions.js";
import { verifyServer, type VerificationReport } from "../verify.js";
import type { CapabilityManifest } from "../types.js";
import { CLIENT_USAGE, clientFlag, findExactServer, findServer, hasAnyFlag, hasFlag, isHelp, liveVerificationEnabled, loadServers, lockedHasLivePins, noInstallableClientsError, numberFlag, positional, printBullet, printCapExplanation, printClientSkips, printField, printHeader, printSubhead, scopeDescription, scopeFlag, sourceFlag, stringAnyFlag, stringFlag, verificationOutcome } from "./shared.js";
export async function audit(rest: string[]): Promise<void> {
  const values = positional(rest);
  if (values[0] === "server") {
    await auditServer(rest.filter((value, index) => index !== 0));
    return;
  }
  if (values[0]) {
    console.error("Warning: `toolpin audit <server>` is deprecated; use `toolpin audit server <server>` for a one-server trust report.");
    await auditServer(rest);
    return;
  }

  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const policyPath = stringFlag(rest, "--policy", DEFAULT_POLICY_PATH);
  const scope = scopeFlag(rest, "all");
  const client = hasAnyFlag(rest, ["--client", "-c"]) ? clientFlag(rest, "all" as ClientName) : "all";
  if (scope !== "all" && scope !== "project" && scope !== "global") throw new Error("--scope must be all, project, or global");
  const findings: Array<{ code: string; severity: "info" | "warning" | "critical"; message: string; key?: string }> = [];

  const [inventory, doctorReport, secretsReport, lockfile, policyConfig] = await Promise.all([
    listInstalledServers({ scope, client }),
    doctorLockfile(path, scope).catch((error) => ({ ok: false, checked: 0, issues: [{ key: path, kind: "unreadable" as const, client: "generic" as ClientName, serverName: path, file: path, message: error instanceof Error ? error.message : String(error) }] })),
    auditSecrets(path, scope).catch((error) => ({ ok: false, checked: 0, findings: [{ kind: "unreadable_config" as const, key: path, client: "generic" as ClientName, serverName: path, file: path, message: error instanceof Error ? error.message : String(error) }] })),
    readLockfile(path).catch((error) => {
      findings.push({ code: "lockfile_unreadable", severity: "critical", message: error instanceof Error ? error.message : String(error), key: path });
      return undefined;
    }),
    readPolicy(policyPath).catch((error) => {
      findings.push({ code: "policy_unreadable", severity: "critical", message: error instanceof Error ? error.message : String(error), key: policyPath });
      return undefined;
    }),
  ]);

  for (const issue of inventory.issues) findings.push({ code: `inventory_${issue.kind}`, severity: "critical", message: issue.message, key: issue.file });
  for (const issue of doctorReport.issues) findings.push({ code: `doctor_${issue.kind}`, severity: issue.kind === "drift" || issue.kind === "unreadable" ? "critical" : "warning", message: issue.message, key: issue.key });
  for (const finding of secretsReport.findings) findings.push({ code: `secret_${finding.kind}`, severity: finding.kind === "plaintext_secret" || finding.kind === "secret_prefix" ? "critical" : "warning", message: finding.message, key: finding.key });

  const policyReports = [];
  const verificationReports = [];
  if (lockfile) {
    for (const [key, locked] of Object.entries(lockfile.servers)) {
      const problem = trustedArtifactEvidenceProblem(locked.trust.evidence ?? []);
      const hasArtifactEvidence = (locked.trust.evidence ?? []).some((entry) => entry.code === "oci_digest_verified" || entry.code === "mcpb_sha256_verified" || entry.code === "npm_integrity_verified");
      if (hasArtifactEvidence && problem) findings.push({ code: "verified_evidence_incomplete", severity: "warning", message: `${key}: ${problem}`, key });
      if (hasFlag(rest, "--require-verified") && (locked.trust.verifiedProvenance !== true || !hasFreshTrustedArtifactEvidence(locked.trust.evidence ?? []))) {
        findings.push({ code: "require_verified_failed", severity: "critical", message: `${key}: ${locked.trust.verifiedProvenance === true ? problem : "missing verified provenance"}`, key });
      }

      if (policyConfig) {
        const policyReport = evaluatePolicy(locked, policyConfig);
        policyReports.push(policyReport);
        for (const issue of policyReport.issues) findings.push({ code: `policy_${issue.code}`, severity: "critical", message: issue.message, key: policyReport.key });
      }

      if (hasFlag(rest, "--verify")) {
        try {
          const server = await findExactServer(rest, locked.name, locked.resolved?.source ?? sourceFlag(rest, "all"));
          const liveVerification = liveVerificationEnabled(rest);
          const verification = await verifyServer(server, {
            liveRemoteProbe: liveVerification,
            livePackageProbe: liveVerification,
            allowExecute: hasFlag(rest, "--allow-execute"),
            timeoutMs: numberFlag(rest, "--timeout", DEFAULT_PROBE_TIMEOUT_MS),
            requireVerified: hasFlag(rest, "--require-verified"),
          });
          verificationReports.push(verification);
          if (!verification.ok) findings.push({ code: "verification_failed", severity: "critical", message: `${key}: verification failed`, key });
          if (hasFlag(rest, "--require-verified") && verificationOutcome(verification) !== "verified") {
            findings.push({ code: "require_verified_failed", severity: "critical", message: `${key}: verification is ${verificationOutcome(verification)}`, key });
          }
        } catch (error) {
          findings.push({ code: "verification_unavailable", severity: hasFlag(rest, "--require-verified") ? "critical" : "warning", message: `${key}: ${error instanceof Error ? error.message : String(error)}`, key });
        }
      }
    }
  }

  const report = {
    ok: !findings.some((finding) => finding.severity === "critical"),
    checked: {
      lockfile: lockfile ? Object.keys(lockfile.servers).length : 0,
      inventory: inventory.checked,
      doctor: doctorReport.checked,
      secrets: secretsReport.checked,
    },
    findings,
    inventory,
    doctor: doctorReport,
    secrets: secretsReport,
    policy: policyConfig ? { ok: policyReports.every((entry) => entry.ok), reports: policyReports } : undefined,
    verification: hasFlag(rest, "--verify") ? { ok: verificationReports.every((entry) => entry.ok), reports: verificationReports } : undefined,
  };

  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHeader(report.ok ? "Audit OK" : "Audit findings");
    printField("lockfile", path);
    printField("checked", `${report.checked.lockfile} locked, ${report.checked.inventory} config file(s)`);
    for (const finding of findings) printBullet(`${finding.severity.toUpperCase()}: ${finding.code}${finding.key ? ` ${finding.key}` : ""}: ${finding.message}`);
  }
  if (!report.ok) process.exitCode = 1;
}

export async function auditServer(rest: string[]): Promise<void> {
  const name = positional(rest)[0];
  if (!name) throw new Error("Usage: toolpin audit [--file mcp-lock.json] [--scope all|project|global] [--client all] [--verify] [--allow-execute] [--require-verified] [--json]\n       toolpin audit server <server-name> [--live] [--json]");
  const server = await findServer(rest, name);
  const trust = scoreServer(server);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ kind: "server_trust_report", name: server.name, version: server.version, trust }, null, 2));
    return;
  }
  printHeader(`Server trust report: ${server.name}@${server.version}`);
  printField("trust", `${trustTier(trust)} / ${trustProfileScore(trust)}% profile / ${evidenceStatus(trust)}`);
  printField("evidence", evidenceSummary(trust));
  printCapExplanation(trust);
}

export async function outdated(rest: string[]): Promise<void> {
  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const lockfile = await readLockfile(path);
  const rows = [];
  for (const [key, locked] of Object.entries(lockfile.servers)) {
    const servers = await loadServers(rest, {
      search: locked.name,
      source: locked.resolved?.source ?? sourceFlag(rest, "all"),
    });
    const comparison = compareLockedToLatest(locked.name, locked.version, servers);
    rows.push({
      key,
      name: locked.name,
      client: locked.client,
      source: locked.resolved?.source ?? "unknown",
      locked: locked.version,
      latest: comparison.latestVersion ?? "unknown",
      status: comparison.status,
      previous: comparison.previousVersions.map((entry) => entry.version),
    });
  }

  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ file: path, checked: rows.length, updates: rows.filter((row) => row.status === "update-available").length, servers: rows }, null, 2));
    return;
  }

  printHeader("Outdated check");
  printField("file", path);
  printField("checked", `${rows.length} locked server/client entrie(s)`);
  if (!rows.length) {
    printField("status", "lockfile has no server entries");
    return;
  }
  for (const row of rows) {
    const marker = row.status === "update-available" ? "update available" : row.status;
    printSubhead(`${row.name} (${row.client})`);
    printField("locked", row.locked);
    printField("latest", row.latest);
    printField("status", marker);
    if (row.previous.length) printField("previous", row.previous.slice(0, 5).join(", "));
  }
}

export async function lock(rest: string[]): Promise<void> {
  if (rest[0] === "digest") {
    await lockDigest(rest.slice(1));
    return;
  }
  if (rest[0] === "sign") {
    await lockSign(rest.slice(1));
    return;
  }
  if (rest[0] === "verify-signature") {
    await lockVerifySignature(rest.slice(1));
    return;
  }
  if (rest[0] === "key-fingerprint") {
    await lockKeyFingerprint(rest.slice(1));
    return;
  }

  const values = positional(rest);
  const name = values[0];
  if (!name) throw new Error(`Usage: toolpin lock <server-name> --client ${CLIENT_USAGE} [--live] [--verify [--allow-execute] [--skip-live-verification | --skip-live-verify] [--timeout 15000]]\n       toolpin lock digest [--file mcp-lock.json] [--json]\n       toolpin lock key-fingerprint --public-key public.pem [--json]\n       toolpin lock sign --policy .toolpin/policy.json --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig]\n       toolpin lock verify-signature --policy .toolpin/policy.json --public-key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig]`);

  const client = clientFlag(rest, "generic");
  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const scope = scopeFlag(rest, "project") as InstallScope;
  const server = await findServer(rest, name);
  let verifiedCapabilityManifest: CapabilityManifest | undefined;
  let verificationReport: VerificationReport | undefined;
  if (hasFlag(rest, "--verify")) {
    const liveVerification = liveVerificationEnabled(rest);
    const report = await verifyServer(server, {
      liveRemoteProbe: liveVerification,
      livePackageProbe: liveVerification,
      allowExecute: hasFlag(rest, "--allow-execute"),
      timeoutMs: numberFlag(rest, "--timeout", DEFAULT_PROBE_TIMEOUT_MS),
      requireVerified: hasFlag(rest, "--require-verified"),
    });
    if (!report.ok) {
      throw new Error([
        "Lock refused because verification failed.",
        ...report.issues.map((issue) => `- ${issue.severity}: ${issue.code}: ${issue.message}`),
      ].join("\n"));
    }
    verifiedCapabilityManifest = report.capabilityManifest;
    verificationReport = report;
  }
  let lockfile;
  if (client === "all") {
    const { clients, skipped } = installableClientsForServer(server, PROJECT_CLIENTS);
    printClientSkips(skipped);
    if (!clients.length) throw noInstallableClientsError(server.name, skipped);
    for (const targetClient of clients) {
      lockfile = await writeLockfile(buildInstallPlan(server, targetClient, { scope, capabilityManifest: verifiedCapabilityManifest, verificationReport }), path);
    }
  } else {
    lockfile = await writeLockfile(buildInstallPlan(server, client, { scope, capabilityManifest: verifiedCapabilityManifest, verificationReport }), path);
  }
  printHeader("Lockfile updated");
  printField("server", `${server.name}@${server.version}`);
  printField("file", path);
  printField("entries", `${Object.keys(lockfile?.servers ?? {}).length} server/client entrie(s)`);
}

export async function lockKeyFingerprint(rest: string[]): Promise<void> {
  const keyPath = stringAnyFlag(rest, ["--public-key", "--key"], "");
  if (!keyPath) throw new Error("Usage: toolpin lock key-fingerprint --public-key public.pem [--json]");
  const fingerprint = await readPublicKeyFingerprint(keyPath);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ publicKey: keyPath, fingerprint }, null, 2));
  } else {
    console.log(fingerprint);
  }
}

export async function lockDigest(rest: string[]): Promise<void> {
  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const digest = await readLockfileDigest(path);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ file: path, digest }, null, 2));
  } else {
    console.log(digest);
  }
}

export async function lockSign(rest: string[]): Promise<void> {
  const keyPath = stringFlag(rest, "--key", "");
  const policyPath = stringFlag(rest, "--policy", "");
  if (!keyPath || !policyPath) throw new Error("Usage: toolpin lock sign --policy .toolpin/policy.json --key private.pem [--file mcp-lock.json] [--signature mcp-lock.sig]");
  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const signaturePath = stringFlag(rest, "--signature", DEFAULT_SIGNATURE_PATH);
  const envelope = await signLockfile(path, keyPath, signaturePath, { policyPath });
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ file: path, signature: signaturePath, envelope }, null, 2));
  } else {
    printHeader(`Signed ${path}`);
    printField("file", path);
    printField("digest", envelope.lockfileDigest);
    printField("policy", envelope.policyDigest ?? "none");
    printField("key", envelope.publicKeyFingerprint);
    printField("signature", signaturePath);
  }
}

export async function lockVerifySignature(rest: string[]): Promise<void> {
  const keyPath = stringAnyFlag(rest, ["--public-key", "--key"], "");
  const policyPath = stringFlag(rest, "--policy", "");
  if (!keyPath || !policyPath) throw new Error("Usage: toolpin lock verify-signature --policy .toolpin/policy.json --public-key public.pem [--file mcp-lock.json] [--signature mcp-lock.sig]");
  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const signaturePath = stringFlag(rest, "--signature", DEFAULT_SIGNATURE_PATH);
  const report = await verifyLockfileSignature(path, keyPath, signaturePath, { policyPath });
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify({ file: path, signature: signaturePath, report }, null, 2));
  } else {
    printHeader(`${report.ok ? "OK" : "FAILED"} ${report.message.replace(/\.$/, "")}`);
    printField("file", path);
    printField("signature", signaturePath);
    printField("policy", report.policyDigest ?? "none");
    if (report.publicKeyFingerprint) printField("key", report.publicKeyFingerprint);
    printField("result", report.message);
  }
  if (!report.ok) process.exitCode = 1;
}

export async function ci(rest: string[]): Promise<void> {
  if (isHelp(rest)) {
    ciHelp();
    return;
  }

  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const expectedDigest = stringFlag(rest, "--expect-digest", "");
  const signaturePath = stringFlag(rest, "--signature", "");
  const publicKeyPath = stringFlag(rest, "--public-key", "");
  const verifyBeforeUse = hasFlag(rest, "--verify");
  const requireVerified = hasFlag(rest, "--require-verified");
  const policyPath = stringFlag(rest, "--policy", DEFAULT_POLICY_PATH);
  const enforcePolicies = !hasFlag(rest, "--no-policy");
  const sarif = hasFlag(rest, "--sarif");
  if (signaturePath || publicKeyPath) {
    if (!signaturePath || !publicKeyPath) throw new Error("toolpin ci requires both --signature and --public-key when verifying a lock signature.");
    let signature;
    try {
      signature = await verifyLockfileSignature(path, publicKeyPath, signaturePath, { policyPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (sarif) {
        console.log(JSON.stringify(sarifLog([ciSarifResult("ci_signature_failed", `Lockfile signature verification failed for ${path}: ${message}`, path)], { executionSuccessful: false }), null, 2));
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    if (!signature.ok) {
      if (sarif) {
        console.log(JSON.stringify(sarifLog([ciSarifResult("ci_signature_failed", `Lockfile signature verification failed for ${path}: ${signature.message}`, path)], { executionSuccessful: false }), null, 2));
        process.exitCode = 1;
        return;
      }
      throw new Error(`Lockfile signature verification failed for ${path}: ${signature.message}`);
    }
  }
  if (expectedDigest) {
    const actualDigest = await readLockfileDigest(path);
    if (actualDigest !== expectedDigest) {
      if (sarif) {
        console.log(JSON.stringify(sarifLog([ciSarifResult("ci_digest_mismatch", `Lockfile digest mismatch for ${path}: expected ${expectedDigest}, got ${actualDigest}`, path)], { executionSuccessful: false }), null, 2));
        process.exitCode = 1;
        return;
      }
      throw new Error(`Lockfile digest mismatch for ${path}: expected ${expectedDigest}, got ${actualDigest}`);
    }
  }
  const report = await verifyFrozenInstall(path, async (locked) => {
    const server = await findExactServer(rest, locked.name, locked.resolved?.source ?? sourceFlag(rest, "all"));
    let verifiedCapabilityManifest: CapabilityManifest | undefined;
    let verification: VerificationReport | undefined;
    if (hasAnyFlag(rest, ["--skip-live-verification", "--skip-live-verify"]) && lockedHasLivePins(locked)) {
      throw new Error(`${locked.name} has live capability pins in ${path}; --skip-live-verification is not allowed for pinned CI entries.`);
    }
    if (
      verifyBeforeUse
      && liveVerificationEnabled(rest)
      && !hasFlag(rest, "--allow-execute")
      && lockedHasLivePins(locked)
      && selectLaunchTarget(server)?.kind === "package"
    ) {
      throw new Error(`${locked.name} has live capability pins in ${path}; re-verifying them executes the package. Add --allow-execute to permit execution in CI.`);
    }
    if (verifyBeforeUse) {
      const liveVerification = liveVerificationEnabled(rest);
      verification = await verifyServer(server, {
        liveRemoteProbe: liveVerification,
        livePackageProbe: liveVerification,
        allowExecute: hasFlag(rest, "--allow-execute"),
        timeoutMs: numberFlag(rest, "--timeout", DEFAULT_PROBE_TIMEOUT_MS),
        requireVerified,
      });
      if (!verification.ok) {
        throw new Error([
          `Verification failed for ${locked.name}:`,
          ...verification.issues.map((issue) => `- ${issue.severity}: ${issue.code}: ${issue.message}`),
        ].join("\n"));
      }
      verifiedCapabilityManifest = verification.capabilityManifest;
    }
    const plan = buildInstallPlan(server, locked.client, { capabilityManifest: verifiedCapabilityManifest, verificationReport: verification, scope: locked.scope ?? "project" });
    if (enforcePolicies) {
      const policy = await enforcePolicy(plan, policyPath);
      if (!policy.ok) {
        throw new Error(policy.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
      }
    }
    return plan;
  });

  if (sarif) {
    console.log(JSON.stringify(sarifLog(ciSarifResults(report, path), { executionSuccessful: report.ok }), null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (!report.ok) {
    throw new Error([
      `Frozen install failed for ${path}.`,
      ...report.issues.flatMap((issue) => [`- ${issue.key}:`, ...issue.messages.map((message) => `  - ${message}`)]),
    ].join("\n"));
  }

  printHeader("Frozen install OK");
  printField("file", path);
  printField("checked", `${report.checked} locked server/client entrie(s)`);
}

export async function policy(rest: string[]): Promise<void> {
  const subcommand = rest[0] ?? "help";
  const values = rest.slice(1);
  if (subcommand === "digest") {
    const policyPath = stringFlag(values, "--policy", stringFlag(values, "--file", DEFAULT_POLICY_PATH));
    const digest = await readPolicyDigest(policyPath);
    if (!digest) throw new Error(`Policy file not found: ${policyPath}`);
    if (hasFlag(values, "--json")) {
      console.log(JSON.stringify({ file: policyPath, digest }, null, 2));
    } else {
      console.log(digest);
    }
    return;
  }
  if (subcommand !== "check") {
    throw new Error(`Usage: toolpin policy digest [--policy .toolpin/policy.json] [--json]\n       toolpin policy check <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--policy .toolpin/policy.json] [--json] [--live]`);
  }

  const name = positional(values)[0];
  if (!name) throw new Error(`Usage: toolpin policy check <server-name> --client ${CLIENT_USAGE} [--scope project|global] [--policy .toolpin/policy.json] [--json] [--live]`);

  const client = clientFlag(values, "generic");
  const scope = scopeFlag(values, "project") as InstallScope;
  const policyPath = stringFlag(values, "--policy", DEFAULT_POLICY_PATH);
  if (scope !== "project" && scope !== "global") {
    throw new Error("--scope must be project or global");
  }
  const server = await findServer(values, name);
  const clients = client === "all" ? clientsForScope(scope) : [client];
  const reports = await Promise.all(clients.map(async (targetClient) => enforcePolicy(buildInstallPlan(server, targetClient), policyPath)));

  if (hasFlag(values, "--json")) {
    console.log(JSON.stringify({ ok: reports.every((report) => report.ok), reports }, null, 2));
  } else {
    for (const report of reports) {
      printSubhead(`${report.ok ? "OK" : "DENIED"} ${report.key}`);
      for (const issue of report.issues) printBullet(`${issue.code}: ${issue.message}`);
    }
  }

  if (reports.some((report) => !report.ok)) process.exitCode = 1;
}

export async function secrets(rest: string[]): Promise<void> {
  const subcommand = rest[0] ?? "help";
  const values = rest.slice(1);
  if (subcommand !== "audit") {
    throw new Error("Usage: toolpin secrets audit [--file mcp-lock.json] [--scope all|project|global] [--json]");
  }

  const path = stringFlag(values, "--file", DEFAULT_LOCKFILE_PATH);
  const scope = scopeFlag(values, "all");
  if (scope !== "all" && scope !== "project" && scope !== "global") {
    throw new Error("--scope must be all, project, or global");
  }

  const report = await auditSecrets(path, scope);
  if (hasFlag(values, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    printHeader("Secrets audit OK");
    printField("checked", `${report.checked} locked server/client entrie(s)`);
    printField("scope", scopeDescription(scope));
  } else {
    printHeader("Secrets audit findings");
    printField("findings", String(report.findings.length));
    printField("checked", `${report.checked} locked server/client entrie(s)`);
    for (const finding of report.findings) {
      const secret = finding.secretName ? ` ${finding.secretSource}:${finding.secretName}` : "";
      const scopeLabel = finding.scope ? ` [${finding.scope}]` : "";
      printBullet(`${finding.kind} ${finding.key}${scopeLabel}${secret}: ${finding.message}`);
      printField("file", finding.file || "no file");
      if (finding.redactedValue) printField("value", finding.redactedValue);
    }
  }

  if (!report.ok) process.exitCode = 1;
}

export async function doctor(rest: string[]): Promise<void> {
  if (isHelp(rest)) {
    doctorHelp();
    return;
  }

  const path = stringFlag(rest, "--file", DEFAULT_LOCKFILE_PATH);
  const scope = scopeFlag(rest, "all");
  if (scope !== "all" && scope !== "project" && scope !== "global") {
    throw new Error("--scope must be all, project, or global");
  }

  const report = await doctorLockfile(path, scope);
  if (hasFlag(rest, "--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    printHeader("Doctor OK");
    printField("checked", `${report.checked} locked server/client entrie(s)`);
    printField("scope", scopeDescription(scope));
  } else {
    printHeader("Doctor issues");
    printField("issues", String(report.issues.length));
    printField("checked", `${report.checked} locked server/client entrie(s)`);
    for (const issue of report.issues) {
      const scopeLabel = issue.scope ? ` [${issue.scope}]` : "";
      printBullet(`${issue.kind} ${issue.key}${scopeLabel}: ${issue.message}`);
      printField("file", issue.file);
    }
  }

  if (!report.ok) process.exitCode = 1;
}

export function ciHelp(): void {
  console.log("Usage: toolpin ci [--file mcp-lock.json] [--expect-digest sha256-...] [--signature mcp-lock.sig --public-key public.pem] [--policy .toolpin/policy.json] [--no-policy] [--source toolpin|official|docker|all|id] [--live] [--verify [--require-verified] [--allow-execute] [--skip-live-verification | --skip-live-verify] [--timeout 15000]] [--sarif]");
}

export function doctorHelp(): void {
  console.log("Usage: toolpin doctor [--file mcp-lock.json] [--scope|-s all|project|global] [--global|-g] [--json]");
}
