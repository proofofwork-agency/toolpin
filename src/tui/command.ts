import type { NormalizedServer } from "../types.js";
import { TUI_COMMANDS } from "./constants.js";
import type { TuiCommandId, TuiCommandState } from "./types.js";

export function commandRequiresServer(commandId: TuiCommandId): boolean {
  return TUI_COMMANDS.find((command) => command.id === commandId)?.requiresServer === true;
}

export function commandLineFor(commandId: TuiCommandId, state: TuiCommandState, server?: NormalizedServer): string {
  const source = `--source ${state.sourceMode}`;
  const live = state.dataMode === "live" ? " --live" : "";
  const serverName = server ? shellQuote(server.name) : "<server-name>";
  switch (commandId) {
    case "ingest":
      return `toolpin ingest ${source} --pages 6`;
    case "installed":
      return "toolpin list --scope all --json";
    case "sources":
      return "toolpin registry list";
    case "search":
      return `toolpin search ${shellQuote(state.query || "mcp")} ${source}${live}`;
    case "more-results":
      return "toolpin tui # show more matching results";
    case "reset-view":
      return "toolpin tui # reset view defaults";
    case "info":
      return `toolpin info ${serverName} ${source}${live}`;
    case "audit":
      return `toolpin audit ${serverName} ${source}${live}`;
    case "plan":
      return `toolpin plan ${serverName} --client ${state.client} ${source}${live}`;
    case "install":
      return `toolpin install ${serverName} --client ${state.client} --scope ${state.installScope} ${source}${live}`;
    case "remove":
      return `toolpin remove ${serverName} --client ${state.client} --scope ${state.installScope} --file mcp-lock.json`;
    case "doctor":
      return `toolpin doctor --scope ${state.installScope} --file mcp-lock.json`;
    case "ci":
      return `toolpin ci --file mcp-lock.json ${source}${live}`;
    case "test":
      return `toolpin test ${serverName} ${source}${live} --timeout 15000`;
    case "lock":
      return `toolpin lock ${serverName} --client ${state.client} ${source}${live} --file mcp-lock.json`;
    case "export-config":
      return `toolpin export-config ${serverName} --client ${state.client} ${source}${live}`;
    case "tui":
      return "toolpin tui";
    case "help":
      return "toolpin help";
  }
}

export function shellQuote(value: string): string {
  return /^[a-zA-Z0-9_./:@-]+$/.test(value) ? value : JSON.stringify(value);
}
