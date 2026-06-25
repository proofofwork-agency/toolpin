import type { NormalizedServer, ToolDescriptionScan, ToolDescriptionScanFinding, TrustIssue } from "./types.js";

export interface ToolDescriptionScanInput {
  name: string;
  description?: string;
}

interface ScanEntry {
  subject: string;
  text: string;
}

const AGENT_DIRECTED_PATTERNS: Array<{ code: string; severity: ToolDescriptionScanFinding["severity"]; pattern: RegExp; label: string }> = [
  {
    code: "agent_instruction_override",
    severity: "warning",
    pattern: /\b(ignore|disregard|override)\s+(all\s+)?(previous|prior|above|system|developer)\s+instructions?\b/i,
    label: "asks the agent to ignore higher-priority instructions",
  },
  {
    code: "agent_hidden_behavior",
    severity: "warning",
    pattern: /\b(do\s+not|don't|never)\s+(tell|inform|notify|mention|reveal)\s+(the\s+)?user\b/i,
    label: "asks the agent to hide behavior from the user",
  },
  {
    code: "agent_forced_tool_order",
    severity: "info",
    pattern: /\b(always|must|required to)\s+(call|use|invoke|run)\s+[a-zA-Z0-9_.:/-]+(\s+first)?\b/i,
    label: "forces tool ordering in descriptive metadata",
  },
];

const HIDDEN_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;

export function scanServerMetadata(server: NormalizedServer, generatedAt = new Date().toISOString()): ToolDescriptionScan {
  return scanToolDescriptions([{ name: server.name, description: server.description }], {
    generatedAt,
    subjectPrefix: "server",
  });
}

export function scanToolDescriptions(
  tools: ToolDescriptionScanInput[],
  options: { generatedAt?: string; subjectPrefix?: string } = {},
): ToolDescriptionScan {
  const entries = tools.map((tool) => ({
    subject: `${options.subjectPrefix ?? "tool"}:${tool.name}`,
    text: `${tool.name}\n${tool.description ?? ""}`,
  }));
  const findings: ToolDescriptionScanFinding[] = [];

  for (const entry of entries) {
    findings.push(...scanEntry(entry));
  }
  findings.push(...duplicateToolFindings(tools, options.subjectPrefix ?? "tool"));
  findings.push(...toolReferenceFindings(tools, options.subjectPrefix ?? "tool"));

  return {
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    scannedDescriptions: tools.length,
    findings: findings.sort((left, right) => `${left.subject}:${left.code}:${left.message}`.localeCompare(`${right.subject}:${right.code}:${right.message}`)),
  };
}

export function scanFindingsToTrustIssues(scan: ToolDescriptionScan): TrustIssue[] {
  return scan.findings.map((finding) => ({
    severity: finding.severity,
    code: finding.code,
    message: `${finding.subject}: ${finding.message}`,
  }));
}

function scanEntry(entry: ScanEntry): ToolDescriptionScanFinding[] {
  const findings: ToolDescriptionScanFinding[] = [];

  if (HIDDEN_CHARACTER_PATTERN.test(entry.text)) {
    findings.push({
      severity: "warning",
      code: "hidden_control_characters",
      subject: entry.subject,
      message: "description contains hidden or control characters",
    });
  }

  for (const detector of AGENT_DIRECTED_PATTERNS) {
    if (detector.pattern.test(entry.text)) {
      findings.push({
        severity: detector.severity,
        code: detector.code,
        subject: entry.subject,
        message: detector.label,
      });
    }
  }

  return findings;
}

function duplicateToolFindings(tools: ToolDescriptionScanInput[], subjectPrefix: string): ToolDescriptionScanFinding[] {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({
      severity: "warning" as const,
      code: "duplicate_tool_name",
      subject: `${subjectPrefix}:${name}`,
      message: `tool name appears ${count} times in this server's tools/list response`,
    }));
}

function toolReferenceFindings(tools: ToolDescriptionScanInput[], subjectPrefix: string): ToolDescriptionScanFinding[] {
  const names = new Set(tools.map((tool) => tool.name));
  const findings: ToolDescriptionScanFinding[] = [];

  for (const tool of tools) {
    const description = tool.description ?? "";
    for (const name of names) {
      if (name === tool.name) continue;
      const escapedName = escapeRegExp(name);
      const pattern = new RegExp(`\\b(always\\s+)?(call|use|invoke|run)\\s+${escapedName}\\b`, "i");
      if (pattern.test(description)) {
        findings.push({
          severity: "info",
          code: "cross_tool_instruction",
          subject: `${subjectPrefix}:${tool.name}`,
          message: `description instructs the agent to use sibling tool ${name}`,
        });
      }
    }
  }

  return findings;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
