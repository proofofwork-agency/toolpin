import { createHash } from "node:crypto";
import type { FrozenInstallReport } from "./ci.js";
import type { VerificationReport } from "./verify.js";
import type { ToolDescriptionScan, ToolDescriptionScanFinding, TrustIssue } from "./types.js";

export interface SarifLog {
  version: "2.1.0";
  $schema: "https://json.schemastore.org/sarif-2.1.0.json";
  runs: SarifRun[];
}

interface SarifRun {
  tool: {
    driver: {
      name: "ToolPin";
      informationUri: "https://github.com/proofofwork-agency/toolpin";
      rules: SarifRule[];
    };
  };
  invocations: Array<{
    executionSuccessful: boolean;
    startTimeUtc: string;
  }>;
  results: SarifResult[];
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  helpUri?: string;
  properties: {
    category: "scan" | "verify" | "ci";
    "problem.severity": "error" | "warning" | "note";
  };
}

export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: SarifLocation[];
  partialFingerprints: { toolpinFindingId: string };
}

interface SarifLocation {
  logicalLocations?: Array<{
    name: string;
    fullyQualifiedName: string;
    kind: string;
  }>;
  physicalLocation?: {
    artifactLocation: { uri: string };
  };
}

const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
const HELP_URI = "https://github.com/proofofwork-agency/toolpin#security-model";

const RULES: SarifRule[] = [
  rule("agent_instruction_override", "Agent instruction override", "Registry or tool metadata asks the agent to ignore higher-priority instructions.", "scan", "warning"),
  rule("agent_hidden_behavior", "Hidden agent behavior", "Registry or tool metadata asks the agent to hide behavior from the user.", "scan", "warning"),
  rule("agent_forced_tool_order", "Forced tool order", "Registry or tool metadata tries to force tool invocation order.", "scan", "note"),
  rule("hidden_control_characters", "Hidden control characters", "Registry or tool metadata contains hidden or control characters.", "scan", "warning"),
  rule("duplicate_tool_name", "Duplicate tool name", "A live tools/list response contains duplicate tool names.", "scan", "warning"),
  rule("cross_tool_instruction", "Cross-tool instruction", "A tool description instructs the agent to use a sibling tool.", "scan", "note"),
  rule("no_install_target", "No install target", "The server has no installable package or remote target.", "verify", "error"),
  rule("mutable_oci_tag", "Mutable OCI tag", "An OCI package is not pinned by digest.", "verify", "error"),
  rule("missing_mcpb_hash", "Missing MCPB hash", "An MCPB package is missing fileSha256.", "verify", "error"),
  rule("package_probe_failed", "Package probe failed", "Live package capability verification failed.", "verify", "error"),
  rule("remote_probe_failed", "Remote probe failed", "Live remote capability verification failed.", "verify", "error"),
  rule("remote_probe_skipped", "Remote probe skipped", "Live remote capability verification was skipped.", "verify", "warning"),
  rule("ci_lock_drift", "CI lock drift", "Frozen install verification found lockfile drift or resolver failures.", "ci", "error"),
  rule("ci_digest_mismatch", "CI digest mismatch", "The lockfile digest does not match the expected digest.", "ci", "error"),
  rule("ci_signature_failed", "CI signature failure", "The detached lockfile signature check failed.", "ci", "error"),
];

export function sarifLog(results: SarifResult[], options: { generatedAt?: string; executionSuccessful?: boolean } = {}): SarifLog {
  return {
    version: "2.1.0",
    $schema: SARIF_SCHEMA,
    runs: [
      {
        tool: {
          driver: {
            name: "ToolPin",
            informationUri: "https://github.com/proofofwork-agency/toolpin",
            rules: rulesForResults(results),
          },
        },
        invocations: [
          {
            executionSuccessful: options.executionSuccessful ?? !results.some((result) => result.level === "error"),
            startTimeUtc: options.generatedAt ?? new Date().toISOString(),
          },
        ],
        results,
      },
    ],
  };
}

export function scanSarifResults(scans: ToolDescriptionScan[]): SarifResult[] {
  return scans.flatMap((scan) => scan.findings.map((finding) => resultFromScanFinding(finding)));
}

