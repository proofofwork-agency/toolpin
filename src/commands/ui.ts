import { TOOLPIN_VERSION } from "../version.js";
import { CLIENT_USAGE } from "./shared.js";

export async function runTui(rest: string[]): Promise<void> {
  if (rest.includes("--help") || rest.includes("-h")) {
    printTuiHelp();
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("toolpin tui requires an interactive terminal: stdin and stdout must both be TTYs.");
  }
  const { runTui: renderTui } = await import("../tui.js");
  renderTui();
}

export async function runInteractive(rest: string[]): Promise<void> {
  const { runInteractive: renderInteractive } = await import("../interactive.js");
  await renderInteractive(rest);
}

export function printTuiHelp(): void {
  console.log(`Usage: toolpin tui

Opens the ToolPin ${TOOLPIN_VERSION} full-screen terminal UI.
Browse rows show evidence labels:
  EVIDENCE   pinned target plus ToolPin-verified npm/OCI/MCPB proof
  REVIEW    useful metadata, but artifact proof is missing/stale/unavailable/declared only
  UNVERIFIED weak or failed pins/evidence, such as mutable OCI or missing MCPB hash
  BLOCKED   critical issue such as no install target or insecure/invalid remote
Browse defaults to source-first ordering: toolpin, official, docker, then other enabled sources.
Use g for the exact source filter and a to cycle sort modes.
Overview top rows are registry metadata summary. The evidence tier, metadata
profile score, pillar scores, and cap reason below explain verification status.`);
}

export function interactiveHelp(): void {
  console.log(`Usage: toolpin interactive [query] [--source id|all] [--live] [--limit 10] [--client ${CLIENT_USAGE}] [--scope project|global] [--version <server-version>] [--verify] [--require-verified] [--timeout 15000] [--policy .toolpin/policy.json] [--no-policy] [--no-input] [--color auto|always|never]
       toolpin i [query] [same options]
       tpn interactive [query]
       tpn i [query]

Guided, scrollback-friendly MCP server search and install review.
Without a TTY it fails closed unless --no-input is provided.
--no-input prints equivalent one-shot command guidance and makes no writes.`);
}