export function verificationSarifResults(report: VerificationReport): SarifResult[] {
  const normalized = new Map<string, SarifResult>();
  for (const issue of report.issues) {
    const result = resultFromTrustIssue(issue, `server:${report.serverName}`);
    normalized.set(dedupeKey(result), result);
  }
  const embeddedScan = report.capabilityManifest.toolDescriptionScan;
  if (embeddedScan) {
    for (const result of scanSarifResults([embeddedScan])) {
      normalized.set(dedupeKey(result), result);
    }
  }
  return [...normalized.values()];
}

export function ciSarifResults(report: FrozenInstallReport, lockfilePath: string): SarifResult[] {
  return report.issues.flatMap((issue) => issue.messages.map((message) => ciSarifResult("ci_lock_drift", message, lockfilePath, issue.key)));
}

export function ciSarifResult(code: "ci_lock_drift" | "ci_digest_mismatch" | "ci_signature_failed", message: string, lockfilePath: string, subject = lockfilePath): SarifResult {
  return {
    ruleId: code,
    level: "error",
    message: { text: message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: lockfilePath },
        },
        logicalLocations: [
          {
            name: subject,
            fullyQualifiedName: subject,
            kind: "lockfileEntry",
          },
        ],
      },
    ],
    partialFingerprints: fingerprintParts(code, subject, message),
  };
}

function resultFromScanFinding(finding: ToolDescriptionScanFinding): SarifResult {
  return {
    ruleId: finding.code,
    level: levelForSeverity(finding.severity),
    message: { text: finding.message },
    locations: [logicalLocation(finding.subject)],
    partialFingerprints: fingerprintParts(finding.code, finding.subject, finding.message),
  };
}

function resultFromTrustIssue(issue: TrustIssue, fallbackSubject: string): SarifResult {
  const { subject, message } = splitSubject(issue.message, fallbackSubject);
  return {
    ruleId: issue.code,
    level: levelForSeverity(issue.severity),
    message: { text: message },
    locations: [logicalLocation(subject)],
    partialFingerprints: fingerprintParts(issue.code, subject, message),
  };
}

function splitSubject(message: string, fallbackSubject: string): { subject: string; message: string } {
  const match = /^(server|tool):([^:]+):\s+(.+)$/.exec(message);
  if (!match) return { subject: fallbackSubject, message };
  return { subject: `${match[1]}:${match[2]}`, message: match[3] ?? message };
}

function logicalLocation(subject: string): SarifLocation {
  const [kind, ...nameParts] = subject.split(":");
  const name = nameParts.join(":") || subject;
  return {
    logicalLocations: [
      {
        name,
        fullyQualifiedName: subject,
        kind: kind || "server",
      },
    ],
  };
}

function fingerprintParts(code: string, subject: string, message: string): { toolpinFindingId: string } {
  return {
    toolpinFindingId: createHash("sha256").update(`${code}\0${subject}\0${message}`).digest("hex"),
  };
}

function dedupeKey(result: SarifResult): string {
  const subject = result.locations[0]?.logicalLocations?.[0]?.fullyQualifiedName ?? "";
  return `${result.ruleId}\0${subject}\0${result.message.text}`;
}

function rulesForResults(results: SarifResult[]): SarifRule[] {
  const ids = new Set(results.map((result) => result.ruleId));
  const selected = [...RULES];
  for (const id of ids) {
    if (!RULES.some((entry) => entry.id === id)) {
      selected.push(rule(id, id, "ToolPin finding.", "verify", "warning"));
    }
  }
  return selected;
}

function levelForSeverity(severity: TrustIssue["severity"] | ToolDescriptionScanFinding["severity"]): SarifResult["level"] {
  if (severity === "critical") return "error";
  if (severity === "warning") return "warning";
  return "note";
}

function rule(id: string, name: string, description: string, category: SarifRule["properties"]["category"], severity: SarifRule["properties"]["problem.severity"]): SarifRule {
  return {
    id,
    name,
    shortDescription: { text: description },
    helpUri: HELP_URI,
    properties: {
      category,
      "problem.severity": severity,
    },
  };
}
